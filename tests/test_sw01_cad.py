"""Checks on the supplied SW01 CAD sheets and their source-specific corrections."""

import json
import sys
import unittest
from pathlib import Path

import numpy as np
import pymupdf

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/floor_graph"))
from cad_layers import CadLayers
from cad_spaces import cad_spaces
from cad_walkways import open_public_walkways
from labels import inventory, label_words


class NativeFloorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.floors = {
            p["floor"]: (p, path) for p, path in inventory() if p["building"] == "SW1"
        }
        cls.config = {
            p["planId"]: p
            for p in json.loads(
                (ROOT / "data/campus/spatial/floor-circulation.json").read_text()
            )["plans"]
        }

    def test_programme_captions_identify_rooms_and_exclude_riser_counts(self):
        plan, path = self.floors["2"]
        with pymupdf.open(path) as source:
            places = cad_spaces(source[0], plan, label_words(plan, source[0]))
        named = {p["text"]: p for p in places}
        self.assertEqual(named["2016"]["kind"], "classroom")
        self.assertEqual(named["S232"]["kind"], "stairs")
        self.assertEqual(named["M222"]["kind"], "shaft")
        self.assertNotIn("21", named)

    def test_overprinted_identifiers_require_the_named_source_partner(self):
        plan = {"id": "label-fixture", "sourceSha256": "unused"}
        labels = [
            {"text": "101Y", "kind": "corridor", "bounds": [0.25, 0.25, 0.35, 0.31]},
            {
                "text": "100Z",
                "kind": "vestibule",
                "bounds": [0.31, 0.28, 0.40, 0.34],
                "coPrintedWith": "101Y",
            },
        ]
        with pymupdf.open() as document:
            page = document.new_page(width=500, height=500)
            # Native identifiers suppress OCR and keep this a source-parsing unit test.
            for i in range(12):
                page.insert_text((350, 30 + i * 25), str(200 + i))
            words = label_words(plan, page, labels)
            self.assertEqual(
                [w["text"] for w in words if w["method"] == "transcription"],
                ["101Y", "100Z"],
            )
            with self.assertRaisesRegex(ValueError, "overlapping source transcription"):
                label_words(plan, page, [{**labels[1], "coPrintedWith": "103Y"}])

    def test_lobby_sill_exception_requires_the_exact_leaf_and_source_strokes(self):
        plan, path = self.floors["1"]
        config = self.config[plan["id"]]
        record = config["cadDoorSills"][0]
        with pymupdf.open(path) as doc:
            sheet = doc[0]
            layers = CadLayers(sheet, config["cadLayers"], [record])
            centre = np.array(record["threshold"]) * [plan["width"], plan["height"]]
            self.assertEqual(
                sum(
                    np.linalg.norm((h + t) / 2 - centre) < 0.3
                    for h, t, *_ in layers.swings()
                ),
                1,
            )
            with self.assertRaisesRegex(ValueError, "sill"):
                CadLayers(
                    sheet, config["cadLayers"], [{**record, "layer": "WALL"}]
                ).swings()

    def test_projection_clearance_is_limited_to_registered_ink_in_a_public_crossing(
        self,
    ):
        with pymupdf.open() as document:
            page = document.new_page(width=40, height=40)
            for start, end in [((4, 20), (36, 20)), ((20, 4), (20, 36))]:
                drawing = page.new_shape()
                drawing.draw_line(start, end)
                drawing.finish(width=0.5, closePath=False)
                drawing.commit()
            record = {
                "basis": "Marked public crossing",
                "bounds": [0.20, 0.40, 0.80, 0.60],
                "sourceLines": [{"layer": "", "segments": [[4, 20, 36, 20, 1]]}],
            }
            public = np.zeros((80, 80), dtype=np.uint8)
            public[:, 22:62] = 255
            sealed = np.full_like(public, 255)
            barriers = sealed.copy()
            door = (np.array([24, 18]), np.array([24, 22]))
            open_public_walkways(page, [], [record], [door], public, sealed, barriers)
            for mask in (sealed, barriers):
                self.assertEqual(mask[40, 32], 0)
                self.assertEqual(mask[40, 40], 255)  # Intersecting wall
                self.assertEqual(mask[40, 48], 255)  # Door threshold
                self.assertEqual(mask[40, 18], 255)  # Outside the public floor
                self.assertEqual(mask[40, 66], 255)  # Outside the registered span
                self.assertEqual(mask[36, 32], 255)  # Unrelated ink
            record["sourceLines"][0]["segments"][0][-1] = 2
            with self.assertRaisesRegex(ValueError, "source line|CAD strokes changed"):
                open_public_walkways(page, [], [record], [], public, sealed, barriers)


if __name__ == "__main__":
    unittest.main()
