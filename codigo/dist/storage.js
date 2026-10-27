import {defaults,newBox,newObject,uid,validateState,APP_VERSION,APP_PUBLISHER,UPDATE_REPO} from './core.js';
let db,root=null;
const native=location.hostname==='127.0.0.1'||location.hostname==='localhost';
export const isNative=!!(native&&document.querySelector('meta[name="woods-desktop"]'));
async function database(){if(db)return db;db=await new Promise((res,rej)=>{const r=indexedDB.open('3d-woods',1);r.onupgradeneeded=()=>{for(const n of ['state','files','handles'])if(!r.result.objectStoreNames.contains(n))r.result.createObjectStore(n);};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});return db;}
async function request(store,method,key,value){const d=await database();return new Promise((res,rej)=>{const tx=d.transaction(store,method==='get'?'readonly':'readwrite'),s=tx.objectStore(store),r=method==='put'?s.put(value,key):s[method](key);let result; r.onsuccess=()=>{result=r.result;};tx.oncomplete=()=>res(result);tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error||Error('No se pudo guardar.'));});}
export async function api(path,data){const r=await fetch(`/api/${path}`,data===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Woods-Request':'1'},body:JSON.stringify(data)});if(!r.ok){const e=await r.text();throw Error(e||`Error ${r.status}`);}return r.json();}
export async function loadState(){
  if(isNative){const data=await api('state');return {state:data.state||defaults(),rootName:data.root,desktop:true,version:data.version||APP_VERSION,publisher:data.publisher||APP_PUBLISHER,updateRepo:data.updateRepo||UPDATE_REPO,platform:data.platform||'windows'};}
  root=await request('handles','get','root');
  const state=await request('state','get','catalog');
  return {state:state||defaults(),rootName:root?.name||'',desktop:false,version:APP_VERSION,publisher:APP_PUBLISHER,updateRepo:UPDATE_REPO,platform:'browser'};
}
let saving=Promise.resolve();
export async function saveState(state){
  const snapshot=structuredClone(state);
  saving=saving.catch(()=>{}).then(async()=>{
    if(isNative)return api('state',snapshot);
    await request('state','put','catalog',snapshot);
    if(root&&await root.queryPermission({mode:'readwrite'})==='granted'){
      await writeJson(root,'.3dwoods-library.json',{...snapshot,boxes:[]});
      for(const b of snapshot.boxes.filter(b=>b.folder&&!b.demo)){
        const dir=await root.getDirectoryHandle(b.folder);await writeJson(dir,'.3dwoods.json',b);
      }
    }
  });return saving;
}
async function writeJson(dir,name,value){const f=await dir.getFileHandle(name,{create:true}),w=await f.createWritable();try{await w.write(JSON.stringify(value,null,2));await w.close();}catch(e){await w.abort();throw e;}}
async function readJson(dir,name){try{return JSON.parse(await(await dir.getFileHandle(name)).getFile().then(f=>f.text()));}catch{return null;}}
export async function chooseRoot(){
  if(isNative)return api('choose-root',{});
  if(!window.showDirectoryPicker)throw Error('Para conectar carpetas usa Chrome o Edge, o la aplicación de Windows.');
  const picked=await window.showDirectoryPicker({mode:'readwrite',id:'woods-library'});root=picked;await request('handles','put','root',root);
  const stored=await readJson(root,'.3dwoods-library.json');return {root:root.name,state:stored};
}
export async function authorizeRoot(){if(root&&await root.queryPermission({mode:'readwrite'})!=='granted'){if(await root.requestPermission({mode:'readwrite'})!=='granted')throw Error('Se necesita acceso a la carpeta para sincronizar.');}}
const supported=/\.(stl|obj|3mf|glb|gcode|gco|png|jpe?g|webp|svg|pdf|txt|mtl)$/i;
export async function scanRoot(){
  if(isNative)return api('scan');
  if(!root)return {boxes:[],root:null};
  if(await root.queryPermission({mode:'readwrite'})!=='granted')return {boxes:[],root:root.name,permissionNeeded:true};
  const boxes=[];
  async function walk(dir,prefix,files){for await(const [n,h]of dir.entries()){
    if(n.startsWith('.'))continue;
    if(h.kind==='directory')await walk(h,prefix+'/'+n,files);
    else if(supported.test(n)){const f=await h.getFile();const id=prefix+'/'+n;await request('handles','put',id,h);files.push({id,name:n,size:f.size,modified:f.lastModified});}
  }}
  for await(const [name,dir]of root.entries()){
    if(dir.kind!=='directory'||name.startsWith('.'))continue;
    let box=await readJson(dir,'.3dwoods.json');if(!box?.id||!Array.isArray(box.objects)){box=newBox(name);box.folder=name;await writeJson(dir,'.3dwoods.json',box);}
    box.folder=name;const files=[];await walk(dir,name,files);box.files=files;boxes.push(box);
  }
  return {root:root.name,boxes};
}
export async function createFolder(box){
  if(isNative){const b=await api('box',{name:box.name,box});return b.box;}
  if(!root)return box;
  await authorizeRoot();const base=box.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').slice(0,100)||'Caja';let name=base,n=2;
  while(true){try{await root.getDirectoryHandle(name);name=`${base} (${n++})`;}catch{break;}}
  const dir=await root.getDirectoryHandle(name,{create:true});box.folder=name;await writeJson(dir,'.3dwoods.json',box);return box;
}
export async function putFile(file,box){
  if(isNative){const f=new FormData();f.set('folder',box.folder);f.set('file',file,file.name);const r=await fetch('/api/upload',{method:'POST',headers:{'X-Woods-Request':'1'},body:f});if(!r.ok)throw Error(await r.text());return r.json();}
  let id=uid(),name=file.name;
  if(root&&box.folder){
    await authorizeRoot();const dir=await root.getDirectoryHandle(box.folder),ext=name.includes('.')?'.'+name.split('.').pop():'',base=ext?name.slice(0,-ext.length):name;let n=2;
    while(true){try{await dir.getFileHandle(name);name=`${base} (${n++})${ext}`;}catch{break;}}
    const handle=await dir.getFileHandle(name,{create:true}),w=await handle.createWritable();try{await w.write(file);await w.close();}catch(e){await w.abort();throw e;}
    id=box.folder+'/'+name;await request('handles','put',id,handle);
  }
  await request('files','put',id,file);return {id,name,size:file.size,modified:file.lastModified};
}
export async function getFile(id){
  if(isNative){const r=await fetch('/api/file?path='+encodeURIComponent(id),{cache:'no-store'});if(!r.ok)throw Error('No se encuentra el archivo en la carpeta.');return new File([await r.blob()],id.split('/').pop());}
  const h=await request('handles','get',id);if(h){try{return await h.getFile();}catch{/* Keep the imported backup when permission is unavailable. */}}
  return request('files','get',id);
}
export async function pickSlicer(){if(!isNative)throw Error('La apertura directa del laminador está disponible en la app de Windows.');return api('choose-slicer',{});}
export async function launchSlicer(box,object,settings){if(!isNative)throw Error('Usa la app de Windows para abrir el laminador, o exporta el STL para importarlo.');const files=object.parts.filter(p=>p.fileId).map(p=>p.fileId);if(!files.length)throw Error('Exporta el STL del ejemplo e impórtalo en una caja para abrirlo en el laminador.');return api('launch',{files,executable:settings.slicerPath});}
export async function launchPrepared(models,settings){if(!isNative)throw Error('La apertura directa requiere la aplicación de Windows.');const data=new FormData();for(const m of models)data.append('models',m.blob,m.name);const r=await fetch('/api/prepare',{method:'POST',headers:{'X-Woods-Request':'1'},body:data});if(!r.ok)throw Error(await r.text());const prepared=await r.json();return api('launch',{files:prepared.files,executable:settings.slicerPath});}
// Puente universal: carpeta vigilada donde cualquier laminador deja su G-code.
export async function pickBridgeFolder(){if(!isNative)throw Error('La carpeta vigilada requiere la aplicación de Windows. En el navegador puedes arrastrar el G-code.');return api('bridge/choose',{});}
export async function scanBridge(folder){if(!isNative)throw Error('La carpeta vigilada requiere la aplicación de Windows.');return api('bridge/scan',{folder:folder||''});}
export async function getBridgeFile(path){if(!isNative)throw Error('La carpeta vigilada requiere la aplicación de Windows.');const r=await fetch('/api/bridge/file?path='+encodeURIComponent(path),{cache:'no-store'});if(!r.ok)throw Error(await r.text()||'No se pudo leer el G-code del puente.');return new File([await r.blob()],String(path).split(/[\\/]/).pop());}
export async function openBridgeFolder(folder){if(!isNative)throw Error('La carpeta vigilada requiere la aplicación de Windows.');return api('bridge/open',{folder:folder||''});}
export async function revealFolder(box){if(!isNative)throw Error('El explorador de carpetas se abre desde la aplicación de Windows.');return api('reveal',{folder:box.folder||''});}
export async function download(blob,name){if(isNative){const data=new FormData();data.set('file',blob,name);const r=await fetch('/api/save-file',{method:'POST',headers:{'X-Woods-Request':'1'},body:data});if(!r.ok)throw Error(await r.text());const result=await r.json();if(result.canceled)throw new DOMException('Guardado cancelado','AbortError');return result;}const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
export async function exportBackup(state,includeFiles=true){
  const copy=structuredClone(state);copy.backupFiles=[];
  if(includeFiles)for(const b of state.boxes)for(const f of b.files||[]){const file=await getFile(f.id);if(!file)throw Error(`No se pudo respaldar ${f.name}.`);const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});copy.backupFiles.push({id:f.id,name:f.name,data});}
  await download(new Blob([JSON.stringify(copy)],{type:'application/json'}),'3D-Woods-respaldo.json');
}
export async function restoreBackup(data){validateState(data);const copy=structuredClone(data),blobs=new Map(),boxIds=new Map();for(const b of copy.boxes){const old=b.id;b.id=uid();boxIds.set(old,b.id);}if(Array.isArray(copy.shelfSlots))copy.shelfSlots=copy.shelfSlots.map(id=>boxIds.get(id)||null);for(const p of copy.products||[])if(boxIds.has(p.sourceBoxId))p.sourceBoxId=boxIds.get(p.sourceBoxId);for(const t of copy.ledger||[])for(const l of t.lines||[])if(boxIds.has(l.boxId))l.boxId=boxIds.get(l.boxId);for(const f of copy.backupFiles||[]){if(!/^data:[^,]*;base64,/.test(f.data))throw Error('Archivo de respaldo inválido.');const b=await(await fetch(f.data)).blob();blobs.set(f.id,new File([b],f.name));}
  for(let i=0;i<copy.boxes.length;i++){
    let b=copy.boxes[i];if(b.demo)continue;delete b.folder;b=await createFolder(b);const mapping={};
    for(const f of b.files||[]){const file=blobs.get(f.id);if(file){const old=f.id,n=await putFile(file,b);Object.assign(f,n);mapping[old]=n.id;}}
    for(const o of b.objects){if(mapping[o.lastSliceFile])o.lastSliceFile=mapping[o.lastSliceFile];for(const p of o.parts){if(mapping[p.fileId])p.fileId=mapping[p.fileId];}}copy.boxes[i]=b;
  }
  delete copy.backupFiles;return copy;
}
