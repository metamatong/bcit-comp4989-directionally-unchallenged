"""Find a door swing only when its arc, straight leaf and adjoining jamb agree on the sheet."""

from collections import defaultdict

import cv2
import numpy as np

SCALE = 2


def door_sweep(angle):
    """Older sheets also draw open leaves at 30, 45 or 60 degrees."""
    return 1.29 < angle < 1.80 or any(
        abs(angle - nominal) < 0.065 for nominal in (np.pi / 6, np.pi / 4, np.pi / 3)
    )


def curve_points(path):
    previous = None
    for command in path:
        op, *args = command
        if op == "m":
            previous = np.array(args[0])
        elif op == "l" and previous is not None:
            end = np.array(args[0])
            yield previous, end
            previous = end
        elif op == "c" and previous is not None:
            a, b, c = map(np.array, args)
            start = previous
            for t in (0.2, 0.4, 0.6, 0.8, 1.0):
                end = (
                    (1 - t) ** 3 * start
                    + 3 * t * (1 - t) ** 2 * a
                    + 3 * t * t * (1 - t) * b
                    + t**3 * c
                )
                yield previous, end
                previous = end
        elif op == "h":
            previous = None


def arc_chains(geometry):
    # Some flattened exports split one swing into separate primitives. Join only
    # unbranched diagonal strokes; never interpolate across a missing segment.
    neighbours = defaultdict(set)
    coords = {}
    for primitive in geometry["primitives"]:
        if primitive["filled"] or primitive["kind"] == "rectangle":
            continue
        for a, b in curve_points(primitive.get("path", [])):
            dx, dy = np.abs(b - a)
            if min(dx, dy) < 0.008 or max(dx, dy) > 15:
                continue
            first, last = (tuple(np.rint(p * 12).astype(int)) for p in (a, b))
            if first != last:
                neighbours[first].add(last)
                neighbours[last].add(first)
                coords[first], coords[last] = a, b
    seen = set()
    for head in neighbours:
        if len(neighbours[head]) == 2:
            continue
        for following in sorted(neighbours[head]):
            if (head, following) in seen:
                continue
            chain = [head]
            prev, cur = head, following
            while True:
                seen.update(((prev, cur), (cur, prev)))
                chain.append(cur)
                if len(neighbours[cur]) != 2 or cur == head:
                    break
                (nxt,) = neighbours[cur] - {prev}
                prev, cur = cur, nxt
            if 4 <= len(chain) <= 170:
                yield np.array([coords[p] for p in chain])


def score_ink(distance, a, b, radius):
    t = np.linspace(0.14, 0.86, 15)[:, None]
    xy = np.rint((a + (b - a) * t) * SCALE).astype(int)
    if (
        np.any(xy < 0)
        or np.any(xy[:, 0] >= distance.shape[1])
        or np.any(xy[:, 1] >= distance.shape[0])
    ):
        return 0.0
    return float(
        np.mean(distance[xy[:, 1], xy[:, 0]] < max(1.6, radius * SCALE * 0.095))
    )


def source_arcs(geometry):
    for chain in arc_chains(geometry):
        yield chain
        steps = np.diff(chain, axis=0)
        turns = np.abs(np.diff(np.unwrap(np.arctan2(steps[:, 1], steps[:, 0]))))
        cuts = np.flatnonzero(turns > 0.62) + 1
        # Two opposed leaves may be emitted as a single polyline with a cusp
        # at their touching tips. Fit each smooth portion independently.
        if cuts.size:
            marks = [0, *cuts, len(chain) - 1]
            for first, last in zip(marks, marks[1:]):
                if last - first >= 3:
                    yield chain[first : last + 1]
    for primitive in geometry["primitives"]:
        if primitive["filled"] or primitive["kind"] != "curve":
            continue
        previous = None
        curves = []
        for item in primitive.get("path", []):
            if item[0] == "c" and previous is not None:
                parts = list(curve_points([["m", previous], item]))
                points = [parts[0][0], *[b for _, b in parts]]
                yield np.asarray(points)
                curves.extend(points if not curves else points[1:])
            else:
                if len(curves) > 6:
                    yield np.asarray(curves)
                curves = []
            previous = item[-1] if item[0] in ("m", "l", "c") else None
        if len(curves) > 6:
            yield np.asarray(curves)


