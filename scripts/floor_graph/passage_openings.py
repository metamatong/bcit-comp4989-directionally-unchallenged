"""Open only the centres of source-identified pairs of door swings inside public corridors."""

import cv2
import numpy as np
from doors import SCALE, curve_points


def _swing(primitive):
    segments = list(curve_points(primitive.get("path", [])))
    if primitive["kind"] != "curve" or primitive["filled"] or not segments:
        raise ValueError("Expected a stroked door arc: " + primitive["id"])
    points = np.array([segments[0][0], *[b for _, b in segments]])
    local = points - points[0]
    centre, *_ = np.linalg.lstsq(
        2 * local[1:], (local[1:] ** 2).sum(axis=1), rcond=None
    )
    radius = np.linalg.norm(centre)
    radial = local - centre
    sweep = np.unwrap(np.arctan2(radial[:, 1], radial[:, 0]))
    if (
        not 2.6 <= radius <= 30
        or not 1.29 < abs(sweep[-1] - sweep[0]) < 1.78
        or max(np.abs(np.linalg.norm(radial, axis=1) - radius)) > radius * 0.055
    ):
        raise ValueError("Expected a quarter-turn door swing: " + primitive["id"])
    return points[[0, -1]], points[0] + centre, radius


def _opening(pair):
    (a, h1, r1), (b, h2, r2) = map(_swing, pair)
    gaps = np.linalg.norm(a[:, None] - b, axis=2)
    i, j = np.unravel_index(gaps.argmin(), gaps.shape)
    centre = (a[i] + b[j]) / 2
    # Two opposite hinges and one common meeting point distinguish a paired door
    # from unrelated arcs (including adjacent room doors).
    if gaps[i, j] > 0.25 or np.dot(h1 - centre, h2 - centre) > -0.95 * r1 * r2:
        raise ValueError("The two leaves do not share a doorway.")
    across = (h2 - h1) / np.linalg.norm(h2 - h1)
    return centre, across, min(r1, r2), np.array([h1, h2])


def _floor_finish(page, primitive):
    if primitive["kind"] != "line" or len(primitive["points"]) != 2:
        raise ValueError("Expected a CAD floor-finish line.")
    original = np.array(primitive["points"])
    for shape in page.get_drawings():
        if shape.get("layer", "").split("|")[-1].upper() != "A-FLOR":
            continue
        for item in shape["items"]:
            if item[0] != "l":
                continue
            ends = np.array([list(p * page.rotation_matrix) for p in item[1:]])
            if np.allclose(ends, original, rtol=0, atol=0.08) or np.allclose(
                ends[::-1], original, rtol=0, atol=0.08
            ):
                return
    raise ValueError(
        "The declared floor marking does not match A-FLOR on this sheet: "
        + primitive["id"]
    )


def _paint(primitive, mask, origin):
    """Rasterize this primitive in the small aperture window. Keep unknown ink blocked."""

    def pixel(p):
        return np.rint(np.array(p) * SCALE - origin).astype(np.int32)

    path = primitive.get("path", [])
    if not path or any(command[0] not in {"m", "l", "c", "h"} for command in path):
        x0, y0, x1, y1 = primitive["bbox"]
        cv2.rectangle(mask, pixel([x0, y0]), pixel([x1, y1]), 255, -1)
        return
    paths = []
    for command in path:
        if command[0] == "m":
            paths.append([])
        if paths:
            paths[-1].append(command)
    for commands in paths:
        segments = list(curve_points(commands))
        if not segments:
            continue
        points = np.array([pixel(segments[0][0]), *[pixel(b) for _, b in segments]])
        if primitive["filled"]:
            cv2.fillPoly(mask, [points], 255)
        cv2.polylines(
            mask,
            [points],
            commands[-1][0] == "h",
            255,
            max(1, int(np.ceil(primitive["strokeWidth"] * SCALE))),
        )


