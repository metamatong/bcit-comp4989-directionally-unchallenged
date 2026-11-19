"""Find public floor components attached to source-bound transfer marks."""

import cv2
import numpy as np


def subcell_passages(grid, portals):
    """Restore short, clear walks lost when an entire coarse cell must fit inside the corridor."""
    count,coarse=cv2.connectedComponents(grid.grid.astype(np.uint8),connectivity=4)
    if count<3:return
    parents=list(range(count))
    def root(i):
        while parents[i]!=i:
            parents[i]=parents[parents[i]]
            i=parents[i]
        return i
    for a,b,*_ in portals:
        parents[root(coarse.flat[a])]=root(coarse.flat[b])
    pitch=grid.cell_size
    safe=cv2.distanceTransform(grid.walk.astype(np.uint8),cv2.DIST_L2,5)>=max(1.5,pitch*.48)
    _,fine=cv2.connectedComponents(safe.astype(np.uint8),connectivity=4)
    yp=np.rint((np.arange(grid.gh)+.5)*pitch).astype(int)
    xp=np.rint((np.arange(grid.gw)+.5)*pitch).astype(int)
    islands=fine[np.ix_(yp,xp)]
    size=np.array([grid.w,grid.h])
    def clear(a,b):
        pts=np.rint(np.linspace(a,b,max(2,int(np.ceil(np.linalg.norm(b-a)*2))+1))).astype(int)
        return safe[pts[:,1],pts[:,0]].all()
    # Only join nearby grid cells in one independently connected fine-resolution
    # free area. Test the actual polyline too: a wall with a distant opening
    # must never be crossed locally just because both sides share a component.
    offsets=sorted(((x,y) for y in range(6) for x in range(-5,6)
                    if (y or x>0) and 1<x*x+y*y<=25),key=lambda d:d[0]**2+d[1]**2)
    for dx,dy in offsets:
        x=max(0,-dx);xx=min(grid.gw,grid.gw-dx);yy=grid.gh-dy
        left=coarse[:yy,x:xx];right=coarse[dy:,x+dx:xx+dx]
        fin=islands[:yy,x:xx]
        ys,xs=np.nonzero((left!=right)&(left>0)&(right>0)&(fin>0)&(fin==islands[dy:,x+dx:xx+dx]))
        for j,i in zip(ys,xs):
            first,second=root(left[j,i]),root(right[j,i])
            if first==second:continue
            start=np.array([xp[i+x],yp[j]]);end=np.array([xp[i+x+dx],yp[j+dy]])
            for bend in ((start+end)/2,np.array([start[0],end[1]]),np.array([end[0],start[1]])):
                if clear(start,bend) and clear(bend,end):
                    a=int(j*grid.gw+i+x);b=int(a+dy*grid.gw+dx)
                    portals.append([a,b,*[np.round(point/size,7).tolist() for point in (start,bend,end)]])
                    parents[first]=second
                    break


def transfer_components(grid, extra, nodes, symbols, faces_at, clear, barriers):
    count, parts = cv2.connectedComponents(grid.grid.astype(np.uint8), connectivity=4)
    parents = list(range(count))

    def component(i):
        i = int(i)
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    for middle, normal, r in symbols:
        faces = faces_at(grid, middle, normal, r)
        if len(faces) != 2 or not clear(barriers, faces[0][0], faces[1][0]):
            continue
        cells = [grid.cell_near(p, r * 0.78) for p, _ in faces]
        if None not in cells:
            a, b = cells
            parents[component(parts.flat[a])] = component(parts.flat[b])
    seeds = []
    seeds.extend(a["point"] for a in extra.get("cadLandingFrontages", []))
    seeds.extend([n["point"]["x"], n["point"]["y"]] for n in nodes)
    keep = set()
    for point in seeds:
        cell = grid.cell_near(grid.norm(point), grid.cell_size * 8, boundary=True)
        if cell is not None:
            keep.add(component(parts.flat[cell]))
    # This pass prefers rooms with an exit onto a component containing a live
    # mapped transfer. Detached but valid local approaches are compiled separately.
    roots = np.array([component(i) in keep for i in range(count)])
    full = np.repeat(
        np.repeat(roots[parts], grid.cell_size, axis=0), grid.cell_size, axis=1
    )
    walk = np.zeros_like(grid.walk)
    walk[: full.shape[0], : full.shape[1]] = full
    return type(grid)(grid.walk & walk, grid.sealed, grid.regions, grid.cell_size)