def doors_on_page(geometry, ink, angled_leaves=False):
    distance = cv2.distanceTransform(255 - ink, cv2.DIST_L2, 3)
    doors = {}
    fits = []
    junctions = defaultdict(list)
    for chain in source_arcs(geometry) if angled_leaves else arc_chains(geometry):
        # Fitting in local coordinates avoids loss of precision on large CAD sheets.
        local = chain - chain[0]
        centre, *_ = np.linalg.lstsq(
            2 * local[1:], (local[1:] ** 2).sum(axis=1), rcond=None
        )
        radius = np.linalg.norm(centre)
        if not 2.6 <= radius <= 30:
            continue
        hinge = chain[0] + centre
        radii = chain - hinge
        errs = np.abs(np.linalg.norm(radii, axis=1) - radius)
        angles = np.unwrap(np.arctan2(radii[:, 1], radii[:, 0]))
        sweep = abs(angles[-1] - angles[0])
        sweep_matches = door_sweep(sweep) if angled_leaves else 1.29 < sweep < 1.78
        if max(errs) > max(0.15, radius * 0.055) or not sweep_matches:
            continue
        if np.abs(np.diff(angles)).sum() > sweep + 0.065:
            continue
        tips = [chain[0], chain[-1]]
        fits.append((hinge, radius, tips, sweep))
        if angled_leaves:
            for tip in tips:
                junctions[tuple(np.rint(tip * 4).astype(int))].append((hinge, radius))
    for hinge, radius, tips, sweep in fits:
        candidates = []
        for i, tip in enumerate(tips):
            leaf = tips[1 - i]
            leaf_support = score_ink(distance, hinge, leaf, radius)
            left_jamb = score_ink(distance, hinge, hinge - (tip - hinge) * 0.85, radius)
            right_jamb = score_ink(distance, tip, tip + (tip - hinge) * 0.85, radius)
            paired = angled_leaves and any(
                (hinge - tip) @ (other - tip) < -0.96 * radius * other_radius
                for other, other_radius in junctions[
                    tuple(np.rint(tip * 4).astype(int))
                ]
            )
            if (
                leaf_support < (0.80 if sweep < 1.29 else 0.70)
                or max(left_jamb, right_jamb) < 0.66
            ):
                continue
            # The actual opening generally extends between two collinear walls.
            candidates.append(
                (
                    leaf_support + left_jamb + right_jamb + (3 if paired else 0),
                    tip,
                    leaf,
                )
            )
        candidates.sort(key=lambda c: -c[0])
        if not candidates or (
            len(candidates) == 2 and candidates[0][0] - candidates[1][0] < 0.20
        ):
            continue
        _, close_tip, open_tip = candidates[0]
        midpoint = (hinge + close_tip) / 2
        tangent = (close_tip - hinge) / np.linalg.norm(close_tip - hinge)
        normal = np.array([-tangent[1], tangent[0]])
        if np.dot(open_tip - hinge, normal) < 0:
            normal *= -1
        key = tuple(np.rint(midpoint).astype(int))
        if not angled_leaves or key not in doors or sweep > doors[key][0]:
            doors[key] = (sweep, (hinge, close_tip, normal, radius))
    if not angled_leaves:
        return [leaf for _, leaf in doors.values()]
    selected = []
    for sweep, leaf in sorted(doors.values(), key=lambda item: -item[0]):
        hinge, _, _, radius = leaf
        if any(
            long_angle > sweep + 0.20
            and abs(radius - old[3]) < 0.40
            and np.linalg.norm(hinge - old[0]) < 0.40
            for long_angle, old in selected
        ):
            continue
        selected.append((sweep, leaf))
    return [leaf for _, leaf in selected]
