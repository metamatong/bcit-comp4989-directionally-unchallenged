import { wallMesh } from "./pilot-meshes.mjs";
import * as T from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { sourceOrientation } from "./sheet-orientation.ts";

import campus from "../data/campus/geolocation/calibrations.json";
import { fitCalibration, localMetres } from "../src/location/geometry.ts";

import candidates from "../data/campus/geolocation/calibration-candidates.json";
import groundImage from "./campus-map.webp";
import officialFootprints from "../data/campus/geolocation/bcit-burnaby-footprints.json";
import drawingExtents from "./drawing-extents.json";

// Centres on the official north-up BCIT PDF rendered at a page height of 1100 px.
// The ground texture uses the same crop at four times this resolution.
const referencePixels={NE1:[527,137],SE16:[527,532],SW1:[439,375],SW9:[439,546],
  SE12:[501,439],SE50:[623,984]};
const campusOrigin={latitude:49.25,longitude:-123};
const referencePoints=campus.buildings.filter(f=>referencePixels[f.building]).map(f=>{
  const coordinates=f.rings.flat().map(([longitude,latitude])=>{
    const m=localMetres({longitude,latitude},campusOrigin);
    return new T.Vector2(m.x,-m.y);
  });
  const centre=new T.Box2().setFromPoints(coordinates).getCenter(new T.Vector2());
  return {centre,pixel:new T.Vector2(...referencePixels[f.building])};
});
const mean=key=>referencePoints.reduce((sum,p)=>sum.add(p[key]),new T.Vector2()).divideScalar(referencePoints.length);
const centreMean=mean("centre"),pixelMean=mean("pixel");
let dot=0,cross=0,energy=0;
for(const point of referencePoints){
  const delta=point.centre.clone().sub(centreMean),pixel=point.pixel.clone().sub(pixelMean);
  dot+=delta.dot(pixel);cross+=delta.cross(pixel);energy+=delta.lengthSq();
}
// Keep model dimensions independent of the resolution of the ground artwork.
const unitsPerMetre=.078;
const mapUp=new T.Vector3(-cross,0,-dot).normalize();
function mapPoint(longitude,latitude){
  const metres=localMetres({longitude,latitude},campusOrigin);
  return new T.Vector3(metres.x*unitsPerMetre,0,-metres.y*unitsPerMetre);
}
const footprints=new Map(campus.buildings.map(({building,rings})=>[
  building,rings.map(ring=>ring.map(([lon,lat])=>mapPoint(lon,lat)))
]));
function campusBase(){
  // Invert the fitted map similarity at each corner of the cropped map.
  const positions=[];
  for(const [x,y] of [[279,78],[279,1055],[694,78],[694,1055]]){
    const dx=x-pixelMean.x,dy=y-pixelMean.y;
    const factor=energy/(dot*dot+cross*cross);
    positions.push((centreMean.x+(dot*dx+cross*dy)*factor)*unitsPerMetre,-.015,
      (centreMean.y+(dot*dy-cross*dx)*factor)*unitsPerMetre);
  }
  const base=new T.BufferGeometry();
  base.setAttribute("position",new T.Float32BufferAttribute(positions,3));
  base.setAttribute("uv",new T.Float32BufferAttribute([0,1,0,0,1,1,1,0],2));
  base.setIndex([0,1,2,2,1,3]);
  const texture=new T.TextureLoader().load(groundImage);
  texture.colorSpace=T.SRGBColorSpace;
  return new T.Mesh(base,new T.MeshBasicMaterial({map:texture,side:T.DoubleSide,alphaTest:.5,color:0xc5caca}));
}
function croppedGeometry(group,height,rings){
  const outline=new T.ShapePath();
  outline.userData.style={fillRule:"evenodd"};
  const inverse=group.matrixWorld.clone().invert();
  for(const ring of rings){
    ring.forEach((world,i)=>{
      const local=world.clone().applyMatrix4(inverse);
      if(i===0)outline.moveTo(local.x,-local.z);else outline.lineTo(local.x,-local.z);
    });
  }
  const geometry=new T.ShapeGeometry(outline.toShapes());
  const {position,uv}=geometry.attributes;
  for(let i=0;i<position.count;i++)uv.setXY(i,.5+position.getX(i)/10,.5+position.getY(i)/height);
  geometry.rotateX(-Math.PI/2);
  return geometry;
}
function campusOverview(plans){
  const model=new T.Group();
  const levels=new Map();
  for(const plan of plans){
    if(!levels.has(plan.building))levels.set(plan.building,new Set());
    levels.get(plan.building).add(plan.floor);
  }
  model.add(campusBase());
  const palette={NE:0x85adb3,NW:0xb79a78,SE:0x83a5c0,SW:0x92aa8d};
  for(const feature of officialFootprints.features){
    const id=feature.attributes.BuildingName;
    const path=new T.ShapePath();
    for(const ring of feature.geometry.rings){
      ring.forEach(([lon,lat],index)=>{
        const p=mapPoint(lon,lat);
        if(index===0)path.moveTo(p.x,-p.z);else path.lineTo(p.x,-p.z);
      });
    }
    const geometry=new T.ExtrudeGeometry(path.toShapes(),{
      depth:(levels.get(id)?.size??1)*.32,bevelEnabled:false
    });
    geometry.rotateX(-Math.PI/2);
    const building=new T.Mesh(geometry,new T.MeshLambertMaterial({color:palette[id.slice(0,2)]??0xaba9a3}));
    building.userData.building=id;
    building.add(new T.LineSegments(new T.EdgesGeometry(geometry,24),new T.LineBasicMaterial({color:0x475867})));
    model.add(building);
  }
  return model;
}
const floorRecords=new Map(campus.floors.map(record=>[record.planId,record]));
const candidateRecords=new Map(candidates.floors.map(f=>[f.planId,f]));
function extent(plan){
  const entry=drawingExtents[plan.id];
  return entry?.hash===plan.sourceSha256 ? entry.bounds : null;
}
function placeSheet(group,plan,height,unmapped){
  const published=floorRecords.get(plan.id);
  const aligned=published?.status==="approximate" && published.sourceSha256===plan.sourceSha256;
  const record=aligned?published:candidateRecords.get(plan.id);
  const elevation=Number(plan.floor)*2;
  if(record?.controls?.length>=4 && record.sourceSha256===plan.sourceSha256){
    const {project}=fitCalibration(record.controls,plan.width,plan.height);
    const {longitude,latitude}=record.controls[0];
    // Sample the app's geographic-to-sheet transform, then invert it for the scene.
    const samples=[[longitude,latitude],[longitude+.0001,latitude],[longitude,latitude+.0001]];
    const [a,b,c]=samples.map(([longitude,latitude])=>{
      const point=project({longitude,latitude});
      return new T.Vector3((point.x-.5)*10,0,(point.y-.5)*height);
    });
    const [u,v,w]=samples.map(([lon,lat])=>mapPoint(lon,lat));
    const basis=(p,q,r)=>new T.Matrix4().makeBasis(q.sub(p),new T.Vector3(0,1,0),r.sub(p)).setPosition(p);
    group.matrix.copy(basis(u,v,w)).multiply(basis(a,b,c).invert());
    group.matrix.elements[13]=elevation;
    group.matrixAutoUpdate=false;
    // Landing coordinates are read before the first render updates the scene.
    group.matrixWorldNeedsUpdate=true;
    return aligned?"aligned":"outline candidate";
  }
  const rings=footprints.get(plan.building);
  const bounds=extent(plan);
  const orientation=sourceOrientation(plan);
  if(rings && bounds){
    const [left,top,right,bottom]=bounds;
    const size=new T.Box3().setFromPoints(rings.flat());
    const span=size.getSize(new T.Vector3());
    const w=10*(right-left),h=height*(bottom-top);
    // Where no sheet heading is recorded only the long-axis alignment is estimated.
    const angle=orientation?.degrees ?? ((w>h)!==(span.x>span.z)?90:0);
    group.rotation.y=-T.MathUtils.degToRad(angle);
    const c=Math.abs(Math.cos(group.rotation.y)),s=Math.abs(Math.sin(group.rotation.y));
    const scale=Math.min(span.x/(w*c+h*s),span.z/(w*s+h*c));
    group.scale.set(scale,1,scale);
    const offset=new T.Vector3(((left+right)/2-.5)*10,0,((top+bottom)/2-.5)*height)
      .multiplyScalar(scale).applyEuler(group.rotation);
    size.getCenter(group.position).sub(offset);
  }else if(rings)new T.Box3().setFromPoints(rings.flat()).getCenter(group.position);
  else group.position.set(unmapped.get(plan.building),0,0);
  group.position.y=elevation;
  return rings && bounds?"footprint size estimate":"unscaled";

}

