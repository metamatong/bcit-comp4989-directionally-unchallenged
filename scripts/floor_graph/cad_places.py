"""Attach exact source place occurrences to usable cells, doorways and open bays."""

from dataclasses import dataclass
import numpy as np
import pymupdf
from cad_doorways import apertures, bind_doors, clear_segment, door_faces, label_centre
from cad_frontages import marked_frontages, mapped_stations, threshold_stations
from corridor_frontages import bind_frontages, corridor_bands, recorded_swings
from doors import SCALE
from labels import MANUAL
from open_fronts import bay_mouths
from surfaces import at_label
from terminal_paths import interior_grid
from cad_layers import CadLayers


@dataclass
class CadSheet:
    plan: dict
    page: pymupdf.Page
    geometry: dict
    extra: dict
    cad: CadLayers
    words: list
    symbols: list
    open_bays: list
    regions: np.ndarray
    by_region: dict
    barriers: np.ndarray


def floor_entries(grid, regional, sheet):
    plan, page, geometry, extra = sheet.plan, sheet.page, sheet.geometry, sheet.extra
    cad, words, symbols, open_bays = (
        sheet.cad,
        sheet.words,
        sheet.symbols,
        sheet.open_bays,
    )
    regions, by_region, barriers = sheet.regions, sheet.by_region, sheet.barriers

    places = []
    rooms = {}
    size = np.array([grid.w, grid.h])
    for word in words:
        place = {
            "label": word["text"],
            "bounds": word["box"],
            "kind": word["kind"],
            "method": word["method"],
            "doors": [],
            "cells": set(),
        }
        places.append(place)
        rooms[id(word)] = place
        if word["kind"] == "corridor" and word["region"]:
            cell = grid.cell_near(label_centre(word, size), grid.cell_size * 6)
            if cell is not None:
                place["cells"].add(cell)
    interior = interior_grid(grid, extra, regions, by_region)
    portals, terminal = bind_doors(
        grid, interior, rooms, by_region, [*symbols, *open_bays], barriers, len(symbols)
    )
    radius = float(np.median([s[3] for s in symbols])) * SCALE
    for word in words:
        place = rooms[id(word)]
        if (
            place["cells"]
            or place.get("terminalPaths")
            or word["kind"] in {"shaft", "void", "stairs", "elevator"}
            or not word["region"]
        ):
            continue
        for point, normal in bay_mouths(
            cad, word, by_region[word["region"]], size, radius
        ):
            face = point + normal * max(2, radius * 0.25)
            if not clear_segment(grid.sealed, point, face):
                continue
            cell = grid.cell_near(face, grid.cell_size * 3)
            if cell is not None:
                place["cells"].add(cell)
            else:
                inner = interior.cell_near(face, interior.cell_size * 3)
                if inner is None:
                    continue
                path = terminal.path(inner, point, face, None)
                if path:
                    place.setdefault("terminalPaths", []).append(path)

    for place in places:
        place["cells"] = sorted(place["cells"])
    for record in extra.get("accessPoints", []):
        matches = [p for p in places if p["label"] == record["label"]]
        if len(matches) != 1:
            raise ValueError("Ambiguous transcribed approach: " + record["label"])
        cell = grid.cell_near(
            grid.norm(record["point"]), grid.cell_size * 8, boundary=True
        )
        if cell is None:
            if regional:
                continue
            raise ValueError("Obstructed transcribed approach: " + record["label"])
        matches[0]["cells"] = sorted(set([*matches[0]["cells"], cell]))
    audit = marked_frontages(
        extra,
        grid,
        interior,
        terminal,
        list(apertures(symbols)),
        door_faces,
        barriers,
        cad.walls,
        words,
        places,
    )
    stations = mapped_stations(
        extra, grid, terminal, words, places, list(apertures(symbols))
    )
    stations.update(
        {
            "leaf:" + key: ok
            for key, ok in threshold_stations(
                extra, grid, terminal, list(apertures(symbols)), places
            ).items()
        }
    )
    outside = set(
        np.unique(
            np.concatenate((regions[0], regions[-1], regions[:, 0], regions[:, -1]))
        )
    )
    for word, place in zip(words, places):
        if (
            place["cells"]
            or place.get("terminalPaths")
            or word["kind"] in {"shaft", "void", "stairs", "elevator"}
        ):
            continue
        region = word["region"]
        if not region or region in outside:
            continue
        members = [w for w in by_region[region] if w["kind"] != "shaft"]
        if len(members) > 1 and (
            any(w["kind"] in {"corridor", "void"} for w in members)
            or word["caption"] != "OFFICE-OPN"
        ):
            continue
        path = terminal.entry_for_enclosure(
            region, label_centre(word, size), radius * 2.5
        )
        if path and len(path["via"]) > 1:
            place["terminalPaths"] = [path]
            if len(members) > 1:
                place["sharedEntry"] = True
    reference_cells = terminal.room_references(regions)
    for word, place in zip(words, places):
        region = word["region"]
        cell = reference_cells.get(region)
        if (
            cell is None
            or place["cells"]
            or place.get("terminalPaths")
            or region in outside
            or word["kind"] in {"shaft", "void", "stairs", "elevator"}
            or len(by_region[region]) != 1
            or "captionBox" not in word
            or at_label(regions, word["captionBox"]) != region
        ):
            continue
        centre = (np.array([cell % grid.gw, cell // grid.gw]) + 0.5) * grid.cell_size
        if grid.grid.flat[cell]:
            place["cells"] = [cell]
        else:
            path = terminal.path(cell, centre, centre, None)
            if not path or len(path["via"]) < 2:
                continue
            place["terminalPaths"] = [path]
        place["roomArea"] = True
    for word, place in zip(words, places):
        if (
            place["cells"]
            or place.get("terminalPaths")
            or word["kind"] not in {"corridor", "atrium", "study"}
        ):
            continue
        centre = label_centre(word, size) / grid.cell_size
        named = []
        for area in extra.get("cadPublicAreas", []):
            if area["near"] != word["text"]:
                continue
            lo = np.ceil(grid.norm(area["bounds"][:2]) / grid.cell_size).astype(int)
            hi = np.floor(grid.norm(area["bounds"][2:]) / grid.cell_size).astype(int)
            ys, xs = np.where(grid.grid[lo[1] : hi[1], lo[0] : hi[0]])
            if len(xs):
                points = np.column_stack((xs + lo[0], ys + lo[1]))
                # Pick a real cell inside the independently traced named area.
                dist = np.linalg.norm(points + 0.5 - centre, axis=1)
                i = np.argmin(dist)
                named.append((dist[i], int(points[i][1] * grid.gw + points[i][0])))
        if named:
            place["cells"] = [min(named)[1]]
    if not regional:
        marked, structural = recorded_swings(
            page, geometry, extra.get("doorFrontages", [])
        )
        bind_frontages(grid, places, words, marked, structural)
    bands = corridor_bands(
        grid,
        places,
        extra.get("areas", []),
        [*MANUAL.get(plan["id"], {}).get("labels", []), *extra.get("labels", [])],
    )
    return places, portals, bands, terminal, audit, stations
