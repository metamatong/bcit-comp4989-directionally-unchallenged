"""Rebuild the checked-in OCR evidence for the 12 Burnaby pilot pages.

Requires Poppler (pdftoppm), Tesseract with English data, and Pillow. Run from
any directory. Original source PDFs and the existing geometry are read only.
"""
import csv
import hashlib
import io
import json
import os
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CAMPUS = ROOT / "data/campus"
OUTPUT = CAMPUS / "spatial"
PILOT = {"SE12", "SW3", "SW1"}
DPI = (300, 400)


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def page_box(row, size, rotation):
    """Invert the counterclockwise quarter-turn into original top-left coordinates."""
    width, height = size
    x, y, w, h = (int(row[key]) for key in ("left", "top", "width", "height"))
    if rotation == 90:
        x, y, w, h = width - (y + h), x, h, w
    elif rotation == 270:
        x, y, w, h = y, height - (x + w), h, w
    return [round(v, 7) for v in (x / width, y / height, (x + w) / width, (y + h) / height)]


def page_words(source, plan, dpi):
    # The first SE12 sheet has a portrait page with a sideways drawing. A
    # second orientation on the other sheets reads vertical corridor labels.
    rotations = [90, 0] if plan["id"] == "SE12-F1-p1" else [0, 270]
    words = []
    with tempfile.TemporaryDirectory() as directory:
        prefix = Path(directory) / "page"
        subprocess.run(["pdftoppm", "-f", str(plan["page"]), "-l", str(plan["page"]),
                        "-r", str(dpi), "-singlefile", "-gray", "-png", str(source), str(prefix)], check=True)
        with Image.open(prefix.with_suffix(".png")) as image:
            size = image.size
            if abs(size[0] / size[1] - plan["width"] / plan["height"]) > .001:
                raise ValueError(f"Unexpected raster orientation: {plan['id']}")
            # A grayscale page sometimes separates thin vector strokes differently
            # from an RGB render. Retain both extractions, with their provenance.
            passes = [(rotations[0], "gray")]
            if dpi == max(DPI):
                passes.extend([(rotations[1], "gray"), (rotations[0], "rgb")])
            for rotation, mode in passes:
                raster = prefix.with_suffix(".png")
                if mode == "rgb":
                    prefix_rgb = Path(directory) / "rgb"
                    subprocess.run(["pdftoppm", "-f", str(plan["page"]), "-l", str(plan["page"]),
                                    "-r", str(dpi), "-singlefile", "-png", str(source), str(prefix_rgb)], check=True)
                    raster = prefix_rgb.with_suffix(".png")
                if rotation:
                    with Image.open(raster) as oriented_source:
                        rotated = oriented_source.transpose(Image.Transpose.ROTATE_90 if rotation == 90 else Image.Transpose.ROTATE_270)
                    raster = Path(directory) / "oriented.png"
                    rotated.save(raster)
                process = subprocess.run(["tesseract", str(raster), "stdout", "-l", "eng", "--psm", "11", "tsv"],
                                         check=True, capture_output=True, text=True,
                                         env={**os.environ, "OMP_THREAD_LIMIT": "1"})
                for row in csv.DictReader(io.StringIO(process.stdout), delimiter="\t", quoting=csv.QUOTE_NONE):
                    text = row["text"].strip()
                    if row["level"] == "5" and text and int(row["width"]) > 0 and int(row["height"]) > 0:
                        words.append({"text": text, "bounds": page_box(row, size, rotation),
                                      "confidence": round(float(row["conf"]), 2), "dpi": dpi, "rotation": rotation, "mode": mode})
    return words


def extract(entry, plan):
    source = ROOT / entry["file"]
    if sha256(source) != entry["sha256"] or plan["sourceSha256"] != entry["sha256"]:
        raise ValueError(f"Source changed: {plan['id']}")
    return {"planId": plan["id"], "page": plan["page"], "sourceSha256": entry["sha256"],
            "geometrySha256": plan["geometry"]["sha256"],
            "words": [word for dpi in DPI for word in page_words(source, plan, dpi)]}


def main():
    manifest = json.loads((CAMPUS / "manifest.json").read_text())
    sources = {source["id"]: source for source in manifest["sources"] if source.get("building") in PILOT}
    index = json.loads((CAMPUS / "visual/index.json").read_text())
    plans = sorted((plan for plan in index["plans"] if plan["building"] in PILOT), key=lambda p: p["id"])
    if {(p["building"], p["floor"], p["page"]) for p in plans} != {
        (b, str(f), 1) for b in PILOT for f in range(1, 5)
    } or len(plans) != 12:
        raise ValueError("Review the official twelve-page pilot inventory before regeneration")
    with ThreadPoolExecutor(max_workers=2) as pool:
        records = list(pool.map(lambda plan: extract(sources[plan["sourceId"]], plan), plans))
    engine = subprocess.check_output(["tesseract", "--version"], text=True).splitlines()[0].strip()
    renderer = subprocess.run(["pdftoppm", "-v"], capture_output=True, text=True, check=True).stderr.splitlines()[0].strip()
    header = {"schemaVersion": 1, "engine": engine, "renderer": renderer, "dpi": DPI,
              "language": "eng", "psm": 11, "attribution": "© British Columbia Institute of Technology"}
    # One word per line keeps source diffs reviewable.
    OUTPUT.mkdir(parents=True, exist_ok=True)
    lines = [json.dumps(header, ensure_ascii=False)[:-1] + ', "pages": [']
    for i, record in enumerate(records):
        words = record.pop("words")
        lines.append(json.dumps(record)[:-1] + ', "words": [')
        lines.extend(json.dumps(word, ensure_ascii=False, separators=(",", ":")) + ("," if j + 1 < len(words) else "")
                     for j, word in enumerate(words))
        lines.append("]}" + ("," if i + 1 < len(records) else ""))
        print(record["planId"], len(words), "OCR words", flush=True)
    lines.append("]}")
    payload = "\n".join(lines) + "\n"
    json.loads(payload)
    output = OUTPUT / "pilot-ocr.json"
    temp = output.with_suffix(".tmp")
    temp.write_text(payload, encoding="utf-8")
    temp.replace(output)
    (OUTPUT / "pilot-ocr.sha256").write_text(sha256(output) + "\n", encoding="ascii")


if __name__ == "__main__":
    main()
