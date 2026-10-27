import {usbSelection} from './usb-core.js';
import {Viewer,objectModel,disposeObject} from './models.js';
import {parseGcode,finite} from './core.js';
import {bridgePreview} from './bridge-core.js';
import {beginPrintSession,advancePrintSession,finishPrintSession,stopPrintSession,discardPrintSession,reconcilePrintSessions,activePrintSessions,printSession,voidTransaction} from './workshop.js';
import {esc,btn,field,select} from './views.js';
import * as storage from './storage.js';

export function printController(c){
 const {ui,render,persist,flush,showModal,closeModal,toast}=c,S=c.state,$=id=>document.getElementById(id);
 let viewer=null,generation=0,polling=false,startPending=false,scanning=false,importing=false,autoTimer=null;
 const printer=()=>S().printers.find(p=>p.id===S().activePrinterId)||S().printers[0];
 const baud=()=>printer()?.baud??S().settings.baud??115200;
 const active=()=>activePrintSessions(S())[0]||null;
 const current=()=>{const s=printSession(S(),ui.printSessionId);return s&&['printing','paused'].includes(s.status)?s:active();};
 const preview=()=>ui.printPreview||null;
 function dispose(){generation++;viewer?.dispose();viewer=null;}
 function updatePrint(){
  const st=ui.printStatus||{},el=document.querySelector('[data-print-status]');
  if(st.state==='error'&&st.message)ui.printError=st.message;
  if(el)el.textContent=`${st.message||'Sin impresión USB activa'}${st.total?' · '+(100*(st.sent||0)/st.total).toFixed(1)+'% de comandos confirmados':''}`;
  const prog=document.querySelector('[data-print-progress]');if(prog)prog.value=st.total?100*(st.sent||0)/st.total:0;
  const error=$('usb-error');if(error){error.hidden=!ui.printError;error.textContent=ui.printError||'';}
  if($('usb-log'))$('usb-log').textContent=(ui.printError?ui.printError+'\n':'')+(st.log||'El intercambio USB aparecerá aquí.');
  for(const [action,enabled] of [['usb-pause',st.state==='printing'],['usb-resume',st.state==='paused'],['usb-stop',['checking','connecting','printing','paused','firmware-pause'].includes(st.state)],['test-usb',!startPending&&!['checking','connecting','printing','paused','firmware-pause'].includes(st.state)],['print-start',!startPending&&!['checking','connecting','printing','paused','firmware-pause'].includes(st.state)]]){const button=document.querySelector(`[data-action="${action}"]`);if(button)button.disabled=!enabled;}
  const confirm=document.querySelector('[data-action="confirm-print-start"]');if(confirm)confirm.disabled=startPending;
 }
 async function mount(){
  if(ui.view!=='print')return;
  const el=$('print-viewer'),o=c.object(),token=++generation;
  if(!el)return;
  if(!o?.parts.length){el.insertAdjacentHTML('beforeend',`<div class="viewer-error">${'<span>Importa un modelo para verlo aquí.</span>'}</div>`);return;}
  try{
   const g=await objectModel(o,S().materials,storage.getFile);if(token!==generation){disposeObject(g);return;}
   viewer=new Viewer(el);viewer.grid.visible=false;viewer.set(g);ui.printObjectImage=viewer.snapshot({size:320});ui.printObjectId=o.id;
   const pv=preview();if(pv&&!pv.thumbnail&&ui.printCapturedFor!==o.id){ui.printCapturedFor=o.id;pv.thumbnail=ui.printObjectImage;persist();render();}
  }catch(e){if(token===generation)el.insertAdjacentHTML('beforeend',`<div class="viewer-error"><span>${esc(e.message)}</span></div>`);}
  updatePrint();
 }
 function capture(){
  if(!viewer){throw Error('El visor del modelo todavía no está listo. Espera un momento e inténtalo de nuevo.');}
  const image=viewer.snapshot({size:320});ui.printObjectImage=image;ui.printCapturedFor=c.object()?.id||'';
  if(preview()){preview().thumbnail=image;persist();render();toast('Imagen del modelo capturada para este G-code.');}
  else toast('Imagen capturada. Abre un G-code para guardarla con la impresión.');
 }
 function normalisePreview(){
  const pv=preview();if(!pv)return null;
  pv.grams=pv.filaments.reduce((n,f)=>n+finite(f.grams),0);
  pv.valid=pv.filaments.some(f=>finite(f.grams)>0&&f.matId);
  pv.units=Math.max(1,Math.floor(finite(ui.printUnits,1)));
  return pv;
 }
 async function importFile(file,{path='',quiet=false}={}){
  if(importing)return;if(!file)throw Error('No se recibió ningún archivo.');
  if(file.size>80*1024*1024)throw Error('El puente admite G-code de hasta 80 MB.');
  importing=true;
  try{
   const text=await file.text();
   const data=parseGcode(text,{diameter:S().settings.diameter,density:S().settings.density});
   const pv=bridgePreview(data,file.name,S().materials);
   if(!data.minutes&&!pv.filaments.some(f=>f.grams>0))pv.warnings=[...(pv.warnings||[]),'El archivo no declara tiempo ni filamento. Puedes escribirlos a mano antes de guardarlo.'];
   pv.path=path;pv.units=1;
   if(!pv.thumbnail&&ui.printObjectImage&&ui.printObjectId===c.object()?.id)pv.thumbnail=ui.printObjectImage;
   ui.printPreview=pv;ui.printText=text;ui.printFilePath=path||file.name;ui.printUnits=1;ui.printError='';ui.bridgeNew=null;
   ui.view='print';ui.tab='overview';
   if(!quiet)toast(pv.valid?'G-code analizado. Revisa color, tiempo y medidas.':'G-code abierto. Completa el tiempo o los gramos para vincularlo al inventario.');
  }finally{importing=false;}
 }
 async function loadBridge(path,name,{auto=false}={}){
  if(!path)throw Error('Selecciona un G-code de la carpeta del puente.');
  if(ui.printPreview?.path===path&&!auto)return;
  try{const file=await storage.getBridgeFile(path);await importFile(file,{path,quiet:auto});if(auto)toast('Nuevo G-code detectado en el puente.');}
  catch(e){ui.printError=e.message;throw e;}
 }
 async function scanBridge({quiet=false}={}){
  if(scanning||!storage.isNative)return;
  if(!S().settings.bridgeFolder){ui.bridgeFiles=[];ui.bridgeError='';return;}
  scanning=true;
  try{
   const r=await storage.scanBridge(S().settings.bridgeFolder);
   if(r.folder&&r.folder!==S().settings.bridgeFolder){S().settings.bridgeFolder=r.folder;persist();}
   ui.bridgeFiles=r.files||[];ui.bridgeChecked=r.checkedAt||new Date().toISOString();ui.bridgeError='';
   if(!quiet&&ui.view==='print')render();
   const latest=ui.bridgeFiles[0];
   if(latest&&S().settings.bridgeWatch!==false&&ui.view==='print'&&!current()){
    const key=latest.path+'|'+latest.modified;
    if(ui.bridgeAutoKey!==key&&(!preview()||preview().path===latest.path)){ui.bridgeAutoKey=key;await loadBridge(latest.path,latest.name,{auto:true});render();}
    else if(preview()&&preview().path!==latest.path)ui.bridgeNew=latest;
   }
  }catch(e){ui.bridgeError=e.message;if(!quiet){ui.printError=e.message;render();}}
  finally{scanning=false;}
 }
 function recalc(){normalisePreview();persist();render();}
 function applyToObject(){
  const pv=normalisePreview();if(!pv)throw Error('Abre primero un G-code.');
  const o=c.object();if(!o)throw Error('Selecciona un objeto de la estantería.');
  const units=Math.max(1,Math.floor(finite(ui.printUnits,1)));
  if(!pv.filaments.some(f=>f.matId&&finite(f.grams)>0))throw Error('Asigna un filamento y gramos mayores que cero.');
  const filaments=pv.filaments.filter(f=>finite(f.grams)>0).map(f=>({matId:f.matId,grams:finite(f.grams)/units,lengthMm:f.lengthMm!=null?finite(f.lengthMm)/units:null,diameter:S().settings.diameter,color:f.color}));
  o.gcode={valid:true,source:pv.source,name:pv.name,units,minutes:pv.minutes==null?null:finite(pv.minutes)/units,filaments,dims:pv.dims||null,image:pv.thumbnail||null,layers:pv.layers||0,edited:false};
  o.printImage=pv.thumbnail||o.printImage||null;
  if(pv.thumbnail&&!c.box().thumbnail)c.box().thumbnail=pv.thumbnail;
  persist();render();toast('Tiempo, medidas y filamento guardados en el objeto.');
 }
 async function copyToBox(){
  const pv=preview();if(!pv)throw Error('Abre primero un G-code.');const b=c.box();
  if(!b.folder)throw Error('Conecta una carpeta o crea una caja real antes de copiar el G-code.');
  const f=await storage.putFile(new File([ui.printText],pv.name),b);b.files.push(f);
  await flush();persist();render();toast('G-code copiado a la caja.');
 }
 function startDialog(mode){
  const pv=normalisePreview();if(!pv)throw Error('Abre primero un G-code en el puente.');
  if(mode==='usb'&&!pv.valid)throw Error('Para enviar por USB no hace falta inventario, pero el archivo debe abrirse correctamente.');
  if(mode!=='usb'&&!pv.valid)throw Error('Asigna material y gramos antes de iniciar el seguimiento de inventario.');
  if(current())throw Error('Ya hay una impresión activa. Termínala o detenla antes de iniciar otra.');
  const p=printer();if(!p)throw Error('Configura una impresora.');
  const products=S().products.filter(x=>!x.retired);
  const options=[['','No sumar producto terminado'],...products.map(x=>[x.id,`${x.name} · ${x.stock} pzas`])];
  const body=`<div class="panel"><b>${esc(pv.name)}</b><p>${pv.minutes!=null?esc(pv.minutes.toFixed(0))+' min':'Sin tiempo'} · ${pv.grams.toFixed(1)} g · ${pv.filaments.length} filamento(s)</p></div>
   <div class="form-grid section-space">${field('Unidades incluidas en el archivo',ui.printUnits||1,'id="print-start-units" min="1" step="1"')}${select('Al completar, sumar al inventario',options,'','id="print-start-product"')}${mode==='usb'?field('Puerto de la impresora',p.usbManual?p.usbPort:(ui.devices||[]).find(d=>d.id===p.deviceId)?.port||p.deviceId||'Puerto configurado','id="print-start-port" readonly','text'):select('Método de avance',[['time','Tiempo estimado del G-code'],['manual','Manual · confirmar al terminar']],'time','id="print-start-track"')}${field('Nota de la impresión','','id="print-start-note"','text')}</div>
   ${mode==='usb'?'<p class="short-note">Se abrirá el puerto, se consultará el firmware y se enviará el G-code. El avance usará los comandos confirmados. Revisa material, boquilla, temperaturas y cama.</p><label class="field inline"><input type="checkbox" id="print-reviewed"> Revisé el perfil y la impresora física</label>':'<p class="short-note">El inventario se descuenta de forma proporcional. Con el método por tiempo, el 100 % solo se aplica al pulsar Completar impresión.</p>'}`;
  showModal(mode==='usb'?'Revisar e imprimir por USB':'Iniciar seguimiento de impresión',body,btn('Cancelar','close-modal')+btn(mode==='usb'?'Iniciar impresión USB':'Iniciar seguimiento','confirm-print-start','printer','primary',`data-mode="${mode}"`));
 }
 async function confirmStart(el){
  const mode=el.dataset.mode||'track',pv=normalisePreview();if(!pv)throw Error('El G-code ya no está disponible.');
  if(mode==='usb'&&!$('print-reviewed').checked)throw Error('Revisa la impresión y marca la confirmación.');
  const unitsInput=$('print-start-units');if(!unitsInput.checkValidity()||+unitsInput.value<1)throw Error('La cantidad debe ser un entero mayor que cero.');
  const units=Math.max(1,Math.floor(+unitsInput.value)),productId=$('print-start-product').value,note=$('print-start-note').value.trim();
  const track=mode==='usb'?'usb':($('print-start-track')?.value||'manual');
  const filaments=pv.filaments.filter(f=>f.matId&&finite(f.grams)>0).map(f=>({matId:f.matId,grams:finite(f.grams)/units,lengthMm:f.lengthMm!=null?finite(f.lengthMm)/units:null,color:f.color}));
  if(!filaments.length)throw Error('No hay filamento asignado.');
  if(startPending)return;startPending=true;
  let session=null;
  try{
   session=beginPrintSession(S(),{name:pv.name,source:pv.source,boxId:c.box()?.id||'',objectId:c.object()?.id||'',printerId:printer().id,filaments,seconds:pv.minutes!=null?finite(pv.minutes)*60:null,dims:pv.dims,image:pv.thumbnail,track,units,note});
   session.plannedProductId=productId;
   if(mode==='usb'){
    await c.probe?.();
    const connection=usbSelection(printer(),ui.devices||[],$('usb-manual-port')?.value||printer().usbPort);
    ui.printError='';ui.printStatus={state:'connecting',message:`Abriendo ${connection.port}…`};updatePrint();
    await storage.api('print-start',{...connection,text:ui.printText,name:pv.name,baud:baud()});
   }
   ui.printSessionId=session.id;ui.printProductId=productId;closeModal();persist();render();
   toast(mode==='usb'?'Impresión USB iniciada. El inventario se descuenta con el avance confirmado.':'Seguimiento iniciado. El inventario se descuenta con el avance.');
  }catch(e){
   if(session)try{discardPrintSession(S(),session.id);}catch{}
   ui.printError=e.message;ui.printStatus={...ui.printStatus,state:'error',message:e.message};updatePrint();throw e;
  }finally{startPending=false;updatePrint();}
 }
 function completeDialog(){
  const session=current();if(!session)throw Error('No hay una impresión activa.');
  const products=S().products.filter(x=>!x.retired);
  const options=[['','No sumar producto terminado'],...products.map(x=>[x.id,`${x.name} · ${x.stock} pzas`])];
  showModal('Completar impresión',`<p>Se aplicará el 100 % del filamento previsto y la sesión quedará cerrada. Si la impresión falló, usa Detener para conservar solo lo consumido.</p><div class="form-grid">${select('Piezas terminadas a sumar',options,session.plannedProductId||'','id="print-complete-product"')}${field('Nota','','id="print-complete-note"','text')}</div>`,btn('Cancelar','close-modal')+btn('Completar y actualizar inventario','confirm-print-complete','check','primary'));
 }
 function confirmComplete(){
  const session=current();if(!session)throw Error('No hay una impresión activa.');
  const productId=$('print-complete-product').value,note=$('print-complete-note').value.trim();
  finishPrintSession(S(),session.id,{completed:true,productId,qty:session.units||1,note});
  ui.printSessionId=null;ui.printProductId='';closeModal();persist();render();toast(productId?'Impresión completada. Filamento descontado y producto sumado al inventario.':'Impresión completada. Inventario actualizado.');
 }
 function stopDialog(){
  const session=current();if(!session)throw Error('No hay una impresión activa.');
  const usb=session.track==='usb';
  showModal('Detener esta impresión',`<p>La sesión quedará como detenida y conservará únicamente el filamento ya consumido.${usb?' También se solicitará M112 al puerto USB.':''}</p>`,btn('Volver','close-modal')+btn('Detener sesión','confirm-print-stop','close','danger'));
 }
 async function confirmStop(){
  const session=current();if(!session)throw Error('No hay una impresión activa.');
  if(session.track==='usb'&&['checking','connecting','printing','paused','firmware-pause'].includes(ui.printStatus?.state))try{await storage.api('print-control',{action:'stop'});}catch{}
  finishPrintSession(S(),session.id,{completed:false,note:'Detenida desde el puente'});
  ui.printSessionId=null;closeModal();persist();render();toast('Sesión detenida. Se conserva el consumo registrado.');
 }
 async function testUSB(){
  if(startPending||isPrinting()||ui.printStatus?.state==='checking')throw Error('Espera a que termine la conexión o impresión actual.');
  try{await c.probe?.();const connection=usbSelection(printer(),ui.devices||[],$('usb-manual-port')?.value||printer().usbPort);ui.printError='';startPending=true;ui.printStatus={state:'checking',message:`Probando ${connection.port} a ${baud()} baudios…`};updatePrint();await storage.api('usb-test',{...connection,baud:baud()});render();}
  catch(e){ui.printError=e.message;ui.printStatus={...ui.printStatus,state:'error',message:e.message};updatePrint();throw e;}
  finally{startPending=false;updatePrint();}
 }
 function isPrinting(){return startPending||['checking','connecting','printing','paused','firmware-pause'].includes(ui.printStatus?.state);}
 let lastPersist=0;
 async function poll(){
  if(polling||!storage.isNative)return;polling=true;
  try{
   const [print]=await Promise.all([storage.api('print-status')]);if(!startPending){ui.printStatus=print;updatePrint();}
   let changed=false,touched=false;
   for(const session of activePrintSessions(S())){
    if(session.track==='time'&&session.status==='printing'){
     const elapsed=(Date.now()-(Date.parse(session.startedAt||'')||Date.now()))/1000,target=session.seconds?Math.min(.99,elapsed/session.seconds):session.progress;
     if(target>finite(session.progress)+1e-4){advancePrintSession(S(),session.id,target);changed=true;}
    }
    if(session.track==='usb'&&session.id===ui.printSessionId){
     if(print.total){const target=Math.min(.99,finite(print.sent)/finite(print.total));if(target>finite(session.progress)+1e-4){advancePrintSession(S(),session.id,target);changed=true;}}
     if(print.state==='complete'){finishPrintSession(S(),session.id,{completed:true,productId:session.plannedProductId||'',qty:session.units||1});ui.printSessionId=null;changed=true;touched=true;toast('Impresión USB completada. Inventario actualizado.');}
     else if(['stopped','error'].includes(print.state)){finishPrintSession(S(),session.id,{completed:false,note:print.message||'La impresión USB se detuvo'});ui.printSessionId=null;changed=true;touched=true;}
    }
   }
   if(!ui.printSessionId){const only=activePrintSessions(S()).find(x=>x.track==='usb');if(only&&['printing','paused','firmware-pause','connecting'].includes(print.state))ui.printSessionId=only.id;}
   if(changed){const now=Date.now();if(now-lastPersist>6000){lastPersist=now;persist();}if(touched)render();else if(now-(ui.printRenderAt||0)>8000){ui.printRenderAt=now;render();}}
   if(S().settings.bridgeWatch!==false&&ui.view==='print'&&!current())await scanBridge({quiet:true});
  }catch(e){ui.printError=e.message;updatePrint();if(isPrinting())ui.printStatus={...ui.printStatus,message:'No se pudo consultar el estado. Revisa la conexión; no asumas que la impresión se detuvo.'};}
  finally{polling=false;}
 }
 const actions={
  'print-refresh':()=>scanBridge({quiet:false}),
  'bridge-pick':async()=>{const r=await storage.pickBridgeFolder();if(r.canceled)return;S().settings.bridgeFolder=r.path;S().settings.bridgeWatch=true;persist();render();await scanBridge({quiet:false});toast('Carpeta del puente conectada.');},
  'bridge-open':()=>storage.openBridgeFolder(S().settings.bridgeFolder),
  'bridge-import':()=>{const input=$('file-input');input.accept='.gcode,.gco,.g';input.dataset.mode='bridge';input.click();},
  'bridge-load':async el=>{await loadBridge(el.dataset.path,el.dataset.name);render();},
  'print-apply':applyToObject,'print-copy':copyToBox,'print-capture':capture,
  'print-start-track':()=>startDialog('track'),'print-start':()=>startDialog('usb'),
  'confirm-print-start':confirmStart,
  'print-complete':completeDialog,'confirm-print-complete':confirmComplete,
  'print-stop':stopDialog,'confirm-print-stop':confirmStop,
  'print-progress':el=>{const session=current();if(!session)throw Error('No hay una impresión activa.');advancePrintSession(S(),session.id,+el.dataset.value);persist();render();},
  'print-clear':()=>{ui.printPreview=null;ui.printText='';ui.printFilePath='';ui.printUnits=1;ui.printError='';render();},
  'print-void':el=>{const session=printSession(S(),el.dataset.id);if(!session?.ledgerId)throw Error('Esta sesión no tiene movimiento de inventario.');voidTransaction(S(),session.ledgerId);persist();render();toast('Movimiento de impresión anulado y stock restaurado.');},
  'test-usb':testUSB,
  'print-dialog':()=>startDialog('usb'),
  'export-usb-diagnostic':async()=>{const st=ui.printStatus||{},text=['3D-Woods · Diagnóstico USB',new Date().toISOString(),'Perfil: '+printer().printer,'Puerto: '+(st.port||printer().usbPort||printer().deviceId||'Sin seleccionar'),'Baudios: '+baud(),'Estado: '+(st.state||'idle'),ui.printError||st.message||'',st.firmware||'',st.log||''].join('\r\n');await storage.download(new Blob([text],{type:'text/plain;charset=utf-8'}),'3D-Woods-diagnostico-USB.txt');},
  'usb-pause':()=>storage.api('print-control',{action:'pause'}),'usb-resume':()=>storage.api('print-control',{action:'resume'}),
  'usb-stop':()=>ui.printStatus?.state==='checking'?storage.api('print-control',{action:'stop'}):showModal('Detener el envío USB','<p>Se interrumpirá el envío y se solicitará M112. La pieza quedará incompleta. Verifica la parada en la impresora; puede requerir reinicio.</p>',btn('Volver','close-modal')+btn('Detener ahora','confirm-usb-stop','close','danger')),
  'confirm-usb-stop':async()=>{await storage.api('print-control',{action:'stop'});closeModal();toast('Parada solicitada. Verifica la impresora.');},
 };
 async function change(el){
  if(el.id==='print-device'){const p=printer();p.usbManual=el.value==='__manual__';if(!p.usbManual){p.deviceId=el.value;p.usbPort=(ui.devices||[]).find(d=>d.id===el.value)?.port||'';}p.connection='usb';ui.printError='';persist();render();return true;}
  if(el.id==='usb-manual-port'){printer().usbPort=el.value.trim().toUpperCase();ui.printError='';persist();updatePrint();return true;}
  if(el.dataset.printMaterial!=null){const pv=normalisePreview(),f=pv.filaments[+el.dataset.printMaterial],m=S().materials.find(x=>x.id===el.value);f.matId=el.value;if(m)f.color=m.color;persist();render();return true;}
  if(el.dataset.printColor!=null){const pv=normalisePreview();pv.filaments[+el.dataset.printColor].color=el.value;persist();render();return true;}
  if(el.dataset.printGrams!=null){if(!el.checkValidity())throw Error('Revisa los gramos del filamento.');const pv=normalisePreview();pv.filaments[+el.dataset.printGrams].grams=finite(el.value);pv.grams=pv.filaments.reduce((n,f)=>n+finite(f.grams),0);pv.valid=pv.filaments.some(f=>finite(f.grams)>0&&f.matId);persist();render();return true;}
  if(el.id==='print-units'){if(!el.checkValidity()||+el.value<1)throw Error('La cantidad debe ser un entero mayor que cero.');ui.printUnits=Math.max(1,Math.floor(+el.value));if(preview())preview().units=ui.printUnits;persist();render();return true;}
  if(el.id==='print-minutes'){if(!el.checkValidity())throw Error('Revisa el tiempo del G-code.');if(preview())preview().minutes=finite(el.value);persist();render();return true;}
  if(el.id?.startsWith('print-dim-')){if(!el.checkValidity())throw Error('Revisa las medidas del G-code.');if(preview()){preview().dims??=[0,0,0];preview().dims[{x:0,y:1,z:2}[el.id.at(-1)]]=finite(el.value);}persist();render();return true;}
  if(el.id==='print-start-product'){ui.printProductId=el.value;return true;}
  return false;
 }
 async function importFromInput(file){await importFile(file);render();}
 return {actions,change,mount,dispose,poll,isPrinting,isBusy:()=>startPending||importing||scanning,importFile:importFromInput,scanBridge,
  reconcile:()=>{const changed=reconcilePrintSessions(S(),{usbActive:isPrinting(),usbSession:ui.printSessionId});const first=activePrintSessions(S())[0];if(first)ui.printSessionId=first.id;if(changed)persist();},
  loadBridge};
}
