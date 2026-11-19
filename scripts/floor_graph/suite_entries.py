"""Offer an identified public suite entrance for an inner room with a drawn opening.

These alternatives stop at the host's mapped entrance. They confer no permission
to enter a private office and add no through edge between public corridors.
"""

from collections import defaultdict

import numpy as np
from cad_doorways import apertures
from door_stations import stamp_region


def shared_suite_entries(grid, places, symbols, protected):
    size = np.asarray([grid.w, grid.h])
    members = defaultdict(list)
    for place in places:
        r = stamp_region(grid.regions, place["bounds"])
        if r:
            members[r].append(place)
    neighbors = defaultdict(set)
    for middle, normal, radius in apertures(symbols):
        # Verify both compartments on either side of this fitted aperture.
        tangent = np.array([-normal[1], normal[0]])
        samples = []
        for side, depth in ((1, 1.27), (-1, 0.55)):
            points = (
                middle
                + side * depth * radius * normal
                + np.array([-0.17, 0, 0.17])[:, None] * tangent * radius
            )
            pix = np.rint(points).astype(int)
            if (
                (pix < 0).any()
                or (pix[:, 0] >= grid.w).any()
                or (pix[:, 1] >= grid.h).any()
            ):
                break
            ids, counts = np.unique(
                grid.regions[pix[:, 1], pix[:, 0]], return_counts=True
            )
            region = int(ids[np.argmax(counts)])
            if not region or max(counts) < 2:
                break
            samples.append(region)
        if len(samples) == 2 and samples[0] != samples[1]:
            a, b = samples
            neighbors[a].add(b)
            neighbors[b].add(a)

    def hosts(region):
        rows = members.get(region, [])
        if any(
            p.get("visitorAccess")
            or p["kind"]
            in {"staff", "shaft", "void", "mechanical", "electrical", "storage"}
            for p in rows
        ):
            return []
        return [
            p
            for p in rows
            if p["kind"] in {"corridor", "atrium", "reception"}
            and p["label"] not in protected
            and (p["cells"] or p.get("terminalPaths"))
            and not p.get("sharedEntry")
        ]

    for r, rows in members.items():
        actual = [p for p in rows if p["kind"] not in {"shaft", "void"}]
        if len(actual) != 1:
            continue
        place = actual[0]
        if (
            place.get("sharedEntry")
            or place.get("sharedAccess")
            or place.get("visitorAccess")
            or place["label"] in protected
            or place["kind"] in {"staff", "stairs", "elevator", "shaft", "void"}
            or (place["kind"] == "room" and place["label"].startswith("M"))
        ):
            continue
        available = [p for nr in neighbors[r] for p in hosts(nr)]
        # Multiple named suites are genuinely ambiguous. Do not guess a parent.
        if len(available) != 1 or available[0] is place:
            continue
        host = available[0]
        # Both source stamps must be in the immediate neighborhood of this
        # shared wall. A leaked exterior component must never name a remote host.
        center = lambda p: (np.asarray(p["bounds"][:2]) + p["bounds"][2:]) * size / 2
        if np.linalg.norm(center(host) - center(place)) > min(grid.w, grid.h) * 0.12:
            continue
        place["sharedAccess"] = {
            "host": host["label"],
            "cells": list(host["cells"]),
            "terminalPaths": list(host.get("terminalPaths", [])),
        }


def bind_shared_suites(grid, places, suites):
    """Bind a transcribed suite to its actual public entrance on this source sheet."""
    place_by_name = {p["label"]: p for p in places}
    for suite in suites:
        parent = place_by_name[suite["entrance"]]
        source_point = np.array(suite["threshold"]) * [grid.w, grid.h]

        def near(cell):
            centre = (
                np.array([cell % grid.gw, cell // grid.gw]) + 0.5
            ) * grid.cell_size
            return np.linalg.norm(centre - source_point) <= 24

        entrance_cells = [c for c in parent["cells"] if near(c)]
        entrance_paths = [
            path
            for path in parent.get("terminalPaths", [])
            if np.linalg.norm(
                np.array(path["via"][0]) * [grid.w, grid.h] - source_point
            )
            <= 24
        ]
        if not entrance_cells and not entrance_paths:
            raise ValueError(
                "The shared suite needs its marked entrance: " + parent["label"]
            )
        for label in suite["rooms"]:
            place = place_by_name[label]
            if place["cells"] or place.get("terminalPaths"):
                place["sharedAccess"] = {
                    "host": parent["label"],
                    "cells": entrance_cells,
                    "terminalPaths": entrance_paths,
                }
                continue
            place["sharedEntry"] = True
            place["sharedHost"] = parent["label"]
            place["cells"] = list(entrance_cells)
            place["terminalPaths"] = list(entrance_paths)
