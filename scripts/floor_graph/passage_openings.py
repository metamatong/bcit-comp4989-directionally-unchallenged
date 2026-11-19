"""Open only the centres of source-identified pairs of door swings inside public corridors."""

import cv2
import numpy as np

from doors import SCALE, curve_points


def _swing(primitive):
    segments = list(curve_points(primitive.get("path", [])))
    if primitive["kind"] != "curve" or primitive["filled"] or not segments:
        raise ValueError("Expected a stroked door arc: " + primitive["id"])
    points = np.array([segments[0][0], *[b for _, b in segments]])
    local = points - points[0]
    centre, *_ = np.linalg.lstsq(
        2 * local[1:], (local[1:] ** 2).sum(axis=1), rcond=None
    )
    radius = np.linalg.norm(centre)
    radial = local - centre
    sweep = np.unwrap(np.arctan2(radial[:, 1], radial[:, 0]))
    if (
        not 2.6 <= radius <= 30
        or not 1.29 < abs(sweep[-1] - sweep[0]) < 1.78
        or max(np.abs(np.linalg.norm(radial, axis=1) - radius)) > radius * 0.055
    ):
        raise ValueError("Expected a quarter-turn door swing: " + primitive["id"])
    return points[[0, -1]], points[0] + centre, radius


def _opening(pair):
    (a, h1, r1), (b, h2, r2) = map(_swing, pair)
    gaps = np.linalg.norm(a[:, None] - b, axis=2)
    i, j = np.unravel_index(gaps.argmin(), gaps.shape)
    centre = (a[i] + b[j]) / 2
    # Two opposite hinges and one common meeting point distinguish a paired door
    # from unrelated arcs (including adjacent room doors).
    if gaps[i, j] > 0.25 or np.dot(h1 - centre, h2 - centre) > -0.95 * r1 * r2:
        raise ValueError("The two leaves do not share a doorway.")
    across = (h2 - h1) / np.linalg.norm(h2 - h1)
    return centre, across, min(r1, r2), np.array([h1, h2])


def _floor_finish(page, primitive):
    if primitive["kind"] != "line" or len(primitive["points"]) != 2:
        raise ValueError("Expected a CAD floor-finish line.")
    original = np.array(primitive["points"])
    for shape in page.get_drawings():
        if shape.get("layer", "").split("|")[-1].upper() != "A-FLOR":
            continue
        for item in shape["items"]:
            if item[0] != "l":
                continue
            ends = np.array([list(p * page.rotation_matrix) for p in item[1:]])
            if np.allclose(ends, original, rtol=0, atol=0.08) or np.allclose(
                ends[::-1], original, rtol=0, atol=0.08
            ):
                return
    raise ValueError(
        "The declared floor marking does not match A-FLOR on this sheet: "
        + primitive["id"]
    )


def _paint(primitive, mask, origin):
    """Rasterize this primitive in the small aperture window. Keep unknown ink blocked."""

    def pixel(p):
        return np.rint(np.array(p) * SCALE - origin).astype(np.int32)

    path = primitive.get("path", [])
    if not path or any(command[0] not in {"m", "l", "c", "h"} for command in path):
        x0, y0, x1, y1 = primitive["bbox"]
        cv2.rectangle(mask, pixel([x0, y0]), pixel([x1, y1]), 255, -1)
        return
    paths = []
    for command in path:
        if command[0] == "m":
            paths.append([])
        if paths:
            paths[-1].append(command)
    for commands in paths:
        segments = list(curve_points(commands))
        if not segments:
            continue
        points = np.array([pixel(segments[0][0]), *[pixel(b) for _, b in segments]])
        if primitive["filled"]:
            cv2.fillPoly(mask, [points], 255)
        cv2.polylines(
            mask,
            [points],
            commands[-1][0] == "h",
            255,
            max(1, int(np.ceil(primitive["strokeWidth"] * SCALE))),
        )


