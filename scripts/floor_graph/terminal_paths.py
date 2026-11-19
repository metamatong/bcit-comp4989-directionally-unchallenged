"""Trace the last part of a journey to a door inside an occupied suite.

These polylines terminate at one source door. The visitor's through network never
contains the interior of a classroom or office as a general corridor.
"""

import cv2
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import dijkstra


def _segments(points):
    """Remove repeats and intermediate collinear grid centres, retaining doorway bends."""
    line = []
    for point in points:
        p = np.asarray(point)
        if line and np.linalg.norm(p - line[-1]) < 1e-6:
            continue
        if len(line) > 1:
            a, b = line[-1] - line[-2], p - line[-1]
            if abs(a[0] * b[1] - a[1] * b[0]) < 1e-7 and a @ b > 0:
                line.pop()
        line.append(p)
    return line


def _point(grid, cell):
    return (np.array([cell % grid.gw, cell // grid.gw]) + 0.5) * grid.cell_size


class TerminalPaths:
    def __init__(self, grid, public, openings):
        self.grid = grid
        mask = grid.grid
        numbering = np.full(mask.shape, -1, dtype=np.int32)
        numbering[mask] = np.arange(np.count_nonzero(mask), dtype=np.int32)
        self.index = numbering.ravel()
        self.cells = np.flatnonzero(mask)
        a = []
        b = []
        weights = []
        for left, right in (
            (numbering[:-1], numbering[1:]),
            (numbering[:, :-1], numbering[:, 1:]),
        ):
            both = (left >= 0) & (right >= 0)
            a.append(left[both])
            b.append(right[both])
            weights.append(np.ones(np.count_nonzero(both)))
        self.apertures = {}
        shortest = {}
        for start, end, points in openings:
            if start > end:
                start, end, points = end, start, list(reversed(points))
            if (
                start == end
                or end - start == grid.gw
                or (end - start == 1 and start // grid.gw == end // grid.gw)
            ):
                continue  # Neighbouring free cells already have their direct walking edge.
            path = [_point(grid, start), *points, _point(grid, end)]
            distance = (
                sum(np.linalg.norm(q - p) for p, q in zip(path, path[1:]))
                / grid.cell_size
            )
            key = (start, end)
            if key not in shortest or distance < shortest[key][0]:
                shortest[key] = (distance, points)
        for (start, end), (distance, points) in shortest.items():
            self.apertures[start, end] = points
            self.apertures[end, start] = list(reversed(points))
            a.append([self.index[start]])
            b.append([self.index[end]])
            weights.append([distance + 8])
        a = np.concatenate(a).astype(np.int32)
        b = np.concatenate(b).astype(np.int32)
        graph = coo_matrix(
            (np.concatenate(weights), (a, b)), shape=(len(self.cells), len(self.cells))
        ).tocsr()
        sources = numbering[public.grid]
        if np.any(sources < 0):
            raise ValueError("Interior graph must preserve the public grid.")
        self.dist, self.prev, _ = dijkstra(
            graph,
            directed=False,
            indices=sources,
            min_only=True,
            return_predecessors=True,
        )

    def path(self, cell, point, face, room_region):
        i = self.index[cell]
        if i < 0 or not np.isfinite(self.dist[i]):
            return None
        points = [point, face, _point(self.grid, cell)]
        while self.prev[i] >= 0:
            j = self.prev[i]
            other = int(self.cells[j])
            x, y = np.rint(_point(self.grid, other)).astype(int)
            if self.grid.regions[y, x] == room_region:
                return None
            door = self.apertures.get((cell, other))
            if door is not None:
                # Reject leaving through the same room door that requested this approach.
                if np.linalg.norm(door[1] - point) < 1:
                    return None
                points.extend(door)
            points.append(_point(self.grid, other))
            cell = other
            i = j
        size = np.array([self.grid.w, self.grid.h])
        return {
            "cell": cell,
            "via": [np.round(p / size, 7).tolist() for p in _segments(points)],
        }

    def export(self):
        """Compress paths from selectable interior cells to the public grid.

        Each run stores the predecessor's signed cell offset. A non-adjacent
        transition additionally names the original door polyline it must follow.
        Public grid cells are the roots and are never stored as interior links.
        """
        linked = self.prev >= 0
        offsets = np.zeros(self.grid.grid.size, dtype=np.int32)
        starts = self.cells[linked]
        targets = self.cells[self.prev[linked]]
        offsets[starts] = targets - starts
        offsets = offsets.reshape(self.grid.grid.shape)
        runs = []
        for y, row in enumerate(offsets):
            splits = np.flatnonzero(np.diff(np.r_[0, row, 0]))
            for a, b in zip(splits, splits[1:]):
                if row[a]:
                    runs.append([y, int(a), int(b - 1), int(row[a])])
        size = np.array([self.grid.w, self.grid.h])
        apertures = []
        for (a, b), path in self.apertures.items():
            if offsets.flat[a] == b - a:
                apertures.append(
                    [int(a), int(b), *[np.round(p / size, 7).tolist() for p in path]]
                )
        return {"runs": runs, "ports": apertures}

    def room_references(self, regions):
        """Choose an independently walkable reference from each enclosed room's geometry.

        Both the signed room and its caption must identify the same enclosure at
        the call site. Clearance from the walls selects the position, without
        using the printed coordinates as a walkable point.
        """
        available = self.cells[np.isfinite(self.dist)]
        if not len(available):
            return {}
        grid = self.grid
        xs = np.rint((available % grid.gw + 0.5) * grid.cell_size).astype(int)
        ys = np.rint((available // grid.gw + 0.5) * grid.cell_size).astype(int)
        labels = regions[ys, xs]
        clearance = cv2.distanceTransform(grid.walk.astype(np.uint8), cv2.DIST_L2, 3)[
            ys, xs
        ]
        # Maximise clearance, then prefer the shorter route to circulation.
        order = np.lexsort((self.dist[self.index[available]], -clearance, labels))
        sorted_labels = labels[order]
        first = np.r_[True, sorted_labels[1:] != sorted_labels[:-1]]
        return {
            int(k): int(c)
            for k, c in zip(sorted_labels[first], available[order[first]])
        }

    def entry_for_enclosure(self, region, printed, limit):
        """Use the room stamp to identify its enclosure, then trace *its boundary*.

        The interior sample is discarded. Only a drawn aperture or a physically
        open boundary reached by the walking graph becomes a route endpoint.
        """
        grid = self.grid
        centre = printed / grid.cell_size
        x, y = np.floor(centre).astype(int)
        radius = int(np.ceil(limit / grid.cell_size))
        left, top = max(0, x - radius), max(0, y - radius)
        ys, xs = np.nonzero(grid.grid[top : y + radius + 1, left : x + radius + 1])
        coords = np.column_stack((xs + left, ys + top))
        if not len(coords):
            return None
        pixels = np.rint((coords + 0.5) * grid.cell_size).astype(int)
        ids = coords[:, 1] * grid.gw + coords[:, 0]
        ok = (grid.regions[pixels[:, 1], pixels[:, 0]] == region) & np.isfinite(
            self.dist[self.index[ids]]
        )
        if not np.any(ok):
            return None
        ids = ids[ok]
        coords = coords[ok]
        cell = int(ids[np.argmin(np.linalg.norm(coords + 0.5 - centre, axis=1))])
        i = self.index[cell]
        while self.prev[i] >= 0:
            j = self.prev[i]
            other = int(self.cells[j])
            p = _point(grid, other)
            xx, yy = np.rint(p).astype(int)
            if grid.regions[yy, xx] != region:
                door = self.apertures.get((cell, other))
                point = door[1] if door else (_point(grid, cell) + p) / 2
                return self.path(other, point, door[-1] if door else p, region)
            cell = other
            i = j
        return None


def interior_grid(public, config, regions, by_region):
    size = np.array([public.w, public.h])
    outline = np.zeros_like(public.sealed)
    for patch in config["cadInteriorBounds"]:
        cv2.fillPoly(outline, [np.rint(np.array(patch) * size).astype(np.int32)], 255)
    blocked = {
        "void",
        "shaft",
        "stairs",
        "elevator",
        "electrical",
        "mechanical",
        "communications",
        "janitor",
        "storage",
    }
    # A physically separate service room can itself have a visitor-facing door.
    # Its interior cannot serve as a passage to another place.
    usable = []
    outside = set(
        np.unique(
            np.concatenate((regions[0], regions[-1], regions[:, 0], regions[:, -1]))
        )
    )
    for index, words in by_region.items():
        if (
            index
            and index not in outside
            and any(w["kind"] not in blocked for w in words)
            and not any(w["kind"] == "void" for w in words)
        ):
            usable.append(index)
    # Unlabelled, bounded compartments inside the transcribed slab can be small
    # vestibules. They can participate only when a source opening reaches them;
    # labelled service spaces, shafts and voids remain excluded.
    for index in np.unique(regions[outline > 0]):
        if index and index not in outside and not by_region.get(index):
            usable.append(index)
    accepted = np.isin(regions, usable)
    protected = [
        k
        for k, items in by_region.items()
        if items and all(w["kind"] in blocked for w in items)
    ]
    suites = np.zeros_like(outline)
    for bounds in config.get("cadSuiteAreas", []):
        x, y, r, b = np.rint(np.array(bounds) * [*size, *size]).astype(int)
        suites[y : b + 1, x : r + 1] = 255
    inside = (
        (outline > 0)
        & (accepted | ((suites > 0) & ~np.isin(regions, protected)))
        & (public.sealed == 0)
    )
    return type(public)(public.walk | inside, public.sealed, regions, public.cell_size)
