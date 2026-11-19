"""Find public floor components attached to source-bound transfer marks."""

import cv2
import numpy as np


def transfer_components(grid, extra, nodes, symbols, faces_at, clear, barriers):
    count, parts = cv2.connectedComponents(grid.grid.astype(np.uint8), connectivity=4)
    parents = list(range(count))

    def component(i):
        i = int(i)
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    for middle, normal, r in symbols:
        faces = faces_at(grid, middle, normal, r)
        if len(faces) != 2 or not clear(barriers, faces[0][0], faces[1][0]):
            continue
        cells = [grid.cell_near(p, r * 0.78) for p, _ in faces]
        if None not in cells:
            a, b = cells
            parents[component(parts.flat[a])] = component(parts.flat[b])
    seeds = []
    seeds.extend(a["point"] for a in extra.get("cadLandingFrontages", []))
    seeds.extend([n["point"]["x"], n["point"]["y"]] for n in nodes)
    keep = set()
    for point in seeds:
        cell = grid.cell_near(grid.norm(point), grid.cell_size * 8, boundary=True)
        if cell is not None:
            keep.add(component(parts.flat[cell]))
    # This pass prefers rooms with an exit onto a component containing a live
    # mapped transfer. Detached but valid local approaches are compiled separately.
    roots = np.array([component(i) in keep for i in range(count)])
    full = np.repeat(
        np.repeat(roots[parts], grid.cell_size, axis=0), grid.cell_size, axis=1
    )
    walk = np.zeros_like(grid.walk)
    walk[: full.shape[0], : full.shape[1]] = full
    return type(grid)(grid.walk & walk, grid.sealed, grid.regions, grid.cell_size)
