"""Clip only wall strokes that cover a confirmed point with a matching source swing."""
import json, math
def cut_openings(lines, plan, geometry, reviews):
    w,h=(geometry["coordinateSystem"][key] for key in ("width","height"))
    assert geometry["sourceSha256"]==plan["sourceSha256"]
    cuts={}
    for record in reviews:
        if record["planId"]!=plan["id"]:continue
        assert record["sourceSha256"]==plan["sourceSha256"]
        x,y=record["point"]; x*=w;y*=h
        for line in lines:
            x1,y1,x2,y2=[v*k for v,k in zip(line,(w,h,w,h))]
            dx,dy=x2-x1,y2-y1
            if abs(dx)>.05 and abs(dy)>.05:continue
            horizontal=abs(dx)>abs(dy)
            along,across=(x,y) if horizontal else (y,x)
            start,end=sorted((x1,x2) if horizontal else (y1,y2))
            face=y1 if horizontal else x1
            if abs(across-face)>.0006*w or not start<=along<=end:continue
            candidates=set()
            for p in geometry["primitives"]:
                if p["kind"]!="curve":continue
                a,b,c,d=p["bbox"]
                span,offset=( (a,c),(b,d) ) if horizontal else ((b,d),(a,c))
                size=span[1]-span[0];depth=offset[1]-offset[0]
                if 2<size<24 and abs(size-depth)<.18*size and span[0]<=along<=span[1] and min(abs(face-t) for t in offset)<1.3:
                    candidates.add(span)
            if len(candidates)==1:
                cuts.setdefault(line,[]).append(next(iter(candidates)))
    kept=set(lines)-cuts.keys()
    for line,intervals in cuts.items():
        x1,y1,x2,y2=line; horizontal=abs(x2-x1)>abs(y2-y1)
        factor=w if horizontal else h
        start,end=sorted((x1,x2) if horizontal else (y1,y2))
        def keep(lo,hi):
            if hi-lo>1e-6:kept.add((lo,y1,hi,y1) if horizontal else (x1,lo,x1,hi))
        for lo,hi in sorted(intervals):
            keep(start,min(end,lo/factor));start=max(start,hi/factor)
        keep(start,end)
    return kept
