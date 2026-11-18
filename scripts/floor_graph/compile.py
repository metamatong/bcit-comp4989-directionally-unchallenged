"""Compile all official pages into exact place occurrences and conservative floor walking grids."""

import argparse
from collections import defaultdict
from concurrent.futures import ProcessPoolExecutor
import hashlib
import json
import math

import cv2
import numpy as np
import pymupdf

from doors import SCALE
from labels import CAMPUS, IDENTIFIER, MANUAL, ROOT, USES, inventory, label_words
from surfaces import near_caption, surfaces

SPATIAL = CAMPUS / "spatial"
CELL = 4  # raster pixels; accept only cells whose entire footprint is walkable
AREAS = {
    p["planId"]: p
    for p in json.loads((SPATIAL / "floor-circulation.json").read_text())["plans"]
}
REVIEWED = json.loads((SPATIAL / "reviewed-network.json").read_text())
TRACES = json.loads((SPATIAL / "corridor-traces.json").read_text())["traces"]
PROPOSALS = json.loads((CAMPUS / "connection-candidates.json").read_text())


def grid_cells(walk, cell_size):
    h, w = walk.shape
    gh, gw = h // cell_size, w // cell_size
    grid = (
        walk[: gh * cell_size, : gw * cell_size]
        .reshape(gh, cell_size, gw, cell_size)
        .all(axis=(1, 3))
    )
    runs = []
    for y, row in enumerate(grid):
        transitions = np.flatnonzero(np.diff(np.r_[False, row, False].astype(np.int8)))
        runs.extend([[y, int(a), int(b) - 1] for a, b in transitions.reshape(-1, 2)])
    return grid, runs


class FloorGrid:
    def __init__(self, walk, sealed, regions, cell_size):
        self.walk, self.sealed, self.regions = walk, sealed, regions
        self.cell_size = cell_size
        self.grid, self.runs = grid_cells(walk, cell_size)
        self.h, self.w = walk.shape
        self.gh, self.gw = self.grid.shape

    def cell_near(self, pos, limit, boundary=False):
        """Connect to free cells by a short visible ray. Never snap through intervening walls."""
        x, y = np.rint(pos).astype(int)
        if not (0 <= x < self.w and 0 <= y < self.h):
            return None
        size = self.cell_size
        gx, gy = x // size, y // size
        pad = math.ceil(limit / size)
        xx, yy = max(0, gx - pad), max(0, gy - pad)
        ys, xs = np.nonzero(self.grid[yy : gy + pad + 1, xx : gx + pad + 1])
        if not len(xs):
            return None
        xs, ys = xs + xx, ys + yy
        centres = np.column_stack(((xs + 0.5) * size, (ys + 0.5) * size))
        distances = np.linalg.norm(centres - pos, axis=1)
        for i in np.argsort(distances):
            distance = distances[i]
            if distance > limit:
                break
            line = np.rint(
                np.linspace(pos, centres[i], max(2, math.ceil(distance * 1.5) + 1))
            ).astype(int)
            # A reviewed marker printed on ink may touch its own first stroke.
            if boundary and len(line) > 2:
                line = line[np.linalg.norm(line - pos, axis=1) > 1.5]
            if len(line) and not np.any(self.sealed[line[:, 1], line[:, 0]]):
                return int(ys[i] * self.gw + xs[i])
        return None

    def norm(self, pair):
        return np.array(pair) * [self.w, self.h]


def ties_for(plan, grid):
    """Only bind the exact published point or trace vertex; runtime checks its live approval."""
    points = [
        n["point"]
        for n in REVIEWED["nodes"]
        if n["planId"] == plan["id"] and n["sourceSha256"] == plan["sourceSha256"]
    ]
    for t in TRACES:
        if t["planId"] == plan["id"] and t["sourceSha256"] == plan["sourceSha256"]:
            points.extend([t["from"], *t["bends"], t["to"]])
    for candidate in PROPOSALS["candidates"]:
        trace = candidate.get("drawingTrace")
        if (
            trace
            and candidate["from"]["planId"] == plan["id"]
            and candidate["from"]["sourceSha256"] == plan["sourceSha256"]
        ):
            points.extend(trace["bends"])
    ties = []
    for x, y in sorted({(p["x"], p["y"]) for p in points}):
        cell = grid.cell_near(grid.norm((x, y)), 4 * CELL, boundary=True)
        if cell is not None:
            ties.append([x, y, cell])
    return ties


