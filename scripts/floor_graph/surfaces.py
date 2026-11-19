"""Partition a drawing at walls and door thresholds; keep routes inside supported public spaces."""

from collections import defaultdict

import cv2
import numpy as np

from doors import SCALE, doors_on_page
from labels import IDENTIFIER
from passage_openings import open_passage_doors


def ink_mask(page, words):
    import pymupdf

    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(SCALE, SCALE), colorspace=pymupdf.csRGB, alpha=False
    )
    # Yellow door arcs and jambs disappear in a grayscale threshold on several older sheets.
    rgb = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
    ink = np.where(rgb.min(axis=2) < 220, 255, 0).astype(np.uint8)
    # Only remove detached ink components wholly contained in a known text box.
    # In particular, a label bounding box is never punched through a wall.
    _, labels, stats, _ = cv2.connectedComponentsWithStats(ink, connectivity=8)
    remove = np.zeros(len(stats), bool)
    for word in words:
        l, t, r, b = np.rint(
            np.array(word["box"]) * [pix.width, pix.height, pix.width, pix.height]
        ).astype(int)
        for k in np.unique(labels[max(0, t - 2) : b + 3, max(0, l - 2) : r + 3]):
            x, y, w, h, _ = stats[k]
            if k and x >= l - 2 and y >= t - 2 and x + w <= r + 3 and y + h <= b + 3:
                remove[k] = True
    ink[remove[labels]] = 0
    return ink


def at_label(regions, box):
    h, w = regions.shape
    x0, y0, x1, y1 = np.rint(np.array(box) * [w, h, w, h]).astype(int)
    patch = regions[max(0, y0 - 2) : min(h, y1 + 3), max(0, x0 - 2) : min(w, x1 + 3)]
    ids, counts = np.unique(patch[patch > 0], return_counts=True)
    return (
        int(ids[np.argmax(counts)])
        if len(ids) and max(counts) >= patch.size * 0.35
        else 0
    )


def door_sides(doors, regions):
    result = []
    h, w = regions.shape
    for hinge, tip, normal, radius in doors:
        midpoint = (hinge + tip) / 2
        # Sample beyond the swing on one side and just beyond the jamb on the other.
        faces = [
            (midpoint + normal * radius * 1.12) * SCALE,
            (midpoint - normal * radius * 0.42) * SCALE,
        ]
        xy = np.rint(faces).astype(int)
        if np.any(xy < 0) or np.any(xy[:, 0] >= w) or np.any(xy[:, 1] >= h):
            continue
        a, b = (int(regions[y, x]) for x, y in xy)
        if a and b and a != b:
            result.append((a, b, faces, midpoint * SCALE, radius * SCALE))
    return result


def classify(words, regions, stats, sides):
    uses = defaultdict(set)
    room_numbers = defaultdict(set)
    for word in words:
        region = at_label(regions, word["box"])
        word["region"] = region
        if word["kind"] != "room":
            uses[region].add(word["kind"])
        if IDENTIFIER.fullmatch(word["text"]):
            room_numbers[region].add(word["text"])

    # Two room numbers in one segmented space can be legitimate corridor zones or
    # a breach between rooms. Only the former have independent circulation labels.
    def labelled_space(region):
        explicit = [
            q for q in words if q["region"] == region and q["kind"] == "corridor"
        ]
        for word in words:
            if (
                word["region"] != region
                or not IDENTIFIER.fullmatch(word["text"])
                or word["kind"] == "corridor"
            ):
                continue
            if not any(near_caption(word["box"], q["box"]) for q in explicit):
                return False
        return bool(explicit)

    neighbours = defaultdict(set)
    for a, b, *_ in sides:
        neighbours[a].add(b)
        neighbours[b].add(a)
    height, width = regions.shape
    public = set()
    for region in range(1, len(stats)):
        x, y, w, h, area = stats[region]
        if (
            area < 40
            or area > width * height * 0.23
            or x < 0.02 * width
            or y < 0.02 * height
            or x + w > 0.985 * width
            or y + h > 0.985 * height
        ):
            continue
        if "corridor" in uses[region] and labelled_space(region):
            public.add(region)
        elif (
            not uses[region]
            and len(room_numbers[region]) <= 1
            and len([i for i in neighbours[region] if room_numbers[i]]) >= 3
        ):
            # Bounded, narrow circulation serving distinct signed rooms, with real
            # door symbols. An unlabelled rectangle or a gap in ink is insufficient.
            if max(w, h) > 4 * min(w, h) or area < 0.32 * w * h:
                public.add(region)
    return public, uses


