"""Rasterize named CAD layers in PDF page coordinates and keep door symbols separate."""

import cv2
import numpy as np
from doors import SCALE, arc_chains, door_sweep, score_ink


def _polyline(item, matrix):
    op = item[0]
    if op == "re":
        r = item[1]
        points = (r.tl, r.tr, r.br, r.bl, r.tl)
    elif op == "qu":
        q = item[1]
        points = (q.ul, q.ur, q.lr, q.ll, q.ul)
    else:
        points = item[1:]
    xy = np.array([list(p * matrix) for p in points])
    if op == "c":
        a, b, c, d = xy
        t = np.linspace(0, 1, 11)[:, None]
        return (
            (1 - t) ** 3 * a
            + 3 * (1 - t) ** 2 * t * b
            + 3 * (1 - t) * t**2 * c
            + t**3 * d
        )
    return xy


def _stroke(shape, lines, mask):
    width = max(1, round((shape.get("width") or 0) * SCALE))
    contours = []
    for line in lines:
        points = np.rint(line * SCALE).astype(np.int32)
        if contours and np.array_equal(contours[-1][-1], points[0]):
            contours[-1] = np.concatenate([contours[-1], points[1:]])
        else:
            contours.append(points)
    if "f" in shape["type"]:
        cv2.fillPoly(mask, contours, 255)
    cv2.polylines(mask, contours, shape.get("closePath", False), 255, width)


class CadLayers:
    def __init__(self, page, config, door_sills=()):
        shape = (round(page.rect.height * SCALE), round(page.rect.width * SCALE))
        self.walls = np.zeros(shape, np.uint8)
        self.objects = np.zeros_like(self.walls)
        self.door_ink = np.zeros_like(self.walls)
        self.door_lines = np.zeros_like(self.walls)
        self.door_curves = []
        structure = set(config["partition"])
        swing = set(config["doors"])
        ignore = set(config["annotation"])
        seen = set()
        geometries = []
        self.sills = [(record, 0) for record in door_sills]
        for drawing in page.get_drawings():
            name = drawing.get("layer", "").split("|")[-1].upper()
            seen.add(name)
            if name in ignore:
                continue
            lines = [_polyline(item, page.rotation_matrix) for item in drawing["items"]]
            if self.sills and name in structure:
                keep = []
                for line in lines:
                    matched = False
                    for i, (sill, count) in enumerate(self.sills):
                        expected = np.asarray(sill["line"])
                        if (
                            sill["layer"] == "PLAN CONCRETE"
                            and name == sill["layer"]
                            and len(line) == 2
                            and drawing["type"] == "s"
                            and (drawing["width"] or 0) < 0.2
                            and (
                                np.allclose(line, expected, rtol=0, atol=0.025)
                                or np.allclose(line[::-1], expected, rtol=0, atol=0.025)
                            )
                        ):
                            self.sills[i] = (sill, count + 1)
                            matched = True
                            break
                    if not matched:
                        keep.append(line)
                lines = keep
            if not lines:
                continue
            if name in swing:
                _stroke(drawing, lines, self.door_ink)
                straight = [p for i, p in zip(drawing["items"], lines) if i[0] != "c"]
                if straight:
                    _stroke(drawing, straight, self.door_lines)
                # PDF exporters can use two cubic segments for one physical
                # leaf. Preserve that path before joining fragments across shapes.
                if (
                    len(lines) > 1
                    and all(item[0] == "c" for item in drawing["items"])
                    and all(
                        np.linalg.norm(left[-1] - right[0]) < 0.05
                        for left, right in zip(lines, lines[1:])
                    )
                ):
                    self.door_curves.append(
                        np.concatenate([lines[0], *[q[1:] for q in lines[1:]]])
                    )
                for item, points in zip(drawing["items"], lines):
                    if item[0] == "c":
                        self.door_curves.append(points)
                    if item[0] not in ("c", "l"):
                        continue
                    geometries.append(
                        {
                            "kind": "curve",
                            "filled": False,
                            "path": [["m", points[0]], *[["l", p] for p in points[1:]]],
                        }
                    )
            else:
                _stroke(
                    drawing, lines, self.walls if name in structure else self.objects
                )
        if (structure | swing) - seen:
            raise ValueError(
                "The selected CAD layers are missing from the current sheet."
            )
        self.door_curves.extend(arc_chains({"primitives": geometries}))

    def swings(self):
        wall_dist = cv2.distanceTransform(255 - self.walls, cv2.DIST_L2, 3)
        leaf_dist = cv2.distanceTransform(255 - self.door_lines, cv2.DIST_L2, 3)
        fitted = []
        ends = {}
        for chain in self.door_curves:
            local = chain - chain[0]
            ctr, *_ = np.linalg.lstsq(2 * local, (local**2).sum(axis=1), rcond=None)
            radius = np.linalg.norm(ctr)
            if not 2.4 <= radius <= 26:
                continue
            vectors = local - ctr
            sweep = np.diff(np.unwrap(np.arctan2(vectors[:, 1], vectors[:, 0])))
            if (
                not door_sweep(abs(sweep.sum()))
                or np.abs(sweep).sum() > abs(sweep.sum()) + 0.07
                or max(abs(np.linalg.norm(vectors, axis=1) - radius))
                > max(0.15, 0.055 * radius)
            ):
                continue
            hinge = chain[0] + ctr
            tips = chain[[0, -1]]
            fitted.append((hinge, radius, tips, abs(sweep.sum())))
            for tip in tips:
                ends.setdefault(tuple(np.rint(tip * 4).astype(int)), []).append(
                    (hinge, radius)
                )
        result = {}
        accepted = []
        for hinge, radius, tips, angle in sorted(fitted, key=lambda entry: -entry[3]):
            choices = []
            for i, tip in enumerate(tips):
                leaf = tips[1 - i]
                support = score_ink(leaf_dist, hinge, leaf, radius)
                tangent = tip - hinge
                extension = [
                    score_ink(wall_dist, hinge, hinge - 0.72 * tangent, radius),
                    score_ink(wall_dist, tip, tip + 0.72 * tangent, radius),
                ]
                # Two opposed hinges sharing their closed tips certify a paired
                # opening even without straight ink along the full open leaf.
                paired = any(
                    (hinge - tip) @ (other - tip) < -0.96 * radius * other_radius
                    for other, other_radius in ends[tuple(np.rint(tip * 4).astype(int))]
                )
                if angle < 1.29 and max(extension) < 0.66:
                    continue
                if support < 0.68 and not (paired and extension[0] > 0.65):
                    continue
                choices.append((support + sum(extension) + (3 if paired else 0), i))
            choices.sort(reverse=True)
            if (
                not choices
                or len(choices) == 2
                and choices[0][0] - choices[1][0] < 0.12
            ):
                continue
            i = choices[0][1]
            tip = tips[i]
            tangent = (tip - hinge) / np.linalg.norm(tip - hinge)
            normal = np.array([-tangent[1], tangent[0]])
            if np.dot(normal, tips[1 - i] - hinge) < 0:
                normal = -normal
            # A quarter turn is often exported as two 45-degree curves. A
            # fragment on an already fitted hinge is not an additional door.
            if any(
                long_angle > angle + 0.20
                and np.linalg.norm(hinge - h) < 0.40
                and abs(radius - r) < 0.40
                for h, r, long_angle in accepted
            ):
                continue
            accepted.append((hinge, radius, angle))
            k = tuple(np.rint((hinge + tip) * 2).astype(int))
            result[k] = (hinge, tip, normal, radius)
        swings = list(result.values())
        for sill, count in self.sills:
            mark = np.asarray(sill["threshold"]) * self.walls.shape[::-1] / SCALE
            fits = [s for s in swings if np.linalg.norm((s[0] + s[1]) / 2 - mark) < 0.3]
            if count != sill["occurrences"] or len(fits) != 1:
                raise ValueError("Door sill needs source review")
            hinge, tip, _, radius = fits[0]
            line = np.asarray(sill["line"])
            delta = line[1] - line[0]
            if (
                not 0.75 * radius < np.linalg.norm(delta) < 1.24 * radius
                or abs(delta @ (tip - hinge)) / (radius * np.linalg.norm(delta)) < 0.96
                or np.linalg.norm(line.mean(axis=0) - mark) > 0.3 * radius
            ):
                raise ValueError("The sill must span only the selected jambs")
        return swings


