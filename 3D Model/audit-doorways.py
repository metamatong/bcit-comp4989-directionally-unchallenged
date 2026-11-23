"""Compare published room routing and the displayed wall solids on the eight pilot plans."""
import csv, hashlib, io, json, math, subprocess
from pathlib import Path
from collections import Counter
root=Path(__file__).resolve().parent
app=root.parent
data=app/"data/campus"
walls=json.loads((root/"pilot-walls.json").read_bytes())
plans={p["id"]:p for p in json.loads((data/"visual/index.json").read_bytes())["plans"]}
graph=(data/"spatial/floor-graphs.json").read_bytes()
assert hashlib.sha256(graph).hexdigest()==(data/"spatial/floor-graphs.sha256").read_text().strip()
output=subprocess.check_output(["node","--import","tsx","scripts/report-building-coverage.ts","--network","--csv"],cwd=app)
coverage=list(csv.DictReader(io.StringIO(output.decode("utf-8-sig"))))
def hits(a,b,wall):
    x,y,X,Y=wall
    dx,dy=X-x,Y-y
    length=math.hypot(dx,dy)
    if not length:return False
    ux,uy=dx/length,dy/length
    # Clip the route segment against the actual oriented box footprint (.012 wide).
    lo,hi=0.,1.
    for axis,vmin,vmax in [((ux,uy),0,length),((-uy,ux),-.006,.006)]:
        u,v=axis
        start=(a[0]-x)*u+(a[1]-y)*v
        delta=(b[0]-a[0])*u+(b[1]-a[1])*v
        if abs(delta)<1e-12:
            if not vmin<=start<=vmax:return False
        else:
            t1,t2=sorted(((vmin-start)/delta,(vmax-start)/delta))
            lo,hi=max(lo,t1),min(hi,t2)
            if lo>hi:return False
    return True
report={}
for floor in json.loads(graph)["floors"]:
    pid=floor["id"]
    if pid not in walls:continue
    plan=plans[pid]; mesh=walls[pid]
    assert plan["sourceSha256"]==floor["sourceSha256"]==mesh["sourceSha256"]
    h=10*plan["height"]/plan["width"]
    segments=[(x*10,y*h,X*10,Y*h) for x,y,X,Y in mesh["segments"]]
    paths={}
    for kind,records in [("public",floor["portals"]),("interior",floor.get("interiorAccess",{}).get("ports",[]))]:
        for _,__,*points in records:
            path=tuple(map(tuple,points))
            key=min(path,path[::-1])
            paths.setdefault(key,set()).add(kind)
    conflicts=[]
    for path,kinds in paths.items():
        pts=[(x*10,y*h) for x,y in path]
        xmin=min(x for x,y in pts)-.006;xmax=max(x for x,y in pts)+.006
        ymin=min(y for x,y in pts)-.006;ymax=max(y for x,y in pts)+.006
        indices=[i for i,w in enumerate(segments) if min(w[0],w[2])<=xmax and max(w[0],w[2])>=xmin and min(w[1],w[3])<=ymax and max(w[1],w[3])>=ymin and any(hits(a,b,w) for a,b in zip(pts,pts[1:]))]
        if indices:conflicts.append(dict(path=path,types=sorted(kinds),wallIndices=indices))
    rooms=[r for r in coverage if r["planId"]==pid and r["excluded"] in ("","false") and r["kind"] not in ("stairs","elevator","corridor","outdoor","vestibule","lobby","shaft","void")]
    door_points={}
    for place in floor["places"]:
        for x,y,cell in place["doors"]:
            door_points.setdefault((x,y),set()).add(place["label"])
    overlaps=[]
    for (x,y),labels in door_points.items():
        point=(10*x,h*y)
        indices=[i for i,w in enumerate(segments) if min(w[0],w[2])-.006<=point[0]<=max(w[0],w[2])+.006 and min(w[1],w[3])-.006<=point[1]<=max(w[1],w[3])+.006 and hits(point,point,w)]
        if indices:overlaps.append(dict(point=[x,y],labels=sorted(labels),wallIndices=indices))
    states=Counter(r["status"] for r in rooms)
    report[pid]=dict(sourceSha256=mesh["sourceSha256"],estimated=mesh["estimated"],uniqueDoorPaths=len(paths),intersectingPaths=len(conflicts),conflicts=conflicts,doorPointCount=len(door_points),doorPointOverlaps=overlaps,roomStatuses=dict(states),rooms=rooms)
    print(pid,len(paths),len(conflicts),dict(states))
(root/"local-analysis/doorway-audit.json").write_text(json.dumps(report,indent=2))
