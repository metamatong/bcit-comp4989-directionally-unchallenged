"""Resolve corridor-side stops without requiring an empty walking cell inside the room."""

from collections import defaultdict

import numpy as np

from cad_doorways import apertures, clear_segment, label_centre
from surfaces import at_label


def stamp_region(regions, box):
    region = at_label(regions, box)
    if region:
        return region
    # Letters sometimes occupy the centre of a small room stamp. Its surrounding
    # border can identify one enclosure, without placing a walking point on text.
    h, w = regions.shape
    x1, y1, x2, y2 = np.rint(np.array(box) * [w,h,w,h]).astype(int)
    x1, x2 = max(0,x1-2), min(w-1,x2+2)
    y1, y2 = max(0,y1-2), min(h-1,y2+2)
    ring = np.r_[regions[y1,x1:x2+1],regions[y2,x1:x2+1],
                 regions[y1:y2+1,x1],regions[y1:y2+1,x2]]
    ids, counts = np.unique(ring[ring>0],return_counts=True)
    if len(ids) and max(counts) >= 0.55 * len(ring):
        return int(ids[np.argmax(counts)])
    return 0


def _room_stamp(word):
    return word["kind"] not in {"shaft","void","corridor"} and not (
        word["kind"]=="room" and word["text"].startswith("M")
    )


def _visible_stamp(grid,face,word,mask=None):
    left,top=grid.norm(word["box"][:2])
    right,bottom=grid.norm(word["box"][2:])
    # Test the near edge of the stamp. Glyph strokes at the centre must not
    # masquerade as an intervening room wall.
    targets=np.array([[left-1,(top+bottom)/2],[right+1,(top+bottom)/2],
                      [(left+right)/2,top-1],[(left+right)/2,bottom+1]])
    mask=grid.partition if mask is None else mask
    return any(clear_segment(mask,face,p) for p in targets)


def _signed_side(grid, members, face, outward, radius, all_words):
    choices = [w for w in members if _room_stamp(w)]
    if not choices and not any(w["kind"]=="corridor" for w in members):
        # A stamp cut by drawing ink can have no compartment ID. A clear line
        # on the room side of this actual leaf must identify just one such stamp.
        choices=[w for w in all_words if _room_stamp(w) and not w["region"]]
        unique_region=False
    else:
        unique_region=len(choices)==1 and not any(v["kind"]=="corridor" for v in members)
    candidates = []
    size = np.array([grid.w, grid.h])
    for w in choices:
        delta = label_centre(w,size) - face
        if delta @ outward < -radius * .25 or np.linalg.norm(delta) > 22 * radius:
            continue
        if unique_region:
            return w
        if _visible_stamp(grid,face,w):
            candidates.append(w)
    return candidates[0] if len(candidates)==1 else None


def _face(grid, middle, direction, shift, radius, swing):
    minimum = 1.13 if swing else .42
    for depth in (minimum, minimum+.2, minimum+.4, minimum+.62):
        p = middle + shift + depth * radius * direction
        x,y = np.rint(p).astype(int)
        if not (0 <= x < grid.w and 0 <= y < grid.h):
            continue
        region = int(grid.regions[y,x])
        if region and clear_segment(grid.structural,middle+shift+.27*radius*direction,p):
            return p, region
    return None


def bind_stations(grid, words, rooms, leaves, terminal):
    by_region=defaultdict(list)
    for w in words:
        by_region[stamp_region(grid.regions,w["box"])].append(w)
    for middle,normal,r in apertures(leaves):
        tangent=np.array([-normal[1],normal[0]])
        stations={}
        for offset in (0,-.27,.27):
            shift=tangent*offset*r
            faces=[_face(grid,middle,n,shift,r,swing) for n,swing in ((normal,True),(-normal,False))]
            if not all(faces) or faces[0][1]==faces[1][1]:
                continue
            for i,(inside,region) in enumerate(faces):
                word=_signed_side(grid,by_region[region],inside,normal if i==0 else -normal,r,words)
                if word is None:
                    continue
                outside,_=faces[1-i]
                cell=grid.cell_near(outside,r*.8)
                path=None
                if cell is None:
                    local=terminal.grid.cell_near(outside,r*.8)
                    if local is None:
                        continue
                    path=terminal.path(local,outside,outside,region)
                    if not path:
                        continue
                key=id(word)
                if key not in stations or (stations[key][0] is None and cell is not None):
                    stations[key]=(cell,path)
        xy=np.round(middle/[grid.w,grid.h],7).tolist()
        for key,(cell,path) in stations.items():
            place=rooms[key]
            if cell is not None:
                if any(d[:2]==xy and d[2] is not None for d in place["doors"]):
                    continue
                place["cells"].add(cell)
                place["doors"]=[d for d in place["doors"] if d[:2]!=xy]+[[*xy,cell]]
            elif not place["cells"] and not place.get("terminalPaths"):
                place["terminalPaths"]=[path]

    _open_leaf_fronts(grid, words, rooms, leaves)


def _open_leaf_fronts(grid, words, rooms, leaves):
    # To stop OUTSIDE a door only its public side needs to be walkable. Desks,
    # printing and tiers inside the room need not have a route through them.
    size=np.array([grid.w,grid.h])
    stamps=[w for w in words if _room_stamp(w)]
    if not stamps: return
    centres=np.array([label_centre(w,size) for w in stamps])
    ownership=getattr(grid,"ownership",grid.partition)
    for middle,normal,r in apertures(leaves):
        tangent=np.array([-normal[1],normal[0]])
        for sign in (1,-1):
            forward=sign*normal
            nearby=np.where(((centres-middle)@forward>0) & (np.linalg.norm(centres-middle,axis=1)<18*r))[0]
            if not len(nearby):continue
            # The far side is considered only if an original, unobstructed
            # public patch exists immediately outside this aperture.
            cell=None
            for lateral in (0,-.23,.23):
                start=middle-forward*r*(1.13 if sign==-1 else .34)+tangent*r*lateral
                for depth in (.03,.25,.48,.72):
                    p=start-forward*r*depth
                    x,y=np.floor(p/grid.cell_size).astype(int)
                    if (0<=x<grid.gw and 0<=y<grid.gh and grid.grid[y,x]
                        and clear_segment(grid.structural,start,p)):
                        cell=int(y*grid.gw+x);break
                if cell is not None:break
            if cell is None:continue
            visible=set()
            for lateral in (0,-.22,.22):
                inner=middle+forward*r*(1.17 if sign==1 else .5)+tangent*r*lateral
                for j in nearby:
                    if _visible_stamp(grid,inner,stamps[j],ownership):
                        visible.add(int(j))
            if len(visible)!=1:continue
            word=stamps[visible.pop()]
            box=(np.array(word["box"][:2])+word["box"][2:])/2
            delta=box*size-middle
            if delta@forward < .35*r:continue
            place=rooms[id(word)];xy=np.round(middle/size,7).tolist()
            if any(np.linalg.norm((np.array(d[:2])-xy)*size)<1.5 and d[2] is not None for d in place["doors"]):
                continue
            place["cells"].add(cell)
            place["doors"]=[d for d in place["doors"] if d[:2]!=xy]+[[*xy,cell]]
