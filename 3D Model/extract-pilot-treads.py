"""Recover repeated tread lines inside source-reviewed stair assembly bounds."""
import hashlib, json, statistics
from collections import defaultdict
from pathlib import Path
root=Path(__file__).resolve().parent
source=root.parent/"data/campus/visual"
manifest=json.loads((root/"local-analysis/stair-training-review/dataset/manifest.json").read_text())
plans={p["id"]:p for p in json.loads((source/"index.json").read_text())["plans"]}
result={}
for item in manifest["objects"]:
    if not item.get("yoloBox"): continue
    pid=item["planId"]
    plan=plans[pid]
    raw=(source/"geometry"/(pid+".json")).read_bytes()
    assert hashlib.sha256(raw).hexdigest()==plan["geometry"]["sha256"]
    g=json.loads(raw)
    assert g["sourceSha256"]==item["sourcePdfSha256"]==plan["sourceSha256"]
    w,h=(g["coordinateSystem"][k] for k in ("width","height"))
    floor=result.setdefault(pid,dict(hash=g["sourceSha256"],width=w,height=h,banks=[]))
    for bounds in [item["bounds"],*item.get("additionalBounds",[])]:
        before=len(floor["banks"])
        x,y,X,Y=[v*s for v,s in zip(bounds,(w,h,w,h))]
        groups=defaultdict(set)
        strokes=defaultdict(list)
        for line in g["primitives"]:
            if line["kind"]!="line":continue
            (a,b),(c,d)=line["points"]
            if not (x-.8<=min(a,c)<=max(a,c)<=X+.8 and y-.8<=min(b,d)<=max(b,d)<=Y+.8):continue
            horizontal=abs(b-d)<.1
            if not horizontal and abs(a-c)>=.1:continue
            left,right=sorted((a,c) if horizontal else (b,d))
            strokes[(horizontal,round(b if horizontal else a,2))].append((left,right))
        # S300 has a narrow drawn divider between two complete adjacent tread banks.
        tolerance = .05 if item["id"] in {"SE12-F2-p1-stair-03","SE12-F3-p1-stair-01","SE12-F3-p1-stair-02","SE12-F3-p1-stair-03"} else .65
        for (horizontal,pos),pieces in strokes.items():
            merged=[]
            for left,right in sorted(pieces):
                if merged and left<=merged[-1][1]+tolerance:
                    merged[-1][1]=max(merged[-1][1],right)
                else: merged.append([left,right])
            for left,right in merged:
                if right-left>=3:
                    groups[(horizontal,round(left*2)/2,round(right*2)/2)].add(pos)
        for (horizontal,left,right),positions in groups.items():
            positions=sorted(positions)
            gaps=[b-a for a,b in zip(positions,positions[1:])]
            usable=[d for d in gaps if .5<=d<=5]
            if len(usable)<3:continue
            pitch=statistics.median(usable)
            # Missing strokes may interrupt a bank. Keep only consecutive regular runs.
            run=[positions[0]]
            for pos in positions[1:]+[float("inf")]:
                if abs(pos-run[-1]-pitch)>max(.14,.12*pitch):
                    if len(run)>=4:
                        floor["banks"].append(dict(horizontal=horizontal,left=left,right=right,marks=run,assembly=item["id"]))
                    run=[]
                run.append(pos)
        if len(floor["banks"])==before:
            # Preserve the checked footprint as a low plinth where individual flights are unresolved.
            floor["banks"].append(dict(bounds=bounds,assembly=item["id"]))
(root/"pilot-treads.json").write_text(json.dumps(result,separators=(",",":")))
for pid,f in result.items():print(pid,len(f["banks"]))
