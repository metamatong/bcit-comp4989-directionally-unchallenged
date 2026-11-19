"""Find signed rooms on either side of physical doors on layered and flattened plans.

Room-stamp segmentation is independent of pedestrian clearance. In particular, text
and seating can split a room stamp on a scan without introducing a public passage.
"""

from collections import defaultdict
from copy import copy

import cv2
import numpy as np
from scipy.spatial import cKDTree

from cad_doorways import bind_doors, apertures, door_faces, clear_segment
from cad_layers import CadLayers, open_wall_gaps
from cad_spaces import cad_spaces
from corridor_vicinities import corridor_vicinities
from doors import SCALE, curve_points
from door_stations import bind_stations, stamp_region
from labels import IDENTIFIER, intersects
from passage_openings import _paint
from surfaces import near_caption
from terminal_paths import interior_grid, TerminalPaths
from public_components import transfer_components


def identify_stamps(page, plan, words, config):
    if "frontageLayers" in config:
        for record in cad_spaces(page, plan, words, ("StylusBT","ArialMT")):
            matching = [w for w in words if w["text"]==record["text"] and intersects(w["box"],record["box"])]
            if not matching:
                words.append(record)
            elif len(matching)==1:
                matching[0]["signedUse"] = True
                if matching[0]["kind"]=="room":
                    matching[0]["kind"]=record["kind"]
            record["signedUse"] = True
    identifiers = [w for w in words if IDENTIFIER.fullmatch(w["text"])]
    captions = [w for w in words if w not in identifiers and w["kind"]!="room"]
    for word in identifiers:
        uses = {w["kind"] for w in captions if near_caption(w["box"],word["box"])
                and sum(near_caption(w["box"],s["box"]) for s in identifiers)==1}
        if len(uses)==1:
            word["signedUse"]=True
            if word["kind"]=="room":
                word["kind"]=next(iter(uses))


def _stroke_of_leaf(points, leaf):
    hinge, tip, normal, radius = leaf
    delta = points - hinge
    along = delta @ ((tip - hinge) / radius)
    up = delta @ normal
    # Match the curved swing itself, or its full straight open leaf. A wall
    # continuing past the jamb is a separate stroke and stays in the mask.
    closed_leaf = (
        max(np.abs(up)) < 0.24 and min(along) >= -.22 and max(along) <= radius+.22
        and min(along) < .18*radius and max(along) > .82*radius
    )
    return closed_leaf or (
        np.all(np.abs(np.linalg.norm(delta, axis=1) - radius) < 0.22)
        and min(along) >= -0.12 and min(up) >= -0.12
        and np.ptp(along) > 0.025 and np.ptp(up) > 0.025
    ) or (
        max(np.abs(along)) < 0.20 and min(up) >= -0.10
        and np.ptp(up) > radius * 0.48 and max(up) < radius + 0.15
    )


def _stamp_free_partitions(ink, words):
    """Remove detached stamp ink before looking for partition gaps next to a label."""
    height,width=ink.shape
    _, labels, stats, _ = cv2.connectedComponentsWithStats(ink,connectivity=8)
    erase=np.zeros(len(stats),bool)
    for word in words:
        l,t,r,b=np.rint(np.array(word["box"])*[width,height,width,height]).astype(int)
        # The name of the space is normally printed immediately below its number.
        # This clearance is for compartment recognition only. Collision keeps every
        # original obstacle, and a line continuing out of the box is preserved.
        dx=max(3,round((r-l)*.85));dy=max(3,round((b-t)*1.8))
        l,t,r,b=max(0,l-dx),max(0,t-dy),min(width,r+dx+1),min(height,b+dy+1)
        for i in np.unique(labels[t:b,l:r]):
            x,y,w,h,_=stats[i]
            if i and x>=l and y>=t and x+w<=r and y+h<=b:
                erase[i]=True
    return np.where(erase[labels],0,ink).astype(np.uint8)


def _stamp_heights(shape,words):
    height,width=shape
    heights=np.zeros(shape,np.float32)
    for word in words:
        l,t,r,b=np.array(word["box"])*[width,height,width,height]
        sw,sh=r-l,b-t
        if not sw or not sh: continue
        # The short dimension gives the height of the printed glyph in either
        # page orientation. Cover the ID and accompanying use caption only.
        dx,dy=(sw*.7,sh*1.8) if sw>=sh else (sw*1.8,sh*.7)
        box=heights[max(0,int(t-dy)):min(height,int(b+dy)+2),max(0,int(l-dx)):min(width,int(r+dx)+2)]
        np.maximum(box,min(sw,sh),out=box)
    return heights


