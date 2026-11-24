"""Check source-bound passage openings and the corridor side of a signed door."""

import json
import sys
import unittest
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts/floor_graph"))
from cad_landings import cell_at_door_swing
from compile import FloorGrid
from passage_openings import (
    SCALE,
    bind_corridor_doorways,
    open_passage_doors,
    open_ramp_markings,
)
from public_components import subcell_passages


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

    def test_door_swing_tie_requires_clearance_within_the_fitted_aperture(self):
        walk = np.zeros((64, 64), dtype=bool)
        walk[:18, 20:37] = True
        sealed = np.zeros((64, 64), dtype=np.uint8)
        sealed[20, :] = 255
        barriers = np.zeros_like(sealed)
        grid = FloorGrid(walk, sealed, np.zeros_like(sealed), 2)
        door = [
            (np.array([10.0, 10.0]), np.array([18.0, 10.0]), np.array([0.0, 1.0]), 8.0)
        ]
        pin = np.array([28.0, 24.0])

        self.assertIsNone(grid.cell_near(pin, 16, boundary=True))
        self.assertIsNotNone(cell_at_door_swing(pin, grid, barriers, door))
        self.assertIsNone(
            cell_at_door_swing(np.array([40.0, 24.0]), grid, barriers, door)
        )
        barriers[20, :] = 255
        self.assertIsNone(cell_at_door_swing(pin, grid, barriers, door))

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


class PublicWalkingGeometryTests(unittest.TestCase):
    def test_ramp_ticks_open_only_in_the_signed_lane_and_preserve_a_wall(self):
        sealed = np.full((64, 64), 255, dtype=np.uint8)
        outline = {
            "id": "ramp",
            "kind": "rectangle",
            "filled": False,
            "bbox": [5, 5, 15, 25],
        }
        wall = {
            "id": "wall",
            "kind": "line",
            "bbox": [6, 25, 14, 25],
            "path": [["m", [6, 25]], ["l", [14, 25]]],
            "filled": False,
            "strokeWidth": 1,
        }
        drawing = {"primitives": [outline, wall]}
        record = {"outline": "ramp", "corridor": "101Z", "laneX": 20 / 64}
        public = sealed.copy()
        with self.assertRaisesRegex(ValueError, "corridor stamp"):
            open_ramp_markings(drawing, [record], sealed, public, [])
        open_ramp_markings(
            drawing, [record], sealed, public, [{"text": "101Z", "kind": "corridor"}]
        )
        self.assertEqual(sealed[10, 20], 0)
        self.assertEqual(sealed[10, 10], 255)
        self.assertEqual(sealed[50, 20], 255)

    def test_narrow_public_lane_keeps_its_connection_and_a_solid_wall_blocks_it(self):
        surface = np.zeros((20, 32), bool)
        surface[2:16, :12] = True
        surface[2:16, 16:] = True
        surface[5:10, 12:16] = True

        def ports(walk):
            grid = FloorGrid(walk, ~walk, np.ones_like(walk, int), 4)
            result = []
            subcell_passages(grid, result)
            return result

        self.assertEqual(len(ports(surface)), 1)
        surface[:, 14] = False
        self.assertEqual(ports(surface), [])
