"""Bind source-labelled door swings and compile shared stretches of named public corridors."""

import cv2
import pymupdf
import numpy as np

from doors import SCALE, curve_points
from labels import IDENTIFIER


def _structural_ink(page):
    # The public face can be covered by a printed shaft callout. Render a temporary
    # display copy with only PDF text objects suppressed, keeping all vector walls,
    # door leaves and images. The source PDF and visitor walk mask are untouched.
    with pymupdf.open() as drawing:
        drawing.insert_pdf(page.parent, from_page=page.number, to_page=page.number)
        sheet = drawing[0]
        sheet.add_redact_annot(
            sheet.rect * sheet.derotation_matrix, fill=False, cross_out=False
        )
        sheet.apply_redactions(
            images=pymupdf.PDF_REDACT_IMAGE_NONE,
            graphics=pymupdf.PDF_REDACT_LINE_ART_NONE,
            text=pymupdf.PDF_REDACT_TEXT_REMOVE,
        )
        pix = sheet.get_pixmap(
            matrix=pymupdf.Matrix(SCALE, SCALE), colorspace=pymupdf.csRGB, alpha=False
        )
        rgb = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
        return cv2.dilate(
            (rgb.min(axis=2) < 220).astype(np.uint8), np.ones((3, 3), np.uint8)
        )


def recorded_swings(page, geometry, entries):
    """Resolve each annotated leaf to a real arc in the source CAD door-swing layer."""
    if not entries:
        return [], None
    cad = []
    for shape in page.get_drawings():
        if (
            shape.get("layer", "").upper().split("|")[-1] != "DSWING"
            or not shape["items"]
        ):
            continue
        items = shape["items"]
        if not all(item[0] == "c" for item in items):
            continue
        tips = [
            items[0][1] * page.rotation_matrix,
            items[-1][-1] * page.rotation_matrix,
        ]
        cad.append(np.array([[p.x, p.y] for p in tips]))
    primitives = {p["id"]: p for p in geometry["primitives"]}
    selected = []
    for entry in entries:
        path = primitives[entry["swing"]]["path"]
        segments = list(curve_points(path))
        points = np.array([segments[0][0], *[end for _, end in segments]])
        tips = points[[0, -1]]
        if (
            sum(np.linalg.norm(source - tips, axis=1).max() < 0.15 for source in cad)
            != 1
        ):
            raise ValueError("Missing source door swing " + entry["swing"])
        local = points - points[0]
        centre, *_ = np.linalg.lstsq(
            2 * local[1:], (local[1:] ** 2).sum(axis=1), rcond=None
        )
        hinge = centre + points[0]
        radius = np.linalg.norm(centre)
        arms = tips - hinge
        if (
            not 2.6 <= radius <= 30
            or np.max(np.abs(np.linalg.norm(points - hinge, axis=1) - radius))
            > radius * 0.055
            or abs(np.dot(*arms)) > radius**2 * 0.22
        ):
            raise ValueError("Invalid marked quarter-turn on " + entry["swing"])
        if entry["closedTip"] not in ("first", "last"):
            raise ValueError("Specify the closed jamb of the marked leaf.")
        closed = 0 if entry["closedTip"] == "first" else 1
        middle = (hinge + tips[closed]) / 2
        normal = arms[1 - closed] / np.linalg.norm(arms[1 - closed])
        selected.append((entry["room"], middle * SCALE, normal, radius * SCALE))
    return selected, _structural_ink(page)


def bind_frontages(grid, places, words, selected, structural_ink):
    """Bind the public side only. A shaft callout printed in a lab is never a room alias."""
    for label, middle, swing_normal, radius in selected:
        occurrences = [p for p in places if p["label"] == label]
        identifiers = [w for w in words if w["text"] == label]
        if (
            len(occurrences) != 1
            or len(identifiers) != 1
            or not identifiers[0]["region"]
        ):
            raise ValueError("A frontage needs a unique source room: " + label)
        room_region = identifiers[0]["region"]
        # The public side may be the swing side or the side opposite the swing.
        # Test each side against the actual enclosed space containing the room identifier.
        faces = [
            middle + swing_normal * radius * 1.14,
            middle - swing_normal * radius * 0.48,
        ]

        def region(point):
            x, y = np.rint(point).astype(int)
            return grid.regions[y, x]

        room_sides = [i for i, p in enumerate(faces) if region(p) == room_region]
        if len(room_sides) != 1:
            raise ValueError("Marked swing does not separate this room: " + label)
        outside = faces[1 - room_sides[0]]
        outward = (outside - middle) / np.linalg.norm(outside - middle)
        cell = None
        # Stay on a short structural line beyond this particular aperture until
        # the ordinary collision-checked corridor grid accepts a public-side cell.
        for distance in np.arange(0, 1.5 * radius, 0.5):
            sample = outside + distance * outward
            x, y = np.rint(sample).astype(int)
            if not (0 <= x < grid.w and 0 <= y < grid.h) or structural_ink[y, x]:
                break
            if not region(sample) or region(sample) == room_region:
                continue
            cell = grid.cell_near(sample, radius * 0.8)
            if cell is not None:
                break
        if cell is None:
            raise ValueError("No unobstructed public approach for " + label)
        threshold = np.round(middle / [grid.w, grid.h], 7).tolist()
        place = occurrences[0]
        place["doors"] = [
            d for d in place["doors"] if np.linalg.norm(grid.norm(d[:2]) - middle) > 0.5
        ]
        place["doors"].append([*threshold, cell])
        place["cells"] = sorted(set([*place["cells"], cell]))


