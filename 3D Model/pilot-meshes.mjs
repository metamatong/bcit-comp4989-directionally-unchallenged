import treads from "./pilot-treads.json";
import * as T from "three";
import walls from "./pilot-walls.json";

function blocks(count, color) {
  return new T.InstancedMesh(new T.BoxGeometry(), new T.MeshLambertMaterial({color}), count);
}

export function wallMesh(plan, height) {
  const record = walls[plan.id];
  if (!record || record.sourceSha256 !== plan.sourceSha256) return;
  const mesh = blocks(record.segments.length, record.estimated ? 0x8cafa9 : 0xb5cddd);
  const block = new T.Object3D();
  record.segments.forEach(([x1,y1,x2,y2], index) => {
    const dx=(x2-x1)*10, dz=(y2-y1)*height;
    block.position.set(((x1+x2)/2-.5)*10,.12,((y1+y2)/2-.5)*height);
    block.rotation.y=-Math.atan2(dz,dx);
    block.scale.set(Math.hypot(dx,dz),.24,.012);
    block.updateMatrix();
    mesh.setMatrixAt(index,block.matrix);
  });
  mesh.userData.estimated=record.estimated;
  return mesh;
}


// Keep each flight on its own sheet. Exploding the stack must never stretch a tread.
export function stairMeshes(plan, sheetHeight, transfers) {
  const floor = treads[plan.id];
  if (!floor || floor.hash !== plan.sourceSha256) return [];
  const sx = 10 / floor.width, sz = sheetHeight / floor.height;
  const assemblies = {
    "SE12-F2-p1-stair-03":"S200", "SE12-F3-p1-stair-01":"S300",
    "SE12-F3-p1-stair-02":"S328", "SE12-F3-p1-stair-03":"S313",
    "SE12-F3-p1-stair-04":"S327", "SW3-F2-p1-stair-01":"S260",
    "SW3-F3-p1-stair-01":"S360",
  };
  const layouts=new Map(), treadLayout=new Map();
  for(const [assembly,label] of Object.entries(assemblies)){
    const transfer=transfers.get(plan.id+"/"+label);
    const banks=floor.banks.filter(b=>b.assembly===assembly && b.marks);
    if(!transfer?.above || !transfer.below || banks.length<2)continue;
    const horizontal=banks[0].horizontal;
    const ranges=banks.map(b=>b.marks);
    const first=Math.min(...ranges.map(r=>r[0])), last=Math.max(...ranges.map(r=>r.at(-1)));
    const approach=horizontal?transfer.point.y*floor.height:transfer.point.x*floor.width;
    const lowSide=Math.abs(approach-first)<=Math.abs(approach-last);
    const left=Math.min(...banks.map(b=>b.left)),right=Math.max(...banks.map(b=>b.right));
    const tandem=label==="S327";
    const depth=Math.min(...banks.map(b=>b.right-b.left))*.65;
    const start=tandem?banks[0].marks.at(-1):lowSide?first-depth:last;
    const end=tandem?banks[1].marks[0]:lowSide?first:last+depth;
    const group=new T.Group();
    group.userData.title=label+" shared landing | gold up to "+transfer.above+" | blue down to "+transfer.below;
    const slab=new T.Mesh(new T.BoxGeometry((horizontal?right-left:end-start)*sx,.012,(horizontal?end-start:right-left)*sz),new T.MeshLambertMaterial({color:0xdac39b}));
    slab.position.set((horizontal?(left+right):(start+end))*sx/2-5,.002,(horizontal?(start+end):(left+right))*sz/2-sheetHeight/2);
    group.add(slab);layouts.set(assembly,group);
    for(const bank of banks){
      const descending=tandem?bank===banks[0]:bank.left===left;
      const adjacent=banks.filter(b=>b.left===bank.left && (!tandem || b===bank));
      const origin=tandem?(descending?start:end):lowSide?Math.min(...adjacent.map(b=>b.marks[0])):Math.max(...adjacent.map(b=>b.marks.at(-1)));
      treadLayout.set(bank,{descending,origin});
      // Extend the flat threshold only to the first recovered tread of each lane.
      const gapStart=Math.min(lowSide?end:start,origin),gapEnd=Math.max(lowSide?end:start,origin);
      if(!tandem && bank===adjacent[0] && gapEnd>gapStart){
        const pad=slab.clone();pad.geometry=new T.BoxGeometry((horizontal?bank.right-bank.left:gapEnd-gapStart)*sx,.012,(horizontal?gapEnd-gapStart:bank.right-bank.left)*sz);
        pad.position.set((horizontal?bank.left+bank.right:gapStart+gapEnd)*sx/2-5,.002,(horizontal?gapStart+gapEnd:bank.left+bank.right)*sz/2-sheetHeight/2);
        group.add(pad);
      }
    }
  }
  const meshes = floor.banks.map(bank => {
    const block = new T.Object3D();
    if (bank.bounds) {
      const [x,y,X,Y] = bank.bounds;
      const mesh = blocks(1, 0xcf985b);
      mesh.userData.assembly=bank.assembly;
      block.position.set(((x+X)/2-.5)*10,.015,((y+Y)/2-.5)*sheetHeight);
      block.scale.set((X-x)*10,.03,(Y-y)*sheetHeight);
      block.updateMatrix(); mesh.setMatrixAt(0,block.matrix);
      return mesh;
    }
    const layout=treadLayout.get(bank);
    const descending=layout?.descending;
    const mesh = blocks(bank.marks.length-1, descending ? 0x37b9e5 : 0xffad43);
    // Adjacent source marks bound each tread exactly. Rise is illustrative.
    let elevation = 0;
    for (let i=1; i<bank.marks.length; i++) {
      const center=(bank.marks[i-1]+bank.marks[i])/2;
      const depth=bank.marks[i]-bank.marks[i-1];
      const mid=(bank.left+bank.right)/2;
      const width=bank.right-bank.left;
      const rise=depth*(bank.horizontal ? sz : sx)*.55;
      block.scale.set((bank.horizontal ? width : depth)*sx,rise,(bank.horizontal ? depth : width)*sz);
      const offset=layout?Math.abs(center-layout.origin)*(bank.horizontal?sz:sx)*.55:elevation+rise/2;
      block.position.set((bank.horizontal ? mid : center)*sx-5,.008+(descending ? -1 : 1)*offset,(bank.horizontal ? center : mid)*sz-sheetHeight/2);
      block.updateMatrix(); mesh.setMatrixAt(i-1,block.matrix);
      elevation+=rise;
    }
    return mesh;
  });
  floor.banks.forEach((bank,i)=>layouts.get(bank.assembly)?.add(meshes[i]));
  return [...layouts.values(),...meshes.filter(mesh=>!mesh.parent)];
}