def _open_gate(page, geometry, by_id, record, sealed, public):
    pair = [by_id[pid] for pid in record["swings"]]
    if len(pair) != 2 or pair[0]["id"] == pair[1]["id"]:
        raise ValueError("Expected two distinct door leaves.")
    centre, across, radius, hinges = _opening(pair)
    removable = {p["id"] for p in pair}
    for pid in record.get("floorFinishLines", []):
        _floor_finish(page, by_id[pid])
        removable.add(pid)

    # Limit changes to a sub-door-width strip. At this step the floor's labels
    # and enclosed spaces have already been classified using the original ink.
    half_width = radius * 0.55
    along = np.array([-across[1], across[0]])
    half_length = radius + 2.5
    corners = np.array(
        [
            centre + i * across * half_width + j * along * half_length
            for i in (-1, 1)
            for j in (-1, 1)
        ]
    )
    x0, y0 = np.maximum(0, np.floor(corners.min(axis=0) * SCALE).astype(int) - 5)
    x1, y1 = np.minimum(
        sealed.shape[::-1], np.ceil(corners.max(axis=0) * SCALE).astype(int) + 6
    )
    allowed = np.zeros((y1 - y0, x1 - x0), np.uint8)
    protected = np.zeros_like(allowed)
    for primitive in geometry["primitives"]:
        l, t, r, b = np.array(primitive["bbox"]) * SCALE
        if l > x1 + 2 or r < x0 - 2 or t > y1 + 2 or b < y0 - 2:
            continue
        _paint(
            primitive, allowed if primitive["id"] in removable else protected, (x0, y0)
        )

    # The segmentation pass may have closed the doorway along its jamb line.
    ends = np.rint(hinges * SCALE - [x0, y0]).astype(int)
    cv2.line(allowed, *ends, 255, 3)
    allowed = cv2.dilate(allowed, np.ones((5, 5), np.uint8))
    protected = cv2.dilate(protected, np.ones((3, 3), np.uint8))
    y, x = np.mgrid[y0:y1, x0:x1]
    dx, dy = x / SCALE - centre[0], y / SCALE - centre[1]
    lane = (np.abs(dx * across[0] + dy * across[1]) <= half_width) & (
        np.abs(dx * along[0] + dy * along[1]) <= half_length
    )
    inside = public[y0:y1, x0:x1] > 0
    if not (lane & inside & (allowed > 0)).any():
        raise ValueError("Doorway is outside the designated public corridor.")
    sealed[y0:y1, x0:x1][lane & inside & (allowed > 0) & (protected == 0)] = 0


def open_passage_doors(page, geometry, records, sealed, public):
    if not records:
        return
    by_id = {p["id"]: p for p in geometry["primitives"]}
    for record in records:
        _open_gate(page, geometry, by_id, record, sealed, public)


def signed_door_cells(grid, words, sides, records):
    """Resolve a marked public-side approach beside another door's overlapping swing."""
    cells = {}
    for record in records:
        labels = [w for w in words if w["text"] == record["room"]]
        target = grid.norm(record["point"])
        aperture = grid.norm(record["threshold"])
        found = [d for d in sides if np.linalg.norm(d[3] - aperture) < 0.3]
        if len(labels) != 1 or len(found) != 1:
            raise ValueError(
                "Cannot identify the marked room and door: " + record["room"]
            )
        a, b, faces, middle, radius = found[0]
        room = labels[0]["region"]
        if room not in (a, b):
            raise ValueError("Door must bound its labelled room: " + record["room"])
        public_side = 1 if a == room else 0
        normal = faces[public_side] - middle
        normal = normal / np.linalg.norm(normal)
        delta = target - middle
        depth = float(delta @ normal)
        lateral = delta - depth * normal
        # Stay within the width of the same leaf, on the public side of the wall.
        if not 0 < depth <= 2 * radius or np.linalg.norm(lateral) > radius * 0.48:
            raise ValueError("Walking point is outside the specified doorway.")
        start = faces[public_side] + lateral
        line = np.rint(
            np.linspace(
                start,
                target,
                max(2, int(np.ceil(np.linalg.norm(target - start) * 2)) + 1),
            )
        ).astype(int)
        other = (a, b)[public_side]
        if not np.all(grid.regions[line[:, 1], line[:, 0]] == other) or np.any(
            grid.sealed[line[:, 1], line[:, 0]]
        ):
            raise ValueError(
                "An obstruction separates the walking point from the door."
            )
        cell = grid.cell_near(target, grid.cell_size * 2)
        if cell is None:
            raise ValueError("The marked door needs a public walking cell.")
        cells[(room, tuple(middle))] = cell
    return cells
