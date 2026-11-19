"""Check source-bound passage openings and the corridor side of a signed door."""

import json
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/floor_graph"))
from compile import FloorGrid
from passage_openings import SCALE, bind_corridor_doorways, open_passage_doors


class PassageOpeningTests(unittest.TestCase):
    def setUp(self):
        path = ROOT / "data/campus/visual/geometry/SW3-F2-p1.json"
        self.drawing = json.loads(path.read_text())
        self.pair = {"swings": ["curve-730", "curve-733"]}
        # These two original arcs meet at this PDF point. Nothing else may be
        # removed except within their opening and the transcribed public area.
        self.x, self.y = np.rint(np.array([626.64, 73.23]) * SCALE).astype(int)
        self.sealed = np.full((1600, 2460), 255, dtype=np.uint8)
        self.public = np.zeros_like(self.sealed)
        self.public[self.y - 20 : self.y + 20, self.x : self.x + 20] = 255

    def test_only_the_public_part_of_the_aperture_opens(self):
        open_passage_doors(None, self.drawing, [self.pair], self.sealed, self.public)
        self.assertEqual(self.sealed[self.y, self.x], 0)
        self.assertEqual(self.sealed[self.y, self.x - 1], 255)
        self.assertEqual(self.sealed[self.y, self.x + 12], 255)

    def test_overlapping_wall_is_preserved_even_at_the_centre(self):
        a, b = [620, 73.23], [635, 73.23]
        self.drawing["primitives"].append(
            {
                "id": "test-wall",
                "kind": "line",
                "bbox": [*a, *b],
                "path": [["m", a], ["l", b]],
                "filled": False,
                "strokeWidth": 0.8,
            }
        )
        open_passage_doors(None, self.drawing, [self.pair], self.sealed, self.public)
        self.assertEqual(self.sealed[self.y, self.x], 255)

    def test_unrelated_leaves_do_not_create_a_passage(self):
        record = {"swings": ["curve-730", "curve-829"]}
        with self.assertRaisesRegex(ValueError, "do not share a doorway"):
            open_passage_doors(None, self.drawing, [record], self.sealed, self.public)


class CorridorDoorwayTests(unittest.TestCase):
    def test_requires_the_exact_leaf_and_a_walkable_cell_on_its_public_side(self):
        public = np.zeros((40, 40), dtype=bool)
        public[8:20] = True
        regions = np.where(public, 1, 2)
        grid = FloorGrid(public, np.zeros_like(public), regions, 2)
        words = [{"text": "1700", "kind": "corridor", "region": 1}]
        places = [
            {
                "label": "1730",
                "bounds": [0.45, 0.7, 0.55, 0.8],
                "doors": [],
                "cells": [],
            }
        ]
        leaf = (np.array([8, 10]), np.array([12, 10]), np.array([0, -1]), 4)
        record = {
            "room": "1730",
            "corridor": "1700",
            "threshold": [0.5, 0.5],
            "point": [0.5, 0.3],
        }
        for change in (
            {"threshold": [0.6, 0.5]},
            {"point": [0.5, 0.7]},
            {"point": [0.5, 0.15]},
            {"corridor": "1600"},
        ):
            with self.subTest(change=change), self.assertRaises(ValueError):
                bind_corridor_doorways(
                    grid, words, places, [leaf], [{**record, **change}]
                )
        self.assertEqual(places[0]["cells"], [])
        bind_corridor_doorways(grid, words, places, [leaf], [record])
        self.assertEqual(places[0]["doors"], [[0.5, 0.5, 130]])
        self.assertEqual(places[0]["cells"], [130])
