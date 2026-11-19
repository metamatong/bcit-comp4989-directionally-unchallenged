"""Compile source-bound CAD walking surfaces, physical approaches and reviewed landing ties."""

from collections import defaultdict
import cv2
import numpy as np
from cad_doorways import apertures, clear_segment, door_faces
from cad_places import CadSheet, floor_entries
from cad_spaces import cad_spaces
from cad_layers import CadLayers, open_wall_gaps
from cad_landings import landing_cells
from labels import label_words
from public_components import transfer_components
from surfaces import at_label, labelled_corridor_strips
from passage_openings import open_passage_doors
from doors import SCALE


def _corridors(config, words, regions, stats, by_region):
    h, w = regions.shape
    public = np.zeros((h, w), np.uint8)
    for region, members in by_region.items():
        if (
            not region
            or not members
            or not all(s["kind"] == "corridor" for s in members)
        ):
            continue
        x, y, rw, rh, area = stats[region]
        if (
            x > 1
            and y > 1
            and x + rw < w - 1
            and y + rh < h - 1
            and area < w * h * 0.16
        ):
            public[regions == region] = 255
    names = {word["text"] for word in words} | set(config.get("cadFacilityLabels", {}))
    for bounds in config.get("cadPublicAreas", []):
        left, top, right, bottom = bounds["bounds"]
        if bounds["near"] not in names or not (
            0 <= left < right <= 1 and 0 <= top < bottom <= 1
        ):
            raise ValueError("Invalid source-bound circulation area: " + bounds["near"])
        x0, y0, x1, y1 = np.rint(np.array(bounds["bounds"]) * [w, h, w, h]).astype(int)
        public[y0 : y1 + 1, x0 : x1 + 1] = 255
    for polygon in config.get("areas", []):
        cv2.fillPoly(
            public, [np.rint(np.array(polygon) * [w, h]).astype(np.int32)], 255
        )
    return public


