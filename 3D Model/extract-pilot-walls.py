"""Extract source-bound wall lines for the pilot Three.js model."""
import hashlib, json, math, sys
from pathlib import Path
root = Path(__file__).resolve().parent
sys.path.insert(0, str(root / ".geometry-tools"))
import pymupdf
from confirmed_doorways import cut_openings
data = root.parent / "data/campus"
catalog = json.loads((data/"visual/index.json").read_text())["plans"]
result = {}
for plan in catalog:
    if plan["building"] not in ("SE12","SW3") or plan["floor"] not in ("1","2","3","4"):
        continue
    path = data/"raw"/plan["sourceUrl"].split("/")[-1]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == plan["sourceSha256"]
    with pymupdf.open(path) as doc:
        page = doc[0]
        w,h = page.rect.width,page.rect.height
        drawings = page.get_drawings()
        names = {"WALL","E-WALL","I-WALL"}
        layered = any(d.get("layer","").split("|")[-1].upper() in names for d in drawings)
        lines = set()
        straight = []
        for d in drawings:
            if layered and d.get("layer","").split("|")[-1].upper() not in names:
                continue
            for item in d["items"]:
                if item[0]=="l": pairs=[item[1:3]]
                elif item[0]=="re" and layered:
                    r=item[1]; pairs=[(r.tl,r.tr),(r.tr,r.br),(r.br,r.bl),(r.bl,r.tl)]
                else: continue
                for a,b in pairs:
                    a,b=a*page.rotation_matrix,b*page.rotation_matrix
                    if layered:
                        if abs(a-b)>.2: lines.add(tuple(round(v,6) for v in (a.x/w,a.y/h,b.x/w,b.y/h)))
                    elif abs(a-b)>9 and max(abs(a.x-b.x)/w,abs(a.y-b.y)/h)<.45:
                        # Paired orthogonal strokes with close spacing and overlapping extents.
                        horizontal=abs(a.y-b.y)<.12
                        if not horizontal and abs(a.x-b.x)>.12: continue
                        x,y=sorted((a.x,b.x) if horizontal else (a.y,b.y))
                        straight.append((horizontal,a.y if horizontal else a.x,x,y))
        if not layered:
            straight.sort()
            for i,(axis,pos,start,end) in enumerate(straight):
                for j in range(i+1,len(straight)):
                    other,p,s,e=straight[j]
                    if axis!=other or p-pos>3.5: break
                    lo,hi=max(start,s),min(end,e)
                    if p-pos<.55 or hi-lo<max(9,.70*min(end-start,e-s)): continue
                    mid=(pos+p)/2
                    coords=(lo/w,mid/h,hi/w,mid/h) if axis else (mid/w,lo/h,mid/w,hi/h)
                    if all(.025<v<.975 for v in coords):
                        lines.add(tuple(round(v,6) for v in coords))
        geometry_path = data.parent.parent / plan["geometry"]["file"]
        raw = geometry_path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == plan["geometry"]["sha256"]
        review = json.loads((root/"local-analysis/doorway-review/confirmed.json").read_bytes())
        lines = cut_openings(lines, plan, json.loads(raw), [r for r in review["locations"] if r["doorway"]])
        result[plan["id"]]={"sourceSha256":plan["sourceSha256"],"estimated":not layered,"segments":sorted(lines)}
        print(plan["id"],"CAD" if layered else "estimated",len(lines))
assert len(result)==8 and all(r["segments"] for r in result.values())
(root/"pilot-walls.json").write_text(json.dumps(result,separators=(",",":")))
