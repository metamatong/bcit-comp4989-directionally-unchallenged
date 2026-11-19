"""Resolve the two sides of a source doorway and bind rooms to public or suite approaches."""

from collections import defaultdict
import numpy as np
from doors import SCALE
from terminal_paths import TerminalPaths


def clear_segment(mask, a, b):
    points = np.rint(
        np.linspace(a, b, max(2, int(np.linalg.norm(b - a) * 1.5) + 1))
    ).astype(int)
    h, w = mask.shape
    return (
        points[:, 0].min() >= 0
        and points[:, 1].min() >= 0
        and points[:, 0].max() < w
        and points[:, 1].max() < h
        and not np.any(mask[points[:, 1], points[:, 0]])
    )


def label_centre(word, size):
    return (np.array(word["box"][:2]) + word["box"][2:]) * size / 2


def apertures(symbols):
    for hinge, tip, normal, r in symbols:
        centre = (hinge + tip) * SCALE / 2
        yield centre, normal, r * SCALE


def _source_room(members, face, normal, radius, sealed, size):
    # The approach belongs to the enclosure containing the printed room. A shaft
    # or a leader beside the room label cannot turn the entire hallway into a room.
    candidates = [
        word for word in members if word["kind"] not in {"corridor", "shaft", "void"}
    ]
    if (
        len(candidates) == 1
        and all(w["kind"] != "corridor" for w in members)
        and np.linalg.norm(label_centre(candidates[0], size) - face) <= 25 * radius
    ):
        return candidates[0]
    visible = []
    for word in candidates:
        anchor = label_centre(word, size)
        delta = anchor - face
        if delta @ normal < -0.15 * radius or np.linalg.norm(delta) > 24 * radius:
            continue
        if clear_segment(sealed, face, anchor):
            visible.append(word)
    return visible[0] if len(visible) == 1 else None


def door_faces(grid, middle, normal, radius):
    # On the swing side the sample must lie BEYOND the open leaf. A small
    # free crescent inside a drawn arc is neither the room nor its corridor.
    tangent = np.array([-normal[1], normal[0]])
    faces = []
    for sign, depths in ((1, (1.18, 1.38, 1.62, 1.85)), (-1, (0.48, 0.64, 0.85, 1.1))):
        face = None
        for depth in depths:
            for shift in (0, -0.24, 0.24):
                p = middle + (normal * sign * depth + tangent * shift) * radius
                x, y = np.rint(p).astype(int)
                if not (0 <= x < grid.w and 0 <= y < grid.h) or grid.sealed[y, x]:
                    continue
                region = int(grid.regions[y, x])
                if not region:
                    continue
                mouth = middle + (normal * sign * 0.32 + tangent * shift) * radius
                if not clear_segment(grid.structural, mouth, p):
                    continue
                face = (p, region)
                break
            if face:
                break
        if face is not None:
            faces.append(face)
    return faces


def _outside_station(grid, middle, normal, radius):
    # A signed door can be used as a stopping point even when the linework in
    # the host room does not permit walking through its threshold.
    tangent = np.array([-normal[1], normal[0]])
    for shift in (0, -0.27, 0.27):
        clear = False
        for depth in np.arange(0.25, 2.05, 0.16):
            p = middle + (normal * depth + tangent * shift) * radius
            x, y = np.rint(p).astype(int)
            if not (0 <= x < grid.w and 0 <= y < grid.h):
                break
            if grid.structural[y, x]:
                if clear or depth > 0.55:
                    break
                continue
            clear = True
            cell = grid.cell_near(p, grid.cell_size * 2)
            if cell is not None:
                return cell
    return None


def bind_doors(grid, interior, rooms, by_region, symbols, barriers, swing_count):
    portals = []
    interior_openings = []
    endpoints = []
    shared = defaultdict(list)
    exterior = set(
        np.unique(
            np.concatenate(
                (
                    grid.regions[0],
                    grid.regions[-1],
                    grid.regions[:, 0],
                    grid.regions[:, -1],
                )
            )
        )
    )
    size = np.array([grid.w, grid.h])
    for number, (middle, normal, radius) in enumerate(apertures(symbols)):
        faces = door_faces(grid, middle, normal, radius)
        if len(faces) != 2:
            continue
        passable = clear_segment(barriers, faces[0][0], faces[1][0])
        public_cells = [grid.cell_near(p, radius * 0.78) for p, _ in faces]
        floor_cells = [interior.cell_near(p, radius * 0.78) for p, _ in faces]
        through = [faces[0][0], middle, faces[1][0]]
        normalized = [np.round(p / size, 7).tolist() for p in through]
        if passable and None not in public_cells and public_cells[0] != public_cells[1]:
            portals.append([*public_cells, *normalized])
        if passable and None not in floor_cells and floor_cells[0] != floor_cells[1]:
            interior_openings.append((*floor_cells, through))
        for i, (p, region) in enumerate(faces):
            if public_cells[i] is not None and (
                faces[0][1] == faces[1][1]
                or any(w["kind"] == "corridor" for w in by_region[region])
            ):
                continue
            if region in exterior or not region:
                continue
            room = _source_room(
                by_region[region],
                p,
                normal if i == 0 else -normal,
                radius,
                grid.partition,
                size,
            )
            # Several desks/offices can share a drawn suite. Offer its actual entry
            # separately when the sheet does not identify an individual doorway.
            others = by_region[region]
            if (
                region not in exterior
                and region != faces[1 - i][1]
                and floor_cells[1 - i] is not None
            ):
                for item in others:
                    if item is room or item["kind"] in {
                        "shaft",
                        "void",
                        "stairs",
                        "elevator",
                    }:
                        continue
                    anchor = label_centre(item, size)
                    if (
                        np.linalg.norm(anchor - p) <= 18 * radius
                        and (anchor - p) @ (normal if i == 0 else -normal)
                        > -radius * 0.15
                        and clear_segment(grid.partition, p, anchor)
                    ):
                        shared[id(item)].append(
                            (
                                float(np.linalg.norm(anchor - p)),
                                floor_cells[1 - i],
                                middle if passable else faces[1 - i][0],
                                faces[1 - i][0],
                                region,
                            )
                        )
            if room is None:
                continue
            place = rooms[id(room)]
            cell = public_cells[1 - i]
            if cell is None and region != faces[1 - i][1]:
                cell = _outside_station(
                    grid, middle, -normal if i == 0 else normal, radius
                )
            record = [*normalized[1], cell]
            if number < swing_count and record not in place["doors"]:
                place["doors"].append(record)
            if cell is not None:
                place["cells"].add(cell)
            elif floor_cells[1 - i] is not None and region != faces[1 - i][1]:
                endpoints.append(
                    (
                        place,
                        floor_cells[1 - i],
                        middle if passable else faces[1 - i][0],
                        faces[1 - i][0],
                        region,
                    )
                )
    terminal = TerminalPaths(interior, grid, interior_openings)
    for place, cell, point, face, region in endpoints:
        path = terminal.path(cell, point, face, region)
        if path and path not in place.get("terminalPaths", []):
            place.setdefault("terminalPaths", []).append(path)
    for key, options in shared.items():
        place = rooms[key]
        if place["cells"] or place.get("terminalPaths"):
            continue
        for _, cell, point, face, region in sorted(options, key=lambda o: o[0]):
            path = terminal.path(cell, point, face, region)
            if path:
                place["sharedEntry"] = True
                place["terminalPaths"] = [path]
                break
    return portals, terminal