def compile_cad_floor(plan, page, geometry, extra, reviewed, grid_type):
    source = label_words(plan, page, extra.get("labels"))
    words = cad_spaces(page, plan, source)
    cad = CadLayers(page, extra["cadLayers"], extra.get("cadDoorSills", []))
    symbols = cad.swings()
    partition = cad.walls | cad.door_ink
    for hinge, tip, *_ in symbols:
        cv2.line(
            partition, *[np.rint(p * SCALE).astype(int) for p in (hinge, tip)], 255, 3
        )
    kernel = np.ones((3, 3), np.uint8)
    gap_cuts, open_bays = open_wall_gaps(cad.walls, symbols)
    partition = cv2.dilate(partition, kernel)
    segmentation = partition | gap_cuts
    _, regions, stats, _ = cv2.connectedComponentsWithStats(
        255 - segmentation, connectivity=4
    )
    by_region = defaultdict(list)
    for word in words:
        word["region"] = at_label(regions, word["box"])
        by_region[word["region"]].append(word)
    public = _corridors(extra, words, regions, stats, by_region)
    radius = float(np.median([s[3] for s in symbols])) * SCALE
    # Fill only short gaps between two transcribed circulation extents. The original
    # structural and threshold mask is applied afterwards and still blocks every wall.
    diameter = max(3, round(radius * 1.3) | 1)
    public = cv2.morphologyEx(
        public,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (diameter, diameter)),
    )
    drawing_bounds = np.zeros_like(public)
    for poly in extra["cadInteriorBounds"]:
        cv2.fillPoly(
            drawing_bounds,
            [np.rint(np.array(poly) * public.shape[::-1]).astype(np.int32)],
            255,
        )
    strips = labelled_corridor_strips(
        partition, regions, words, extra.get("corridorSeeds", []), radius
    )
    public[strips & (drawing_bounds > 0)] = 255
    barriers = cad.walls | cad.objects
    sealed = partition | cv2.dilate(cad.objects, kernel)
    open_passage_doors(page, geometry, extra.get("passageOpenings", []), sealed, public)
    # A reported staff-only interior is closed in both the public and terminal
    # graphs. Its label remains evidence and its mark cannot become a map pin.
    restrictions = extra.get("visitorRestrictions", [])
    restricted = np.zeros_like(sealed)
    for rule in restrictions:
        if rule["access"] != "staff-only" or rule["basis"] != "user-confirmation":
            raise ValueError("An explicit visitor-access determination is required")
        for coordinates in rule["areas"]:
            polygon = np.rint(
                np.array(coordinates) * [sealed.shape[1], sealed.shape[0]]
            ).astype(np.int32)
            cv2.fillPoly(restricted, [polygon], 255)
    sealed |= restricted
    barriers |= restricted
    local = grid_type((public > 0) & (sealed == 0), sealed, regions, 2)
    local.partition = segmentation
    local.structural = barriers
    nodes = [
        n
        for n in reviewed
        if n["planId"] == plan["id"] and n["sourceSha256"] == plan["sourceSha256"]
    ]
    primary = transfer_components(
        local,
        extra,
        nodes,
        list(apertures([*symbols, *open_bays])),
        door_faces,
        clear_segment,
        barriers,
    )
    primary.partition = segmentation
    primary.structural = barriers
    sheet = CadSheet(
        plan,
        page,
        geometry,
        extra,
        cad,
        words,
        symbols,
        open_bays,
        regions,
        by_region,
        barriers,
    )
    places, portals, bands, terminal, audit, stations = floor_entries(
        local, False, sheet
    )
    preferred, _, _, _, pa, ps = floor_entries(primary, True, sheet)
    for key in audit:
        audit[key] |= pa.get(key, False)
    for key in stations:
        stations[key] |= ps.get(key, False)
    for i, (base, connected) in enumerate(zip(places, preferred)):
        if not connected["cells"] and not connected.get("terminalPaths"):
            continue
        if (
            connected.get("sharedEntry")
            and (base["cells"] or base.get("terminalPaths"))
            and not base.get("sharedEntry")
        ):
            continue
        # Keep distinct physically drawn doors on this sheet. At the very same
        # threshold prefer the approach to an approved transfer over a detached strip.
        seen = {tuple(d[:2]) for d in connected["doors"] if d[2] is not None}
        seen.update(
            tuple(path["via"][0]) for path in connected.get("terminalPaths", [])
        )
        for x, y, cell in base["doors"]:
            if (x, y) in seen or cell is None:
                continue
            connected["doors"] = [d for d in connected["doors"] if d[:2] != [x, y]] + [
                [x, y, cell]
            ]
            connected["cells"] = sorted(set([*connected["cells"], cell]))
        if not base.get("sharedEntry"):
            for path in base.get("terminalPaths", []):
                if tuple(path["via"][0]) not in seen:
                    connected.setdefault("terminalPaths", []).append(path)
        places[i] = connected
    missing = [key for key, valid in {**audit, **stations}.items() if not valid]
    if missing:
        raise ValueError(
            f"{plan['id']} source frontages need review: {', '.join(missing)}"
        )
    place_by_name = {p["label"]: p for p in places}
    for suite in extra.get("cadSharedSuites", []):
        parent = place_by_name[suite["entrance"]]
        source_point = np.array(suite["threshold"]) * [local.w, local.h]

        def near(cell):
            centre = (
                np.array([cell % local.gw, cell // local.gw]) + 0.5
            ) * local.cell_size
            return np.linalg.norm(centre - source_point) <= 24

        entrance_cells = [c for c in parent["cells"] if near(c)]
        entrance_paths = [
            path
            for path in parent.get("terminalPaths", [])
            if np.linalg.norm(
                np.array(path["via"][0]) * [local.w, local.h] - source_point
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
                continue
            place["sharedEntry"] = True
            place["sharedHost"] = parent["label"]
            place["cells"] = list(entrance_cells)
            place["terminalPaths"] = list(entrance_paths)
    published = {n["id"]: n for n in nodes}
    for label, binding in extra.get("cadReviewedDoors", {}).items():
        node = published.get(binding["nodeId"])
        if not node:
            continue
        if (
            node["kind"] != "door"
            or node["version"] != binding["version"]
            or list(node["point"].values()) != binding["point"]
        ):
            raise ValueError("Stale surveyed room doorway: " + label)
        place_by_name[label]["reviewedDoor"] = binding
    for rule in restrictions:
        place = place_by_name[rule["label"]]
        place.update(visitorAccess=rule["access"], cells=[])
        place.pop("terminalPaths", None)
        place.pop("sharedEntry", None)
    landings = landing_cells(plan, places, reviewed, local, cad, symbols, extra)
    return local, places, portals, bands, landings, len(symbols), terminal.export()
