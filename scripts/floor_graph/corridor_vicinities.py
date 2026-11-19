"""Identify a public stopping area along a signed room's common wall with a corridor.

This is separate from a doorway. A continuous frontage can support directions to
the corridor outside a room even when the drawing does not resolve its entrance.
"""

from collections import defaultdict

import cv2
import numpy as np
from door_stations import stamp_region
from labels import IDENTIFIER

NON_ROOMS = {"corridor", "atrium", "shaft", "void", "stairs", "elevator"}


def _corridors(grid, members, config):
    mask = np.zeros_like(grid.sealed)
    public = [
        r
        for r, rows in members.items()
        if r and rows and all(w["kind"] in {"corridor", "atrium"} for w in rows)
    ]
    mask[np.isin(grid.regions, public)] = 255
    for points in config.get("areas", []):
        cv2.fillPoly(
            mask, [np.rint(np.array(points) * [grid.w, grid.h]).astype(np.int32)], 255
        )
    for area in config.get("cadPublicAreas", []):
        l, t, r, b = np.rint(
            np.array(area["bounds"]) * [grid.w, grid.h, grid.w, grid.h]
        ).astype(int)
        mask[t : b + 1, l : r + 1] = 255
    return mask


def corridor_vicinities(grid, places, config, radius, protected=()):
    members = defaultdict(list)
    for place in places:
        members[stamp_region(grid.regions, place["bounds"])].append(place)
    # A leaky enclosure with multiple room numbers cannot identify whose wall this is.
    owners = {}
    for region, rows in members.items():
        rooms = [w for w in rows if w["kind"] not in {"shaft", "void"}]
        if not region or len(rooms) != 1:
            continue
        room = rooms[0]
        if (
            room["kind"] in NON_ROOMS
            or not IDENTIFIER.fullmatch(room["label"])
            or room["label"] in protected
            or room.get("visitorAccess")
            or (room["kind"] == "room" and room["label"].startswith("M"))
        ):
            continue
        owners[region] = room
    if not owners:
        return
    corridor = _corridors(grid, members, config)
    y, x = np.where(grid.grid)
    pitch = grid.cell_size
    px, py = (
        np.rint((x + 0.5) * pitch).astype(int),
        np.rint((y + 0.5) * pitch).astype(int),
    )
    eligible = corridor[py, px] > 0
    x, y, px, py = (v[eligible] for v in (x, y, px, py))
    regions = grid.regions
    initial = regions[py, px]
    # The outside of the sheet or an unclassified void cannot be a signed room.
    area = np.bincount(regions.ravel())
    owner_ids = np.array([r for r in owners if area[r] < grid.w * grid.h * 0.12], int)
    if not owner_ids.size:
        return
    _, components = cv2.connectedComponents(grid.grid.astype(np.uint8), connectivity=4)
    contacts = defaultdict(dict)
    for dx, dy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        active = initial > 0
        wall = np.zeros(len(x), bool)
        for distance in range(1, max(4, round(0.85 * radius)) + 1):
            sx = np.clip(px + distance * dx, 0, grid.w - 1)
            sy = np.clip(py + distance * dy, 0, grid.h - 1)
            other = regions[sy, sx]
            wall |= (other == 0) & (grid.structural[sy, sx] > 0)
            entered = active & (other != 0) & (other != initial)
            hits = np.flatnonzero(entered & wall & np.isin(other, owner_ids))
            for i in hits:
                # Group consecutive public cells along one partition, not across corners.
                axis = int(y[i] if dx else x[i])
                key = (
                    int(other[i]),
                    int(initial[i]),
                    int(components[y[i], x[i]]),
                    dx,
                    dy,
                    int(x[i] if dx else y[i]),
                )
                contacts[key][axis] = int(y[i] * grid.gw + x[i])
            active &= ~entered
    best = {}
    for (room_id, public_id, component, dx, dy, _), row in contacts.items():
        coords = np.array(sorted(row))
        for span in np.split(coords, np.flatnonzero(np.diff(coords) != 1) + 1):
            if len(span) * pitch < max(3 * pitch, radius):
                continue
            cell = row[span[len(span) // 2]]
            point = (np.array([cell % grid.gw, cell // grid.gw]) + 0.5) * pitch
            room = owners[room_id]
            centre = grid.norm((np.array(room["bounds"][:2]) + room["bounds"][2:]) / 2)
            if (centre - point) @ [dx, dy] <= 0 or np.linalg.norm(
                centre - point
            ) > 26 * radius:
                continue
            key = (room_id, public_id, component, dx, dy)
            if key in best and best[key][0] >= len(span):
                continue
            ends = np.array(
                [[row[k] % grid.gw, row[k] // grid.gw] for k in (span[0], span[-1])]
            )
            bounds = (
                np.r_[ends.min(axis=0), ends.max(axis=0) + 1]
                * pitch
                / np.tile([grid.w, grid.h], 2)
            )
            best[key] = (len(span), {"cell": cell, "bounds": bounds.round(7).tolist()})
    for (region, *_), (_, station) in sorted(best.items()):
        owners[region].setdefault("corridorVicinities", []).append(station)
