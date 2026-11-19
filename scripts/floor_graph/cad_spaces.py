"""Associate exact printed room numbers with the adjacent space-use caption on a CAD plan."""

import numpy as np
import pymupdf

from labels import IDENTIFIER, TRANSIT, intersects

USES = {
    "CLASS": "classroom",
    "LECTURE": "lecture",
    "LAB": "lab",
    "OFFICE": "office",
    "STOR": "storage",
    "MECH": "mechanical",
    "ELEC": "electrical",
    "WASH": "washroom",
    "JANITOR": "janitor",
    "KITCHEN": "kitchen",
    "RESOURCE": "resource",
    "SUPP": "instructional-support",
    "SPEC": "instructional-support",
    "STAFF": "staff",
    "PROJECTS": "projects",
    "LOUNGE": "lounge",
    "MEETING": "meeting",
    "STUDY": "study",
    "COMM": "communications",
    "AV": "av",
    "FOOD": "food-service",
    "RETAIL": "retail",
    "INTERVIEW": "interview",
    "RECEPTION": "reception",
    "ATRIUM": "atrium",
    "VOID": "void",
    "SHAFT": "shaft",
    "STAIR": "stairs",
    "WASHUP": "washroom",
    "ELEVATOR": "elevator",
    **{w: "corridor" for w in TRANSIT},
}


def cad_spaces(page, plan, labels, fonts=("StylusBT",)):
    spans = []
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line["spans"]:
                if span["font"] not in fonts or not span["text"].strip():
                    continue
                bounds = pymupdf.Rect(span["bbox"]) * page.rotation_matrix
                spans.append((span["text"].strip().upper(), np.array(list(bounds))))
    size = np.array([plan["width"], plan["height"]] * 2)
    records = []
    for (text, box), (caption, caption_box) in zip(spans, spans[1:]):
        kind = USES.get(caption.split("-")[0])
        if not kind or not IDENTIFIER.fullmatch(text):
            continue
        text_size = min(box[2:] - box[:2])
        delta = (caption_box[:2] + caption_box[2:] - box[:2] - box[2:]) / 2
        if np.linalg.norm(delta) > max(2.8 * text_size, 12):
            continue
        bounds = (box / size).round(7).tolist()
        marks = [
            r
            for r in labels
            if r["text"] == text
            and r["method"] == "transcription"
            and intersects(r["box"], bounds)
        ]
        records.append(
            {
                "text": text,
                "box": marks[0]["box"] if len(marks) == 1 else bounds,
                "kind": kind,
                "caption": caption,
                "captionBox": (caption_box / size).round(7).tolist(),
                "method": "transcription" if len(marks) == 1 else "pdf-text",
            }
        )
    for mark in labels:
        if mark["method"] != "transcription" or not IDENTIFIER.fullmatch(mark["text"]):
            continue
        if any(
            r["text"] == mark["text"] and intersects(r["box"], mark["box"])
            for r in records
        ):
            continue
        records.append(dict(mark, caption=mark["kind"].upper()))
    return records
