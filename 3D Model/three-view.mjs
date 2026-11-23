import { wallMesh, stairMeshes } from "./pilot-meshes.mjs";
import * as T from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { sourceOrientation } from "./sheet-orientation.ts";

const el = id => document.getElementById(id);
async function start() {
  const response = await fetch("/api/snapshot?source=navigation",{cache:"no-store"});
  if (!response.ok) throw Error("Navigation records could not be loaded.");
  const {plans, document: network} = await response.json();
  const canvas = document.querySelector("canvas");
  const renderer = new T.WebGLRenderer({canvas, antialias:true, alpha:false});
  renderer.setClearColor(0x101925);
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(45,1,.02,2000);
  const controls = new TrackballControls(camera,canvas);
  controls.staticMoving = true;
  const sheets = [];
  const nodes = new Map(network.nodes.map(n=>[n.id,n]));
  const floorNumbers=new Map(plans.map(plan=>[plan.id,Number(plan.floor)]));
  const transfers=new Map();
  for(const edge of network.edges){
    if(edge.kind!=="stairs" || edge.direction!=="both") continue;
    const a=nodes.get(edge.fromNodeId), b=nodes.get(edge.toNodeId);
    for(const [here,there] of [[a,b],[b,a]]){
      if(here.planId.split("-")[0]!==there.planId.split("-")[0])continue;
      const delta=floorNumbers.get(there.planId)-floorNumbers.get(here.planId);
      if(!delta)continue;
      const key=here.planId+"/"+here.label.split(" ")[0];
      if(!transfers.has(key))transfers.set(key,{point:here.point});
      transfers.get(key)[delta>0?"above":"below"]=there.label.split(" ")[0];
    }
  }
  const buildings = el("building");
  buildings.add(new Option("SW03 + SE12 + SW01","SW3,SE12,SW1"));
  buildings.add(new Option("SW03 + SE12","SW3,SE12"));
  for(const b of [...new Set(plans.map(p=>p.building))].sort()) buildings.add(new Option(b,b));

  const hiddenFloors=new Set();
  const floorKey=p=>p.building+"/"+p.floor;
  if(new URLSearchParams(location.search).get("view")==="se12-3-4"){
    buildings.value="SE12";
    for(const floor of ["1","2"])hiddenFloors.add("SE12/"+floor);
  }
  function showFloorControls(){
    const container=el("floor-controls");
    container.replaceChildren();
    for(const building of buildings.value.split(",")){
      const group=document.createElement("fieldset"), title=document.createElement("legend");
      title.textContent=building+" floors";group.append(title);
      const numbers=[...new Set(plans.filter(p=>p.building===building).map(p=>p.floor))].sort((a,b)=>Number(a)-Number(b));
      for(const floor of numbers){
        const key=building+"/"+floor, label=document.createElement("label"), input=document.createElement("input");
        input.type="checkbox";input.checked=!hiddenFloors.has(key);
        input.onchange=()=>{if(input.checked)hiddenFloors.delete(key);else hiddenFloors.add(key);rebuild()};
        label.append(input," "+floor);group.append(label);
      }
      container.append(group);
    }
  }
  function frame(box) {
    const sphere=box.getBoundingSphere(new T.Sphere());
    const halfAngle=Math.min(1,camera.aspect)*Math.tan(Math.PI/8);
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(new T.Vector3(.45,.8,1).normalize(),Math.max(1,sphere.radius)*1.2*Math.sqrt(1+1/halfAngle**2));
    camera.up.set(0,1,0);
    camera.lookAt(controls.target);
    controls.update();
  }
  let activeLayers=new Map();
  const grids=new Map();
  const walkable=el("walkable");
  let overlayRevision=0;

  async function updateWalkable(){
    const revision=++overlayRevision;
    const status=el("grid-status");
    for(const layer of activeLayers.values()){
      if(layer.overlay)layer.overlay.visible=walkable.checked;
    }
    status.textContent="";
    if(!walkable.checked || !activeLayers.size)return;
    status.textContent="Loading walking grids…";
    const failed=[],empty=[];
    await Promise.all([...activeLayers.values()].map(async layer=>{
      const {plan,group,height}=layer;
      try{
        if(!grids.has(plan.id)){
          const request=fetch("/api/floor?id="+encodeURIComponent(plan.id),{cache:"no-store"})
            .then(async response=>{
              if(!response.ok)throw Error(response.statusText);
              const {width,height,runs}=await response.json();
              return {width,height,runs};
            }).catch(error=>{grids.delete(plan.id);throw error});
          grids.set(plan.id,request);
        }
        const grid=await grids.get(plan.id);
        if(revision!==overlayRevision)return;
        if(!grid.runs.length){empty.push(plan.id);return}
        if(layer.overlay)return;
        const mask=document.createElement("canvas");
        mask.width=grid.width;mask.height=grid.height;
        const ink=mask.getContext("2d");
        ink.fillStyle="#30df75";
        for(const [row,left,right] of grid.runs)ink.fillRect(left,row,right-left+1,1);
        const texture=new T.CanvasTexture(mask);
        texture.colorSpace=T.SRGBColorSpace;
        texture.magFilter=T.NearestFilter;texture.minFilter=T.NearestFilter;
        texture.generateMipmaps=false;
        const material=new T.MeshBasicMaterial({map:texture,transparent:true,alphaTest:.01,opacity:.76,
          side:T.DoubleSide,depthWrite:false});
        layer.overlay=new T.Mesh(new T.PlaneGeometry(10,height),material);
        layer.overlay.rotation.x=-Math.PI/2;layer.overlay.position.y=.003;
        group.add(layer.overlay);
      }catch{failed.push(plan.id)}
    }));
    if(revision!==overlayRevision)return;
    status.textContent=["Green = app walking-grid cells.",
      empty.length?"No mapped cells on "+empty.join(", ")+".":"",
      failed.length?"Grid unavailable for "+failed.join(", ")+".":""].filter(Boolean).join(" ");
  }
  walkable.onchange=updateWalkable;
  function rebuild() {
    scene.traverse(obj=>{if(obj.isInstancedMesh)obj.dispose();obj.geometry?.dispose();obj.material?.map?.dispose();obj.material?.dispose()});
    scene.clear();sheets.length=0;
    scene.add(new T.HemisphereLight(0xffffff,0x697380,1.9));
    const sun=new T.DirectionalLight(0xffffff,1.6);
    sun.position.set(4,10,6);scene.add(sun);
    const chosen=buildings.value.split(",");
    const loader=new T.TextureLoader();
    const visible=plans.filter(p=>chosen.includes(p.building)&&!hiddenFloors.has(floorKey(p)));
    const layers=new Map();
    for(const plan of visible) {
      const group=new T.Group(), height=10*plan.height/plan.width;
      group.position.set((chosen.indexOf(plan.building)-(chosen.length-1)/2)*18,Number(plan.floor)*2,0);
      group.rotation.y=-T.MathUtils.degToRad(sourceOrientation(plan)?.degrees ?? 0);
      const walls=wallMesh(plan,height);
      if(walls){
        group.add(walls);
        walls.visible=!walls.userData.estimated||el("estimates").checked;
      }
      const localFlights=stairMeshes(plan,height,transfers);
      for(const flight of localFlights)group.add(flight);
      scene.add(group);layers.set(plan.id,{plan,group,height});
      const texture=loader.load("/image?id="+encodeURIComponent(plan.id),undefined,undefined,()=>{if(group.parent) el("status").textContent="Could not load sheet "+plan.id;});
      texture.colorSpace=T.SRGBColorSpace;
      const material=new T.MeshBasicMaterial({map:texture,side:T.DoubleSide,transparent:true,depthWrite:false,opacity:Number(el("opacity").value)});
      const mesh=new T.Mesh(new T.PlaneGeometry(10,height),material);
      mesh.rotation.x=-Math.PI/2;group.add(mesh);sheets.push(material);
    }
    activeLayers=layers;
    void updateWalkable();
    const panel=el("connections"), list=panel.querySelector("ul");
    list.replaceChildren();panel.hidden=true;
    for(const building of chosen){
      const floors=new Set(visible.filter(p=>p.building===building).map(p=>p.floor));
      if(floors.size!==2)continue;
      panel.hidden=false;
      let count=0;
      for(const edge of network.edges){
        if(!["stairs","elevator"].includes(edge.kind))continue;
        const from=nodes.get(edge.fromNodeId),to=nodes.get(edge.toNodeId);
        const a=layers.get(from.planId),b=layers.get(to.planId);
        if(!a||!b||a.plan.building!==building||b.plan.building!==building||a.plan.floor===b.plan.floor)continue;
        const point=(layer,node)=>layer.group.localToWorld(new T.Vector3((node.point.x-.5)*10,.045,(node.point.y-.5)*layer.height));
        const start=point(a,from), end=point(b,to);
        const color=edge.kind==="stairs" ? 0xffb454 : 0xb99aff;
        scene.add(new T.Line(new T.BufferGeometry().setFromPoints([start,end]),
          new T.LineBasicMaterial({color})));
        if(edge.kind==="stairs"){
          const addHead=(origin,tip)=>{
            const direction=tip.clone().sub(origin).normalize();
            const head=new T.Mesh(new T.ConeGeometry(.07,.22,12),new T.MeshBasicMaterial({color}));
            head.position.copy(tip).addScaledVector(direction,-.11);
            head.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction);
            scene.add(head);
          };
          addHead(start,end);
          if(edge.direction==="both")addHead(end,start);
        }
        count++;
        const row=document.createElement("li");
        row.textContent=building+" "+edge.kind+" · "+from.label+(edge.direction==="both"?" ↔ ":" → ")+to.label;
        list.append(row);
      }
      if(!count){const row=document.createElement("li");row.textContent=building+" · No direct published stair or elevator connection between these floors.";list.append(row)}
    }
    el("status").textContent="Published revision "+network.revision+" · "+sheets.length+" floor sheets";
    if(visible.length)frame(new T.Box3().setFromObject(scene));
  }
  el("estimates").onchange=()=>scene.traverse(obj=>{
    if(obj.userData.estimated)obj.visible=el("estimates").checked;
  });
  buildings.onchange=()=>{showFloorControls();rebuild()};
  el("opacity").oninput=()=>sheets.forEach(m=>m.opacity=Number(el("opacity").value));
  el("fit").onclick=()=>frame(new T.Box3().setFromObject(scene));
  function resize(){
    const {width,height}=canvas.parentElement.getBoundingClientRect();
    renderer.setSize(width,height,false);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();controls.handleResize();
  }
  resize();new ResizeObserver(resize).observe(canvas.parentElement);
  showFloorControls();rebuild();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});
}
start().catch(e=>document.getElementById("status").textContent="Three.js view unavailable Â· "+e.message);
