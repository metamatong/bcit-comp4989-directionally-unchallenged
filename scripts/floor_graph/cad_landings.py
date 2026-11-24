"""Bind confirmed landings and doorway pins to public walking cells on their source sheet."""

import numpy as np
from doors import SCALE


def landing_cells(plan, places, nodes, grid, cad, symbols, config):
    approvals = []
    for node in nodes:
        if node["planId"] != plan["id"] or node["kind"] not in {
            "stair-landing",
            "elevator-stop",
        }:
            continue
        if node["sourceSha256"] != plan["sourceSha256"]:
            raise ValueError("Landing source changed")
        elevator = node["kind"] == "elevator-stop"
        label = (
            node["label"].rsplit(" at ", 1)[-1]
            if elevator
            else node["label"].split(" · ")[0]
        )
        matched = [p for p in places if p["label"] == label]
        if not matched and label in config.get("cadFacilityLabels", {}):
            place = {
                "label": label,
                "bounds": config["cadFacilityLabels"][label],
                "kind": "elevator",
                "method": "transcription",
                "doors": [],
                "cells": [],
            }
            places.append(place)
            matched = [place]
        if len(matched) != 1:
            raise ValueError("Missing source landing label: " + label)
        place = matched[0]
        if elevator:
            place["kind"] = "elevator"
        point = [node["point"]["x"], node["point"]["y"]]
        place["reviewedLanding"] = {
            "nodeId": node["id"],
            "version": node["version"],
            "point": point,
        }
        pixel = grid.norm(point)
        cell = grid.cell_near(pixel, grid.cell_size * 4, boundary=True)
        if cell is None:
            # A pin may lie on the drawing of its door swing. Within that actual
            # aperture only, the swing ink is traversable; all walls and fixtures remain.
            cell = cell_at_door_swing(pixel, grid, cad.walls | cad.objects, symbols)
        via = []
        explicit = next(
            (
                v
                for v in config.get("cadLandingFrontages", [])
                if v["nodeId"] == node["id"]
            ),
            None,
        )
        if explicit:
            if explicit["version"] != node["version"] or explicit["mark"] != point:
                raise ValueError("Stale reviewed landing approach")
            target = grid.norm(explicit["point"])
            ray = np.linspace(
                pixel, target, max(4, round(np.linalg.norm(target - pixel) * 2))
            )
            # Only the initial printed marker touches the guard. The surveyed
            # approach must immediately leave its ink on the landing side.
            ray = np.rint(ray[np.linalg.norm(ray - pixel, axis=1) > 3]).astype(int)
            if (
                np.linalg.norm(target - pixel) > 12
                or not len(ray)
                or ((cad.walls | cad.objects)[ray[:, 1], ray[:, 0]] > 0).any()
            ):
                raise ValueError("Obstructed landing frontage " + label)
            cell = grid.cell_near(target, grid.cell_size * 3)
            if cell is None:
                raise ValueError(
                    "Landing frontage misses the interior walking area: " + label
                )
            via = [explicit["point"]]
        if cell is not None:
            place["cells"] = sorted(set([*place["cells"], cell]))
            approvals.append(
                {
                    "nodeId": node["id"],
                    "version": node["version"],
                    "landing": point,
                    "cell": cell,
                    "via": via,
                }
            )
    return approvals


def cell_at_door_swing(pixel, grid, barriers, symbols):
    """Cross only a fitted door's aperture on a clear ray to the public walking grid."""
    x, y = np.rint(pixel).astype(int)
    if not (0 <= x < grid.w and 0 <= y < grid.h):
        return None
    best = None
    for hinge, tip, normal, source_radius in symbols:
        centre = (hinge + tip) * SCALE / 2
        radius = source_radius * SCALE
        tangent = (tip - hinge) / source_radius
        if (
            np.linalg.norm(pixel - centre) >= radius
            or abs((pixel - centre) @ tangent) > 0.52 * radius
        ):
            continue
        for side in (-1, 1):
            for lateral in (0, -0.18, 0.18):
                p = (
                    centre
                    + normal * side * radius * (1.15 if side > 0 else 0.55)
                    + lateral * tangent * radius
                )
                cell = grid.cell_near(p, radius * 0.6)
                if cell is None:
                    continue
                end = (
                    np.array([cell % grid.gw, cell // grid.gw]) + 0.5
                ) * grid.cell_size
                ray = np.rint(
                    np.linspace(
                        pixel, end, max(3, round(np.linalg.norm(end - pixel) * 2))
                    )
                ).astype(int)
                if (np.abs((ray - centre) @ tangent) > 0.65 * radius).any() or barriers[
                    ray[:, 1], ray[:, 0]
                ].any():
                    continue
                candidate = (np.linalg.norm(end - pixel), cell)
                if best is None or candidate < best:
                    best = candidate
    return best[1] if best else None
