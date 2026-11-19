"""Validate page-specific frontage transcriptions against the original walls and doors."""

import numpy as np


def _clear(mask, start, end):
    ray = np.rint(
        np.linspace(start, end, max(2, round(np.linalg.norm(end - start) * 1.5)))
    ).astype(int)
    return not mask[ray[:, 1], ray[:, 0]].any()


def marked_frontages(
    config, grid, interior, terminal, symbols, faces_at, barriers, walls, words, places
):
    size = np.array([grid.w, grid.h])
    labels = {
        w["text"]: [(p, q) for p, q in zip(places, words) if p["label"] == w["text"]]
        for w in words
    }
    results = {}
    for mark in config.get("cadFrontages", []):
        label = mark["label"]
        feature = mark["feature"]
        point = grid.norm(mark["point"])
        record_key = label + "|" + feature
        results[record_key] = False
        if len(labels.get(label, [])) != 1:
            raise ValueError(
                "The marked frontage needs a unique source label: " + label
            )
        place, w = labels[label][0]
        attached = False
        if feature == "door":
            for middle, normal, r in sorted(
                symbols, key=lambda s: np.linalg.norm(s[0] - point)
            ):
                if np.linalg.norm(middle - point) > r * 1.4:
                    continue
                faces = faces_at(grid, middle, normal, r)
                if len(faces) != 2:
                    continue
                for i, (inside, region) in enumerate(faces):
                    if region != w["region"] or region == faces[1 - i][1]:
                        continue
                    centre = (np.array(w["box"][:2]) + w["box"][2:]) * size / 2
                    if (centre - middle) @ (normal if i == 0 else -normal) < -0.3 * r:
                        continue
                    if not _clear(walls, inside, centre):
                        continue
                    outside = faces[1 - i][0]
                    station = middle if _clear(barriers, middle, outside) else outside
                    attached = _attach(
                        place,
                        station,
                        outside,
                        grid,
                        interior,
                        terminal,
                        r * 0.95,
                        region,
                        feature,
                    )
                    if attached:
                        break
                if attached:
                    break
        else:
            if feature not in {"landing", "corridor", "open-front", "shared"}:
                raise ValueError(feature)
            if feature in {"open-front", "shared"}:
                anchor = (np.array(w["box"][:2]) + w["box"][2:]) * size / 2
                if not _clear(barriers, anchor, point):
                    continue
            attached = _attach(
                place,
                point,
                point,
                grid,
                interior,
                terminal,
                grid.cell_size * 4,
                None,
                feature,
            )
        results[record_key] = attached
    return results


def _attach(place, point, face, grid, interior, terminal, radius, exclude, feature):
    cell = grid.cell_near(face, radius)
    if cell is not None and feature != "shared":
        if place.get("sharedEntry"):
            place.pop("sharedEntry")
            place.pop("terminalPaths", None)
        place["cells"] = sorted(set([*place["cells"], cell]))
        if feature == "door":
            norm = np.round(point / [grid.w, grid.h], 7).tolist()
            place["doors"] = [d for d in place["doors"] if d[:2] != norm] + [
                [*norm, cell]
            ]
        return True
    private = interior.cell_near(face, radius)
    if private is None:
        return False
    path = terminal.path(private, point, face, exclude)
    if not path or len(path["via"]) < 2:
        return False
    if place.get("sharedEntry") and feature != "shared":
        place.pop("sharedEntry")
        place.pop("terminalPaths", None)
    if feature == "shared" and (place["cells"] or place.get("terminalPaths")):
        return False
    if path not in place.get("terminalPaths", []):
        place.setdefault("terminalPaths", []).append(path)
    if feature == "shared":
        place["sharedEntry"] = True
    return True


def mapped_stations(config, grid, terminal, words, places, symbols):
    """Accept only explicitly marked free positions on this source and its walking graph."""
    size = np.array([grid.w, grid.h])
    result = {}
    for record in config.get("cadAreaArrivals", []):
        place, word = next(
            (p, w) for p, w in zip(places, words) if p["label"] == record["label"]
        )
        point = grid.norm(record["point"])
        feature = record["feature"]
        if feature not in {"stair-foot", "door-side", "room-area"}:
            raise ValueError(feature)
        if feature == "door-side":
            # The marker is on the approach side of an independently drawn door.
            nearby = any(np.linalg.norm(m - point) <= 1.9 * r for m, _, r in symbols)
            if not nearby:
                result[place["label"]] = False
                continue
        else:
            anchor = (np.array(word["box"][:2]) + word["box"][2:]) * size / 2
            if feature == "room-area" and (
                np.linalg.norm(point - anchor) > 46
                or not _clear(grid.structural, anchor, point)
            ):
                result[place["label"]] = False
                continue
        area = terminal.grid
        cell = area.cell_near(point, grid.cell_size * 2)
        if cell is None or not np.isfinite(terminal.dist[terminal.index[cell]]):
            result[place["label"]] = False
            continue
        centre = (np.array([cell % area.gw, cell // area.gw]) + 0.5) * area.cell_size
        if grid.grid.flat[cell]:
            place["cells"] = sorted(set([*place["cells"], cell]))
        else:
            path = terminal.path(cell, centre, centre, None)
            if not path or len(path["via"]) < 2:
                result[place["label"]] = False
                continue
            if path not in place.get("terminalPaths", []):
                place.setdefault("terminalPaths", []).append(path)
        if feature == "room-area":
            place["roomArea"] = True
        result[place["label"]] = True
    return result


def threshold_stations(config, grid, terminal, symbols, places):
    """Locate the surveyed side of a particular fitted leaf, never through its wall."""
    results = {}
    for entry in config.get("cadThresholdStations", []):
        label = entry["label"]
        p = next(v for v in places if v["label"] == label)
        expected = grid.norm(entry["threshold"])
        matches = [s for s in symbols if np.linalg.norm(s[0] - expected) < 1.6]
        if len(matches) != 1:
            raise ValueError("Marked source leaf no longer matches: " + label)
        middle, normal, radius = matches[0]
        if entry["side"] == "opposite":
            normal = -normal
        elif entry["side"] != "swing":
            raise ValueError("Missing side of " + label)
        tangent = np.array([-normal[1], normal[0]])
        candidates = []
        for shift in (0, -0.20, 0.20):
            free = False
            for depth in np.arange(0.28, 1.96, 0.13):
                point = middle + (normal * depth + tangent * shift) * radius
                x, y = np.rint(point).astype(int)
                if grid.structural[y, x]:
                    if free or depth > 0.58:
                        break
                    continue
                free = True
                cell = terminal.grid.cell_near(point, grid.cell_size * 2)
                if cell is None or not np.isfinite(terminal.dist[terminal.index[cell]]):
                    continue
                candidates.append((not grid.grid.flat[cell], depth + abs(shift), cell))
                break
        if not candidates:
            results[label] = False
            continue
        _, _, cell = min(candidates)
        centre = (np.array([cell % grid.gw, cell // grid.gw]) + 0.5) * grid.cell_size
        if grid.grid.flat[cell]:
            p["cells"] = sorted(set([*p["cells"], cell]))
        else:
            path = terminal.path(cell, centre, centre, None)
            if not path or len(path["via"]) < 2:
                results[label] = False
                continue
            if path not in p.get("terminalPaths", []):
                p.setdefault("terminalPaths", []).append(path)
        results[label] = True
    return results
