import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';
import { materialColors } from './core.js';

const material=(color)=>new THREE.MeshStandardMaterial({color,roughness:.82,metalness:0,flatShading:true});
const GRADIENT_STOPS=16;
// A multi-color filament is painted as one continuous gradient along the
// longest dimension of the part. The gradient lives in the shader so the shared
// model cache never stores a recolored copy of a mesh.
function gradientMaterial(colors,matrix,axis,min,max){
  const picked=colors.slice(0,GRADIENT_STOPS).map(c=>new THREE.Color(c));
  const palette=new Float32Array(GRADIENT_STOPS*3);
  for(let i=0;i<GRADIENT_STOPS;i++){const c=picked[Math.min(i,picked.length-1)];palette[i*3]=c.r;palette[i*3+1]=c.g;palette[i*3+2]=c.b;}
  const mat=new THREE.MeshStandardMaterial({roughness:.82,metalness:0,flatShading:true});
  mat.onBeforeCompile=shader=>{
    shader.uniforms.uGradMatrix={value:matrix};
    shader.uniforms.uGradAxis={value:axis};
    shader.uniforms.uGradMin={value:min};
    shader.uniforms.uGradMax={value:max};
    shader.uniforms.uGradColors={value:palette};
    shader.uniforms.uGradCount={value:picked.length};
    shader.vertexShader='varying float vGradT;\nuniform mat4 uGradMatrix;\nuniform vec3 uGradAxis;\n'+shader.vertexShader
      .replace('#include <begin_vertex>','#include <begin_vertex>\n  vGradT = dot(( uGradMatrix * vec4( position, 1.0 ) ).xyz, uGradAxis );');
    shader.fragmentShader=`uniform float uGradMin;\nuniform float uGradMax;\nuniform vec3 uGradColors[${GRADIENT_STOPS}];\nuniform int uGradCount;\nvarying float vGradT;\n`+shader.fragmentShader
      .replace('#include <color_fragment>',`#include <color_fragment>
  float gradK = clamp( ( vGradT - uGradMin ) / max( 1e-6, uGradMax - uGradMin ), 0.0, 1.0 ) * float( uGradCount - 1 );
  int gradI = int( floor( gradK ) );
  int gradN = min( gradI + 1, uGradCount - 1 );
  diffuseColor.rgb *= mix( uGradColors[ gradI ], uGradColors[ gradN ], gradK - float( gradI ) );`);
  };
  mat.customProgramCacheKey=()=>'woods-filament-gradient';
  mat.userData.filamentGradient=true;
  return mat;
}
function applyFilamentGradient(group,colors){
  group.updateMatrixWorld(true);
  const box=new THREE.Box3().setFromObject(group),size=box.getSize(new THREE.Vector3());
  const axisIndex=size.x>=size.y&&size.x>=size.z?0:size.y>=size.z?1:2;
  const axis=new THREE.Vector3();axis.setComponent(axisIndex,1);
  const min=box.min.getComponent(axisIndex),max=box.max.getComponent(axisIndex);
  group.traverse(m=>{if(m.isMesh)m.material=gradientMaterial(colors,m.matrixWorld.clone(),axis,min,max);});
}
function mesh(geo,color,pos=[0,0,0],scale=[1,1,1]){const m=new THREE.Mesh(geo,material(color));m.position.set(...pos);m.scale.set(...scale);m.castShadow=true;m.receiveShadow=true;return m;}
function ball(g,p,s,c,segments=10){g.add(mesh(new THREE.SphereGeometry(1,segments,8),c,p,s));}
function branch(g,a,b,r,c){const v1=new THREE.Vector3(...a),v2=new THREE.Vector3(...b),d=v2.clone().sub(v1);const m=mesh(new THREE.CylinderGeometry(r*.58,r,d.length(),6),c);m.position.copy(v1.add(v2).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),d.normalize());g.add(m);}
function cylinder(g,r,h,p,c,segments=12){const m=mesh(new THREE.CylinderGeometry(r,r,h,segments),c,p);m.rotation.x=Math.PI/2;g.add(m);}
export function demoModel(type,color='#678361'){
  const g=new THREE.Group();
  if(type==='rabbit'){
    ball(g,[0,0,36],[25,23,35],color);ball(g,[0,-6,72],[20,18,22],color);
    ball(g,[-11,-1,101],[6,6,29],color);ball(g,[11,0,103],[6,6,30],color);
    ball(g,[-18,-14,8],[13,21,9],color);ball(g,[18,-14,8],[13,21,9],color);
    ball(g,[0,23,23],[12,11,12],color);ball(g,[-8,-22,75],[2,1.5,2],'#283d30');ball(g,[8,-22,75],[2,1.5,2],'#283d30');
    ball(g,[0,-24,67],[3,2,2],'#8a735c');
  }else if(type==='antlers'){
    for(const s of [-1,1]){branch(g,[s*7,0,0],[s*22,0,22],3,color);branch(g,[s*22,0,22],[s*26,3,43],2.5,color);branch(g,[s*20,0,20],[s*37,-3,28],2.3,color);branch(g,[s*25,2,35],[s*39,3,43],1.7,color);branch(g,[s*20,0,20],[s*13,-7,34],1.7,color);}
  }else if(type==='planter'){
    const pts=[[0,0],[36,0],[50,88],[49,94],[44,94],[42,85],[31,5],[0,5]].map(p=>new THREE.Vector2(...p));
    const m=mesh(new THREE.LatheGeometry(pts,10),color);m.rotation.x=Math.PI/2;g.add(m);
    for(let z=17;z<90;z+=17){const tor=mesh(new THREE.TorusGeometry(36+z*.15,1.1,3,10),color,[0,0,z]);g.add(tor);}
  }else if(type==='base'){
    cylinder(g,48,10,[0,0,5],color,14);for(let i=0;i<7;i++)ball(g,[Math.cos(i)*40,Math.sin(i)*27,10],[6,4,3],color,6);
  }else if(type==='stems'){
    branch(g,[-15,0,0],[-19,0,60],8,color);branch(g,[22,10,0],[24,10,40],6,color);branch(g,[5,-23,0],[5,-23,25],5,color);
  }else if(type==='caps'){
    for(const [x,y,z,r]of[[-19,0,0,30],[24,10,-20,23],[5,-23,-35,18]]){
      const m=mesh(new THREE.SphereGeometry(r,12,5,0,Math.PI*2,0,Math.PI/2),color,[x,y,z]);m.rotation.x=Math.PI/2;g.add(m);
      for(let i=0;i<4;i++)ball(g,[x+Math.cos(i*1.9)*r*.5,y+Math.sin(i*1.9)*r*.5,z+r*.82],[r*.1,r*.1,r*.035],'#edddba',6);
    }
  }else if(type==='leaf'){
    const s=new THREE.Shape();s.moveTo(0,-25);s.bezierCurveTo(-32,-3,-18,13,0,28);s.bezierCurveTo(18,13,32,-3,0,-25);
    const h=new THREE.Path();h.absellipse(0,-17,2.5,2.5,0,Math.PI*2,true);s.holes.push(h);
    g.add(mesh(new THREE.ExtrudeGeometry(s,{depth:3,bevelEnabled:true,bevelSize:.8,bevelThickness:.4,bevelSegments:1,curveSegments:8}),color));
    branch(g,[0,-11,4],[0,23,4],.6,'#97ad79');for(const y of [-4,4,12]){branch(g,[0,y,4],[-10,y+7,4],.5,'#97ad79');branch(g,[0,y,4],[10,y+7,4],.5,'#97ad79');}
  }else if(type==='stand'){
    const s=new THREE.Shape();[[0,0],[80,0],[80,7],[52,7],[31,92],[23,95],[48,7],[8,7],[8,18],[0,18]].forEach((p,i)=>i?s.lineTo(...p):s.moveTo(...p));s.closePath();
    const m=mesh(new THREE.ExtrudeGeometry(s,{depth:75,bevelEnabled:true,bevelSize:1.5,bevelThickness:1.5,bevelSegments:2}),color);m.rotation.x=Math.PI/2;g.add(m);
  }else if(type==='deer'){
    ball(g,[0,0,63],[37,17,22],color,8);ball(g,[28,0,91],[13,13,30],color,8);ball(g,[40,-1,111],[21,11,13],color,8);
    for(const x of[-23,22])for(const y of[-10,10])branch(g,[x,y,55],[x+(x>0?3:-7),y,0],5,color);
    ball(g,[28,-10,119],[5,3,12],color,6);ball(g,[28,10,119],[5,3,12],color,6);ball(g,[46,-10,115],[1.6,1.2,1.6],'#172f23',6);
  }
  normalize(g);return g;
}
export function normalize(g){g.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(g),c=b.getCenter(new THREE.Vector3());if(b.isEmpty())throw Error('El archivo no contiene una malla visible.');g.position.add(new THREE.Vector3(-c.x,-c.y,-b.min.z));g.updateMatrixWorld(true);return g;}
export function bounds(g){g.updateMatrixWorld(true);const v=new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());return [v.x,v.y,v.z];}
// Parsed meshes are kept in a small LRU cache. Without a limit, every model
// ever rendered (including thumbnail generation) stays in memory forever.
const cache=new Map(),pending=new Map();
const CACHE_MAX_MODELS=16,CACHE_MAX_VERTICES=6000000;
let cacheVertices=0;
function countVertices(g){let n=0;g.traverse(m=>{if(m.isMesh)n+=m.geometry.attributes.position?.count||0;});return n;}
function dropCacheEntry(key){
  const entry=cache.get(key);if(!entry)return;
  cache.delete(key);cacheVertices-=entry.vertices;
  entry.group.traverse(m=>{if(m.isMesh&&m.geometry){m.geometry.dispose();delete m.geometry.userData.cached;}});
}
function trimCache(protect){
  while(cache.size>CACHE_MAX_MODELS||cacheVertices>CACHE_MAX_VERTICES){
    const key=cache.keys().next().value;
    if(key===protect&&cache.size===1)break;
    dropCacheEntry(key);
  }
}
export const invalidateModel=id=>{pending.delete(id);dropCacheEntry(id);};
export const modelCacheStats=()=>({models:cache.size,vertices:cacheVertices});
const base64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);};
const ATTR=new Map();
function attr(tag,name){
  let re=ATTR.get(name);
  if(!re){re=new RegExp('\\b'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*=\\s*["\']([^"\']*)["\']');ATTR.set(name,re);}
  return re.exec(tag)?.[1]??null;
}
const tagEnd=c=>c===32||c===9||c===10||c===13||c===47||c===62;
function findTag(xml,name,from,end=xml.length){
  let p=from;
  while((p=xml.indexOf('<'+name,p))>=0&&p<end){
    if(tagEnd(xml.charCodeAt(p+name.length+1)))return p;
    p+=name.length+1;
  }
  return -1;
}
function transform3MF(value){
  const m=new THREE.Matrix4();
  if(!value)return m;
  const v=value.trim().split(/\s+/).map(Number);
  if(v.length!==12||v.some(n=>!Number.isFinite(n)))return m;
  m.set(v[0],v[3],v[6],v[9],v[1],v[4],v[7],v[10],v[2],v[5],v[8],v[11],0,0,0,1);
  return m;
}
function parse3MFMesh(xml,start,end){
  const vs=findTag(xml,'vertices',start,end),ve=vs>=0?xml.indexOf('</vertices>',vs):-1;
  const ts=findTag(xml,'triangles',start,end),te=ts>=0?xml.indexOf('</triangles>',ts):-1;
  if(vs<0||ve<0||ve>end||ts<0||te<0||te>end)return null;
  let count=0,q=vs;
  while((q=findTag(xml,'vertex',q,ve))>=0){count++;q=xml.indexOf('>',q)+1;if(q<1)break;}
  let triangles=0;
  q=ts;while((q=findTag(xml,'triangle',q,te))>=0){triangles++;q=xml.indexOf('>',q)+1;if(q<1)break;}
  if(!count||!triangles)return null;
  const positions=new Float32Array(count*3),index=new Uint32Array(triangles*3);
  let i=0;q=vs;
  while((q=findTag(xml,'vertex',q,ve))>=0){const gt=xml.indexOf('>',q),tag=xml.slice(q,gt+1);positions[i++]=+attr(tag,'x')||0;positions[i++]=+attr(tag,'y')||0;positions[i++]=+attr(tag,'z')||0;q=gt+1;}
  i=0;q=ts;
  while((q=findTag(xml,'triangle',q,te))>=0){const gt=xml.indexOf('>',q),tag=xml.slice(q,gt+1);const a=+attr(tag,'v1'),b=+attr(tag,'v2'),c=+attr(tag,'v3');index[i++]=a<count?a:0;index[i++]=b<count?b:0;index[i++]=c<count?c:0;q=gt+1;}
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setIndex(new THREE.BufferAttribute(index,1));
  geometry.computeVertexNormals();
  return geometry;
}
// Three's 3MF loader turns the whole XML into a DOM. A sliced 3MF can expand
// from 10 MB to more than 100 MB of XML, which needed several gigabytes of RAM.
// This reader walks the XML once and keeps only the final typed arrays.
function parse3MFDocument(xml,path){
  const objects=new Map();
  let p=0;
  while((p=findTag(xml,'object',p,xml.length))>=0){
    const gt=xml.indexOf('>',p);if(gt<0)break;
    if(xml.charCodeAt(gt-1)===47){p=gt+1;continue;}
    const end=xml.indexOf('</object>',gt+1);if(end<0)break;
    const id=attr(xml.slice(p,gt+1),'id');
    if(id&&!objects.has(id)){
      let mesh=null;const ms=findTag(xml,'mesh',gt+1,end);
      if(ms>=0){const me=xml.indexOf('</mesh>',ms);if(me>ms)mesh=parse3MFMesh(xml,ms,me);}
      const components=[],cs=findTag(xml,'components',gt+1,end);
      if(cs>=0){const ce=xml.indexOf('</components>',cs);let q=cs;while((q=findTag(xml,'component',q,ce))>=0){const cgt=xml.indexOf('>',q),tag=xml.slice(q,cgt+1);components.push({path:(attr(tag,'p:path')||attr(tag,'path')||path).replace(/^\/+/,''),id:attr(tag,'objectid'),matrix:transform3MF(attr(tag,'transform'))});q=cgt+1;}}
      objects.set(id,{mesh,components});
    }
    p=end+9;
  }
  const items=[],bs=findTag(xml,'build',0,xml.length);
  if(bs>=0){const be=xml.indexOf('</build>',bs);let q=bs;while((q=findTag(xml,'item',q,be))>=0){const gt=xml.indexOf('>',q),tag=xml.slice(q,gt+1);items.push({path:(attr(tag,'p:path')||attr(tag,'path')||path).replace(/^\/+/,''),id:attr(tag,'objectid'),matrix:transform3MF(attr(tag,'transform'))});q=gt+1;}}
  return {objects,items};
}
function parse3MF(buf){
  const zip=unzipSync(new Uint8Array(buf),{filter:f=>/\.model$/i.test(f.name)});
  const mainKey=Object.keys(zip).find(k=>/^3d\/3dmodel\.model$/i.test(k))||Object.keys(zip).find(k=>/\.model$/i.test(k));
  if(!mainKey)throw Error('El 3MF no contiene un modelo 3D.');
  const mainPath=mainKey.replace(/^\/+/,''),docs=new Map();
  let unit=1;
  function load(path){
    if(docs.has(path))return;
    const key=Object.keys(zip).find(k=>k.replace(/^\/+/,'')===path);if(!key)return;
    const xml=strFromU8(zip[key]);
    if(path===mainPath)unit=({micron:.001,millimeter:1,centimeter:10,inch:25.4,foot:304.8,meter:1000})[attr(xml.slice(0,Math.min(4096,xml.length)),'unit')]||1;
    const doc=parse3MFDocument(xml,path);delete zip[key];docs.set(path,doc);
    for(const obj of doc.objects.values())for(const c of obj.components)if(c.path&&!docs.has(c.path))load(c.path);
  }
  load(mainPath);
  const main=docs.get(mainPath);
  if(!main)throw Error('El 3MF no contiene un modelo 3D.');
  const root=new THREE.Group();
  function instantiate(path,id,matrix,depth=0){
    const obj=docs.get(path)?.objects.get(id);
    if(!obj||depth>32)return null;
    const holder=new THREE.Group();holder.applyMatrix4(matrix);
    if(obj.mesh)holder.add(new THREE.Mesh(obj.mesh,material('#a4b88a')));
    for(const c of obj.components){const child=instantiate(c.path,c.id,c.matrix,depth+1);if(child)holder.add(child);}
    return holder;
  }
  if(main.items.length){for(const it of main.items){const node=instantiate(it.path,it.id,it.matrix);if(node)root.add(node);}}
  else for(const id of main.objects.keys()){const node=instantiate(mainPath,id,new THREE.Matrix4());if(node)root.add(node);}
  if(!root.children.length)throw Error('El 3MF no contiene una malla visible.');
  return {group:root,unit};
}
// Prusa/Orca 3MF files usually carry a small preview. Using it avoids parsing a
// huge XML model just to paint the closed box. BambuStudio stores plate previews
// instead of `Metadata/thumbnail.png`.
export async function embeddedThumbnail(file){
  if(!file||!file.name.toLowerCase().endsWith('.3mf'))return null;
  const zip=unzipSync(new Uint8Array(await file.arrayBuffer()),{filter:f=>/^metadata\/(thumbnail|plate_1_small|plate_1|top_1|pick_1)\.(png|jpe?g|webp)$/i.test(f.name)});
  const names=Object.keys(zip),pick=pattern=>names.find(k=>pattern.test(k));
  const key=pick(/^metadata\/thumbnail\./i)||pick(/^metadata\/plate_1_small\./i)||pick(/^metadata\/plate_1\./i)||pick(/^metadata\/top_1\./i)||pick(/^metadata\/pick_1\./i);
  if(!key)return null;
  const ext=key.split('.').pop().toLowerCase(),mime=ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg';
  return `data:${mime};base64,${base64(zip[key])}`;
}
export async function parseModel(file,unit='mm'){
  const ext=file.name.split('.').pop().toLowerCase();let g;const buf=await file.arrayBuffer();
  let factor=unit==='cm'?10:unit==='in'?25.4:1;
  if(ext==='stl')g=mesh(new STLLoader().parse(buf),'#a4b88a');
  else if(ext==='obj')g=new OBJLoader().parse(new TextDecoder().decode(buf));
  else if(ext==='3mf'){
    const parsed=parse3MF(buf);g=parsed.group;factor=parsed.unit;
  }else if(ext==='glb'){
    const manager=new THREE.LoadingManager();manager.setURLModifier(url=>{if(/^(https?:|file:)/i.test(url))throw Error('Usa GLB con recursos incrustados.');return url;});
    const data=await new GLTFLoader(manager).parseAsync(buf,'');g=data.scene;g.rotation.x=Math.PI/2;factor=1000;
  }else throw Error('Vista 3D disponible para STL, OBJ, 3MF y GLB.');
  const wrap=new THREE.Group();wrap.add(g);wrap.scale.setScalar(factor);normalize(wrap);
  let vertices=0;wrap.traverse(m=>{if(m.isMesh){vertices+=m.geometry.attributes.position?.count||0;m.castShadow=true;m.receiveShadow=true;}});
  if(vertices>9000000)throw Error('La malla supera los nueve millones de vértices del visor. Simplifícala antes de importarla.');
  const dims=bounds(wrap);if(dims.some(v=>!Number.isFinite(v))||!dims.some(v=>v>0))throw Error('Dimensiones de malla inválidas.');
  return {group:wrap,dims};
}
async function cachedModel(fileId,part,getFile){
  let entry=cache.get(fileId);
  if(entry){cache.delete(fileId);cache.set(fileId,entry);return entry.group;}
  let job=pending.get(fileId);
  if(!job){
    job=(async()=>{
      const file=await getFile(fileId);if(!file)throw Error(`Falta el archivo ${part.name}`);
      const group=(await parseModel(file,part.unit||'mm')).group,vertices=countVertices(group);
      group.traverse(m=>{if(m.isMesh)m.geometry.userData.cached=true;});
      cache.set(fileId,{group,vertices});cacheVertices+=vertices;trimCache(fileId);
      return group;
    })();
    pending.set(fileId,job);
    job.finally(()=>{if(pending.get(fileId)===job)pending.delete(fileId);}).catch(()=>{});
  }
  return job;
}
export async function partModel(part,materials,getFile){
  const mat=materials.find(m=>m.id===part.matId),colors=materialColors(mat),color=colors[0]||'#91a57b';let g;
  if(part.demo){g=demoModel(part.demo,color);const d=bounds(g);const wrap=new THREE.Group();wrap.add(g);wrap.scale.set(...part.dims.map((v,i)=>v/(d[i]||1)));g=wrap;}
  else {
    g=(await cachedModel(part.fileId,part,getFile)).clone(true);
    if(colors.length<2)g.traverse(m=>{if(m.isMesh)m.material=material(color);});
  }
  if(colors.length>1)applyFilamentGradient(g,colors);
  const container=new THREE.Group();container.add(g);container.userData.partId=part.id;
  container.position.set(...(part.position||[0,0,0]));container.rotation.set(...(part.rotation||[0,0,0]).map(v=>v*Math.PI/180));container.scale.setScalar(part.scale??1);
  return container;
}
export async function objectModel(obj,materials,getFile){
  const g=new THREE.Group();for(const p of obj.parts||[])g.add(await partModel(p,materials,getFile));return g;
}
export function disposeObject(g){
  g?.traverse(m=>{
    if(!m.isMesh)return;
    if(Array.isArray(m.material))m.material.forEach(x=>x?.dispose?.());
    else m.material?.dispose?.();
    // Geometry owned by the shared model cache stays alive; the cache evicts it.
    if(m.geometry&&!m.geometry.userData.cached)m.geometry.dispose();
  });
}
export class Viewer{
  constructor(el,{editable=false,onTransform=()=>{},still=false}={}){
    this.el=el;this.onTransform=onTransform;this.dead=false;this.group=null;this.still=still;
    this.renderer=new THREE.WebGLRenderer({antialias:!still,alpha:true,preserveDrawingBuffer:true});
    this.renderer.setPixelRatio(still?1:Math.min(window.devicePixelRatio||1,2));this.renderer.setClearColor(0x000000,0);
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;this.renderer.shadowMap.enabled=!still;this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    el.prepend(this.renderer.domElement);this.scene=new THREE.Scene();this.scene.add(new THREE.HemisphereLight('#ffffff','#716b54',2.7));
    const key=new THREE.DirectionalLight('#fff4dc',4);key.position.set(180,-200,300);key.castShadow=!still;key.shadow.mapSize.set(1024,1024);Object.assign(key.shadow.camera,{left:-200,right:200,top:200,bottom:-200,near:1,far:1000});key.shadow.bias=-.001;this.scene.add(key);
    const fill=new THREE.DirectionalLight('#c4e6d4',2);fill.position.set(-150,150,170);this.scene.add(fill);
    this.camera=new THREE.PerspectiveCamera(36,1,.1,10000);this.camera.up.set(0,0,1);this.camera.position.set(220,-300,190);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=!still;this.controls.autoRotate=false;this.controls.autoRotateSpeed=.7;this.controls.addEventListener('start',()=>{this.cameraMotion=null;});
    this.grid=new THREE.GridHelper(400,20,'#718879','#a2afa6');this.grid.rotation.x=Math.PI/2;this.grid.material.transparent=true;this.grid.material.opacity=.13;this.scene.add(this.grid);
    if(editable){this.transform=new TransformControls(this.camera,this.renderer.domElement);this.scene.add(this.transform.getHelper());this.transform.addEventListener('dragging-changed',e=>{this.controls.enabled=!e.value;});this.transform.addEventListener('objectChange',()=>{const m=this.transform.object;if(m)this.onTransform(m.userData.partId,{position:m.position.toArray().map(v=>+v.toFixed(2)),rotation:m.rotation.toArray().slice(0,3).map(v=>+(v*180/Math.PI).toFixed(2)),scale:m.scale.x});});}
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(el);this.resize();if(!still)this.animate();
  }
  resize(){if(this.dead)return;const w=this.el.clientWidth,h=this.el.clientHeight;this.renderer.setSize(w||320,h||320);this.camera.aspect=(w||320)/(h||320);this.camera.updateProjectionMatrix();}
  set(g,{animate=false,direction=1}={}){this.transform?.detach();this.cameraMotion=null;if(this.group){this.scene.remove(this.group);disposeObject(this.group);}this.group=g;this.scene.add(g);this.fit();if(!this.still&&animate&&!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches){const end=this.camera.position.clone(),relative=end.clone().sub(this.controls.target),start=relative.applyAxisAngle(new THREE.Vector3(0,0,1),direction*.2).multiplyScalar(1.16).add(this.controls.target);this.cameraMotion={start,end,time:performance.now()};this.camera.position.copy(start);}}
  fit(){if(!this.group)return;const b=new THREE.Box3().setFromObject(this.group),s=b.getSize(new THREE.Vector3()),c=b.getCenter(new THREE.Vector3()),d=Math.max(...s.toArray(),20)*2.25;this.controls.target.copy(c);this.camera.position.copy(c).add(new THREE.Vector3(.7,-1,.65).normalize().multiplyScalar(d));this.controls.update();}
  select(partId,mode='translate'){const m=this.group?.children.find(m=>m.userData.partId===partId);if(m&&this.transform){this.transform.attach(m);this.transform.setMode(mode);}}
  snapshot({size=0,type='image/webp',quality=.82}={}){
    this.renderer.render(this.scene,this.camera);
    const source=this.renderer.domElement;
    if(!size||Math.max(source.width,source.height)<=size)return source.toDataURL(type,quality);
    const scale=size/Math.max(source.width,source.height),out=document.createElement('canvas');
    out.width=Math.max(1,Math.round(source.width*scale));out.height=Math.max(1,Math.round(source.height*scale));
    const ctx=out.getContext('2d');if(!ctx)return source.toDataURL(type,quality);
    ctx.drawImage(source,0,0,out.width,out.height);return out.toDataURL(type,quality);
  }
  animate(){if(this.dead)return;if(this.cameraMotion){const m=this.cameraMotion,t=Math.min(1,(performance.now()-m.time)/450);this.camera.position.lerpVectors(m.start,m.end,1-(1-t)**3);if(t>=1)this.cameraMotion=null;}this.controls.update();this.renderer.render(this.scene,this.camera);this.raf=requestAnimationFrame(()=>this.animate());}
  dispose(){this.dead=true;cancelAnimationFrame(this.raf);this.observer.disconnect();this.controls.dispose();this.transform?.dispose();if(this.group){this.scene.remove(this.group);disposeObject(this.group);this.group=null;}this.renderer.dispose();this.renderer.forceContextLoss();this.renderer.domElement.remove();}
}
export function exportSTL(g){return new Blob([new STLExporter().parse(g,{binary:true})],{type:'application/octet-stream'});}
export {THREE};
