"""Read exact place identifiers and space uses on each official drawing, in page coordinates."""

import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess

import cv2
import numpy as np
import pymupdf

ROOT = Path(__file__).resolve().parents[2]
CAMPUS = ROOT / "data/campus"
CACHE = ROOT / "tmp/floor-compiler"
IDENTIFIER = re.compile(r"[A-Z]{0,2}[0-9]{2,5}[A-Z]?(?:-[0-9]+[A-Z]?)?")
TRANSIT = {
    "CORRIDOR",
    "CORR",
    "CORR.",
    "HALLWAY",
    "LOBBY",
    "VEST",
    "VEST.",
    "VESTIBULE",
    "PASSAGE",
    "WALKWAY",
    "FOYER",
}
USES = {
    "STAIR": "stairs",
    "STAIRS": "stairs",
    "STAIRWELL": "stairs",
    "ELEVATOR": "elevator",
    "ELEV": "elevator",
    "ELEV.": "elevator",
    "LIFT": "elevator",
    **{key: "corridor" for key in TRANSIT},
}
MANUAL = {
    p["planId"]: p
    for p in json.loads((CAMPUS / "spatial/plan-annotations.json").read_text())["plans"]
}


def inventory():
    sources = {
        s["id"]: s
        for s in json.loads((CAMPUS / "manifest.json").read_text())["sources"]
    }
    for plan in json.loads((CAMPUS / "visual/index.json").read_text())["plans"]:
        source = ROOT / sources[plan["sourceId"]]["file"]
        if hashlib.sha256(source.read_bytes()).hexdigest() != plan["sourceSha256"]:
            raise ValueError(f"Changed source PDF {source}")
        yield plan, source


def space_use(text):
    if text in USES:
        return USES[text]
    for prefix, kind in (
        ("CLASS", "classroom"),
        ("LAB", "lab"),
        ("OFFICE", "office"),
        ("OFFC", "office"),
        ("WASH", "washroom"),
        ("STOR", "storage"),
        ("SHOP", "workshop"),
        ("MECH", "mechanical"),
        ("ELEC", "electrical"),
        ("SHAFT", "shaft"),
        ("JANITOR", "janitor"),
        ("BEDROOM", "bedroom"),
        ("SUPP", "support"),
    ):
        if text == prefix or text.startswith(prefix + "-"):
            return kind
    return None


def read_ocr(page, scale, turn, text_only=False):
    # A rotated drawing may have both horizontal and vertical room signs.
    pix = page.get_pixmap(
        matrix=pymupdf.Matrix(scale, scale), colorspace=pymupdf.csGRAY, alpha=False
    )
    pixels = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width)
    if text_only:
        ink = (pixels < 230).astype(np.uint8)
        _, components, stats, _ = cv2.connectedComponentsWithStats(ink)
        extents = np.max(stats[:, 2:4], axis=1) / scale
        glyph = (extents < 16) & (extents > 1.1) & (stats[:, 4] > 2)
        pixels = 255 - cv2.dilate(
            glyph[components].astype(np.uint8) * 255, np.ones((2, 2), np.uint8)
        )
    oriented = np.rot90(pixels, turn)
    image = cv2.imencode(".png", oriented, [cv2.IMWRITE_PNG_COMPRESSION, 1])[1]
    output = subprocess.run(
        ["tesseract", "stdin", "stdout", "-l", "eng", "--psm", "11", "tsv"],
        input=image.tobytes(),
        capture_output=True,
        check=True,
        env={**os.environ, "OMP_THREAD_LIMIT": "1"},
    ).stdout.decode()
    result = []
    for row in csv.DictReader(
        io.StringIO(output), delimiter="\t", quoting=csv.QUOTE_NONE
    ):
        text = row["text"].strip().upper()
        if (
            not (IDENTIFIER.fullmatch(text) or space_use(text))
            or float(row["conf"]) < 55
        ):
            continue
        x, y, w, h = [int(row[k]) for k in ("left", "top", "width", "height")]
        if turn == 1:
            x, y, w, h = pix.width - y - h, x, h, w
        elif turn == 3:
            x, y, w, h = y, pix.height - x - w, h, w
        box = [x / pix.width, y / pix.height, (x + w) / pix.width, (y + h) / pix.height]
        result.append([text, box, float(row["conf"])])
    return result


def intersects(a, b):
    return min(a[2], b[2]) > max(a[0], b[0]) and min(a[3], b[3]) > max(a[1], b[1])