def connectivity(grid, places, portals, ties):
    """Describe whole-floor connectivity without selecting or testing named journeys."""
    count, components = cv2.connectedComponents(
        grid.grid.astype(np.uint8), connectivity=4
    )
    group = list(range(count))

    def root(index):
        while index != group[index]:
            group[index] = group[group[index]]
            index = group[index]
        return index

    def component(cell):
        return root(int(components.flat[cell]))

    for a, b, *_ in portals:
        group[component(a)] = component(b)
    for place in places:
        place["components"] = sorted({component(cell) for cell in place["cells"]})
    return {
        "withPlaces": len({c for p in places for c in p["components"]}),
        "ties": [[x, y, component(cell)] for x, y, cell in ties],
    }


def compile_floor(item):
    plan, filename = item
    cv2.setNumThreads(1)
    extra = AREAS.get(plan["id"], {})
    review = MANUAL.get(plan["id"], {})
    if any(
        row and row["sourceSha256"] != plan["sourceSha256"] for row in (extra, review)
    ):
        raise ValueError("A plan transcription needs review: " + plan["id"])
    geometry_bytes = (ROOT / plan["geometry"]["file"]).read_bytes()
    if hashlib.sha256(geometry_bytes).hexdigest() != plan["geometry"]["sha256"]:
        raise ValueError("Changed source geometry: " + plan["id"])
    with pymupdf.open(filename) as doc:
        page = doc[plan["page"] - 1]
        if (
            abs(page.rect.width - plan["width"]) > 0.01
            or abs(page.rect.height - plan["height"]) > 0.01
        ):
            raise ValueError("Coordinate frame changed: " + plan["id"])
        words = label_words(plan, page, extra.get("labels"))
        walk, sealed, regions, sides, uses, door_count = surfaces(
            page, json.loads(geometry_bytes), words, extra
        )
    grid = FloorGrid(
        walk,
        sealed,
        regions,
        2 if sides and np.median([d[4] for d in sides]) < 12 else CELL,
    )
    entries = defaultdict(list)
    physical_doors = defaultdict(list)
    portals = []
    for a, b, faces, midpoint, r in sides:
        cells = [grid.cell_near(face, r * 0.50) for face in faces]
        threshold = np.round(midpoint / [grid.w, grid.h], 7).tolist()
        for i, room in enumerate((a, b)):
            physical_doors[room].append([*threshold, cells[1 - i]])
        for index, room in enumerate((a, b)):
            access = cells[1 - index]
            if access is not None:
                entries[room].append(access)
        if cells[0] is not None and cells[1] is not None and cells[0] != cells[1]:
            portals.append(
                [
                    *cells,
                    np.round(faces[0] / [grid.w, grid.h], 7).tolist(),
                    threshold,
                    np.round(faces[1] / [grid.w, grid.h], 7).tolist(),
                ]
            )
    places = []
    region_sizes = np.bincount(regions.ravel())
    for word in words:
        label, box, kind, area = word["text"], word["box"], word["kind"], word["region"]
        # Riser counts, dimension strings, sheet years and title-block text are
        # retained in raw drawing evidence. They do not identify visitor places.
        if word["method"] != "transcription":
            short = len("".join(c for c in label if c.isdigit())) < 3
            captioned = any(
                w["region"] == area
                and w["kind"] != "room"
                and w is not word
                and near_caption(w["box"], box)
                for w in words
            )
            if IDENTIFIER.fullmatch(label) and short and not captioned:
                continue
            if not area or region_sizes[area] > grid.w * grid.h * 0.44:
                continue
            if (
                IDENTIFIER.fullmatch(label)
                and not captioned
                and box[1] > 0.84
                and label.isdigit()
                and 1900 <= int(label) <= 2099
                and not entries[area]
            ):
                continue
        if not IDENTIFIER.fullmatch(label):
            if kind not in {"stairs", "elevator", "corridor"}:
                continue
            # Associate ordinary space captions with the nearby, exact identifier.
            if any(
                w["region"] == area
                and IDENTIFIER.fullmatch(w["text"])
                and near_caption(box, w["box"])
                for w in words
            ):
                continue
        elif kind == "room":
            for caption in words:
                if (
                    caption["text"] in USES
                    and caption["region"] == area
                    and near_caption(box, caption["box"])
                ):
                    kind = USES[caption["text"]]
                    break
        doors = []
        if area == 0:
            access = []
        elif kind == "corridor":
            centre = grid.norm([(box[0] + box[2]) / 2, (box[1] + box[3]) / 2])
            cell = grid.cell_near(centre, 4 * CELL)
            access = [cell] if cell is not None else []
        else:
            doors = physical_doors[area]
            access = list(entries[area])
            # A leaky room boundary must not bind one room to all doors on the floor.
            other_rooms = [
                w
                for w in words
                if w is not word
                and w["region"] == area
                and w["text"] != label
                and IDENTIFIER.fullmatch(w["text"])
                and w["kind"] != "corridor"
            ]
            if other_rooms:
                access, doors = [], []
        for landing in extra.get("accessPoints", []):
            if (
                label == landing["label"]
                and sum(w["text"] == label for w in words) == 1
            ):
                cell = grid.cell_near(
                    grid.norm(landing["point"]), 4 * CELL, boundary=True
                )
                if cell is not None:
                    access.append(cell)
        places.append(
            {
                "label": label,
                "bounds": box,
                "kind": kind,
                "method": word["method"],
                "doors": doors,
                "cells": sorted(set(access)),
            }
        )
    ties = ties_for(plan, grid)
    parts = connectivity(grid, places, portals, ties)
    return {
        "id": plan["id"],
        "sourceSha256": plan["sourceSha256"],
        "geometrySha256": plan["geometry"]["sha256"],
        "width": grid.gw,
        "height": grid.gh,
        "step": grid.cell_size / SCALE,
        "runs": grid.runs,
        "portals": portals,
        "ties": ties,
        "components": parts,
        "places": places,
        "doorSymbols": door_count,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--page", help="Inspect one compiled page without replacing the campus graph"
    )
    parser.add_argument("--workers", type=int, default=4)
    args = parser.parse_args()
    items = list(inventory())
    if args.page:
        floor = compile_floor(
            next(item for item in items if item[0]["id"] == args.page)
        )
        path = ROOT / "tmp/floor-compiler" / (args.page + ".json")
        path.write_text(json.dumps(floor))
        return
    with ProcessPoolExecutor(max(1, args.workers)) as pool:
        floors = []
        for f in pool.map(compile_floor, items):
            print(
                f["id"],
                len(f["places"]),
                sum(bool(p["cells"]) for p in f["places"]),
                len(f["runs"]),
                flush=True,
            )
            floors.append(f)
    inputs = [
        "spatial/plan-annotations.json",
        "spatial/floor-circulation.json",
        "spatial/reviewed-network.json",
        "spatial/corridor-traces.json",
        "connection-candidates.json",
    ]
    hashes = {
        name: hashlib.sha256((CAMPUS / name).read_bytes()).hexdigest()
        for name in inputs
    }
    data = (
        json.dumps(
            {"schemaVersion": 1, "inputSha256": hashes, "floors": floors},
            separators=(",", ":"),
        )
        + "\n"
    ).encode()
    output = SPATIAL / "floor-graphs.json"
    output.write_bytes(data)
    output.with_suffix(".sha256").write_text(hashlib.sha256(data).hexdigest() + "\n")


if __name__ == "__main__":
    main()
