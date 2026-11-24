"""Extract approximate drawing extents from the official floor-plan thumbnails."""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

model = Path(__file__).resolve().parent
repo = model.parent
plans = json.loads((repo / "data/campus/visual/index.json").read_text())["plans"]
records = {}
for plan in plans:
    image = Image.open(repo / plan["overview"]["file"]).convert("L")
    image.thumbnail((800, 800))
    ink = np.asarray(image) < 210
    h, w = ink.shape
    # Remove long page-frame strokes before grouping nearby drawing strokes.
    for axis, length in [(0, int(.83*h)), (1, int(.83*w))]:
        shape = (length, 1) if axis == 0 else (1, length)
        ink &= ~ndimage.binary_opening(ink, structure=np.ones(shape, bool))
    labels, count = ndimage.label(ndimage.maximum_filter(ink, size=7))
    if not count:
        continue
    weights = np.bincount(labels[ink])
    best = weights[1:].argmax() + 1
    ys, xs = np.where((labels == best) & ink)
    if len(xs) < 100:
        continue
    bounds = [xs.min()/w, ys.min()/h, (xs.max()+1)/w, (ys.max()+1)/h]
    records[plan["id"]] = {"hash":plan["sourceSha256"], "bounds":[round(v,5) for v in bounds]}
(model / "drawing-extents.json").write_text(json.dumps(records, indent=2)+"\n")