def near_caption(a, b):
    ax, ay, bx, by = (
        (a[0] + a[2]) / 2,
        (a[1] + a[3]) / 2,
        (b[0] + b[2]) / 2,
        (b[1] + b[3]) / 2,
    )
    return (
        abs(ax - bx) < max(a[2] - a[0], b[2] - b[0]) * 0.65
        and abs(ay - by) < max(a[3] - a[1], b[3] - b[1]) * 2.4
    ) or (
        abs(ay - by) < max(a[3] - a[1], b[3] - b[1]) * 0.65
        and abs(ax - bx) < max(a[2] - a[0], b[2] - b[0]) * 2.4
    )


def labelled_corridor_strips(sealed, regions, words, seeds, radius):
    """Recover an open-ended signed hall only within opposing parallel boundaries.

    A room beside an open-plan area may share its flood component. Requiring walls
    on both sides of a named corridor avoids filling that entire component.
    """
    h, w = regions.shape
    band = np.zeros((h, w), np.uint8)
    for transpose in (False, True):
        source = sealed.T.copy() if transpose else sealed
        horizontal = cv2.morphologyEx(
            source, cv2.MORPH_OPEN, np.ones((1, max(5, round(radius * 1.1))), np.uint8)
        )
        # Close brief interruptions in the wall-direction test only. The actual
        # cells remain clipped against every original wall and closed threshold.
        horizontal = cv2.morphologyEx(
            horizontal,
            cv2.MORPH_CLOSE,
            np.ones((1, max(3, round(radius * 0.7))), np.uint8),
        )
        size = source.shape[0]
        rows = np.arange(size, dtype=np.int32)[:, None]
        last = np.maximum.accumulate(np.where(horizontal > 0, rows, -size), axis=0)
        following = np.minimum.accumulate(
            np.where(horizontal > 0, rows, size * 2)[::-1], axis=0
        )[::-1]
        span = following - last
        supported = (
            (span > radius * 0.80) & (span < radius * 4.2) & (source == 0)
        ).astype(np.uint8)
        supported = cv2.morphologyEx(
            supported,
            cv2.MORPH_OPEN,
            np.ones((1, max(5, round(radius * 1.8))), np.uint8),
        )
        band |= supported.T if transpose else supported
    band[sealed > 0] = 0
    _, segments, stats, _ = cv2.connectedComponentsWithStats(band, connectivity=4)
    trusted = set()
    blocked = set()
    for word in words:
        component = at_label(segments, word["box"])
        if word["kind"] == "corridor":
            trusted.add(component)
        elif word["kind"] not in {"room", "elevator", "stairs"}:
            blocked.add(component)
    for x, y in seeds:
        trusted.add(int(segments[round(y * h), round(x * w)]))
    trusted -= blocked | {0}
    return np.isin(segments, list(trusted))


def surfaces(page, geometry, words, annotation):
    ink = ink_mask(page, words)
    doors = doors_on_page(geometry, ink)
    sealed = ink.copy()
    for hinge, tip, *_ in doors:
        cv2.line(
            sealed,
            tuple(np.rint(hinge * SCALE).astype(int)),
            tuple(np.rint(tip * SCALE).astype(int)),
            255,
            3,
        )
    sealed = cv2.dilate(sealed, np.ones((3, 3), np.uint8))
    _, regions, stats, _ = cv2.connectedComponentsWithStats(
        255 - sealed, connectivity=4
    )
    sides = door_sides(doors, regions)
    public, uses = classify(words, regions, stats, sides)
    h, w = regions.shape
    # A point read on this sheet identifies an enclosed corridor only. Reject a
    # component that leaked into the page exterior or into a labelled private room.
    for sx, sy in annotation.get("corridorSeeds", []):
        region = int(regions[round(sy * h), round(sx * w)])
        x, y, rw, rh, area = stats[region]
        private_uses = uses[region] - {
            "corridor",
            "stairs",
            "elevator",
            "vestibule",
            "lobby",
        }
        if (
            region
            and not private_uses
            and area < h * w * 0.23
            and x > w * 0.02
            and y > h * 0.02
            and x + rw < w * 0.985
            and y + rh < h * 0.985
        ):
            public.add(region)
    walk = np.isin(regions, list(public))
    if doors:
        radius = float(np.median([d[3] for d in doors])) * SCALE
        walk |= labelled_corridor_strips(
            sealed, regions, words, annotation.get("corridorSeeds", []), radius
        )
    # Where a corridor opens into a large neighbouring room, named polygons
    # transcribed on this sheet restrict the source walk area independently of flood fill.
    h, w = regions.shape
    envelopes = annotation.get("areas", [])
    if envelopes:
        extra = np.zeros_like(ink)
        for points in envelopes:
            poly = np.rint(np.array(points) * [w, h]).astype(np.int32)
            cv2.fillPoly(extra, [poly], 255)
        open_passage_doors(
            page, geometry, annotation.get("passageOpenings", []), sealed, extra
        )
        walk |= (extra > 0) & (sealed == 0)
    return walk, sealed, regions, sides, uses, doors