def _printed_glyph(item,box,heights):
    if not item["filled"] or item["kind"]!="curve" or len(item.get("path",[]))<8:return False
    l,t,r,b=np.rint(box*SCALE).astype(int)
    h,w=heights.shape
    if l<0 or t<0 or r>=w or b>=h:return False
    font_height=min(heights[t,l],heights[b,r])
    return font_height>0 and max(r-l,b-t) <= min(19,1.4*font_height+1)


def _flattened_masks(geometry, shape, leaves, words):
    barriers = np.zeros(shape, np.uint8)
    glyphs=np.zeros_like(barriers)
    heights=_stamp_heights(shape,words)
    hinges = cKDTree([h for h, *_ in leaves])
    largest = max(leaf[3] for leaf in leaves)
    for item in geometry["primitives"]:
        box = np.array(item["bbox"])
        if _printed_glyph(item,box,heights):
            _paint(item,glyphs,np.zeros(2))
            continue
        near = hinges.query_ball_point(
            (box[:2] + box[2:]) / 2, largest + np.linalg.norm(box[2:] - box[:2]) / 2 + 1
        )
        if near and not item["filled"] and item["kind"] != "rectangle":
            segments = list(curve_points(item.get("path", [])))
            if segments:
                # A single PDF path can draw several doors AND unrelated walls.
                # Keep its individual wall segments even when they share this path.
                for a, b in segments:
                    nearby = hinges.query_ball_point((a + b) / 2, largest + 1)
                    if nearby and any(_stroke_of_leaf(np.array([a,b]), leaves[i]) for i in nearby):
                        continue
                    cv2.line(barriers, np.rint(a*SCALE).astype(int), np.rint(b*SCALE).astype(int), 255,
                             max(1, int(np.ceil(item["strokeWidth"]*SCALE))))
                continue
        _paint(item, barriers, np.zeros(2))
    # Only for identifying the enclosure behind a door. Short strokes from
    # vectorized letters and curved seating rows are not room partitions.
    length = max(7, round(np.median([s[3] for s in leaves]) * SCALE * 1.45))
    ink = _stamp_free_partitions(barriers,words)
    walls = np.zeros_like(barriers)
    for kernel in (np.ones((1, length), np.uint8), np.ones((length, 1), np.uint8)):
        walls |= cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel)
    # Keep oblique partitions too; omit curved glyphs/seat rows from ownership only.
    for item in geometry["primitives"]:
        if item["kind"] != "line" or len(item["points"]) != 2:
            continue
        a, b = np.array(item["points"]) * SCALE
        if np.linalg.norm(a - b) >= length and min(np.abs(a - b)) > 1:
            cv2.line(walls, np.rint(a).astype(int), np.rint(b).astype(int), 255, 1)
    return walls, barriers, glyphs


def _distinct_leaves(primary, extra):
    leaves = list(primary)
    centres = [(h + tip) / 2 for h, tip, *_ in leaves]
    for leaf in extra:
        mid = (leaf[0] + leaf[1]) / 2
        if not any(np.linalg.norm(mid - c) < 0.9 for c in centres):
            leaves.append(leaf)
            centres.append(mid)
    return leaves


