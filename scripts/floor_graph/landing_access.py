"""Attach reviewed stair pins inside a drawn door swing to that doorway's public approach."""

import numpy as np

from doors import SCALE


def landing_approaches(plan, annotation, nodes, grid, sides, door_symbols, places):
    result = []
    for record in annotation.get("landingDoors", []):
        node = next((n for n in nodes if n["id"] == record["nodeId"]), None)
        if (
            not node
            or node["kind"] != "stair-landing"
            or node["planId"] != plan["id"]
            or node["sourceSha256"] != plan["sourceSha256"]
            or node["version"] != record["version"]
            or [node["point"]["x"], node["point"]["y"]] != record["landing"]
            or node["label"].split(" · ")[0] != record["label"]
        ):
            raise ValueError("Stair landing needs review: " + record["label"])

        threshold = grid.norm(record["threshold"])
        # The annotation must select one detected arc, leaf and jamb at its original
        # position. A nearby door on the same floor cannot take its place.
        apertures = [d for d in sides if np.linalg.norm(d[3] - threshold) < 0.3]
        if len(apertures) != 1:
            raise ValueError(
                "Stair doorway is missing or ambiguous: " + record["label"]
            )
        _, _, faces, middle, radius = apertures[0]
        normal = (faces[0] - middle) / np.linalg.norm(faces[0] - middle)
        delta = grid.norm(record["landing"]) - middle
        depth = float(delta @ normal) / radius
        lateral = abs(float(delta @ np.array([-normal[1], normal[0]]))) / radius
        hinges = [
            hinge * SCALE
            for hinge, tip, *_ in door_symbols
            if np.linalg.norm((hinge + tip) * SCALE / 2 - middle) < 0.3
        ]
        # Allow one raster pixel at the arc boundary for a marker drawn on its ink.
        inside_swing = (
            len(hinges) == 1
            and np.linalg.norm(grid.norm(record["landing"]) - hinges[0]) <= radius + 1
        )
        if not inside_swing or not 0 <= depth <= 1 or lateral >= 0.5:
            raise ValueError(
                "Landing pin is outside its marked doorway: " + record["label"]
            )

        # The marker is in the swing on the stair side. The opposite face must
        # have a short, unobstructed connection to an actual public walking cell.
        cell = grid.cell_near(faces[1], radius * 0.50)
        if cell is None:
            raise ValueError("Stair door lacks a public approach: " + record["label"])
        labels = [
            p for p in places if p["label"] == record["label"] and p["kind"] == "stairs"
        ]
        if len(labels) != 1:
            raise ValueError("Stair label is missing or ambiguous: " + record["label"])
        labels[0]["cells"] = sorted(set([*labels[0]["cells"], cell]))
        scale = np.array([grid.w, grid.h])
        result.append(
            {
                "nodeId": node["id"],
                "version": node["version"],
                "landing": record["landing"],
                "cell": cell,
                "via": [
                    np.round(middle / scale, 7).tolist(),
                    np.round(faces[1] / scale, 7).tolist(),
                ],
            }
        )
    return result