def _open_gate(page, geometry, by_id, record, sealed, public):
    pair = [by_id[pid] for pid in record["swings"]]
    if len(pair) != 2 or pair[0]["id"] == pair[1]["id"]:
        raise ValueError("Expected two distinct door leaves.")
    centre, across, radius, hinges = _opening(pair)
    removable = {p["id"] for p in pair}
    for pid in record.get("floorFinishLines", []):
        _floor_finish(page, by_id[pid])
        removable.add(pid)

    # Limit changes to a sub-door-width strip. At this step the floor's labels
    # and enclosed spaces have already been classified using the original ink.
    half_width = radius * 0.55
    along = np.array([-across[1], across[0]])
    half_length = radius + 2.5
    corners = np.array(
        [
            centre + i * across * half_width + j * along * half_length
            for i in (-1, 1)
            for j in (-1, 1)
        ]
    )
    x0, y0 = np.maximum(0, np.floor(corners.min(axis=0) * SCALE).astype(int) - 5)
    x1, y1 = np.minimum(
        sealed.shape[::-1], np.ceil(corners.max(axis=0) * SCALE).astype(int) + 6
    )
    allowed = np.zeros((y1 - y0, x1 - x0), np.uint8)
    protected = np.zeros_like(allowed)
    for primitive in geometry["primitives"]:
        l, t, r, b = np.array(primitive["bbox"]) * SCALE
        if l > x1 + 2 or r < x0 - 2 or t > y1 + 2 or b < y0 - 2:
            continue
        _paint(
            primitive, allowed if primitive["id"] in removable else protected, (x0, y0)
        )

    # The segmentation pass may have closed the doorway along its jamb line.
    ends = np.rint(hinges * SCALE - [x0, y0]).astype(int)
    cv2.line(allowed, *ends, 255, 3)
    allowed = cv2.dilate(allowed, np.ones((5, 5), np.uint8))
    protected = cv2.dilate(protected, np.ones((3, 3), np.uint8))
    y, x = np.mgrid[y0:y1, x0:x1]
    dx, dy = x / SCALE - centre[0], y / SCALE - centre[1]
    lane = (np.abs(dx * across[0] + dy * across[1]) <= half_width) & (
        np.abs(dx * along[0] + dy * along[1]) <= half_length
    )
    inside = public[y0:y1, x0:x1] > 0
    if not (lane & inside & (allowed > 0)).any():
        raise ValueError("Doorway is outside the designated public corridor.")
    sealed[y0:y1, x0:x1][lane & inside & (allowed > 0) & (protected == 0)] = 0


def open_passage_doors(page, geometry, records, sealed, public):
    if not records:
        return
    by_id = {p["id"]: p for p in geometry["primitives"]}
    for record in records:
        _open_gate(page, geometry, by_id, record, sealed, public)


def open_ramp_markings(geometry, records, sealed, public, words):
    """Open the transverse drawing ticks of a signed ramp, keeping its side walls."""
    by_id = {p["id"]: p for p in geometry["primitives"]}
    for record in records:
        rectangle = by_id[record["outline"]]
        if (
            rectangle["kind"] != "rectangle"
            or rectangle["filled"]
            or not any(
                w["text"] == record["corridor"] and w["kind"] == "corridor"
                for w in words
            )
        ):
            raise ValueError("Expected the registered ramp and its corridor stamp.")
        a, b, c, d = np.array(rectangle["bbox"]) * SCALE
        x = record["laneX"] * sealed.shape[1]
        if d - b <= c - a or not a + 5 < x < c - 5:
            raise ValueError("Ramp lane must stay between the two side rails.")
        for y in (b, d):
            l, t, r, bt = np.rint([x - 5, y - 4, x + 5, y + 4]).astype(int)
            preserve = np.zeros((bt - t + 1, r - l + 1), np.uint8)
            for item in geometry["primitives"]:
                if item["id"] == rectangle["id"]:
                    continue
                x0, y0, x1, y1 = np.array(item["bbox"]) * SCALE
                if x0 <= r + 2 and l - 2 <= x1 and y0 <= bt + 2 and t - 2 <= y1:
                    _paint(item, preserve, np.array([l, t]))
            protect = cv2.dilate(preserve, np.ones((3, 3), np.uint8))
            patch = sealed[t : bt + 1, l : r + 1]
            patch[(protect == 0) & (public[t : bt + 1, l : r + 1] > 0)] = 0


def signed_door_cells(grid, words, sides, records):
    """Resolve a marked public-side approach beside another door's overlapping swing."""
    cells = {}
    callout_doors = {}
    for record in records:
        labels = [w for w in words if w["text"] == record["room"]]
        target = grid.norm(record["point"])
        aperture = grid.norm(record["threshold"])
        found = [d for d in sides if np.linalg.norm(d[3] - aperture) < 0.3]
        if len(labels) != 1 or len(found) != 1:
            raise ValueError(
                "Cannot identify the marked room and door: " + record["room"]
            )
        a, b, faces, middle, radius = found[0]
        room = labels[0]["region"]
        if "roomProbe" in record:
            # Some plans print the identifier outside its room. A point just inside the
            # fitted doorway identifies the enclosure without making the text walkable.
            probe = grid.norm(record["roomProbe"])
            x, y = np.rint(probe).astype(int)
            if (
                not (0 <= x < grid.w and 0 <= y < grid.h)
                or np.linalg.norm(probe - middle) > 2 * radius
            ):
                raise ValueError("Invalid room-side callout point: " + record["room"])
            room = int(grid.regions[y, x])
        if room not in (a, b):
            raise ValueError("Door must bound its labelled room: " + record["room"])
        public_side = 1 if a == room else 0
        normal = faces[public_side] - middle
        normal = normal / np.linalg.norm(normal)
        delta = target - middle
        depth = float(delta @ normal)
        lateral = delta - depth * normal
        # Stay within the width of the same leaf, on the public side of the wall.
        if not 0 < depth <= 2 * radius or np.linalg.norm(lateral) > radius * 0.48:
            raise ValueError("Walking point is outside the specified doorway.")
        start = faces[public_side] + lateral
        line = np.rint(
            np.linspace(
                start,
                target,
                max(2, int(np.ceil(np.linalg.norm(target - start) * 2)) + 1),
            )
        ).astype(int)
        other = (a, b)[public_side]
        if not np.all(grid.regions[line[:, 1], line[:, 0]] == other) or np.any(
            grid.sealed[line[:, 1], line[:, 0]]
        ):
            raise ValueError(
                "An obstruction separates the walking point from the door."
            )
        cell = grid.cell_near(target, grid.cell_size * 2)
        if cell is None:
            raise ValueError("The marked door needs a public walking cell.")
        cells[(room, tuple(middle))] = cell
        if "roomProbe" in record:
            threshold = np.round(middle / [grid.w, grid.h], 7).tolist()
            callout_doors.setdefault(record["room"], []).append([*threshold, cell])
    return cells, callout_doors


