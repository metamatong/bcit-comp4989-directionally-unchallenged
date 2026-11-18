"""Find a door swing only when its arc, straight leaf and adjoining jamb agree on the sheet."""

from collections import defaultdict

import cv2
import numpy as np

SCALE = 2


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


def doors_on_page(geometry, ink):
    distance = cv2.distanceTransform(255 - ink, cv2.DIST_L2, 3)
    doors = {}
    for chain in arc_chains(geometry):
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
        if max(errs) > max(0.15, radius * 0.055) or not 1.29 < sweep < 1.78:
            continue
        if np.abs(np.diff(angles)).sum() > sweep + 0.065:
            continue
        tips = [chain[0], chain[-1]]
        candidates = []
        for i, tip in enumerate(tips):
            leaf = tips[1 - i]
            leaf_support = score_ink(distance, hinge, leaf, radius)
            left_jamb = score_ink(distance, hinge, hinge - (tip - hinge) * 0.85, radius)
            right_jamb = score_ink(distance, tip, tip + (tip - hinge) * 0.85, radius)
            if leaf_support < 0.70 or max(left_jamb, right_jamb) < 0.66:
                continue
            # The actual opening generally extends between two collinear walls.
            candidates.append((leaf_support + left_jamb + right_jamb, tip, leaf))
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
        doors[key] = (hinge, close_tip, normal, radius)
    return list(doors.values())
