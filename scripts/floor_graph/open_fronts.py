"""Identify an open bay from its back wall, two side walls and a clear mouth.

Printed room text selects a compartment only. The routing point is measured at the
end of the two partitions and must lead to a source-backed floor walking cell.
"""

import numpy as np


def _span(row, centre, limit):
    low = max(0, centre - limit)
    high = min(len(row), centre + limit + 1)
    a = np.flatnonzero(row[low:centre])
    b = np.flatnonzero(row[centre + 1 : high])
    if not (len(a) and len(b)):
        return None
    return int(low + a[-1]), int(centre + 1 + b[0])


def bay_mouths(cad, word, words, size, radius):
    centre = (np.array(word["box"][:2]) + word["box"][2:]) * size / 2
    neighbours = [
        (np.array(w["box"][:2]) + w["box"][2:]) * size / 2
        for w in words
        if w is not word and w["kind"] not in {"shaft", "void"}
    ]
    results = []
    for transposed in (False, True):
        wall = cad.walls.T if transposed else cad.walls
        x, y = np.rint(centre[::-1] if transposed else centre).astype(int)
        if wall[y, x]:
            continue
        sides = _span(wall[y], x, round(6 * radius))
        if not sides:
            continue
        l, r = sides
        if not 0.8 * radius < r - l < 7 * radius:
            continue
        for sign in (-1, 1):
            # A continuous back partition must bound the bay behind its label.
            back = None
            for d in range(1, round(6 * radius)):
                yy = y - sign * d
                if yy < 1 or yy >= wall.shape[0] - 1:
                    break
                if np.count_nonzero(wall[yy, l + 1 : r]) > 0.72 * (r - l - 1):
                    back = yy
                    break
                if wall[yy, x]:
                    break
            if back is None:
                continue
            end = None
            for d in range(1, round(8 * radius)):
                yy = y + sign * d
                if yy < 1 or yy >= wall.shape[0] - 1 or wall[yy, x]:
                    break
                # The left and right returns border the same strip all the way to its mouth.
                tol = max(2, round(radius * 0.22))
                edges = [wall[yy, max(0, v - tol) : v + tol + 1].any() for v in (l, r)]
                if not all(edges):
                    end = yy
                    break
            if end is None or abs(end - back) < 0.6 * radius:
                continue
            # Some open bays lose only one side at the entrance. The outside must
            # actually widen and three quarters of the mouth must be clear.
            ahead = end + sign * max(2, round(radius * 0.5))
            if not 0 <= ahead < wall.shape[0]:
                continue
            outer = _span(wall[ahead], x, round(10 * radius))
            if outer and outer[1] - outer[0] < r - l + radius * 0.65:
                continue
            if (wall[end, l + 2 : r - 1] > 0).mean() > 0.18:
                continue
            if any(
                l < a < r and min(back, end) < b < max(back, end)
                for a, b in [(p[::-1] if transposed else p) for p in neighbours]
            ):
                continue
            point = np.array([(l + r) / 2, end])
            normal = np.array([0, sign])
            if transposed:
                point = point[::-1]
                normal = normal[::-1]
            results.append((point, normal))
    return results