def label_words(plan, page, supplemental=None):
    annotation = MANUAL.get(plan["id"], {})
    bounds = annotation.get("drawingRegion", [0.025, 0.035, 0.98, 0.94])
    words = []

    def add(text, box, method, kind=None, co_printed_with=None):
        key = text.strip().upper()
        if not (IDENTIFIER.fullmatch(key) or space_use(key)):
            return
        x, y = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        if not (bounds[0] < x < bounds[2] and bounds[1] < y < bounds[3]):
            return
        # CAD labels can physically overlap. Keep both only when two exact
        # source transcriptions explicitly identify that pair on this sheet.
        if co_printed_with is not None and not any(
            w["method"] == "transcription"
            and w["text"] == co_printed_with
            and intersects(w["box"], box)
            for w in words
        ):
            raise ValueError(
                "Missing overlapping source transcription: " + co_printed_with
            )
        if any(
            intersects(w["box"], box)
            and (
                w["text"] == key
                or (w["method"] == "transcription" and w["text"] != co_printed_with)
                or (method == "repeated-ocr" and w["method"] == "pdf-text")
            )
            for w in words
        ):
            return
        words.append(
            {
                "text": key,
                "box": [round(v, 7) for v in box],
                "method": method,
                "kind": kind or space_use(key) or "room",
            }
        )

    for label in [*annotation.get("labels", []), *(supplemental or [])]:
        kind = label["kind"]
        add(
            label["text"],
            label["bounds"],
            "transcription",
            "corridor" if kind in {"vestibule", "corridor", "lobby"} else kind,
            label.get("coPrintedWith"),
        )
    for x0, y0, x1, y1, text, *_ in page.get_text("words"):
        box = pymupdf.Rect(x0, y0, x1, y1) * page.rotation_matrix
        add(
            text,
            [
                box.x0 / page.rect.width,
                box.y0 / page.rect.height,
                box.x1 / page.rect.width,
                box.y1 / page.rect.height,
            ],
            "pdf-text",
        )
    # On flattened CAD exports the glyphs are paths; require agreement across two resolutions.
    if sum(w["method"] == "pdf-text" for w in words) < 10:
        cache = CACHE / (plan["sourceSha256"] + "-words-v2.json")
        if not cache.exists():
            passes = []
            for turn in (0, 1, 3):
                readings = [
                    read_ocr(page, 4, turn),
                    read_ocr(page, 4, turn, text_only=True),
                ]
                if not any(readings):
                    continue
                readings.append(read_ocr(page, 5, turn))
                readings.append(read_ocr(page, 5, turn, text_only=True))
                for i, reading in enumerate(readings):
                    for text, box, confidence in reading:
                        if any(
                            other == text
                            and intersects(box, other_box)
                            and max(score, confidence) >= 78
                            for later in readings[i + 1 :]
                            for other, other_box, score in later
                        ):
                            passes.append([text, box])
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(passes))
        for text, box in json.loads(cache.read_text()):
            add(text, box, "repeated-ocr")

    # Different renderings can each repeat a different reading of the same glyphs
    # (for example S150 and 5150). Retain the raw readings in the OCR cache, but
    # do not promote either as a signed place without source text or a transcription.
    def same_print(a, b):
        return (
            intersects(a, b)
            and a[0] <= (b[0] + b[2]) / 2 <= a[2]
            and a[1] <= (b[1] + b[3]) / 2 <= a[3]
            and b[0] <= (a[0] + a[2]) / 2 <= b[2]
            and b[1] <= (a[1] + a[3]) / 2 <= b[3]
        )

    return [
        word
        for word in words
        if word["method"] != "repeated-ocr"
        or not any(
            other["method"] == "repeated-ocr"
            and other["text"] != word["text"]
            and IDENTIFIER.fullmatch(word["text"])
            and IDENTIFIER.fullmatch(other["text"])
            and same_print(word["box"], other["box"])
            for other in words
        )
    ]


def warm(item):
    plan, filename = item
    with pymupdf.open(filename) as document:
        words = label_words(plan, document[plan["page"] - 1])
    return plan["id"], len(words)


if __name__ == "__main__":
    from concurrent.futures import ProcessPoolExecutor

    with ProcessPoolExecutor(4) as pool:
        for plan_id, count in pool.map(warm, inventory()):
            print(plan_id, count, flush=True)
