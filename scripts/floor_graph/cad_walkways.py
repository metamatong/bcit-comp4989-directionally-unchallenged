"""Preserve walking clearance under source-identified projection lines on a public aisle."""

from collections import Counter

import cv2
import numpy as np
from cad_layers import _polyline, _stroke
from doors import SCALE


def _line_key(layer, endpoints):
    a, b = sorted(tuple(map(float, point)) for point in np.round(endpoints, 2))
    return layer, a, b


def _intersects(bounds, low, high):
    x0, y0, x1, y1 = bounds
    return x1 >= low[0] and y1 >= low[1] and x0 <= high[0] and y0 <= high[1]


def _drawing_bounds(drawing, matrix):
    rect = drawing["rect"]
    a, b = rect.tl * matrix, rect.br * matrix
    return min(a.x, b.x), min(a.y, b.y), max(a.x, b.x), max(a.y, b.y)


def _registered_lines(groups):
    expected = {}
    for group in groups:
        for x0, y0, x1, y1, copies in group["segments"]:
            key = _line_key(group["layer"], [[x0, y0], [x1, y1]])
            if key in expected or not isinstance(copies, int) or copies < 1:
                raise ValueError("Invalid projected source line registration")
            expected[key] = copies
    if not expected:
        raise ValueError("A public walkway correction needs identified source strokes")
    return expected


def _render_crossing(record, drawings, matrix, origin, extent):
    marked = np.zeros(tuple((extent - origin)[::-1]), np.uint8)
    protected = np.zeros_like(marked)
    expected = _registered_lines(record["sourceLines"])
    observed = Counter()
    offset = origin / SCALE
    low, high = offset - 2, extent / SCALE + 2
    for drawing, layer, bounds in drawings:
        if not _intersects(bounds, low, high):
            continue
        others = []
        for item in drawing["items"]:
            line = _polyline(item, matrix)
            key = None
            if item[0] == "l" and drawing["type"] == "s" and not drawing["closePath"]:
                key = _line_key(layer, line)
            if key in expected:
                observed[key] += 1
                _stroke(drawing, [line - offset], marked)
            else:
                others.append(line - offset)
        if others:
            _stroke(drawing, others, protected)
    if observed != expected:
        raise ValueError("Projected CAD strokes changed at " + record["basis"])
    return marked, protected


def _open_walkway(record, drawings, matrix, symbols, public, sealed, barriers):
    size = np.asarray(sealed.shape[::-1])
    box = record["bounds"]
    if not (0 <= box[0] < box[2] <= 1 and 0 <= box[1] < box[3] <= 1):
        raise ValueError("Invalid public walkway bounds")
    start = np.floor(np.asarray(box[:2]) * size).astype(int)
    end = np.ceil(np.asarray(box[2:]) * size).astype(int)
    # Pad for stroke dilation. An even origin preserves rounding from the full raster.
    origin = np.maximum(0, (start - 6) // 2 * 2)
    extent = np.minimum(size, end + 7)
    marked, protected = _render_crossing(record, drawings, matrix, origin, extent)
    # Fitted door closures are also obstacles. Only the separate verified-door
    # pass may open a real threshold. All unrelated marks and columns survive.
    for hinge, tip, *_ in symbols:
        ends = np.rint(np.array([hinge, tip]) * SCALE).astype(int) - origin
        cv2.line(protected, *ends, 255, 3)
    kernel = np.ones((3, 3), np.uint8)
    free = (cv2.dilate(marked, kernel) > 0) & (cv2.dilate(protected, kernel) == 0)
    left, top = start
    right, bottom = end
    local_x, local_y = start - origin
    width, height = end - start
    region = np.s_[top:bottom, left:right]
    clear = free[local_y : local_y + height, local_x : local_x + width] & (
        public[region] > 0
    )
    if not clear.any():
        raise ValueError(
            "Projected lines do not cross the public walkway at " + record["basis"]
        )
    sealed[region][clear] = 0
    barriers[region][clear] = 0


def open_public_walkways(
    page, annotation_layers, records, symbols, public, sealed, barriers
):
    if not records:
        return
    matrix = page.rotation_matrix
    drawings = []
    for drawing in page.get_drawings():
        layer = drawing.get("layer", "").split("|")[-1].upper()
        if layer not in annotation_layers:
            drawings.append((drawing, layer, _drawing_bounds(drawing, matrix)))
    for record in records:
        _open_walkway(record, drawings, matrix, symbols, public, sealed, barriers)