const el = id => document.getElementById(id);
const stairSymbolScale = 0.65;
// Clear the 0.24-unit wall top by 0.03 at the underside of the symbol plaque.
const stairMarkerLift = .24 + .03 - (.265 - .045/2)*stairSymbolScale;
// A raised, fixed-size stair pictogram stays readable across different drawing scales.
function stairMarker(){
  const marker=new T.Group();
  const plaque=new T.Mesh(new T.CylinderGeometry(.22,.22,.045,32),
    new T.MeshBasicMaterial({color:0x26364b}));
  plaque.position.y=.265;
  marker.add(plaque);
  const stem=new T.Mesh(new T.CylinderGeometry(.018,.028,.25,8),
    new T.MeshBasicMaterial({color:0xffb454}));
  const stemExtension=stairMarkerLift/stairSymbolScale;
  stem.scale.y=(.25+stemExtension)/.25;
  stem.position.y=(.25-stemExtension)/2;
  marker.add(stem);
  const gold=new T.MeshLambertMaterial({color:0xffb454});
  for(let i=0;i<4;i++){
    const height=.032*(i+1);
    const step=new T.Mesh(new T.BoxGeometry(.071,height,.17),gold);
    step.position.set((i-1.5)*.071,.2875+height/2,0);
    marker.add(step);
  }
  marker.scale.setScalar(stairSymbolScale);
  // Keep the original picking envelope around the smaller visible symbol.
  const hitArea=new T.Mesh(new T.CylinderGeometry(.22,.22,.43,16),new T.MeshBasicMaterial());
  hitArea.scale.setScalar(1/stairSymbolScale);
  hitArea.position.y=.215/stairSymbolScale;
  hitArea.visible=false;
  marker.add(hitArea);
  return marker;
}
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
  const planById=new Map(plans.map(plan=>[plan.id,plan]));
  const stairStops=new Set();
  for(const edge of network.edges){
    if(edge.kind!=="stairs") continue;
    const a=nodes.get(edge.fromNodeId), b=nodes.get(edge.toNodeId);
    const lower=planById.get(a?.planId), upper=planById.get(b?.planId);
    if(!lower || !upper || lower.building!==upper.building || lower.floor===upper.floor)continue;
    stairStops.add(a.id);
    stairStops.add(b.id);
  }
  const buildingName=id=>id.replace(/^(SW|SE)(\d)$/,(_,prefix,digit)=>prefix+"0"+digit);
  const buildingLinks=network.edges.filter(edge=>{
    if(!["building-link","outdoor"].includes(edge.kind))return false;
    const a=planById.get(nodes.get(edge.fromNodeId)?.planId);
    const b=planById.get(nodes.get(edge.toNodeId)?.planId);
    return a && b && a.building!==b.building;
  });
  const ids=[...new Set(plans.map(plan=>plan.building))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  const mapBounds=new T.Box3().setFromPoints([...footprints.values()].flat(2));
  const unmapped=new Map(ids.filter(id=>!footprints.has(id)).map((id,i)=>[id,mapBounds.max.x+20+i*18]));
  const query=new URLSearchParams(location.search);
  const preset=query.get("view")==="se12-3-4";
  const requested=(query.get("pair")??"").split(",").filter(id=>ids.includes(id));
  const mode=el("mode");
  mode.value=preset || requested.length || query.get("view")==="floors"?"floors":"campus";
  let campusModel,inspectionBounds;
  const selected=new Set(preset?["SE12"]:requested.length?requested:["SW3","SE12","SW1"]);
  const hiddenFloors=new Set();
  const floorKey=p=>p.building+"/"+p.floor;
  const pairSelect=el("linked-pair");
  const pairs=new Map();
  for(const edge of buildingLinks){
    const ends=[edge.fromNodeId,edge.toNodeId].map(id=>planById.get(nodes.get(id).planId));
    const key=ends.map(p=>p.building).sort().join(",");
    if(!pairs.has(key))pairs.set(key,new Set());
    for(const plan of ends)pairs.get(key).add(floorKey(plan));
  }
  for(const key of [...pairs.keys()].sort())pairSelect.add(new Option(key.split(",").map(buildingName).join(" + "),key));
  function selectPair(key){
    const ends=pairs.get(key);
    if(!ends)return;
    mode.value="mapped";pairSelect.value=key;
    selected.clear();
    for(const id of key.split(","))selected.add(id);
    for(const plan of plans.filter(p=>selected.has(p.building))){
      if(ends.has(floorKey(plan)))hiddenFloors.delete(floorKey(plan));else hiddenFloors.add(floorKey(plan));
    }
    for(const input of el("building-controls").querySelectorAll("input"))input.checked=selected.has(input.value);
  }
  const initialPair=requested.slice().sort().join(",");
  if(!preset && (pairs.has(initialPair) || query.get("view")==="mapped"))selectPair(pairs.has(initialPair)?initialPair:pairSelect.options[1]?.value);
  pairSelect.onchange=()=>{if(pairSelect.value){selectPair(pairSelect.value);showFloorControls();rebuild()}};
  if(preset){
    for(const floor of ["1","2"])hiddenFloors.add("SE12/"+floor);
  }
  for(const id of ids){
    const label=document.createElement("label"), input=document.createElement("input");
    input.type="checkbox";input.value=id;input.checked=selected.has(id);
    input.onchange=()=>{
      pairSelect.value="";
      if(input.checked)selected.add(id);else selected.delete(id);
      showFloorControls();rebuild();
    };
    label.append(input," "+buildingName(id)+(unmapped.has(id)?" (off map)":""));
    el("building-controls").append(label);
  }
  function showFloorControls(){
    el("building-count").textContent=selected.size+" selected";
    const container=el("floor-controls");
    container.replaceChildren();
    for(const building of selected){
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
  function frame(box,topDown=false) {
    const sphere=box.getBoundingSphere(new T.Sphere());
    const halfAngle=Math.min(1,camera.aspect)*Math.tan(Math.PI/8);
    controls.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector((topDown?new T.Vector3(0,1,0):new T.Vector3(.45,.8,1).normalize()),Math.max(1,sphere.radius)*1.2*Math.sqrt(1+1/halfAngle**2));
    if(topDown)camera.up.copy(mapUp);else camera.up.set(0,1,0);
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
  const markers=new Map(), stairLinks=new Map();
  const raycaster=new T.Raycaster();
  let overviewStatus="", restoreColors=[], press;
  function clearFocus(){
    for(const [material, color] of restoreColors)material.color.setHex(color);
    restoreColors=[];
    el("status").textContent=overviewStatus;
  }
  function focusLink(link){
    clearFocus();
    const ends=[markers.get(link.edge.fromNodeId),markers.get(link.edge.toNodeId)];
    const materials=new Set(link.graphics.map(object=>object.material));
    const bounds=new T.Box3();
    for(const marker of ends){
      bounds.expandByObject(marker);
      marker.traverse(object=>{if(object.material)materials.add(object.material)});
    }
    for(const material of materials){
      restoreColors.push([material,material.color.getHex()]);
      material.color.setHex(0x31e6fc);
    }
    frame(bounds.expandByScalar(.12));
    el("status").textContent=link.description;
  }
  function aimRay(event){
    const rect=canvas.getBoundingClientRect();
    raycaster.setFromCamera(new T.Vector2(
      (event.clientX-rect.left)/rect.width*2-1,
      1-(event.clientY-rect.top)/rect.height*2),camera);

  }
  canvas.addEventListener("pointerdown",event=>{
    press=event.isPrimary && event.button===0 ? {id:event.pointerId,x:event.clientX,y:event.clientY} : undefined;
  });
  canvas.addEventListener("pointermove",event=>{
    if(press && Math.hypot(event.clientX-press.x,event.clientY-press.y)>5)press=undefined;
  });
  canvas.addEventListener("pointercancel",()=>{press=undefined});
  canvas.addEventListener("pointerup",event=>{
    const click=press?.id===event.pointerId;
    press=undefined;
    if(!click)return;
    aimRay(event);
    if(campusModel){
      const building=raycaster.intersectObjects(campusModel.children,false).find(hit=>hit.object.userData.building)?.object.userData.building;
      if(!building)return;
      if(!ids.includes(building)){el("status").textContent=building+" · No floor plans in the catalogue.";return}
      pairSelect.value="";selected.clear();selected.add(building);
      for(const input of el("building-controls").querySelectorAll("input"))input.checked=input.value===building;
      mode.value="floors";showFloorControls();rebuild();return;
    }
    const marker=raycaster.intersectObjects([...markers.values()],true)[0]?.object.parent;
    if(!marker)return;
    const links=stairLinks.get(marker.userData.nodeId)??[];
    if(links.length===1)focusLink(links[0]);
    else{
      clearFocus();
      if(links.length)el("connections").open=true;
      el("status").textContent=links.length?"Choose a connection in the floor connections list.":"Select two connected floors to inspect this landing.";
    }
  });
  function rebuild() {
    clearFocus();markers.clear();stairLinks.clear();
    scene.traverse(obj=>{if(obj.isInstancedMesh)obj.dispose();obj.geometry?.dispose();obj.material?.map?.dispose();obj.material?.dispose()});
    scene.clear();sheets.length=0;
    scene.add(new T.HemisphereLight(0xffffff,0x697380,1.9));
    const sun=new T.DirectionalLight(0xffffff,1.6);
    sun.position.set(4,10,6);scene.add(sun);
    const campusMode=mode.value==="campus";
    document.body.classList.toggle("campus",campusMode);
    const mapped=mode.value==="mapped";
    document.body.classList.toggle("mapped",mapped);
    campusModel=null;inspectionBounds=null;
    if(campusMode){
      activeLayers=new Map();void updateWalkable();
      el("connections").hidden=true;
      campusModel=campusOverview(plans);scene.add(campusModel);
      overviewStatus="BCIT Burnaby · "+officialFootprints.features.length+" building footprints · Illustrative heights. Click a building to inspect its floors.";
      el("status").textContent=overviewStatus;
      frame(new T.Box3().setFromObject(campusModel));return;
    }
    const chosen=[...selected];
    const loader=new T.TextureLoader();
    const visible=plans.filter(p=>chosen.includes(p.building)&&!hiddenFloors.has(floorKey(p)));
    const layers=new Map();
    const schematic=[];
    for(const id of chosen){
      if(!visible.some(plan=>plan.building===id))continue;
      for(const ring of footprints.get(id)??[]){
        scene.add(new T.LineLoop(new T.BufferGeometry().setFromPoints(ring),new T.LineBasicMaterial({color:0x63919e})));
      }
    }
    for(const plan of visible) {
      const group=new T.Group(), height=10*plan.height/plan.width;
      const placement=placeSheet(group,plan,height,unmapped);
      if(placement!=="aligned")schematic.push(plan.id+" ("+placement+")");
      const rings=footprints.get(plan.building);
      if(mapped && !rings)continue;
      scene.add(group);
      group.updateWorldMatrix(true,false,true);
      const walls=!mapped && wallMesh(plan,height);
      if(walls){
        group.add(walls);
        walls.visible=!walls.userData.estimated||el("estimates").checked;
      }
      const showStairs=!mapped || new Set(visible.filter(p=>p.building===plan.building).map(p=>p.floor)).size===2;
      if(showStairs)for(const id of stairStops){
        const landing=nodes.get(id);
        if(landing.planId!==plan.id)continue;
        const marker=stairMarker();
        marker.position.set((landing.point.x-.5)*10,stairMarkerLift,(landing.point.y-.5)*height);
        group.localToWorld(marker.position);
        marker.userData.nodeId=id;markers.set(id,marker);
        scene.add(marker);
      }
      layers.set(plan.id,{plan,group,height});
      const texture=loader.load("/image?id="+encodeURIComponent(plan.id),undefined,undefined,()=>{if(group.parent) el("status").textContent="Could not load sheet "+plan.id;});
      texture.colorSpace=T.SRGBColorSpace;
      const material=new T.MeshBasicMaterial({map:texture,side:T.DoubleSide,transparent:true,depthWrite:false,opacity:Number(el("opacity").value)});
      if(mapped){
        const mesh=new T.Mesh(croppedGeometry(group,height,rings),material);
        group.add(mesh);sheets.push(material);continue;
      }
      const fullSheet=el("full-sheets").checked;
      if(!fullSheet){
        // Render the drawing ink over the dark scene without stacking white paper.
        material.onBeforeCompile=shader=>{
          shader.fragmentShader=shader.fragmentShader.replace("#include <map_fragment>", `
            #include <map_fragment>
            float ink = 1.0 - dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            diffuseColor.a *= smoothstep(0.05, 0.85, ink);
            diffuseColor.rgb = vec3(0.70, 0.80, 0.87);
          `);
        };
      }
      const bounds=fullSheet?null:extent(plan);
      const [left,top,right,bottom]=bounds?bounds.map((v,i)=>T.MathUtils.clamp(v+(i<2?-.015:.015),0,1)):[0,0,1,1];
      texture.offset.set(left,1-bottom);texture.repeat.set(right-left,bottom-top);
      const mesh=new T.Mesh(new T.PlaneGeometry(10*(right-left),height*(bottom-top)),material);
      mesh.position.set(((left+right)/2-.5)*10,0,((top+bottom)/2-.5)*height);
      mesh.rotation.x=-Math.PI/2;group.add(mesh);sheets.push(material);
    }
    activeLayers=layers;
    void updateWalkable();
    const panel=el("connections"), list=panel.querySelector("ul");
    list.replaceChildren();panel.hidden=true;
    function drawConnection(edge,a,from,b,to){
        const point=(layer,node)=>layer.group.localToWorld(new T.Vector3((node.point.x-.5)*10,edge.kind==="stairs" ? stairMarkerLift+.43*stairSymbolScale : .045,(node.point.y-.5)*layer.height));
        const start=point(a,from), end=point(b,to);
        const color={stairs:0xffb454,elevator:0xb99aff,"building-link":0xff80ae,outdoor:0xa5dd70}[edge.kind];
        const shaft=new T.Line(new T.BufferGeometry().setFromPoints([start,end]),
          new T.LineBasicMaterial({color}));
        scene.add(shaft);
        const graphics=[shaft];
        if(edge.kind!=="elevator"){
          const addHead=(origin,tip)=>{
            const direction=tip.clone().sub(origin).normalize();
            const head=new T.Mesh(new T.ConeGeometry(.07,.22,12),new T.MeshBasicMaterial({color}));
            head.position.copy(tip).addScaledVector(direction,-.11);
            head.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),direction);
            scene.add(head);graphics.push(head);
          };
          addHead(start,end);
          if(edge.direction==="both")addHead(end,start);
        }
      return graphics;
    }
    for(const edge of buildingLinks){
      const from=nodes.get(edge.fromNodeId),to=nodes.get(edge.toNodeId);
      const a=layers.get(from.planId),b=layers.get(to.planId);
      if(!a||!b)continue;
      drawConnection(edge,a,from,b,to);
      panel.hidden=false;
      const row=document.createElement("li");
      row.textContent=(edge.kind==="outdoor"?"Outdoor link":"Building passage")+" · "+
        from.planId+" "+from.label+(edge.direction==="both"?" ↔ ":" → ")+to.planId+" "+to.label;
      list.append(row);
    }
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
        const graphics=drawConnection(edge,a,from,b,to);
        count++;
        const row=document.createElement("li");
        row.textContent=building+" "+edge.kind+" · "+from.label+(edge.direction==="both"?" ↔ ":" → ")+to.label;
        if(edge.kind==="stairs"){
          const description=from.planId+" "+from.label+(edge.direction==="both"?" ↔ ":" → ")+to.planId+" "+to.label;
          const link={edge,graphics,description};
          for(const id of [from.id,to.id]){
            if(!stairLinks.has(id))stairLinks.set(id,[]);
            stairLinks.get(id).push(link);
          }
          const button=document.createElement("button");
          button.textContent=description;button.onclick=()=>focusLink(link);
          row.replaceChildren(button);
        }
        list.append(row);
      }
      if(!count){const row=document.createElement("li");row.textContent=building+" · No direct published stair or elevator connection between these floors.";list.append(row)}
    }
    el("status").textContent=overviewStatus="Published revision "+network.revision+" · "+sheets.length+" floor sheets"+(schematic.length?" · Estimated placement: "+schematic.join(", "):"")+(!visible.length?" · Select a building and floor.":"");
    inspectionBounds=new T.Box3().setFromObject(scene);
    if(mapped){
      scene.add(campusBase());
      const skipped=visible.filter(p=>!footprints.has(p.building)).map(p=>p.id);
      if(skipped.length)el("status").textContent=overviewStatus+=" · No mapped footprint for "+skipped.join(", ");
    }
    if(sheets.length)frame(inspectionBounds,mapped);
    else if(mapped)frame(new T.Box3().setFromObject(scene),true);
  }
  el("estimates").onchange=()=>scene.traverse(obj=>{
    if(obj.userData.estimated)obj.visible=el("estimates").checked;
  });

  el("opacity").oninput=()=>sheets.forEach(m=>m.opacity=Number(el("opacity").value));
  mode.onchange=()=>{
    if(mode.value==="mapped" && !pairSelect.value)selectPair(pairSelect.options[1]?.value);
    if(mode.value!=="mapped")pairSelect.value="";
    showFloorControls();rebuild();
  };
  el("full-sheets").onchange=rebuild;
  el("map-view").onclick=()=>{if(campusModel || sheets.length){clearFocus();frame(inspectionBounds??new T.Box3().setFromObject(scene),true)}};
  el("fit").onclick=()=>{clearFocus();frame(inspectionBounds??new T.Box3().setFromObject(scene))};
  function resize(){
    const {width,height}=canvas.parentElement.getBoundingClientRect();
    renderer.setSize(width,height,false);camera.aspect=width/Math.max(1,height);camera.updateProjectionMatrix();controls.handleResize();
  }
  resize();new ResizeObserver(resize).observe(canvas.parentElement);
  showFloorControls();rebuild();renderer.setAnimationLoop(()=>{controls.update();renderer.render(scene,camera)});
}
start().catch(e=>document.getElementById("status").textContent="Three.js view unavailable Â· "+e.message);
