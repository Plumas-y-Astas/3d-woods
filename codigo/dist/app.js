import {shelfController} from './shelf-controller.js';
import {reconcileShelf} from './shelf-order.js';
import {objectMotion} from './object-motion.js';
import {commerceController} from './commerce-controller.js';
import {printController} from './print-controller.js';
import {defaults,seedBoxes,newBox,newObject,uid,calculate,parseGcode,dimensions,formatTime,money,validateState,materialColors,APP_VERSION,APP_PUBLISHER,UPDATE_REPO,previewParts,scanGroup} from './core.js';
import {renderApp,renderCards,filteredBoxes,icon,esc,btn,field,select,modal} from './views.js';
import {migrate,saveActivePrinter,syncSupplyPrices,recordAdjustment} from './workshop.js';
import {workshopController} from './workshop-controller.js';
import * as storage from './storage.js';
import {Viewer,objectModel,partModel,parseModel,bounds,exportSTL,invalidateModel,disposeObject,embeddedThumbnail} from './models.js';

let state=defaults(),rootName='',viewer=null,renderId=0,saveTimer=null,savePromise=Promise.resolve(),busy=false,scanBusy=false,modalReturn=null;
const ui={view:'shelf',selected:null,objectId:null,partId:null,filter:'Todo',search:'',sort:'manual',list:false,tab:'overview',picked:false,focusId:null,bedPage:1,bedPart:null,devices:[],printerStatus:{},update:{status:'idle',current:APP_VERSION,publisher:APP_PUBLISHER,repo:UPDATE_REPO,latest:'',available:false,ready:false,notes:'',error:''}};
const app=document.getElementById('app'),modalRoot=document.getElementById('modal-root');
const box=()=>state.boxes.find(b=>b.id===ui.selected)||state.boxes.find(b=>!b.archived);
const object=()=>box()?.objects.find(o=>o.id===ui.objectId)||box()?.objects[0];
const part=()=>object()?.parts.find(p=>p.id===ui.partId)||object()?.parts[0];
let toastTimer;
function toast(text,error=false){const el=document.getElementById('toast');el.textContent=text;el.className='visible'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',error?8500:4500);}
async function attempt(fn){try{await fn();}catch(e){if(e.name!=='AbortError')toast(e.message||String(e),true);}}
function persist(){reconcileShelf(state);clearTimeout(saveTimer);saveTimer=setTimeout(()=>{saveTimer=null;savePromise=storage.saveState(state).catch(e=>toast('No se pudo guardar: '+e.message,true));},350);}
async function flush(){reconcileShelf(state);clearTimeout(saveTimer);saveTimer=null;await savePromise;await storage.saveState(state);}
window.woodsBeforeClose=async()=>{if(print.isPrinting())throw Error('Hay una impresión USB activa. Finalízala o detenla antes de cerrar.');if(busy||workshop.isBusy()||commerce.isBusy()||print.isBusy())throw Error('Espera a que termine la operación de guardado.');await flush();};
function applyTheme(){document.documentElement.dataset.theme=state.theme;document.querySelector('meta[name="theme-color"]').content=state.theme==='dark'?'#17251e':'#203d31';}
let inputRenderTimer=null,pointerActive=false,inputRenderPending=false;
function scheduleRender(){clearTimeout(inputRenderTimer);inputRenderPending=true;inputRenderTimer=setTimeout(()=>{if(!pointerActive){inputRenderPending=false;render();}},0);}
document.addEventListener('pointerdown',()=>{pointerActive=true;},true);
for(const evt of ['pointerup','pointercancel'])document.addEventListener(evt,()=>{pointerActive=false;if(inputRenderPending)scheduleRender();},true);
function render(){
  syncSupplyPrices(state);
  clearTimeout(inputRenderTimer);inputRenderPending=false;
  const active=document.activeElement,descriptor=active?.matches('input,select,textarea')?{tag:active.tagName,id:active.id,data:{...active.dataset},start:active.selectionStart,end:active.selectionEnd}:null;
  if(ui.selected&&!state.boxes.some(b=>b.id===ui.selected&&!b.archived)){ui.selected=state.boxes.find(b=>!b.archived)?.id;ui.objectId=null;}
  if(!ui.selected)ui.selected=state.boxes.find(b=>!b.archived)?.id;
  if(!object()&&box())box().objects.push(newObject(box().name,state.materials.find(m=>!m.retired)?.id));
  if(ui.picked)ui.focusId=ui.selected;print.dispose();viewer?.dispose();viewer=null;applyTheme();app.innerHTML=renderApp(state,ui,rootName);const id=++renderId;mountViewer(id);observeThumbnails();print.mount();ui.animateObject=false;
  if(descriptor){const next=descriptor.id?document.getElementById(descriptor.id):[...app.querySelectorAll(descriptor.tag)].find(x=>Object.keys(descriptor.data).length&&Object.entries(descriptor.data).every(([k,v])=>x.dataset[k]===v));if(next){next.focus({preventScroll:true});if(descriptor.start!=null&&next.setSelectionRange)try{next.setSelectionRange(descriptor.start,descriptor.end);}catch{}}}
}
async function mountViewer(id){
  const enter=!!ui.animateObject,direction=ui.objectDirection||1;const el=document.getElementById('model-viewer'),o=object();if(!el||!o)return;
  if(!o.parts.length){el.insertAdjacentHTML('beforeend',`<div class="viewer-error">${icon('box')}<span>Importa tu primer modelo para verlo aquí.</span></div>`);return;}
  const b=box(),sizes={};for(const f of b?.files||[])sizes[f.id]=f.size||0;
  const preview=previewParts(o.parts,sizes,VIEW_BUDGET_BYTES,ui.partId),target=preview.full?o:{...o,parts:preview.parts};
  try{
    const g=await objectModel(target,state.materials,storage.getFile);if(id!==renderId){disposeObject(g);return;}
    viewer=new Viewer(el,{editable:ui.view==='workspace'&&ui.tab==='parts',onTransform:(partId,t)=>{
      const p=o.parts.find(p=>p.id===partId);if(!p)return;Object.assign(p,t);if(preview.full){o.previewDims=bounds(viewer.group);document.querySelectorAll('[data-dim]').forEach(e=>e.textContent=dimensions(o.previewDims)+(ui.view==='shelf'?' cm':''));}
      for(const input of document.querySelectorAll('[data-part][data-axis]'))if(input.dataset.part===partId){const prop=input.dataset.prop;input.value=p[prop][+input.dataset.axis];}persist();
    }});viewer.set(g,{animate:enter,direction});
    if(preview.full){o.previewDims=bounds(g);document.querySelectorAll('[data-dim]').forEach(e=>e.textContent=dimensions(o.previewDims)+(ui.view==='shelf'?' cm':''));}
    else el.insertAdjacentHTML('beforeend',`<div class="viewer-notice">${icon('layers')}<span>Vista ligera: ${preview.parts.length} de ${preview.total} piezas (${Math.max(1,Math.round(preview.bytes/1048576))} MB). Elige una pieza en “Piezas y montaje” para verla; el cálculo, la exportación y el laminador usan el montaje completo.</span></div>`);
    if(ui.tab==='parts'&&ui.view==='workspace'&&part())viewer.select(part().id);
    const b=box();
    if(b&&b.objects.includes(o)&&needsThumb(b)&&!print.isPrinting()){
      try{const grid=viewer.grid.visible,helper=viewer.transform?.getHelper(),helperVisible=helper?.visible;viewer.grid.visible=false;if(helper)helper.visible=false;b.thumbnail=viewer.snapshot({size:THUMB_SIZE});viewer.grid.visible=grid;if(helper)helper.visible=helperVisible;updateThumbInDom(b);persist();}catch{/* A cover is optional. */}
    }
  }catch(e){if(id!==renderId)return;el.insertAdjacentHTML('beforeend',`<div class="viewer-error">${icon('box')}<span>${esc(e.message)}</span><small>La gestión y la calculadora siguen disponibles.</small></div>`);}
}
const THUMB_SIZE=256,HEAVY_THUMB=60000,COVER_MAX_BYTES=40*1024*1024,VIEW_BUDGET_BYTES=160*1024*1024;
const thumbQueue=[],thumbQueued=new Set(),thumbSkip=new Set();
let thumbTimer=null,thumbViewer=null,thumbViewerEl=null,thumbRetire=null,thumbChanges=0,thumbObserver=null,thumbRunning=false,thumbUnavailable=false;
const isHeavyThumb=src=>typeof src==='string'&&src.length>HEAVY_THUMB;
const needsThumb=b=>!!(b&&!b.archived&&!b.thumbnail&&!thumbSkip.has(b.id)&&b.objects.some(o=>o.parts.length));
const needsCompact=b=>!!(b&&!b.archived&&b.thumbnail&&isHeavyThumb(b.thumbnail)&&!thumbSkip.has(b.id)&&b.objects.some(o=>o.parts.length));
function enqueueThumb(id,first=false){
  const b=state.boxes.find(b=>b.id===id);if(!(needsThumb(b)||needsCompact(b))||thumbQueued.has(id))return;
  if(needsThumb(b)&&thumbUnavailable)return;
  thumbQueued.add(id);first?thumbQueue.unshift(id):thumbQueue.push(id);
  if(!thumbTimer)scheduleThumbs(120);
}
function thumbnails(list=state.boxes,{first=false}={}){for(const b of list){if(needsThumb(b)){thumbSkip.delete(b.id);enqueueThumb(b.id,first);}else if(needsCompact(b))enqueueThumb(b.id);}}
function compactThumbnails(){thumbnails();}
function updateThumbInDom(b){for(const im of document.querySelectorAll('[data-thumb]'))if(im.dataset.thumb===b.id)im.src=b.thumbnail;}
function scheduleThumbs(delay){clearTimeout(thumbTimer);thumbTimer=setTimeout(runThumbnails,delay);}
function flushThumbChanges(){if(!thumbChanges)return;thumbChanges=0;persist();}
function thumbnailViewer(){
  clearTimeout(thumbRetire);thumbRetire=null;
  if(thumbViewer)return thumbViewer;
  thumbViewerEl=document.createElement('div');
  Object.assign(thumbViewerEl.style,{position:'fixed',left:'-10000px',top:'0',width:'320px',height:'320px',pointerEvents:'none',contain:'strict'});
  document.body.append(thumbViewerEl);
  try{thumbViewer=new Viewer(thumbViewerEl,{still:true});thumbViewer.grid.visible=false;}catch(e){thumbUnavailable=true;thumbViewerEl.remove();thumbViewerEl=null;throw e;}
  return thumbViewer;
}
function retireThumbViewer(){
  if(!thumbViewer&&!thumbViewerEl)return;
  clearTimeout(thumbRetire);
  thumbRetire=setTimeout(()=>{thumbViewer?.dispose();thumbViewer=null;thumbViewerEl?.remove();thumbViewerEl=null;},15000);
}
async function shrinkThumbnail(b){
  const src=b.thumbnail,img=document.createElement('img');
  if(typeof img.decode!=='function')return false;
  img.src=src;await img.decode();
  const w=img.naturalWidth||img.width,h=img.naturalHeight||img.height;if(!w||!h)return false;
  const scale=Math.min(1,THUMB_SIZE/Math.max(w,h)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(w*scale));canvas.height=Math.max(1,Math.round(h*scale));
  const ctx=canvas.getContext('2d');if(!ctx)return false;
  ctx.drawImage(img,0,0,canvas.width,canvas.height);
  const out=canvas.toDataURL('image/webp',.82);
  if(!out||out.length>=src.length)return false;
  b.thumbnail=out;return true;
}
async function runThumbnails(){
  thumbTimer=null;
  if(thumbRunning)return;
  thumbRunning=true;
  try{
    if(!thumbQueue.length){flushThumbChanges();retireThumbViewer();return;}
    if(document.hidden||busy||scanBusy||print.isPrinting()){scheduleThumbs(1200);return;}
    const id=thumbQueue.shift(),b=state.boxes.find(x=>x.id===id);
    let changed=false;
    if(b&&needsThumb(b)&&!thumbUnavailable){
      let g=null;
      try{
        const o=b.objects.find(o=>o.parts.length),p=o?.parts[0];
        // A cover only needs one representative piece. Loading the complete
        // assembly here opened every mesh of a box just to paint its closed lid.
        if(!p)throw Error('Sin piezas para la portada.');
        const ext=String(p.fileId||'').split('.').pop().toLowerCase(),size=(b.files||[]).find(f=>f.id===p.fileId)?.size||0;
        const embedded=ext==='3mf'?await embeddedThumbnail(await storage.getFile(p.fileId)):null;
        if(embedded){b.thumbnail=embedded;changed=true;}
        else if(size>COVER_MAX_BYTES)throw Error('La portada se creará al abrir la caja.');
        else{
          g=await partModel({...p,position:[0,0,0],rotation:[0,0,0]},state.materials,storage.getFile);
          if(!state.boxes.includes(b)||!needsThumb(b)){/* The box changed while loading; skip its cover. */}
          else{const v=thumbnailViewer();v.set(g);g=null;b.thumbnail=v.snapshot({size:THUMB_SIZE});changed=!!b.thumbnail;}
        }
      }catch{thumbSkip.add(id);/* Other boxes remain usable if an imported mesh is missing. */}
      finally{if(g)disposeObject(g);}
    }else if(b&&needsCompact(b)){
      try{changed=await shrinkThumbnail(b);}catch{changed=false;}
      if(!changed)thumbSkip.add(b.id);
    }
    thumbQueued.delete(id);
    if(changed){thumbChanges++;updateThumbInDom(b);if(thumbChanges>=5)flushThumbChanges();}
    if(thumbQueue.length)scheduleThumbs(120);
    else{flushThumbChanges();retireThumbViewer();}
  }finally{thumbRunning=false;}
}
function observeThumbnails(){
  const byId=new Map(state.boxes.map(b=>[b.id,b]));
  const targets=[...document.querySelectorAll('[data-thumb]')].filter(im=>{const b=byId.get(im.dataset.thumb);return needsThumb(b)||needsCompact(b);});
  thumbObserver?.disconnect();thumbObserver=null;
  if(!targets.length)return;
  if(typeof IntersectionObserver!=='function'){for(const im of targets.slice(0,12)){const b=byId.get(im.dataset.thumb);if(needsThumb(b))thumbnails([b],{first:true});}return;}
  thumbObserver=new IntersectionObserver(entries=>{
    for(const e of entries){if(!e.isIntersecting)continue;thumbObserver?.unobserve(e.target);enqueueThumb(e.target.dataset.thumb);}
  },{rootMargin:'240px'});
  for(const im of targets)thumbObserver.observe(im);
}
function showModal(title,body,footer){modalReturn=document.activeElement;modalRoot.innerHTML=modal(title,body,footer);setTimeout(()=>modalRoot.querySelector('input,select,button')?.focus(),20);}
function closeModal(){modalRoot.innerHTML='';modalReturn?.focus?.();modalReturn=null;}
function ask(title,text,action){showModal(title,`<p>${esc(text)}</p>`,btn('Cancelar','close-modal')+btn('Confirmar',action,'check','primary'));}
function basicBoxDialog(){const cats=Array.isArray(state.categories)&&state.categories.length?state.categories:['Sin categoría'];showModal('Una caja para tu próxima idea',`<p>Guarda un objeto o reúne todas las piezas de un proyecto.</p>${field('Nombre de la caja','','id="new-box-name" maxlength="100" required','text')}${select('Categoría',cats.map(c=>[c,c]),cats[0],'id="new-box-category"')}`,btn('Cancelar','close-modal')+btn('Crear caja','create-box','plus','primary'));}
function categoryList(){if(!Array.isArray(state.categories)||!state.categories.length)state.categories=['Sin categoría'];return state.categories;}
function readCategoryName(){const name=(document.getElementById('category-name')?.value||'').trim();if(!name)throw Error('Escribe el nombre de la categoría.');if(name.length>40)throw Error('Usa 40 caracteres o menos.');if(['todo','favoritos','armables'].includes(name.toLocaleLowerCase('es')))throw Error('Ese nombre está reservado para los filtros de la estantería.');return name;}
function categoryModal(oldName=''){const editing=!!oldName;showModal(editing?'Renombrar categoría':'Nueva categoría',`<p>${editing?'El cambio se aplica a todas las cajas de esa categoría.':'Después puedes asignar cajas desde la ficha de cada una.'}</p>${field('Nombre de la categoría',oldName,'id="category-name" maxlength="40" required','text')}`,btn('Cancelar','close-modal')+btn(editing?'Guardar':'Crear categoría',editing?'save-category':'create-category','check','primary',editing?`data-old="${esc(oldName)}"`:''));}
function newObjectDialog(){showModal('Agregar otro objeto',`<p>Este objeto tendrá sus propios componentes, costos e insumos dentro de la misma caja.</p>${field('Nombre del objeto','','id="new-object-name" required','text')}`,btn('Cancelar','close-modal')+btn('Agregar objeto','create-object','plus','primary'));}
let importFiles=[],importTarget=null;
function importDialog(files,target=null){
  importFiles=Array.from(files).filter(f=>/\.(stl|obj|3mf|glb|gcode|gco|png|jpe?g|webp|svg|pdf|txt|mtl)$/i.test(f.name));importTarget=target;
  if(!importFiles.length){toast('Elige archivos STL, OBJ, 3MF, GLB, G-code o archivos de referencia.',true);return;}
  const base=importFiles[0].webkitRelativePath?.split('/')[0]||importFiles[0].name.replace(/\.[^.]+$/,'');
  showModal('Un lugar para estos archivos',`<div class="file-list">${importFiles.map(f=>`<div><b>${esc(f.name)}</b><span>${(f.size/1024/1024).toFixed(2)} MB</span></div>`).join('')}</div><div class="form-grid">${select('Destino',[['new','Crear una caja nueva'],...state.boxes.filter(b=>!b.archived&&!b.demo).map(b=>[b.id,b.name])],target&&state.boxes.find(b=>b.id===target&&!b.demo)?target:'new','id="import-destination"')}${field('Nombre para la caja nueva',base,'id="import-name"','text')}${select('Organizar los modelos',[['parts','Componentes de un solo objeto'],['objects','Un objeto por cada archivo']], 'parts','id="import-group"')}${select('Unidades de STL / OBJ',[['mm','Milímetros (habitual)'],['cm','Centímetros'],['in','Pulgadas']],'mm','id="import-units"')}</div><p class="short-note">3MF usa sus unidades y GLB usa metros. Las imágenes, G-code y documentos se guardan como archivos de apoyo. Los originales se copian, no se mueven. No hay límite de peso para importar.</p>`,btn('Cancelar','close-modal')+btn(`Importar ${importFiles.length} archivo(s)`,'do-import','upload','primary'));
}
async function processFiles(files,b,{group='parts',unit='mm',saveFiles=true}={}){
  const errors=[];let count=0;
  for(const fileOrMeta of files){
    let f=fileOrMeta,record=null;
    if(!saveFiles){record=fileOrMeta;f=await storage.getFile(record.id);if(!f){errors.push(record.name+': archivo no disponible');continue;}}
    try{
      if(saveFiles){record=await storage.putFile(f,b);b.files.push(record);}
      if(/\.(stl|obj|3mf|glb)$/i.test(f.name)){
        if(b.objects.some(o=>o.parts.some(p=>p.fileId===record.id)))continue;
        const result=await parseModel(f,unit);let o=b.objects.find(o=>o.id===ui.objectId)||b.objects[0];
        if(group==='objects'&&o.parts.length){o=newObject(f.name.replace(/\.[^.]+$/,''),state.materials.find(m=>!m.retired)?.id);b.objects.push(o);}else if(group==='objects')o.name=f.name.replace(/\.[^.]+$/,'');
        const pos=o.parts.length?[Math.max(...o.parts.map(p=>(p.position?.[0]||0)+(p.dims?.[0]||0)/2))+result.dims[0]/2+8,0,0]:[0,0,0];
        o.parts.push({id:uid(),name:f.name.replace(/\.[^.]+$/,''),fileId:record.id,unit,matId:state.materials.find(m=>!m.retired)?.id,qty:1,grams:null,minutes:null,dims:result.dims,position:pos,rotation:[0,0,0],scale:1});o.assembly=o.parts.length>1;o.gcode=null;b.thumbnail=null;
      }
      count++;
    }catch(e){errors.push(f.name+': '+e.message);}
  }
  return {count,errors};
}
async function doImport(){
  if(busy)return;const dest=document.getElementById('import-destination').value,name=document.getElementById('import-name').value.trim(),group=document.getElementById('import-group').value,unit=document.getElementById('import-units').value;
  if(dest==='new'&&!name){toast('Dale un nombre a la caja.',true);return;}busy=true;closeModal();toast('Guardando y preparando los modelos…');
  try{let b=state.boxes.find(b=>b.id===dest);if(!b){b=newBox(name);b=await storage.createFolder(b);state.boxes.unshift(b);}const result=await processFiles(importFiles,b,{group,unit});ui.selected=b.id;ui.objectId=b.objects[0]?.id;ui.view='workspace';ui.tab='overview';await flush();render();thumbnails([b],{first:true});if(result.errors.length)showModal('Importación terminada con avisos',`<p>${result.count} archivo(s) procesado(s). Los archivos copiados se conservan aunque no se puedan visualizar.</p><div class="file-list">${result.errors.map(e=>`<p>${esc(e)}</p>`).join('')}</div>`,btn('Entendido','close-modal','','primary'));else toast(`${result.count} archivo(s) guardado(s) en ${b.name}.`);}finally{busy=false;importFiles=[];}
}
let pendingGcode=null,pendingBackup=null;
async function readGcode(file){if(!object())throw Error('Crea primero un objeto.');const data=parseGcode(await file.text(),state.settings);if(!data.valid)throw Error('No se encontraron tiempo y consumo de filamento compatibles en este G-code. Puedes introducirlos manualmente.');pendingGcode={data,file,objectId:object().id};showModal('Datos del G-code',`<p>El G-code estima <b>${formatTime(data.minutes)}</b> y <b>${data.grams.reduce((a,b)=>a+b,0).toFixed(2)} g</b> para el archivo completo.</p><div class="form-grid">${field('Objetos completos incluidos en este G-code',1,'id="gcode-units" min="1" step="1"')}${data.grams.map((g,i)=>select(`Filamento ${i+1} · ${g.toFixed(2)} g`,state.materials.filter(m=>!m.retired).map(m=>[m.id,m.name]),object().parts[i]?.matId||state.materials.find(m=>!m.retired)?.id,`id="gcode-mat-${i}"`)).join('')}</div><p class="short-note">Selecciona el color de cada filamento. Los gramos se convierten desde longitud usando el diámetro y la densidad del material elegido. Si el G-code mezcla objetos distintos, sepáralos antes de asignarlo a un objeto. Para imprimir y descontar inventario, usa el Puente de impresión.</p>`,btn('Cancelar','close-modal')+btn('Aplicar al objeto','apply-gcode','check','primary'));}
async function applyGcode(){const {data,file,objectId}=pendingGcode;const unitsInput=document.getElementById('gcode-units');if(!unitsInput.checkValidity()||+unitsInput.value<1)throw Error('La cantidad debe ser un entero mayor que cero.');const units=+unitsInput.value;const o=box().objects.find(o=>o.id===objectId);if(!o)throw Error('Objeto no disponible.');
  const filaments=data.grams.map((g,i)=>{const matId=document.getElementById('gcode-mat-'+i).value,m=state.materials.find(m=>m.id===matId);return {matId,grams:(data.lengths[i]!=null?data.lengths[i]*Math.PI*(state.settings.diameter/2)**2/1000*m.density:g)/units,lengthMm:data.lengths[i]!=null?data.lengths[i]/units:null};});
  o.gcode={valid:true,source:data.source,name:file.name,units,minutes:data.minutes/units,filaments};if(!box().files.some(f=>f.name===file.name)){const f=await storage.putFile(file,box());box().files.push(f);}closeModal();ui.tab='cost';persist();render();toast('Tiempo y material aplicados a este objeto.');pendingGcode=null;
}
async function sync({manual=false}={}){
  if(manual&&saveTimer)await flush();
  if(scanBusy||busy||saveTimer||modalRoot.childElementCount&&!manual)return;scanBusy=true;
  try{
    await savePromise;if(manual)await storage.authorizeRoot();const result=await storage.scanRoot();if(result.permissionNeeded){if(manual)toast('Vuelve a autorizar la carpeta con Conectar carpeta.',true);return;}
    if(!result.root){if(manual)toast('Conecta una carpeta para detectar modelos nuevos.');return;}rootName=result.root;let changed=false;
    for(const scanned of result.boxes){
      validateState({version:1,boxes:[scanned],materials:state.materials,settings:state.settings});
      let b=state.boxes.find(b=>b.id===scanned.id||b.folder===scanned.folder);const isNew=!b;if(!b){b=scanned;state.boxes.unshift(b);changed=true;}
      const oldFiles=isNew?[]:b.files||[];const fresh=scanned.files||[];const added=fresh.filter(f=>!b.objects.some(o=>o.parts.some(p=>p.fileId===f.id))&&!oldFiles.some(x=>x.id===f.id&&x.size===f.size));
      for(const f of fresh){const prior=oldFiles.find(x=>x.id===f.id);
        // A different timestamp with the same size is normal after copying or restoring
        // a folder. Reparsing every one of those files on startup can load gigabytes
        // of meshes and freeze the shelf, so only a size change forces a reparse.
        if(prior&&prior.size!==f.size){invalidateModel(f.id);for(const o of b.objects)for(const p of o.parts)if(p.fileId===f.id){try{const loaded=await parseModel(await storage.getFile(f.id),p.unit);p.dims=loaded.dims;p.grams=null;p.minutes=null;o.gcode=null;b.thumbnail=null;}catch(e){if(manual)toast(e.message,true);}}}}
      if(JSON.stringify(oldFiles)!==JSON.stringify(fresh)){b.files=fresh;changed=true;}
      if(added.length){const res=await processFiles(added,b,{saveFiles:false,group:scanGroup(b)});if(res.errors.length&&manual)toast(res.errors.join(' · '),true);changed=true;}
    }
    if(changed){migrate(state);await flush();render();thumbnails();if(manual)toast('Carpetas y modelos actualizados.');}else if(manual)toast('La estantería ya está al día.');
  }catch(e){if(manual)throw e;}finally{scanBusy=false;}
}
async function connect(){if(busy)return;await flush();const result=await storage.chooseRoot();if(result.canceled)return;rootName=result.root;if(result.state?.version===1){state=migrate({...defaults(),...result.state,boxes:result.state.boxes||[]});}else{state={...state,boxes:state.boxes.filter(b=>b.demo)};}ui.selected=null;ui.objectId=null;await sync({manual:true});await flush();render();toast('Carpeta conectada. Las subcarpetas aparecerán como cajas.');}
function materialDialog(id){const m=state.materials.find(m=>m.id===id)||{id:uid(),name:'PLA · Nuevo color',color:'#738b5e',colors:['#738b5e'],price:350,spoolGrams:1000,stock:0,density:1.24,minStock:100},colors=materialColors(m);showModal(id?'Editar filamento':'Un nuevo color en el taller',`<div class="form-grid">${field('Nombre',m.name,'id="mat-name" required','text')}${field('Precio de la bobina',m.price,'id="mat-price"')}${field('Peso de la bobina (g)',m.spoolGrams,'id="mat-weight" min="1"')}${field('Existencias actuales (g)',m.stock,'id="mat-stock"')}${field('Avisar al quedar estos gramos',m.minStock??100,'id="mat-min"')}${field('Densidad (g/cm³)',m.density,'id="mat-density" min="0.01"')}</div><div class="material-color-editor"><div class="between"><div><b>Colores del filamento</b><p class="small muted">Uno o varios colores por bobina.</p></div>${btn('Agregar color','add-material-color','plus','small')}</div><div class="material-colors">${colors.map((c,i)=>`<div class="material-color-row"><input type="color" id="mat-color-${i}" value="${esc(c)}"><span class="small muted">Color ${i+1}${i===0?' · principal':''}</span>${i?`<button class="icon-btn" data-action="remove-material-color" aria-label="Quitar color">${icon('trash')}</button>`:''}</div>`).join('')}</div><p class="short-note">El primer color es el principal en la estantería. En el punto de venta puedes elegir cualquiera de estos colores para cada pieza.</p></div>`,btn('Cancelar','close-modal')+btn('Guardar filamento','save-material','check','primary',`data-id="${esc(m.id)}"`));}
function reindexMaterialColors(){const rows=[...document.querySelectorAll('.material-colors .material-color-row')];rows.forEach((row,i)=>{const input=row.querySelector('input[type="color"]');input.id='mat-color-'+i;const label=row.querySelector('span');if(label)label.textContent=`Color ${i+1}${i===0?' · principal':''}`;const remove=row.querySelector('[data-action="remove-material-color"]');if(i===0&&remove)remove.remove();if(i>0&&!remove){const button=document.createElement('button');button.className='icon-btn';button.dataset.action='remove-material-color';button.setAttribute('aria-label','Quitar color');button.innerHTML=icon('trash');row.append(button);}});if(rows.length>=16)document.querySelector('[data-action="add-material-color"]')?.setAttribute('disabled','');}
function quotesDialog(){showModal('Cotizaciones guardadas',state.quotes.length?`<div class="stack">${state.quotes.slice().reverse().map(q=>`<div class="panel"><div class="between"><b>${esc(q.objectName)}</b><span class="small muted">${new Date(q.date).toLocaleDateString('es-MX')}</span></div><p>${q.qty} objeto(s) · ${money(q.unit,q.currency)} / unidad · ×${q.multiplier}</p><div class="between"><strong>${money(q.total,q.currency)}</strong>${btn('Exportar CSV','export-quote','download','small',`data-id="${esc(q.id)}"`)}</div></div>`).join('')}</div>`:'<p>Todavía no hay cotizaciones. Guarda una desde la calculadora.</p>',btn('Cerrar','close-modal'));}
async function saveCover(){if(!viewer?.group)throw Error('No hay un modelo visible para capturar.');const old=viewer.grid.visible;viewer.grid.visible=false;if(viewer.transform)viewer.transform.detach();box().thumbnail=viewer.snapshot({size:THUMB_SIZE});viewer.grid.visible=old;persist();toast('Portada guardada con este ángulo.');}
async function openSlicer(){
  if(!storage.isNative)throw Error('La apertura directa usa la app de Windows. Puedes exportar el STL desde Vista general.');
  const o=object();if(!o?.parts.length)throw Error('Agrega al menos un modelo.');await flush();
  if(o.parts.some(p=>p.demo||(p.scale||1)!==1||p.qty!==1||['cm','in'].includes(p.unit))){
    if(o.parts.reduce((n,p)=>n+(p.qty||1),0)>100)throw Error('Envía un máximo de 100 componentes al laminador. Para pedidos mayores prepara una cama y usa la calculadora.');
    const models=[];for(const p of o.parts){const g=await partModel({...p,position:[0,0,0],rotation:[0,0,0]},state.materials,storage.getFile),blob=exportSTL(g);disposeObject(g);for(let i=0;i<(p.qty||1);i++)models.push({name:`${p.name}-${i+1}.stl`,blob});}
    await storage.launchPrepared(models,state.settings);
  }else await storage.launchSlicer(box(),o,state.settings);
  toast(`Componentes enviados a ${state.settings.slicerName}. Revisa su acomodo y perfil antes de laminar.`);
}
async function exportQuote(q){const rows=[['3D-Woods','Cotización'],['Fecha',q.date],['Caja',q.boxName],['Objeto',q.objectName],['Moneda',q.currency],['Cantidad',q.qty],['Multiplicador',q.multiplier],['Costo por unidad',q.cost],['Precio por unidad',q.unit],['Total',q.total],['Tiempo estimado total (min)',q.minutes],['Nota','Sin impuestos. Tiempos y costos estimados.']];const cell=v=>{const text=String(v);return '"'+(/^[=+@-]/.test(text)?"'":'')+text.replaceAll('"','""')+'"';};await storage.download(new Blob(['\uFEFF'+rows.map(r=>r.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}),'3D-Woods-cotizacion.csv');}
function changeObject(update,direction=1){objectMotion(()=>{ui.animateObject=true;ui.objectDirection=direction;update();render();},direction);}
const UPDATE_REPO_PATTERN=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
function updateRepoName(){return String(state.settings.updateRepo||ui.update.repo||UPDATE_REPO).trim().replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i,'').replace(/\.git$/i,'').replace(/^\/+|\/+$/g,'');}
function updateError(e){ui.update={...ui.update,status:'error',error:e.message||String(e)};if(ui.view==='settings')render();}
async function checkUpdates({manual=false,silent=false}={}){
  if(!ui.desktop){if(manual)toast('La actualización automática está disponible en la aplicación de Windows.',true);return;}
  if(ui.update.status==='checking'||ui.update.status==='downloading')return;
  if(ui.update.ready&&!manual)return;
  const repo=updateRepoName();
  if(!UPDATE_REPO_PATTERN.test(repo)){updateError(Error('Usa el formato usuario/repositorio de GitHub.'));if(manual)toast(ui.update.error,true);return;}
  ui.update={...ui.update,status:'checking',error:''};if(ui.view==='settings'&&manual)render();
  try{
    const r=await storage.api('update/check',{repo});
    ui.update={...ui.update,status:r.available?'available':'latest',current:r.current||ui.update.current,latest:r.latest||'',available:!!r.available,notes:r.notes||'',url:r.url||'',publishedAt:r.published_at||'',error:''};
    if(r.available){
      if(!manual&&state.settings.updateSkippedVersion===r.latest)return;
      await downloadUpdate({silent});
    }else if(manual)toast(`Ya tienes la última versión (${ui.update.current}).`);
  }catch(e){
    updateError(e);
    if(manual||!silent)toast(e.message||String(e),true);
  }finally{if(ui.view==='settings')render();}
}
async function downloadUpdate({silent=false}={}){
  if(ui.update.status==='downloading')return;
  const repo=updateRepoName();
  ui.update={...ui.update,status:'downloading',ready:false,error:''};if(ui.view==='settings')render();
  try{
    const r=await storage.api('update/download',{repo});
    ui.update={...ui.update,status:'ready',ready:true,latest:r.version||ui.update.latest,notes:r.notes||ui.update.notes,size:r.size||0,sha256:r.sha256||'',error:''};
    if(ui.view==='settings')render();
    if(!modalRoot.childElementCount)showUpdateDialog();
    else toast(`Actualización ${ui.update.latest} lista. Ábrela en Ajustes > Actualizaciones.`);
  }catch(e){updateError(e);throw e;}
}
function showUpdateDialog(){
  const u=ui.update,notes=(u.notes||'').slice(0,4000);
  showModal(`Actualización ${u.latest} lista`,`<p>Se descargó y verificó con SHA-256. La instala <b>${esc(u.publisher||APP_PUBLISHER)}</b> desde GitHub.</p>${notes?`<pre class="release-notes">${esc(notes)}</pre>`:''}<p class="short-note">Al reiniciar, 3D-Woods se cierra, reemplaza el ejecutable y vuelve a abrirse. Tus cajas, inventario y ajustes no se tocan.</p>`,btn('Más tarde','dismiss-update')+btn('Reiniciar e instalar','install-update','download','primary'));
}
async function installUpdate(){
  if(!ui.update.ready)throw Error('Primero descarga la actualización.');
  if(!ui.desktop||!window.woodsCloseReady)throw Error('La instalación automática solo está disponible en la aplicación de Windows.');
  await window.woodsBeforeClose();
  busy=true;
  try{
    await storage.api('update/install',{});
    toast('Actualización instalada. 3D-Woods se reiniciará.');
    closeModal();
    await new Promise(r=>setTimeout(r,350));
    await window.woodsCloseReady();
  }finally{busy=false;}
}
const actions={
 'nav':el=>{shelf.cancel();ui.view=el.dataset.view;ui.picked=false;ui.tab='overview';if(ui.view==='pos')commerce.enterPOS();render();window.scrollTo(0,0);},
 'theme':()=>{state.theme=state.theme==='dark'?'light':'dark';persist();render();},
 'filter':el=>{shelf.cancel();ui.filter=el.dataset.filter;ui.picked=false;ui.focusId=null;render();},
 'grid-view':()=>{ui.list=false;render();},'list-view':()=>{ui.list=true;render();},
 'clear-search':()=>{ui.search='';ui.filter='Todo';render();},
 
 
 
 
 'confirm-box':()=>{if(!ui.picked)return;ui.view='workspace';ui.tab='overview';render();window.scrollTo(0,0);},
 'select-object':el=>{if(object()?.id===el.dataset.id)return;const direction=(box().objects.findIndex(o=>o.id===el.dataset.id)>box().objects.findIndex(o=>o.id===object()?.id))?1:-1;changeObject(()=>{ui.objectId=el.dataset.id;ui.partId=null;},direction);},
 'favorite':el=>{const b=state.boxes.find(b=>b.id===el.dataset.id);b.favorite=!b.favorite;persist();render();},
 'new-box':basicBoxDialog,
 'new-category':()=>categoryModal(),
 'create-category':()=>{const name=readCategoryName(),alt=name.toLocaleLowerCase('es'),list=categoryList();if(list.some(c=>c.toLocaleLowerCase('es')===alt))throw Error('Ya existe esa categoría.');if(list.length>=100)throw Error('Puedes tener hasta 100 categorías.');list.push(name);ui.filter=name;closeModal();persist();render();toast('Categoría creada.');},
 'rename-category':el=>categoryModal(el.dataset.name),
 'save-category':el=>{const old=el.dataset.old,name=readCategoryName();if(old==='Sin categoría')throw Error('La categoría base no se puede renombrar.');const list=categoryList(),alt=name.toLocaleLowerCase('es'),index=list.indexOf(old);if(index<0)throw Error('La categoría ya no existe.');if(list.some((c,i)=>i!==index&&c.toLocaleLowerCase('es')===alt))throw Error('Ya existe esa categoría.');list[index]=name;for(const b of state.boxes)if(b.category===old)b.category=name;if(ui.filter===old)ui.filter=name;closeModal();persist();render();toast('Categoría renombrada.');},
 'delete-category':el=>{const name=el.dataset.name,count=state.boxes.filter(b=>!b.archived&&b.category===name).length;showModal('Eliminar categoría',`<p>Se eliminará <b>${esc(name)}</b>. ${count?`${count} caja(s) pasarán a Sin categoría. `:''}Las cajas y sus archivos no se borran.</p>`,btn('Cancelar','close-modal')+btn('Eliminar categoría','confirm-delete-category','trash','danger',`data-name="${esc(name)}"`));},
 'confirm-delete-category':el=>{const name=el.dataset.name;if(name==='Sin categoría')throw Error('La categoría base no se puede eliminar.');state.categories=categoryList().filter(c=>c!==name);for(const b of state.boxes)if(b.category===name)b.category='Sin categoría';if(ui.filter===name)ui.filter='Todo';closeModal();persist();render();toast('Categoría eliminada.');},
 'create-box':async()=>{const name=document.getElementById('new-box-name').value.trim();if(!name)throw Error('Dale un nombre a tu caja.');const category=document.getElementById('new-box-category')?.value||'Sin categoría',draft=newBox(name);if((state.categories||[]).includes(category))draft.category=category;let b=await storage.createFolder(draft);state.boxes.unshift(b);ui.selected=b.id;ui.objectId=null;ui.view='workspace';ui.tab='overview';closeModal();await flush();render();toast('Tu caja está lista. Ahora agrega los modelos.');},
 'new-object':newObjectDialog,
 'create-object':()=>{const name=document.getElementById('new-object-name').value.trim();if(!name)throw Error('Escribe el nombre del objeto.');const o=newObject(name,state.materials.find(m=>!m.retired)?.id);box().objects.push(o);ui.objectId=o.id;ui.tab='overview';closeModal();persist();render();},
 'tab':el=>{ui.tab=el.dataset.tab;render();},
 'close-modal':closeModal,
 'import':el=>{importTarget=el.dataset.box||null;const input=document.getElementById('file-input');input.accept='.stl,.obj,.3mf,.glb,.gcode,.gco,.png,.jpg,.jpeg,.webp,.svg,.pdf,.txt,.mtl';input.dataset.mode='models';input.click();},
 'do-import':doImport,
 'import-gcode':()=>{const input=document.getElementById('file-input');input.accept='.gcode,.gco';input.dataset.mode='gcode';input.click();},
 'read-gcode-file':async el=>readGcode(await storage.getFile(el.dataset.id)),
 'apply-gcode':applyGcode,
 'clear-gcode':()=>{object().gcode=null;persist();render();},
 'add-gcode-color':()=>{const o=object(),materials=state.materials.filter(m=>!m.retired),mat=materials.find(m=>!o.gcode.filaments.some(f=>f.matId===m.id))||materials[0];if(!mat)throw Error('Agrega un filamento en Inventario.');o.gcode.filaments.push({matId:mat.id,grams:0,lengthMm:null});o.gcode.edited=true;persist();render();},
 'remove-gcode-color':el=>{const g=object().gcode;if(g.filaments.length<=1)return;g.filaments.splice(+el.dataset.index,1);g.edited=true;persist();render();},
 'rotate-view':()=>{if(viewer)viewer.controls.autoRotate=!viewer.controls.autoRotate;},
 'fit-view':()=>viewer?.fit(),
 'select-part':el=>{ui.partId=el.dataset.id;render();},
 'transform-move':()=>{if(part())viewer?.select(part().id,'translate');},
 'transform-rotate':()=>{if(part())viewer?.select(part().id,'rotate');},
 'save-cover':saveCover,
 'export-stl':async()=>{const o=object();if(!o?.parts.length)throw Error('Agrega al menos un modelo.');const own=!viewer?.group,g=viewer?.group||await objectModel(o,state.materials,storage.getFile);try{await storage.download(exportSTL(g),o.name.replace(/[<>:"/\\|?*]/g,'_')+'-montaje.stl');}finally{if(own)disposeObject(g);}toast('Montaje exportado. Revísalo en el laminador antes de imprimir.');},
 'launch-slicer':openSlicer,
 'quit-app':async()=>{await window.woodsBeforeClose();if(window.woodsCloseReady){await window.woodsCloseReady();return;}await storage.api('quit',{});app.innerHTML='<div class="boot"><img src="./logo.svg" width="70" alt="Jackalope"><h1>El taller está cerrado.</h1><p>Todo quedó guardado. Puedes cerrar esta ventana.</p></div>';},
 'pick-slicer':async()=>{const r=await storage.pickSlicer();if(r.path){state.settings.slicerPath=r.path;persist();render();toast('Laminador configurado.');}},
 'reveal':()=>storage.revealFolder(box()),
 'connect':connect,'sync':()=>sync({manual:true}),
 'download-file':async el=>{const f=await storage.getFile(el.dataset.id);if(!f)throw Error('El archivo ya no está disponible.');await storage.download(f,f.name);},
 'multiplier':el=>{object().multiplier=+el.dataset.value;persist();render();},
 'add-extra':()=>{object().extras.push({id:uid(),name:'Nuevo insumo',qty:1,price:0});persist();render();},
 'remove-extra':el=>{object().extras=object().extras.filter(e=>e.id!==el.dataset.id);persist();render();},
 'save-quote':()=>{const o=object(),c=calculate(o,state.materials,state.settings,o.orderQty,o.multiplier);if(c.missing)throw Error('Completa los gramos y tiempos.');state.quotes.push({id:uid(),date:new Date().toISOString(),boxName:box().name,objectName:o.name,qty:c.qty,multiplier:o.multiplier,cost:c.cost,unit:c.price,total:c.total,minutes:c.requirements.minutes,currency:state.currency,snapshot:{object:structuredClone(o),settings:structuredClone(state.settings),materials:structuredClone(state.materials)}});persist();toast('Cotización guardada. La encontrarás en Historial.');},
 'quotes':quotesDialog,'export-quote':el=>exportQuote(state.quotes.find(q=>q.id===el.dataset.id)),
 'new-material':()=>materialDialog(),'edit-material':el=>materialDialog(el.dataset.id),
 'add-material-color':()=>{const wrap=document.querySelector('.material-colors');if(!wrap)return;if(wrap.querySelectorAll('.material-color-row').length>=16)throw Error('Puedes guardar hasta 16 colores por filamento.');const row=document.createElement('div');row.className='material-color-row';row.innerHTML=`<input type="color" value="#738b5e"><span class="small muted"></span><button class="icon-btn" data-action="remove-material-color" aria-label="Quitar color">${icon('trash')}</button>`;wrap.append(row);reindexMaterialColors();},
 'remove-material-color':el=>{const rows=document.querySelectorAll('.material-colors .material-color-row');if(rows.length<=1)return;el.closest('.material-color-row')?.remove();reindexMaterialColors();},
 'save-material':el=>{const inputs=[...modalRoot.querySelectorAll('input')];if(inputs.some(x=>!x.checkValidity()))throw Error('Revisa los campos del filamento.');const name=document.getElementById('mat-name').value.trim();if(!name)throw Error('Escribe el nombre del filamento.');const colors=[...new Set([...modalRoot.querySelectorAll('.material-colors input[type="color"]')].map(x=>x.value.toLowerCase()))];if(!colors.length)colors.push('#738b5e');const m={id:el.dataset.id,name,color:colors[0],colors,price:+document.getElementById('mat-price').value,spoolGrams:+document.getElementById('mat-weight').value,stock:+document.getElementById('mat-stock').value,density:+document.getElementById('mat-density').value,minStock:+document.getElementById('mat-min').value};if(m.spoolGrams<=0||m.density<=0)throw Error('Peso y densidad deben ser mayores que cero.');const n=state.materials.findIndex(x=>x.id===m.id);const stock=m.stock;m.stock=n<0?0:state.materials[n].stock;if(n<0)state.materials.push(m);else state.materials[n]=m;recordAdjustment(state,'material',m.id,stock,n<0?'Conteo inicial de filamento':'Ajuste de filamento');for(const b of state.boxes)for(const o of b.objects)if(o.gcode?.valid)for(const f of o.gcode.filaments)if(f.matId===m.id&&f.lengthMm!=null)f.grams=f.lengthMm*Math.PI*((f.diameter||state.settings.diameter)/2)**2/1000*m.density;closeModal();persist();render();toast('Filamento guardado.');},
 'backup':async()=>{busy=true;toast('Preparando el respaldo con tus archivos…');try{await flush();await storage.exportBackup(state);toast('Respaldo exportado.');}finally{busy=false;}},
 'restore':()=>document.getElementById('backup-input').click(),
 'restore-complete':async()=>{if(!pendingBackup||busy)return;busy=true;try{await flush();await storage.exportBackup(state);const previous=state.boxes.filter(b=>b.folder).map(b=>({...structuredClone(b),archived:true}));const restored=await storage.restoreBackup(pendingBackup);restored.boxes.push(...previous);state=migrate(restored);ui.sort=state.shelfSort||'manual';state.initialized=true;pendingBackup=null;ui.picked=false;ui.selected=null;closeModal();await flush();render();thumbnails();toast('Catálogo, inventario y movimientos restaurados. Se guardó un respaldo previo.');}finally{busy=false;}},
 'restore-boxes':async()=>{if(!pendingBackup||busy)return;busy=true;try{const restored=await storage.restoreBackup(pendingBackup);for(const m of restored.materials)if(!state.materials.some(x=>x.id===m.id))state.materials.push({...m,stock:0});for(const m of restored.supplies)if(!state.supplies.some(x=>x.id===m.id))state.supplies.push({...m,stock:0});for(const b of restored.boxes){if(state.boxes.some(x=>x.id===b.id))b.id=uid();state.boxes.push(b);}migrate(state);pendingBackup=null;closeModal();await flush();render();thumbnails();toast('Cajas agregadas. El stock y las ventas actuales se conservan.');}finally{busy=false;}},
 'remove-demos':()=>ask('Retirar las cajas de ejemplo','Se retirarán solo las cajas de demostración. Tus archivos y cajas importadas se conservan.','confirm-remove-demos'),
 'confirm-remove-demos':()=>{state.boxes=state.boxes.filter(b=>!b.demo);ui.selected=null;ui.objectId=null;closeModal();persist();render();},
 'add-demos':()=>{for(const b of seedBoxes())if(!state.boxes.some(x=>x.id===b.id))state.boxes.push(b);migrate(state);persist();render();thumbnails();},
 'archive':()=>ask('Archivar esta caja','La caja se ocultará de la estantería. Sus archivos permanecerán en su carpeta. Puedes restaurarla desde Ajustes.','confirm-archive'),
 'confirm-archive':()=>{box().archived=true;ui.selected=null;ui.view='shelf';closeModal();persist();render();},
 'unarchive':el=>{const b=state.boxes.find(b=>b.id===el.dataset.id);b.archived=false;persist();render();},
 'remove-part':el=>{ui.partId=el.dataset.id;ask('Quitar componente del objeto','El archivo original se conserva en la caja. El componente dejará de participar en el montaje y en el cálculo.','confirm-remove-part');},
 'confirm-remove-part':()=>{object().parts=object().parts.filter(p=>p.id!==ui.partId);object().gcode=null;ui.partId=null;box().thumbnail=null;closeModal();persist();render();thumbnails([box()],{first:true});},
 'move-part':el=>{ui.partId=el.dataset.id;const other=box().objects.filter(o=>o.id!==object().id);if(!other.length)throw Error('Agrega otro objeto a la caja antes de mover el componente.');showModal('Mover componente',select('Objeto de destino',other.map(o=>[o.id,o.name]),other[0].id,'id="part-destination"'),btn('Cancelar','close-modal')+btn('Mover','confirm-move-part','check','primary'));},
 'confirm-move-part':()=>{const destination=box().objects.find(o=>o.id===document.getElementById('part-destination').value),p=part();object().parts=object().parts.filter(x=>x.id!==p.id);object().gcode=null;destination.parts.push(p);destination.gcode=null;destination.assembly=destination.parts.length>1;ui.partId=null;closeModal();persist();render();},
 'check-updates':()=>checkUpdates({manual:true}),
 'download-update':()=>downloadUpdate(),
 'install-update':installUpdate,
 'dismiss-update':()=>{if(ui.update.latest){state.settings.updateSkippedVersion=ui.update.latest;persist();}closeModal();toast('Esta versión no se volverá a ofrecer. Puedes instalarla desde Ajustes > Actualizaciones.');},
};
const workshop=workshopController({state:()=>state,setState:s=>{state=s;},box,object,ui,render,persist,flush,showModal,closeModal,toast});
const print=printController({state:()=>state,box,object,ui,render,persist,flush,showModal,closeModal,toast,probe:()=>workshop.probe()});
const commerce=commerceController({state:()=>state,setState:s=>{state=s;},ui,render,persist,flush,showModal,closeModal,toast});
const shelf=shelfController({state:()=>state,ui,render,persist,showModal,closeModal,items:filteredBoxes});
Object.assign(actions,workshop.actions,print.actions,commerce.actions,shelf.actions);
document.addEventListener('click',e=>{if(workshop.isBusy()||commerce.isBusy()){e.preventDefault();return;}const el=e.target.closest('[data-action]');if(!el)return;e.stopPropagation();e.preventDefault();const action=actions[el.dataset.action];if(action)attempt(()=>action(el));});
document.addEventListener('input',e=>{if(e.target.id==='search'){shelf.cancel();ui.search=e.target.value;ui.picked=false;ui.focusId=null;render();}});
document.addEventListener('change',e=>attempt(async()=>{
 const el=e.target;
 if(await commerce.change(el))return;
 if(await print.change(el))return;
 if(await workshop.change(el))return;
 if(el.id==='file-input'){const files=Array.from(el.files);el.value='';if(!files.length)return;if(el.dataset.mode==='gcode')await readGcode(files[0]);else if(el.dataset.mode==='bridge')await print.importFile(files[0]);else importDialog(files,importTarget);return;}
 if(el.id==='backup-input'){
  const file=el.files[0];el.value='';if(!file)return;busy=true;toast('Restaurando respaldo…');
  try{pendingBackup=migrate(validateState(JSON.parse(await file.text())));showModal('Restaurar respaldo',`<p>El respaldo contiene ${pendingBackup.boxes.length} cajas y ${pendingBackup.ledger.length} movimientos. La restauración completa reemplaza el catálogo, stock y movimientos actuales por los del respaldo. Las cajas actuales se conservarán archivadas en sus carpetas. Primero se te pedirá guardar un respaldo del estado actual.</p><p>También puedes agregar solo las cajas y conservar tu inventario actual.</p>`,btn('Cancelar','close-modal')+btn('Solo agregar cajas','restore-boxes')+btn('Restaurar catálogo completo','restore-complete','check','primary'));}finally{busy=false;}return;
 }
 if(el.id==='sort'){shelf.cancel();ui.picked=false;ui.reorder=false;ui.sort=el.value;state.shelfSort=ui.sort;persist();render();return;}
 if(el.id==='calc-box'){changeObject(()=>{ui.selected=el.value;ui.objectId=null;});return;}
 if(el.id==='calc-object'){changeObject(()=>{ui.objectId=el.value;});return;}
 if(el.type==='number'&&!el.checkValidity()){toast('Introduce un número válido en el rango indicado.',true);el.reportValidity();return;}
 const val=el.type==='checkbox'?el.checked:el.type==='number'?(el.value===''?null:+el.value):el.value;
 if(el.dataset.object){const key=el.dataset.object;if(['name'].includes(key)&&!String(val).trim())throw Error('El nombre no puede quedar vacío.');object()[key]=val;if(key==='orderQty')object()[key]=Math.max(1,Math.floor(val||1));if(key==='sizeClass'){if(val==='small')object().multiplier=5;}persist();scheduleRender();}
 if(el.dataset.boxField){box()[el.dataset.boxField]=val;persist();scheduleRender();}
 if(el.dataset.setting){const key=el.dataset.setting;if(['bedX','bedY','bedZ','lifeHours','replacementHours','diameter','density'].includes(key)&&!(val>0))throw Error('Este valor debe ser mayor que cero.');state.settings[key]=val??0;if(key==='updateRepo')ui.update={...ui.update,status:'idle',latest:'',available:false,ready:false,notes:'',error:''};saveActivePrinter(state);persist();scheduleRender();}
 if(el.dataset.preference){state[el.dataset.preference]=val;persist();scheduleRender();}
 if(el.dataset.part){const o=object(),p=o.parts.find(p=>p.id===el.dataset.part),key=el.dataset.prop;
  if(key==='position'||key==='rotation'){p[key]??=[0,0,0];p[key][+el.dataset.axis]=val||0;}
  else if(key==='hours')p.minutes=val==null?null:val*60+((p.minutes||0)%60);
  else if(key==='extraMinutes')p.minutes=val==null?null:Math.floor((p.minutes||0)/60)*60+val;
  else if(key==='scalePercent'){p.scale=(val||100)/100;p.grams=null;p.minutes=null;o.gcode=null;toast('Escala actualizada. Vuelve a laminar para obtener gramos y tiempo.');}
  else {p[key]=val;if(key==='qty'){p.qty=Math.max(1,Math.floor(val||1));o.gcode=null;}}
  if(['grams','hours','extraMinutes','matId'].includes(key))o.gcode=null;
  if(['matId','scalePercent','position','rotation'].includes(key))box().thumbnail=null;
  persist();scheduleRender();
 }
 if(el.dataset.extra){const x=object().extras.find(x=>x.id===el.dataset.extra);x[el.dataset.prop]=val;persist();scheduleRender();}
 if(el.dataset.gcodeTime){const g=object().gcode;g.minutes=el.dataset.gcodeTime==='hours'?val*60+g.minutes%60:Math.floor(g.minutes/60)*60+val;g.edited=true;persist();scheduleRender();return;}
 if(el.dataset.gcodeGrams!=null){const f=object().gcode.filaments[+el.dataset.gcodeGrams];f.grams=val;f.lengthMm=null;object().gcode.edited=true;persist();scheduleRender();return;}
 if(el.dataset.gcodeMaterial!=null){const f=object().gcode.filaments[+el.dataset.gcodeMaterial];f.matId=val;if(f.lengthMm!=null)f.grams=f.lengthMm*Math.PI*((f.diameter||state.settings.diameter)/2)**2/1000*state.materials.find(m=>m.id===val).density;persist();scheduleRender();}
}));
document.addEventListener('keydown',e=>{
 if(workshop.isBusy()||commerce.isBusy()){e.preventDefault();return;}
 if(e.key==='Escape'){if(modalRoot.childElementCount)closeModal();else if(shelf.isBusy()){shelf.cancel();ui.picked=false;render();}else if(ui.picked)attempt(()=>shelf.returnBox());return;}
 if(ui.view==='shelf'&&!modalRoot.childElementCount&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();attempt(()=>shelf.step(e.key==='ArrowLeft'?-1:1));return;}if(e.key==='Enter'&&!e.target.closest('button,a,[role="button"]')){e.preventDefault();attempt(()=>actions['take-focused']());return;}}
 if(e.key==='Tab'&&modalRoot.childElementCount){const focus=[...modalRoot.querySelectorAll('button,input,select,textarea,[tabindex="0"]')].filter(x=>!x.disabled),first=focus[0],last=focus.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
 if((e.key==='Enter'||e.key===' ')&&e.target.matches('[role="button"]')){e.preventDefault();e.target.click();}
 if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){const input=document.getElementById('search');if(input){e.preventDefault();input.focus();}}
});
let dragDepth=0;
document.addEventListener('dragenter',e=>{if(!e.dataTransfer.types.includes('Files'))return;e.preventDefault();dragDepth++;if(!document.querySelector('.drop-overlay')){const d=document.createElement('div');d.className='drop-overlay';d.innerHTML=`${icon('box')}<h2>Dale una caja a tu idea.</h2><p>Suelta sobre una caja para añadirla, o en cualquier espacio para crear una nueva.</p>`;document.body.append(d);}});
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
document.addEventListener('dragleave',e=>{if(!e.dataTransfer.types.includes('Files'))return;dragDepth--;if(dragDepth<=0)document.querySelector('.drop-overlay')?.remove();});
async function filesFromDrop(dt){const items=[...dt.items];const entries=items.map(i=>i.webkitGetAsEntry?.()).filter(Boolean);if(!entries.some(e=>e.isDirectory))return [...dt.files];const files=[];async function visit(e){if(e.isFile){files.push(await new Promise((res,rej)=>e.file(res,rej)));}else if(e.isDirectory){const reader=e.createReader();while(true){const batch=await new Promise((res,rej)=>reader.readEntries(res,rej));if(!batch.length)break;for(const x of batch)await visit(x);}}}for(const e of entries)await visit(e);return files;}
document.addEventListener('drop',e=>{if(!Array.from(e.dataTransfer?.types||[]).includes('Files'))return;e.preventDefault();dragDepth=0;document.querySelector('.drop-overlay')?.remove();const target=e.target.closest('[data-action="select-box"]')?.dataset.id||(ui.view==='workspace'?box()?.id:null);attempt(async()=>{const files=await filesFromDrop(e.dataTransfer);if(ui.view==='print'){const gcode=files.filter(f=>/\.(gcode|gco|g)$/i.test(f.name));if(gcode.length===1){await print.importFile(gcode[0]);return;}if(gcode.length>1){toast('Abre un solo G-code a la vez. Puedes elegir el resto desde la lista del puente.',true);return;}}importDialog(files,target);});});
window.addEventListener('beforeunload',e=>{if(saveTimer||busy||workshop.isBusy()){e.preventDefault();e.returnValue='';}});
async function init(){try{const data=await storage.loadState();state={...defaults(),...data.state};state.settings={...defaults().settings,...state.settings};state.quotes??=[];validateState(state);rootName=data.rootName;ui.desktop=data.desktop;ui.update={...ui.update,current:data.version||APP_VERSION,publisher:data.publisher||APP_PUBLISHER,repo:data.updateRepo||UPDATE_REPO};if(!state.initialized){state.boxes=seedBoxes();state.initialized=true;}state=migrate(state);ui.sort=state.shelfSort||'manual';ui.selected=state.boxes.find(b=>!b.archived)?.id;print.reconcile();render();await sync();persist();setTimeout(compactThumbnails,4000);workshop.probe();setInterval(()=>print.poll(),1500);setInterval(()=>{if(!document.hidden)workshop.probe();},5000);setInterval(()=>{if(!document.hidden)sync();},120000);if(ui.desktop){setTimeout(()=>{if(state.settings.updateAuto!==false)attempt(()=>checkUpdates({silent:true}));},5000);setInterval(()=>{if(!document.hidden&&state.settings.updateAuto!==false)attempt(()=>checkUpdates({silent:true}));},21600000);}}catch(e){app.innerHTML=`<div class="boot"><img src="./logo.svg" width="70" alt=""><h1>El taller no pudo abrir</h1><p>${esc(e.message)}</p><p>Permite el almacenamiento local del navegador y vuelve a cargar.</p><button class="btn primary" onclick="location.reload()">Volver a intentar</button></div>`;}}
init();