def open_wall_gaps(walls, swings):
    """Find physically clear, door-width gaps between two collinear wall returns.

    Closing is used only to partition open bays for room identification. Each walking
    connection is subsequently checked against the unchanged wall and fixture mask.
    """
    radius = np.median([d[3] for d in swings]) * SCALE
    additions = []
    segments = np.zeros_like(walls)
    known = [((a + b) * SCALE / 2, r * SCALE) for a, b, _, r in swings]
    for vertical in (False, True):
        axis = walls.T.copy() if vertical else walls
        continuous = cv2.morphologyEx(
            axis, cv2.MORPH_OPEN, np.ones((1, max(3, round(radius * 0.7))), np.uint8)
        )
        closed = cv2.morphologyEx(
            continuous, cv2.MORPH_CLOSE, np.ones((1, round(radius * 2.6) | 1), np.uint8)
        )
        gaps = cv2.bitwise_and(closed, cv2.bitwise_not(axis))
        _, parts, stats, _ = cv2.connectedComponentsWithStats(gaps, connectivity=4)
        for k, (x, y, w, h, area) in enumerate(stats[1:], 1):
            if (
                not 0.61 * radius <= w <= 2.5 * radius
                or h > 0.8 * radius
                or area < w * 0.75
            ):
                continue
            patch = parts[y : y + h, x : x + w] == k
            row = int(np.argmax(patch.sum(axis=1)))
            xs = np.flatnonzero(patch[row])
            if not len(xs) or xs[-1] - xs[0] + 1 != len(xs) or len(xs) < 0.61 * radius:
                continue
            a = np.array([x + xs[0] - 1, y + row])
            b = np.array([x + xs[-1] + 1, y + row])
            if vertical:
                a, b = a[::-1], b[::-1]
            centre = (a + b) / 2
            if any(np.linalg.norm(centre - p) < 0.60 * r for p, r in known):
                continue
            cv2.line(segments, a, b, 255, max(3, h + 2))
            normal = np.array([1.0, 0.0]) if vertical else np.array([0.0, 1.0])
            additions.append(
                (a / SCALE, b / SCALE, normal, np.linalg.norm(b - a) / SCALE)
            )
    return segments, additions