def _on_room_front(record, grid, places, place, middle, target, along_wall, radius):
    bounds = np.array(place["bounds"])
    centre = grid.norm((bounds[:2] + bounds[2:]) / 2)
    if "roomSide" not in record:
        half_stamp = np.abs(along_wall) @ grid.norm((bounds[2:] - bounds[:2]) / 2)
        return abs((centre - middle) @ along_wall) <= half_stamp + radius * SCALE / 2
    # Tier lines can separate a lecture-room stamp from its door. The source-bound
    # polygon identifies the room side only; none of it becomes a walking surface.
    polygon = np.asarray([grid.norm(pair) for pair in record["roomSide"]], np.float32)
    distance = lambda p: cv2.pointPolygonTest(polygon, tuple(map(float, p)), True)
    inside = [
        p
        for p in places
        if distance(grid.norm((np.asarray(p["bounds"][:2]) + p["bounds"][2:]) / 2)) > 0
    ]
    return (
        len(inside) == 1
        and inside[0] is place
        and distance(target) < 0
        and all(
            abs(distance(middle + t * along_wall * radius * SCALE)) < 1
            for t in (-0.44, 0, 0.44)
        )
    )


def bind_corridor_doorways(grid, words, places, symbols, records):
    """Bind the public stop at a drawn door when ink or interior steps split its sample regions."""
    for record in records:
        room = record["room"]
        matches = [p for p in places if p["label"] == room]
        halls = [
            w
            for w in words
            if w["text"] == record["corridor"] and w["kind"] == "corridor"
        ]
        threshold = grid.norm(record["threshold"])
        leaves = [
            (hinge, tip, normal, radius)
            for hinge, tip, normal, radius in symbols
            if np.linalg.norm((hinge + tip) * (SCALE / 2) - threshold) < 0.3
        ]
        if len(matches) != 1 or len(halls) != 1 or len(leaves) != 1:
            raise ValueError(
                "Cannot identify the source room, corridor and door: " + room
            )
        place, hall = matches[0], halls[0]
        hinge, tip, normal, radius = leaves[0]
        middle = (hinge + tip) * (SCALE / 2)
        target = grid.norm(record["point"])
        delta = target - middle
        depth = delta @ normal
        bounds = np.array(place["bounds"])
        room_centre = grid.norm((bounds[:2] + bounds[2:]) / 2)
        along_wall = (tip - hinge) / np.linalg.norm(tip - hinge)
        if (
            not 0 < abs(depth) <= 2 * radius * SCALE
            or np.linalg.norm(delta - depth * normal) > 0.48 * radius * SCALE
            or ((room_centre - middle) @ normal) * depth >= 0
            or not _on_room_front(
                record, grid, places, place, middle, target, along_wall, radius
            )
        ):
            raise ValueError(
                "The marked approach must face the room from the corridor: " + room
            )
        x, y = np.floor(target / grid.cell_size).astype(int)
        pixel_x, pixel_y = np.floor(target).astype(int)
        if (
            not (0 <= x < grid.gw and 0 <= y < grid.gh)
            or not grid.grid[y, x]
            or not hall["region"]
            or grid.regions[pixel_y, pixel_x] != hall["region"]
        ):
            raise ValueError(
                "The marked approach needs a walking cell in the named corridor: "
                + room
            )
        cell = int(y * grid.gw + x)
        doorway = np.round(middle / [grid.w, grid.h], 7).tolist()
        place["doors"] = [d for d in place["doors"] if d[:2] != doorway] + [
            [*doorway, cell]
        ]
        place["cells"] = sorted(set([*place["cells"], cell]))