def _named_strip(polygon, grid, places, captions):
    corners = np.array(polygon)
    lower, upper = corners.min(axis=0), corners.max(axis=0)
    if {tuple(p) for p in corners} != {
        (x, y) for x in (lower[0], upper[0]) for y in (lower[1], upper[1])
    }:
        return None
    # Only use a transcribed corridor caption inside this exact source rectangle.
    names = set()
    for caption in captions:
        if caption["kind"] != "corridor" or not IDENTIFIER.fullmatch(caption["text"]):
            continue
        box = np.array(caption["bounds"])
        centre = (box[:2] + box[2:]) / 2
        if np.all(lower <= centre) and np.all(centre <= upper):
            names.update(
                i
                for i, p in enumerate(places)
                if p["label"] == caption["text"]
                and p["kind"] == "corridor"
                and np.allclose(p["bounds"], box, atol=1e-6, rtol=0)
            )
    if len(names) != 1:
        return None
    lo = np.ceil(grid.norm(lower) / grid.cell_size).astype(int)
    hi = np.floor(grid.norm(upper) / grid.cell_size).astype(int) - 1
    sizes = hi - lo + 1
    axis = int(np.argmax(sizes))
    if sizes[1 - axis] < 2 or sizes[axis] < 3 * sizes[1 - axis]:
        return None
    return names.pop(), lo, hi, axis


def corridor_bands(grid, places, areas, captions):
    """Index opposing signed frontages in one continuous local public strip.

    Member spans follow actual public-side doors along the strip. Printed room
    labels distinguish its two sides, but never supply a route coordinate.
    """
    bands = []
    for area in areas:
        spec = _named_strip(area, grid, places, captions)
        if spec is None:
            continue
        corridor, lo, hi, axis = spec
        cross = 1 - axis
        mask = grid.grid[lo[1] : hi[1] + 1, lo[0] : hi[0] + 1].astype(np.uint8)
        _, components = cv2.connectedComponents(mask, connectivity=4)

        def coords(cell):
            return np.array([cell % grid.gw, cell // grid.gw])

        def comp(xy):
            if np.any(xy < lo) or np.any(xy > hi):
                return 0
            x, y = xy - lo
            return int(components[y, x])

        for component in sorted(
            {comp(coords(c)) for c in places[corridor]["cells"]} - {0}
        ):
            members = []
            for index, place in enumerate(places):
                if not place["doors"] or place["kind"] in {
                    "corridor",
                    "shaft",
                    "elevator",
                    "stairs",
                }:
                    continue
                a = grid.norm(place["bounds"][:2]) / grid.cell_size
                b = grid.norm(place["bounds"][2:]) / grid.cell_size
                side = (
                    -1 if b[cross] < lo[cross] else 1 if a[cross] > hi[cross] + 1 else 0
                )
                if not side:
                    continue
                positions = []
                for x, y, cell in place["doors"]:
                    if cell is None:
                        continue
                    xy = coords(cell)
                    jamb = grid.norm((x, y)) / grid.cell_size
                    inward = (jamb[cross] - (xy[cross] + 0.5)) * side
                    if (
                        comp(xy) == component
                        and inward > 0
                        and abs(jamb[axis] - xy[axis] - 0.5) <= inward + 1
                    ):
                        positions.append(int(xy[axis]))
                if positions:
                    # Allow a stagger across the passage up to its own drawn width.
                    pad = int((hi[cross] - lo[cross] + 1) // 2)
                    members.append(
                        [
                            index,
                            side,
                            max(int(lo[axis]), min(positions) - pad),
                            min(int(hi[axis]), max(positions) + pad),
                        ]
                    )
            if len({m[1] for m in members}) != 2:
                continue
            coords_by_column = {}
            ys, xs = np.where(components == component)
            mid = (lo[cross] + hi[cross]) / 2
            for x, y in zip(xs + lo[0], ys + lo[1]):
                xy = (int(x), int(y))
                column = xy[axis]
                choice = (abs(xy[cross] - mid), int(y * grid.gw + x))
                if column not in coords_by_column or choice < coords_by_column[column]:
                    coords_by_column[column] = choice
            spine = [cell for _, (_, cell) in sorted(coords_by_column.items())]
            bands.append(
                {
                    "corridor": corridor,
                    "axis": "xy"[axis],
                    "bounds": [
                        float(min(p[0] for p in area)),
                        float(min(p[1] for p in area)),
                        float(max(p[0] for p in area)),
                        float(max(p[1] for p in area)),
                    ],
                    "members": members,
                    "spine": spine,
                }
            )
    return bands
