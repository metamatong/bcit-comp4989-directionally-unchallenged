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


if __name__ == "__main__":
    unittest.main()