class DrawingFrontages:
    def __init__(self, page, geometry, config, leaves, sealed, words):
        self.glyphs=None
        if "frontageLayers" in config:
            sheet = CadLayers(page, config["frontageLayers"])
            self.leaves = _distinct_leaves(sheet.swings(), leaves)
            walls, barriers = sheet.walls, sheet.walls | sheet.objects
            partition = walls | sheet.door_ink
        else:
            self.leaves = leaves
            walls, barriers, self.glyphs = _flattened_masks(geometry, sealed.shape, leaves, words)
            partition = walls.copy()
        for hinge, tip, *_ in self.leaves:
            a, b = np.rint(np.array([hinge, tip]) * SCALE).astype(int)
            cv2.line(partition, a, b, 255, 3)
        kernel = np.ones((3, 3), np.uint8)
        self.structural = barriers
        self.sealed = cv2.dilate(partition | barriers, kernel)
        gaps, self.open_bays = open_wall_gaps(walls, self.leaves)
        self.ownership = cv2.dilate(partition,kernel)
        self.partition = self.ownership | gaps
        _, self.regions, self.stats, _ = cv2.connectedComponentsWithStats(
            255 - self.partition, connectivity=4
        )

    def extend_surface(self, base_walk, sealed, words, config):
        h, w = sealed.shape
        occupancy = defaultdict(set)
        for stamp in words:
            if IDENTIFIER.fullmatch(stamp["text"]):
                occupancy[stamp_region(self.regions, stamp["box"])].add(stamp["kind"])
        public = np.zeros_like(sealed)
        for region, kinds in occupancy.items():
            x, y, rw, rh, area = self.stats[region]
            if (region and kinds == {"corridor"} and area < h * w * 0.12
                and x > 1 and y > 1 and x + rw < w - 1 and y + rh < h - 1):
                public[self.regions == region] = 255
        for polygon in config.get("areas", []):
            cv2.fillPoly(public, [np.rint(np.array(polygon) * [w, h]).astype(np.int32)], 255)
        outline = np.zeros_like(public)
        for polygon in config["cadInteriorBounds"]:
            cv2.fillPoly(outline, [np.rint(np.array(polygon) * [w, h]).astype(np.int32)], 255)
        public[outline == 0] = 0
        # With named CAD layers the public surface can disregard printed annotations.
        # Flattened sheets retain their original collision mask for walking.
        if self.glyphs is not None:
            # Remove only the ink of matched vector glyphs. Independent walls
            # under a caption and the closed jamb line retain their collision.
            lettering=cv2.dilate(self.glyphs,np.ones((5,5),np.uint8))
            sealed=sealed.copy()
            sealed[(lettering>0)&(self.sealed==0)]=0
        collision = self.sealed if "frontageLayers" in config else sealed
        walk = base_walk | ((public > 0) & (collision == 0))
        return walk, np.where(public, sealed & collision, sealed).astype(np.uint8)

    def bind(self, base, places, config, protected, transfer_nodes):
        view = copy(base)
        view.regions, view.partition, view.structural = self.regions, self.partition, self.structural
        view.ownership=self.ownership
        words, by_region, rooms = [], defaultdict(list), {}
        for place in places:
            word = {"text": place["label"], "kind": place["kind"], "box": place["bounds"]}
            word["region"] = stamp_region(self.regions, word["box"])
            words.append(word)
            by_region[word["region"]].append(word)
            rooms[id(word)] = {"label": word["text"], "cells": set(), "doors": []}
        interior = interior_grid(view, config, self.regions, by_region)
        portals, terminal = bind_doors(
            view, interior, rooms, by_region, [*self.leaves, *self.open_bays], self.structural, len(self.leaves)
        )
        bind_stations(view, words, rooms, self.leaves, terminal)
        for place, word in zip(places, words):
            if (place["label"] in protected or place.get("visitorAccess")
                or place["kind"] in {"shaft", "void", "stairs", "elevator"}
                or not IDENTIFIER.fullmatch(place["label"])):
                continue
            new = rooms[id(word)]
            old = {tuple(d[:2]): d[2] for d in place["doors"]}
            for x, y, cell in new["doors"]:
                if cell is not None and old.get((x, y)) is None:
                    old[(x, y)] = cell
            if not place["cells"]:
                place["cells"] = sorted(new["cells"])
                if new.get("terminalPaths"):
                    place["terminalPaths"] = new["terminalPaths"]
                if new.get("sharedEntry"):
                    place["sharedEntry"] = True
            else:
                place["cells"] = sorted(set(place["cells"]) | {
                    cell for point, cell in old.items()
                    if cell is not None and not any(
                        np.linalg.norm(view.norm(point) - view.norm(d[:2])) < 2
                        for d in place["doors"] if d[2] is not None
                    )
                })
            place["doors"] = [[*point, cell] for point, cell in old.items()]
        primary=transfer_components(view,config,transfer_nodes,list(apertures([*self.leaves,*self.open_bays])),
                                    door_faces,clear_segment,self.structural)
        if np.any(primary.grid):
            passages=[(a,b,points) for (a,b),points in terminal.apertures.items() if a<b]
            to_transfer=TerminalPaths(interior,primary,passages)
            to_transfer.attach_local_stations(places,protected)
        corridor_vicinities(view,places,config,float(np.median([s[3] for s in self.leaves]))*SCALE,protected)
        return portals, terminal
