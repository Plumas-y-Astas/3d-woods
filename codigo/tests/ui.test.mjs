import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {defaults} from '../dist/core.js';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('Local desktop UI: bridge G-code, live inventory, USB printing and persisted state',async()=>{
 const html=(await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace('<head>','<head><meta name="woods-desktop" content="1">');
 const dom=new JSDOM(html,{url:'http://127.0.0.1:31337/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
 for(const k of ['window','document','location','DOMParser'])globalThis[k]=dom.window[k];
 dom.window.scrollTo=()=>{};dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
 globalThis.ResizeObserver=class{observe(){}disconnect(){}};
 const oldError=console.error;console.error=(...a)=>{if(!String(a[0]).includes('THREE.WebGLRenderer'))oldError(...a);};
 const oldInterval=globalThis.setInterval;globalThis.setInterval=(...a)=>oldInterval(...a).unref();
 const oldFetch=globalThis.fetch;let saved=null,printState={state:'idle'},printRequest=null,usbTestRequest=null,rejectStart=false,bridgeScanRequest=null;
 const fileMap=new Map();
 const gcodeText=';FLAVOR:Marlin\n;TIME:1200\n;Filament used: 2m\n;MINX:0\n;MAXX:20\n;MINY:0\n;MAXY:30\n;MINZ:0\n;MAXZ:10\n;LAYER_COUNT:5\nG21\nG90\nM82\nG92 E0\nG1 Z0.2\nG1 X20 Y20 E1\nM104 S0\nM140 S0\n';
 const bridgeFile='C:\\Bridge\\impresion.gcode';
 globalThis.fetch=async(path,options={})=>{
  const route=String(path);if(route.startsWith('data:'))return oldFetch(path,options);
  let data;
  if(route==='/api/state'){if(options.method==='POST'){saved=JSON.parse(options.body);data={saved:true};}else data={state:saved||defaults(),root:'C:\\Models'};}
  else if(route==='/api/printers')data={devices:[{id:'USB-TEST',hardwareId:'USB-TEST',name:'Impresora de prueba',port:'COM8',status:'OK'}],statuses:{},checkedAt:new Date().toISOString()};
  else if(route==='/api/bridge/scan'){bridgeScanRequest=JSON.parse(options.body||'{}');data={folder:bridgeScanRequest.folder||'C:\\Bridge',files:[{path:bridgeFile,name:'impresion.gcode',size:gcodeText.length,modified:Date.now(),rel:'impresion.gcode'}],checkedAt:new Date().toISOString()};}
  else if(route.startsWith('/api/bridge/file?')){const id=new URL('http://test'+route).searchParams.get('path');return new Response(fileMap.get(id)||new File([gcodeText],'impresion.gcode'));}
  else if(route==='/api/bridge/choose')data={path:'C:\\Bridge'};
  else if(route==='/api/bridge/open')data={opened:true,folder:'C:\\Bridge'};
  else if(route==='/api/print-status')data=printState;
  else if(route==='/api/usb-test'){usbTestRequest=JSON.parse(options.body);printState={kind:'probe',state:'connected',message:'USB respondió',firmware:'FIRMWARE_NAME:Marlin',log:'M115\nFIRMWARE_NAME:Marlin\nok'};data={started:true};}
  else if(route==='/api/print-start'){if(rejectStart){rejectStart=false;return new Response('COM8 ocupado: cierra el programa que usa el puerto',{status:400});}printRequest=JSON.parse(options.body);printState={state:'printing',message:'Imprimiendo prueba',total:100,sent:10};data={started:true};}
  else if(route==='/api/print-control'){const action=JSON.parse(options.body).action;printState={...printState,state:action==='stop'?'stopped':action==='pause'?'paused':'printing'};data={accepted:true};}
  else if(route==='/api/scan')data={root:'C:\\Models',boxes:[]};
  else if(route==='/api/trash-box')data={removed:true,trash:'C:\\Models\\.3dwoods-papelera'};
  else if(route==='/api/box'){const input=JSON.parse(options.body);input.box.folder=input.name;data={box:input.box};}
  else if(route==='/api/upload'){const f=options.body.get('file'),folder=options.body.get('folder'),id=folder+'/'+f.name;fileMap.set(id,f);data={id,name:f.name,size:f.size,modified:Date.now()};}
  else if(route.startsWith('/api/file?')){const id=new URL('http://test'+route).searchParams.get('path');return new Response(fileMap.get(id));}
  else throw Error('Unexpected route: '+route);
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 };
 const click=sel=>{const el=document.querySelector(sel);assert.ok(el,'Missing '+sel);el.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));};
 const change=(sel,value)=>{const el=document.querySelector(sel);assert.ok(el,'Missing '+sel);el.value=value;el.dispatchEvent(new window.Event('change',{bubbles:true}));};
 const flush=()=>window.woodsBeforeClose();
 try{
  await import('../dist/app.js');await wait(120);assert.equal(document.querySelectorAll('.box-card').length,6);
  assert.equal(document.querySelector('#inspector'),null);
  assert.equal(document.querySelectorAll('.cube-face').length,36);assert.equal(document.querySelectorAll('.rack-row').length,2);assert.equal(document.querySelectorAll('.rack-slots').length,2);assert.ok([...document.querySelectorAll('.rack-slots')].every(x=>x.children.length===5));
  click('[data-action="select-box"][data-id="leaf"]');await wait(30);assert.equal(document.querySelector('#inspector'),null);await wait(700);assert.equal(document.querySelectorAll('.tabs').length,0);assert.ok(document.querySelector('#inspector').textContent.includes('Llavero hoja'));
  click('[data-action="confirm-box"]');await wait(30);assert.ok(document.querySelector('.tabs'));
  click('[data-action="nav"][data-view="shelf"]');click('[data-action="new-box"]');document.getElementById('new-box-name').value='Mi caja local';click('[data-action="create-box"]');await wait(100);assert.ok(document.querySelector('h1').textContent.includes('Mi caja local'));
  // Categories can be created, assigned, renamed and deleted without losing boxes.
  click('[data-action="nav"][data-view="shelf"]');await wait(30);click('[data-action="new-category"]');document.getElementById('category-name').value='Pruebas';click('[data-action="create-category"]');await wait(420);
  assert.ok(saved.categories.includes('Pruebas'));assert.ok(document.querySelector('[data-filter="Pruebas"]'));
  const localBoxId=saved.boxes[0].id;click('[data-action="filter"][data-filter="Todo"]');await wait(20);click(`[data-action="select-box"][data-id="${localBoxId}"]`);await wait(750);click('[data-action="confirm-box"]');await wait(80);
  change('[data-box-field="category"]','Pruebas');await wait(420);assert.equal(saved.boxes[0].category,'Pruebas');
  click('[data-action="nav"][data-view="settings"]');await wait(30);click('[data-action="rename-category"][data-name="Pruebas"]');document.getElementById('category-name').value='Ideas';click('[data-action="save-category"]');await wait(420);
  assert.ok(saved.categories.includes('Ideas'));assert.equal(saved.boxes[0].category,'Ideas');
  click('[data-action="delete-category"][data-name="Ideas"]');click('[data-action="confirm-delete-category"]');await wait(420);
  assert.ok(!saved.categories.includes('Ideas'));assert.equal(saved.boxes[0].category,'Sin categoría');
  click('[data-action="nav"][data-view="shelf"]');await wait(20);click(`[data-action="select-box"][data-id="${localBoxId}"]`);await wait(750);click('[data-action="confirm-box"]');await wait(80);
  const f=new File(['solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 20 0 0\nvertex 0 40 10\nendloop\nendfacet\nendsolid triangle'],'modelo.stl');
  // A reported size above the old 150 MB cap must still import; only the real bytes are parsed.
  Object.defineProperty(f,'size',{value:151*1024*1024});
  click('[data-action="import"]');const input=document.getElementById('file-input');Object.defineProperty(input,'files',{value:[f],configurable:true});input.dispatchEvent(new window.Event('change',{bubbles:true}));await wait(30);click('[data-action="do-import"]');await wait(160);assert.equal(fileMap.size,1);assert.equal(saved.boxes[0].objects[0].parts.length,1);assert.deepEqual(saved.boxes[0].objects[0].parts[0].dims,[20,40,10]);
  click('[data-action="tab"][data-tab="cost"]');await wait(20);assert.ok(document.querySelector('[data-action="save-quote"]').disabled);
  change('[data-prop="grams"]','20');await wait(20);change('[data-prop="hours"]','1');await wait(20);change('[data-prop="extraMinutes"]','30');await wait(20);assert.equal(document.querySelector('[data-action="save-quote"]').disabled,false);
  change('[data-object="orderQty"]','10');await wait(20);click('[data-action="multiplier"][data-value="3"]');await wait(20);click('[data-action="save-quote"]');await wait(450);assert.equal(saved.quotes.length,1);assert.equal(saved.quotes[0].qty,10);assert.equal(saved.quotes[0].multiplier,3);assert.equal(saved.quotes[0].minutes,900);
  click('[data-action="theme"]');assert.equal(document.documentElement.dataset.theme,'dark');
  await flush();assert.equal(saved.theme,'dark');assert.equal(saved.boxes[0].objects[0].parts[0].grams,20);
  click('[data-action="tab"][data-tab="parts"]');change('[data-prop="position"][data-axis="0"]','-10');await wait(30);await flush();assert.equal(saved.boxes[0].objects[0].parts[0].position[0],-10);

  // Exercise the real inventory forms and persisted financial transactions.
  const localBox=saved.boxes[0],localObject=localBox.objects[0],stockBefore=saved.materials.find(m=>m.id==='forest').stock;
  click('[data-action="nav"][data-view="inventory"]');click('[data-action="inventory-tab"][data-tab="supplies"]');click('[data-action="new-supply"]');document.getElementById('supply-name').value='Imán';document.getElementById('supply-cost').value='2';document.getElementById('supply-pack').value='10';document.getElementById('supply-min').value='3';click('[data-action="save-supply"]');await flush();
  const supply=saved.supplies.find(x=>x.name==='Imán');assert.ok(supply);assert.equal(supply.stock,0);
  click(`[data-action="purchase"][data-id="${supply.id}"]`);assert.equal(document.getElementById('purchase-units').value,'10');click('[data-action="confirm-purchase"]');await wait(50);assert.equal(saved.supplies.find(x=>x.id===supply.id).stock,10);assert.equal(saved.ledger[0].total,20);
  click('[data-action="nav"][data-view="calculator"]');click('[data-action="assign-supply"]');document.getElementById('extra-supply').value=supply.id;document.getElementById('extra-units').value='2';click('[data-action="confirm-assign-supply"]');await wait(30);
  click('[data-action="nav"][data-view="pos"]');click('[data-action="pos-source"][data-source="models"]');click(`[data-action="pos-add"][data-id="${localObject.id}"]`);await wait(20);change('[data-pos-qty="0"]','3');await wait(20);change('[data-pos-price="0"]','100');await wait(20);assert.equal(document.querySelector('[data-action="pos-checkout"]').disabled,false);click('[data-action="pos-checkout"]');document.getElementById('payment-received').value='500';click('[data-action="confirm-checkout"]');click('[data-action="confirm-checkout"]');await wait(80);
  const sale=saved.ledger.find(t=>t.type==='sale');assert.equal(saved.ledger.filter(t=>t.type==='sale').length,1);assert.equal(sale.total,300);assert.equal(sale.payment.change,200);assert.equal(saved.supplies.find(x=>x.id===supply.id).stock,4);assert.ok(Math.abs(saved.materials.find(m=>m.id==='forest').stock-(stockBefore-66))<1e-6);assert.ok(document.querySelector('.receipt').textContent.includes('W-000001'));
  click('[data-action="close-modal"]');click('[data-action="pos-tab"][data-tab="history"]');click(`[data-action="void-transaction"][data-id="${sale.id}"]`);click('[data-action="confirm-void"]');await wait(60);assert.equal(saved.supplies.find(x=>x.id===supply.id).stock,10);assert.equal(saved.materials.find(m=>m.id==='forest').stock,stockBefore);assert.ok(saved.ledger.find(t=>t.id===sale.id).voided);
  // Product counts, finished production and a second sale use different stock.
  click('[data-action="nav"][data-view="inventory"]');click('[data-action="inventory-tab"][data-tab="products"]');click('[data-action="new-product"]');change('#stock-source',localBox.id+'|'+localObject.id);await wait(20);document.getElementById('stock-sku').value='PR-01';document.getElementById('stock-qty').value='2';document.getElementById('stock-price').value='100';click('[data-action="save-stock-item"]');await wait(80);const product=saved.products[0];assert.equal(product.stock,2);
  click(`[data-action="produce-product"][data-id="${product.id}"]`);click('[data-action="confirm-production"]');await wait(80);assert.equal(saved.products[0].stock,3);const afterProduction=saved.materials.find(m=>m.id==='forest').stock;
  click('[data-action="nav"][data-view="pos"]');click('[data-action="pos-tab"][data-tab="sale"]');click('[data-action="pos-source"][data-source="products"]');click(`[data-action="pos-add"][data-id="${product.id}"]`);click('[data-action="pos-checkout"]');click('[data-action="confirm-checkout"]');await wait(80);assert.equal(saved.products[0].stock,2);assert.equal(saved.materials.find(m=>m.id==='forest').stock,afterProduction);click('[data-action="close-modal"]');
  // Open tickets survive navigation, keep their number and requested color, then can be returned and cut.
  click('[data-action="nav"][data-view="pos"]');click('[data-action="pos-tab"][data-tab="sale"]');click('[data-action="pos-source"][data-source="products"]');click(`[data-action="pos-add"][data-id="${product.id}"]`);await wait(30);
  assert.ok(document.querySelector('.pos-draft-chip').textContent.includes('W-000003'));change('[data-pos-color="0|0"]','ivory');await wait(30);await flush();
  assert.equal(saved.posDrafts.length,1);assert.equal(saved.posDrafts[0].number,'W-000003');assert.equal(saved.posDrafts[0].cart[0].requestedColor,'ivory');
  click('[data-action="nav"][data-view="inventory"]');click('[data-action="nav"][data-view="pos"]');await wait(30);assert.ok(document.querySelector('.pos-ticket-head').textContent.includes('W-000003'));
  click('[data-action="pos-checkout"]');click('[data-action="confirm-checkout"]');await wait(80);
  const resumed=saved.ledger.find(t=>t.ticket==='W-000003');assert.ok(resumed);assert.equal(resumed.lines[0].requestedColorName,'PLA · Marfil');assert.equal(saved.products[0].stock,1);assert.equal(saved.posDrafts.length,0);click('[data-action="close-modal"]');
  click('[data-action="pos-tab"][data-tab="history"]');click(`[data-action="return-sale"][data-id="${resumed.id}"]`);click('[data-action="confirm-return"]');await wait(80);
  assert.ok(saved.ledger.some(t=>t.type==='return'&&t.saleId===resumed.id));assert.equal(saved.products[0].stock,2);assert.ok(document.querySelector('.receipt').textContent.includes('REEMBOLSO'));click('[data-action="close-modal"]');
  click('[data-action="pos-tab"][data-tab="cuts"]');click('[data-action="partial-cut"]');document.getElementById('cut-note').value='Turno de prueba';click('[data-action="confirm-cut"]');await wait(80);
  assert.equal(saved.cashCuts.length,1);assert.equal(saved.cashCuts[0].type,'partial');assert.ok(document.querySelector('.receipt.cut-summary'));click('[data-action="close-modal"]');click('[data-action="pos-tab"][data-tab="sale"]');
  // New printer profiles can be switched without losing their bed or cost parameters.
  click('[data-action="nav"][data-view="settings"]');assert.ok(document.querySelector('main').textContent.includes('Mis impresoras'));click('[data-action="new-printer"]');document.getElementById('printer-name').value='Mi segunda impresora';click('[data-action="create-printer"]');await wait(30);change('[data-setting="bedX"]','300');await wait(30);change('[data-setting="power"]','240');await wait(30);await flush();const printerId=saved.activePrinterId;assert.equal(saved.printers.find(p=>p.id===printerId).bedX,300);const oldPrinter=saved.printers[0].id;
  click(`[data-action="use-printer"][data-id="${oldPrinter}"]`);await wait(30);assert.equal(document.querySelector('[data-setting="bedX"]').value,'220');click(`[data-action="use-printer"][data-id="${printerId}"]`);await wait(30);assert.equal(document.querySelector('[data-setting="power"]').value,'240');

  // The universal bridge reads external G-code, applies it to the object and tracks inventory.
  click('[data-action="nav"][data-view="print"]');await wait(50);assert.ok(document.querySelector('#print-viewer'));assert.ok(document.querySelector('[data-action="bridge-import"]'));
  click('[data-action="bridge-import"]');const gcode=new File([gcodeText],'impresion.gcode');const ginput=document.getElementById('file-input');Object.defineProperty(ginput,'files',{value:[gcode],configurable:true});ginput.dispatchEvent(new window.Event('change',{bubbles:true}));await wait(120);
  assert.ok(document.querySelector('#print-minutes'));assert.equal(document.querySelector('#print-minutes').value,'20');assert.ok(document.querySelector('main').textContent.includes('G-CODE LISTO'));
  change('#print-units','2');await wait(40);click('[data-action="print-apply"]');await wait(80);await flush();
  const bridged=saved.boxes.find(b=>b.id===localBox.id).objects[0];assert.equal(bridged.gcode.minutes,10);assert.equal(bridged.gcode.units,2);assert.ok(bridged.gcode.filaments[0].grams>0);assert.deepEqual(bridged.gcode.dims,[20,30,10]);
  const forestBefore=saved.materials.find(m=>m.id==='forest').stock;
  click('[data-action="print-start-track"]');await wait(30);assert.ok(document.getElementById('print-start-track'));click('[data-action="confirm-print-start"]');await wait(500);await flush();
  assert.equal(saved.printSessions.length,1);assert.equal(saved.printSessions[0].status,'printing');assert.equal(saved.printSessions[0].track,'time');
  click('[data-action="print-progress"][data-value="0.50"]');await wait(500);await flush();assert.equal(saved.printSessions[0].progress,0.5);assert.ok(saved.materials.find(m=>m.id==='forest').stock<forestBefore);
  click('[data-action="print-complete"]');await wait(30);document.getElementById('print-complete-product').value=product.id;click('[data-action="confirm-print-complete"]');await wait(500);await flush();
  assert.equal(saved.printSessions[0].status,'completed');assert.equal(saved.products[0].stock,4);assert.ok(saved.ledger.some(t=>t.type==='print'&&t.sessionId===saved.printSessions[0].id));
  // USB diagnostics keep the manual COM port and the same G-code.
  change('#print-device','USB-TEST');await wait(20);change('#print-device','__manual__');await wait(20);change('#usb-manual-port','com12');await wait(20);click('[data-action="test-usb"]');await wait(1600);assert.equal(usbTestRequest.port,'COM12');assert.equal(usbTestRequest.manual,true);assert.ok(document.getElementById('usb-log').textContent.includes('FIRMWARE_NAME:Marlin'));
  change('#print-device','USB-TEST');await wait(20);click('[data-action="print-start"]');await wait(30);assert.ok(document.getElementById('print-reviewed'));document.getElementById('print-reviewed').checked=true;rejectStart=true;click('[data-action="confirm-print-start"]');await wait(80);assert.ok(document.getElementById('usb-error').textContent.includes('COM8 ocupado'));await wait(1600);assert.ok(document.getElementById('usb-error').textContent.includes('COM8 ocupado'));
  click('[data-action="confirm-print-start"]');await wait(80);assert.equal(printRequest.port,'COM8');assert.equal(printRequest.manual,false);assert.ok(printRequest.text.includes(';TIME:1200'));await assert.rejects(flush,/impresión USB activa/);
  await wait(1600);click('[data-action="usb-stop"]');click('[data-action="confirm-usb-stop"]');await wait(1600);await flush();assert.equal(printState.state,'stopped');assert.equal(saved.printSessions.find(s=>s.track==='usb').status,'stopped');
  // The bridge folder can be configured and scanned from the page.
  change('[data-setting="bridgeFolder"]','C:\\Bridge');await wait(30);click('[data-action="print-refresh"]');await wait(120);await flush();assert.equal(saved.settings.bridgeFolder,'C:\\Bridge');assert.equal(bridgeScanRequest.folder,'C:\\Bridge');assert.ok(document.querySelector('main').textContent.includes('impresion.gcode'));
 }finally{console.error=oldError;globalThis.setInterval=oldInterval;globalThis.fetch=oldFetch;dom.window.close();}
});
