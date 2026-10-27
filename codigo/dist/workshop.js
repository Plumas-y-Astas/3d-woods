import {uid,defaults,calculate,finite,materialColors} from './core.js';
export const PROFILE_KEYS=['printer','bedX','bedY','bedZ','power','nominalPower','machineCost','lifeHours','replacements','replacementHours','diameter','density'];
const positive=(v,label,zero=false)=>{const n=Number(v);if(!Number.isFinite(n)||(zero?n<0:n<=0))throw Error(`Revisa ${label}.`);return n;};
const ticketSerial=value=>{const match=String(value||'').match(/(\d+)\s*$/);return match?Number(match[1]):0;};
const ticketLabel=n=>'W-'+String(n).padStart(6,'0');
const usedTicket=sale=>Math.max(...[sale.ticketSerial,...(sale.ledger||[]).filter(t=>t.type==='sale').map(t=>ticketSerial(t.ticket)),...(sale.posDrafts||[]).map(d=>ticketSerial(d.number)),0].filter(Number.isFinite));
export function peekTicket(s){return ticketLabel(usedTicket(s)+1);}
export function claimTicket(s){const n=usedTicket(s)+1;s.ticketSerial=n;return ticketLabel(n);}
export function migrate(s){
 s.settings={...defaults().settings,...s.settings};s.quotes??=[];s.supplies??=[];s.products??=[];s.assets??=[];s.ledger??=[];s.printSessions??=[];
 s.posDrafts??=[];s.cashCuts??=[];
 s.printers??=[{id:uid(),...Object.fromEntries(PROFILE_KEYS.map(k=>[k,s.settings[k]])),connection:'none',deviceId:'',host:'',port:80}];
 if(!s.printers.some(p=>p.id===s.activePrinterId))s.activePrinterId=s.printers[0]?.id;
 for(const m of s.materials){m.minStock??=100;m.colors=materialColors(m);m.color=m.colors[0];}
 const reserved=['todo','favoritos','armables'],categoryMap=new Map();
 const addCategory=value=>{const name=String(value??'').trim(),key=name.toLocaleLowerCase('es');if(!name||reserved.includes(key)||categoryMap.has(key))return;categoryMap.set(key,name);};
 addCategory('Sin categoría');
 for(const c of Array.isArray(s.categories)?s.categories:[])addCategory(c);
 for(const b of s.boxes||[])addCategory(b.category);
 s.categories=[...categoryMap.values()].slice(0,100);
 const canonicalCategory=value=>{const name=categoryMap.get(String(value??'').trim().toLocaleLowerCase('es'));return name&&s.categories.includes(name)?name:'Sin categoría';};
 for(const b of s.boxes||[])b.category=canonicalCategory(b.category);
 s.posDrafts=s.posDrafts.filter(d=>d&&typeof d.id==='string').map(d=>({...d,number:typeof d.number==='string'?d.number:'',customer:String(d.customer||''),note:String(d.note||''),reserve:d.reserve!==false,cart:Array.isArray(d.cart)?d.cart.filter(l=>l&&['product','model'].includes(l.kind)&&Number.isFinite(+l.qty)&&+l.qty>0):[],createdAt:d.createdAt||new Date().toISOString(),updatedAt:d.updatedAt||d.createdAt||new Date().toISOString()}));
 s.cashCuts=Array.isArray(s.cashCuts)?s.cashCuts.filter(c=>c&&typeof c.id==='string'&&['partial','full'].includes(c.type)):[];
 let serial=usedTicket(s);for(const d of s.posDrafts){const number=ticketSerial(d.number);if(number>serial)serial=number;}
 for(const d of s.posDrafts)if(!ticketSerial(d.number))d.number=ticketLabel(++serial);
 s.ticketSerial=Math.max(finite(s.ticketSerial),serial);
 const firstDate=(s.ledger||[]).map(t=>Date.parse(t.date)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
 s.cashCutStart=s.cashCutStart&&Number.isFinite(Date.parse(s.cashCutStart))?s.cashCutStart:new Date(firstDate||0).toISOString();
 // Old per-object accessories become a shared supply, with no invented stock.
 for(const b of s.boxes)for(const o of b.objects)for(const e of o.extras||[]){
  if(Object.hasOwn(e,'supplyId'))continue;
  let item=s.supplies.find(x=>x.name.toLocaleLowerCase()===e.name.toLocaleLowerCase());
  if(!item){item={id:uid(),name:e.name,unit:'pzas',stock:0,minStock:10,unitCost:e.price,packUnits:100};s.supplies.push(item);}
  e.supplyId=item.id;
 }
 s.schemaRevision=6;syncSupplyPrices(s);validateWorkshop(s);return s;
}
export function syncSupplyPrices(s){for(const b of s.boxes)for(const o of b.objects)for(const e of o.extras||[]){const item=s.supplies.find(x=>x.id===e.supplyId);if(item){e.name=item.name;e.price=item.unitCost;}}}
export function validateWorkshop(s){
 for(const key of ['supplies','products','assets','ledger','printers'])if(!Array.isArray(s[key])||s[key].length>100000)throw Error('Datos del taller inválidos.');
 if(s.printers.length<1||s.printers.length>32)throw Error('Se requiere entre 1 y 32 perfiles de impresora.');
 const ids=new Set();for(const m of [...s.materials,...s.supplies,...s.products,...s.assets]){if(typeof m.id!=='string'||ids.has(m.id)||typeof m.name!=='string')throw Error('Identificador de inventario inválido o repetido.');ids.add(m.id);positive(m.stock,'existencias',true);positive(m.minStock??0,'aviso de stock',true);if(s.materials.includes(m)&&m.colors!=null&&(!Array.isArray(m.colors)||m.colors.length>16||m.colors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c))))throw Error('Colores del filamento inválidos.');if(!s.materials.includes(m)){positive(m.unitCost,'costo del insumo',true);positive(m.packUnits,'tamaño del paquete');}}
 for(const p of s.printers){if(typeof p.id!=='string'||typeof p.printer!=='string'||!['none','usb','network'].includes(p.connection))throw Error('Perfil de impresora inválido.');for(const k of PROFILE_KEYS.filter(k=>k!=='printer'))positive(p[k],k,true);}
 for(const t of s.ledger){if(!['sale','return','purchase','production','adjustment','print'].includes(t.type)||!Array.isArray(t.movements)||typeof t.id!=='string')throw Error('Movimiento inválido.');positive(t.total,'importe',true);positive(t.cost??0,'costo',true);if(!['MXN','USD','EUR'].includes(t.currency))throw Error('Moneda de movimiento inválida.');for(const m of t.movements){if(!['material','supply','product','asset'].includes(m.kind))throw Error('Inventario inválido.');positive(m.units,'cantidad');if(m.delta!=null&&!Number.isFinite(m.delta))throw Error('Movimiento de stock inválido.');if(typeof m.id!=='string')throw Error('Referencia de inventario inválida.');}if(t.type==='return'&&(typeof t.saleId!=='string'||!Array.isArray(t.items)))throw Error('Devolución inválida.');}
 for(const ps of s.printSessions){if(typeof ps.id!=='string'||!['printing','paused','completed','stopped','interrupted'].includes(ps.status)||!Array.isArray(ps.filaments))throw Error('Sesión de impresión inválida.');positive(ps.progress??0,'avance',true);if(ps.progress>1)throw Error('Avance de impresión inválido.');for(const f of ps.filaments){positive(f.grams,'gramos',true);positive(f.consumed??0,'consumo',true);if(f.matId!=null&&typeof f.matId!=='string')throw Error('Filamento de impresión inválido.');}}
 for(const d of s.posDrafts){if(typeof d.id!=='string'||typeof d.number!=='string'||!Array.isArray(d.cart)||d.cart.length>500)throw Error('Ticket abierto inválido.');for(const l of d.cart){if(!['product','model'].includes(l.kind)||typeof l.name!=='string'||!Number.isInteger(+l.qty)||+l.qty<1)throw Error('Línea de ticket inválida.');positive(l.unitPrice,'precio',true);}}
 for(const c of s.cashCuts){if(typeof c.id!=='string'||typeof c.number!=='string'||!['partial','full'].includes(c.type)||!c.report||typeof c.report!=='object')throw Error('Corte de caja inválido.');}
 return s;
}
export function setPrinter(s,id){const p=s.printers.find(x=>x.id===id);if(!p)throw Error('Impresora no disponible.');s.activePrinterId=id;for(const k of PROFILE_KEYS)s.settings[k]=p[k];}
export function saveActivePrinter(s){const p=s.printers.find(x=>x.id===s.activePrinterId);if(p)for(const k of PROFILE_KEYS)p[k]=s.settings[k];}
export const stockList=(s,kind)=>({material:s.materials,supply:s.supplies,product:s.products,asset:s.assets})[kind]||[];
export const stockItem=(s,kind,id)=>stockList(s,kind).find(x=>x.id===id);
export function alerts(s){return [...s.materials.map(m=>({...m,kind:'material',unit:'g'})),...s.supplies.map(m=>({...m,kind:'supply'})),...s.products.map(m=>({...m,kind:'product',unit:'pzas'})),...s.assets.map(m=>({...m,kind:'asset'}))].filter(m=>!m.retired&&m.stock<=m.minStock);}
export function salePreview(s,cart,reserve=true){
 syncSupplyPrices(s);if(!cart.length)throw Error('Agrega al menos un producto al ticket.');
 const movements=new Map(),lines=[];let total=0,cost=0;
 const add=(map,kind,id,units)=>{if(!units)return;const item=stockItem(s,kind,id);if(!item||item.retired)throw Error('Asigna los materiales e insumos del objeto antes de vender.');const key=kind+':'+id,m=map.get(key)||{kind,id,name:item.name,unit:kind==='material'?'g':item.unit||'pzas',units:0};m.units+=units;map.set(key,m);};
 for(const line of cart){
  const qty=positive(line.qty,'cantidad');if(!Number.isInteger(qty))throw Error('La cantidad de objetos debe ser entera.');const unitPrice=positive(line.unitPrice,'precio',true),lineMovements=new Map();
  if(line.kind==='product'){
   const product=stockItem(s,'product',line.productId);if(!product||product.retired)throw Error('El producto ya no está disponible.');
   add(lineMovements,'product',product.id,qty);
   const requested=line.requestedColor?stockItem(s,'material',line.requestedColor):null;
   const saved={kind:'product',productId:product.id,name:product.name,sku:product.sku||'',qty,unitPrice,unitCost:product.unitCost,requestedColor:requested?.id||'',requestedColorName:requested?.name||'',requestedColors:requested?materialColors(requested):[],movements:[...lineMovements.values()]};
   lines.push(saved);total+=qty*unitPrice;cost+=qty*product.unitCost;for(const m of lineMovements.values())add(movements,m.kind,m.id,m.units);continue;
  }
  const b=s.boxes.find(x=>x.id===line.boxId),o=b?.objects.find(x=>x.id===line.objectId);if(!o)throw Error('Un objeto del pedido ya no existe.');
  const calc=calculate(o,s.materials,s.settings,qty,o.multiplier);if(calc.missing)throw Error(`Lamina o completa gramos y tiempos de ${o.name}.`);
  const requestColors=Array.isArray(line.colors)?line.colors:[],selected=[];
  let selectedFilament=0;
  calc.requirements.rows.forEach((row,index)=>{
   const chosen=requestColors[index]?stockItem(s,'material',requestColors[index]):null;
   const material=chosen||stockItem(s,'material',row.id);
   if(!material||material.retired)throw Error(`El color ${index+1} de ${o.name} ya no está disponible.`);
   add(lineMovements,'material',material.id,reserve?row.reserve:row.grams);
   selectedFilament+=(row.grams/qty)*finite(material.price)/Math.max(1,finite(material.spoolGrams,1000));
   selected.push({index,matId:material.id,name:material.name,color:material.color,colors:materialColors(material)});
  });
  for(const e of o.extras||[])if(e.qty>0)add(lineMovements,'supply',e.supplyId,e.qty*qty);
  const lineCost=calc.cost+(selectedFilament-calc.filament)*(1+finite(s.settings.error)/100);
  const saved={kind:'model',boxId:b.id,objectId:o.id,name:o.name,qty,unitPrice,unitCost:lineCost,colors:selected.map(c=>c.matId),colorRequests:selected,movements:[...lineMovements.values()]};
  lines.push(saved);total+=qty*unitPrice;cost+=qty*lineCost;for(const m of lineMovements.values())add(movements,m.kind,m.id,m.units);
 }
 if(!Number.isFinite(total)||!Number.isFinite(cost))throw Error('El importe supera el límite admitido.');
 const rows=[...movements.values()].map(m=>({...m,available:stockItem(s,m.kind,m.id).stock,shortage:Math.max(0,m.units-stockItem(s,m.kind,m.id).stock),delta:-m.units}));
 return {lines,movements:rows,total,cost,shortages:rows.filter(m=>m.shortage>1e-6)};
}
const movementDelta=(t,m)=>m.delta??(['purchase','return'].includes(t.type)?m.units:-m.units);
function applyMovements(s,movements,multiplier=1){const combined=new Map();for(const m of movements){const key=m.kind+':'+m.id;combined.set(key,{...m,delta:(combined.get(key)?.delta||0)+m.delta*multiplier});}for(const m of combined.values()){const item=stockItem(s,m.kind,m.id);if(!item)throw Error('No existe el artículo '+m.name);if(!Number.isFinite(item.stock+m.delta)||item.stock+m.delta < -1e-6)throw Error('Parte de este stock ya se consumió: '+m.name);}for(const m of combined.values()){const item=stockItem(s,m.kind,m.id);item.stock=Math.max(0,item.stock+m.delta);}}
export function recordSale(s,cart,{reserve=true,note='',customer='',payment=null,ticket=''}={}){
 const p=salePreview(s,cart,reserve);if(p.shortages.length)throw Error('Stock insuficiente: '+p.shortages.map(m=>`${m.name} (${m.shortage.toFixed(2)} ${m.unit})`).join(', '));
 const method=payment?.method||'registro',received=payment?positive(payment.received,'importe recibido',true):p.total;if(!['efectivo','tarjeta','transferencia','registro'].includes(method))throw Error('Forma de pago inválida.');if(received+1e-6<p.total)throw Error('El importe recibido no cubre el total.');
 const explicit=String(ticket||'').trim();if(explicit&&s.ledger.some(t=>t.type==='sale'&&t.ticket===explicit))throw Error('Ese número de ticket ya fue cobrado.');
 const number=explicit||claimTicket(s),serial=ticketSerial(number);s.ticketSerial=Math.max(finite(s.ticketSerial),serial);
 const t={id:uid(),ticket:number,type:'sale',date:new Date().toISOString(),currency:s.currency,note,customer,printerId:s.activePrinterId,payment:{method,received,change:received-p.total},...p};delete t.shortages;applyMovements(s,t.movements);s.ledger.push(t);return t;
}
export function recordPurchase(s,{kind,id,packs,packUnits,total,note=''}){
 const item=stockItem(s,kind,id);if(!item||item.retired)throw Error('Selecciona un artículo activo.');packs=positive(packs,'paquetes');packUnits=positive(packUnits,'contenido del paquete');total=positive(total,'importe',true);if(!Number.isInteger(packs))throw Error('La cantidad de paquetes debe ser entera.');const units=packs*packUnits;if(kind==='product'&&!Number.isInteger(units))throw Error('Las piezas terminadas se cuentan en unidades enteras.');if(!Number.isFinite(units))throw Error('Cantidad demasiado grande.');
 const t={id:uid(),type:'purchase',date:new Date().toISOString(),currency:s.currency,total,cost:0,note,movements:[{kind,id,name:item.name,unit:kind==='material'?'g':item.unit||'pzas',units,delta:units}],packs,packUnits};applyMovements(s,t.movements);s.ledger.push(t);return t;
}
export function recordProduction(s,{productId,qty,reserve=true,note=''}){
 const product=stockItem(s,'product',productId);if(!product||product.retired||!product.sourceBoxId||!product.sourceObjectId)throw Error('Vincula el producto a un objeto de la estantería para producirlo.');qty=positive(qty,'cantidad a producir');if(!Number.isInteger(qty))throw Error('La producción debe ser entera.');
 const plan=salePreview(s,[{boxId:product.sourceBoxId,objectId:product.sourceObjectId,qty,unitPrice:0}],reserve);if(plan.shortages.length)throw Error('Stock insuficiente para registrar la producción.');const oldStock=product.stock,productCostBefore=product.unitCost,oldValue=oldStock*product.unitCost,movements=[...plan.movements,{kind:'product',id:product.id,name:product.name,unit:'pzas',units:qty,delta:qty}];applyMovements(s,movements);product.unitCost=(oldValue+plan.cost)/(oldStock+qty);const t={id:uid(),type:'production',date:new Date().toISOString(),currency:s.currency,total:0,cost:plan.cost,note,movements,productId,qty,productCostBefore,productCostAfter:product.unitCost};s.ledger.push(t);return t;
}
export function recordAdjustment(s,kind,id,newStock,note='Ajuste de conteo'){const item=stockItem(s,kind,id);newStock=positive(newStock,'existencias',true);if(!item)throw Error('Artículo no disponible.');if(kind==='product'&&!Number.isInteger(newStock))throw Error('Las piezas terminadas se cuentan en unidades enteras.');const delta=newStock-item.stock;if(Math.abs(delta)<1e-9)return;const t={id:uid(),type:'adjustment',date:new Date().toISOString(),currency:s.currency,total:0,cost:0,note,movements:[{kind,id,name:item.name,unit:kind==='material'?'g':item.unit||'pzas',units:Math.abs(delta),delta}]};applyMovements(s,t.movements);s.ledger.push(t);return t;}

// --- Puente de impresión: sesiones y consumo en vivo -------------------------
export function printSession(s,id){return (s.printSessions||[]).find(x=>x.id===id)||null;}
const printLedger=(s,id)=>s.ledger.find(t=>t.type==='print'&&t.sessionId===id);
const activePrint=session=>['printing','paused'].includes(session?.status);
export function activePrintSessions(s){return (s.printSessions||[]).filter(activePrint);}
export function beginPrintSession(s,{name='impresion.gcode',source='G-code',boxId='',objectId='',printerId='',filaments=[],seconds=null,dims=null,image=null,track='time',units=1,note=''}={}){
 if(!Array.isArray(filaments)||!filaments.length)throw Error('El G-code no informa filamento; asigna los gramos antes de iniciar.');
 units=positive(units,'unidades');if(!Number.isInteger(units))throw Error('Las unidades deben ser un número entero.');
 const plan=new Map();
 for(const f of filaments){
  const grams=positive(f.grams,'gramos de filamento')*units,m=stockItem(s,'material',f.matId);
  if(!m||m.retired)throw Error('Asigna un filamento disponible a cada color del G-code.');
  const row=plan.get(m.id)||{matId:m.id,name:m.name,color:f.color||m.color,grams:0,lengthMm:null,consumed:0,price:m.price,spoolGrams:m.spoolGrams};
  row.grams+=grams;if(f.lengthMm!=null)row.lengthMm=(row.lengthMm||0)+positive(f.lengthMm,'longitud')*units;plan.set(m.id,row);
 }
 for(const f of plan.values())if(f.grams>stockItem(s,'material',f.matId).stock+1e-6)throw Error(`Stock insuficiente de ${f.name}: necesitas ${f.grams.toFixed(1)} g y hay ${stockItem(s,'material',f.matId).stock.toFixed(1)} g. Compra o ajusta el inventario antes de imprimir.`);
 const now=new Date().toISOString(),session={id:uid(),name,source,status:'printing',track:['time','usb','manual'].includes(track)?track:'manual',startedAt:now,updatedAt:now,lastProgressAt:now,progress:0,units,seconds:seconds==null?null:positive(seconds,'tiempo estimado'),dims,image,boxId,objectId,printerId,note,cost:0,filaments:[...plan.values()]};
 s.printSessions.unshift(session);
 const t={id:uid(),type:'print',date:now,currency:s.currency,total:0,cost:0,note:note||`Impresión · ${name}`,sessionId:session.id,printerId,movements:[]};
 s.ledger.push(t);session.ledgerId=t.id;return session;
}
function printMovement(t,item,delta,unit,price,spoolGrams){
 let m=t.movements.find(x=>x.kind==='material'&&x.id===item.id);
 if(!m){m={kind:'material',id:item.id,name:item.name,unit:'g',units:0,delta:0};t.movements.push(m);}
 m.units+=delta;m.delta-=delta;t.cost+=delta*positive(price,'precio')/Math.max(1,positive(spoolGrams,'peso de bobina'));
}
export function advancePrintSession(s,id,progress,{status,now=Date.now(),note=''}={}){
 const session=printSession(s,id);if(!session)throw Error('Sesión de impresión no encontrada.');
 if(!activePrint(session))return session;
 const target=Math.max(positive(session.progress,'avance',true),Math.min(1,positive(progress,'avance',true)));
 const t=printLedger(s,session.id);if(!t)throw Error('El movimiento de inventario de esta impresión no está disponible.');
 let shortage=false;
 for(const f of session.filaments){
  const wanted=f.grams*target-f.consumed;if(wanted<=1e-6)continue;
  const item=stockItem(s,'material',f.matId);if(!item){shortage=true;continue;}
  const delta=Math.min(wanted,Math.max(0,item.stock));
  if(delta+1e-6<wanted)shortage=true;
  if(delta>1e-9){applyMovements(s,[{kind:'material',id:item.id,name:item.name,unit:'g',units:delta,delta:-delta}]);f.consumed+=delta;printMovement(t,item,delta,'g',f.price||item.price,f.spoolGrams||item.spoolGrams);}
 }
 session.progress=target;session.updatedAt=new Date(now).toISOString();session.lastProgressAt=session.updatedAt;session.cost=t.cost;
 if(shortage)session.shortage=true;if(note)session.note=note;
 if(status)session.status=status;
 t.total=t.cost;return session;
}
export function finishPrintSession(s,id,{completed=false,productId='',qty=1,note=''}={}){
 const session=printSession(s,id);if(!session)throw Error('Sesión de impresión no encontrada.');
 if(!activePrint(session))throw Error('Esta impresión ya está cerrada.');
 if(completed)advancePrintSession(s,id,1,{status:'completed',note});
 else{const now=new Date().toISOString();session.status='stopped';session.updatedAt=now;if(note)session.note=note;}
 const t=printLedger(s,session.id);
 if(completed&&productId){
  const product=stockItem(s,'product',productId);qty=positive(qty,'cantidad');if(!product||product.retired)throw Error('Producto terminado no disponible.');if(!Number.isInteger(qty))throw Error('Las piezas terminadas se cuentan en unidades enteras.');
  const oldStock=product.stock,productCostBefore=product.unitCost,oldValue=oldStock*product.unitCost;
  const movement={kind:'product',id:product.id,name:product.name,unit:'pzas',units:qty,delta:qty};
  applyMovements(s,[movement]);const existing=t.movements.find(m=>m.kind==='product'&&m.id===product.id);if(existing){existing.units+=qty;existing.delta+=qty;}else t.movements.push(movement);
  product.unitCost=(oldValue+(session.cost||0))/(oldStock+qty);session.productId=product.id;session.units=qty;
  t.productId=product.id;t.productCostBefore=productCostBefore;t.productCostAfter=product.unitCost;
 }
 if(t){t.completed=!!completed;if(note)t.note=note;t.total=t.cost;}
 if(completed)session.completedAt=new Date().toISOString();
 return session;
}
export function stopPrintSession(s,id,note=''){return finishPrintSession(s,id,{completed:false,note});}
// Recupera sesiones tras reiniciar la app sin inventar consumo: la sesión por
// tiempo continúa; la de USB se interrumpe si el puerto ya no está trabajando.
export function reconcilePrintSessions(s,{usbActive=false,usbSession='',now=Date.now()}={}){
 let changed=false;
 for(const session of s.printSessions||[]){
  if(!activePrint(session))continue;
  const updated=Date.parse(session.updatedAt||session.startedAt||'')||now;
  if(session.track==='time'&&session.seconds){
   const elapsed=(now-(Date.parse(session.startedAt||'')||now))/1000;
   if(elapsed>session.seconds*3+3600){session.status='interrupted';session.updatedAt=new Date(now).toISOString();changed=true;}
   else{const target=Math.min(0.99,Math.max(session.progress||0,elapsed/session.seconds));if(target>session.progress+1e-6){advancePrintSession(s,session.id,target,{now});changed=true;}}
  }else if(session.track==='usb'){
   if((!usbActive||(usbSession&&session.id!==usbSession))&&now-updated>60000){session.status='interrupted';session.updatedAt=new Date(now).toISOString();changed=true;}
  }else if(now-updated>12*60*60*1000){session.status='interrupted';session.updatedAt=new Date(now).toISOString();changed=true;}
 }
 return changed;
}
export function printHistory(s,limit=30){return [...(s.printSessions||[])].sort((a,b)=>String(b.startedAt||'').localeCompare(String(a.startedAt||''))).slice(0,limit);}
// Quita una sesión que nunca llegó a consumir material (por ejemplo, el puerto
// USB no abrió). No altera stock porque su avance es cero.
export function discardPrintSession(s,id){const session=printSession(s,id);if(!session)return;if(finite(session.progress)>0||session.filaments.some(f=>finite(f.consumed)>0))throw Error('Esta sesión ya consumió material; deténla en lugar de descartarla.');s.printSessions=s.printSessions.filter(x=>x.id!==id);s.ledger=s.ledger.filter(t=>t.sessionId!==id);}

export function voidTransaction(s,id){const t=s.ledger.find(x=>x.id===id);if(!t||t.voided)throw Error('Movimiento no disponible.');if(t.type==='sale'&&s.ledger.some(x=>x.type==='return'&&x.saleId===t.id&&!x.voided))throw Error('Esta venta tiene devoluciones vigentes. Anula primero las devoluciones.');if(t.type==='return'&&s.ledger.find(x=>x.id===t.saleId)?.voided)throw Error('La venta original ya fue anulada.');if(t.type==='print'){const session=(s.printSessions||[]).find(x=>x.id===t.sessionId);if(session&&['printing','paused'].includes(session.status))throw Error('Detén la impresión antes de anular su movimiento de inventario.');if(t.productId){const later=s.ledger.slice(s.ledger.indexOf(t)+1).some(x=>!x.voided&&x.movements.some(m=>m.kind==='product'&&m.id===t.productId));if(later)throw Error('Anula primero los movimientos posteriores de este producto.');}}if(t.type==='production'){const later=s.ledger.slice(s.ledger.indexOf(t)+1).some(x=>!x.voided&&x.movements.some(m=>m.kind==='product'&&m.id===t.productId));if(later)throw Error('Anula primero los movimientos posteriores de este producto.');const product=stockItem(s,'product',t.productId);if(t.productCostAfter!=null&&Math.abs(product.unitCost-t.productCostAfter)>1e-8)throw Error('El costo de este producto fue editado después de producir. Restáuralo antes de anular.');}const movements=t.movements.map(m=>({...m,delta:movementDelta(t,m)}));applyMovements(s,movements,-1);if(t.type==='production'&&t.productCostBefore!=null)stockItem(s,'product',t.productId).unitCost=t.productCostBefore;if(t.type==='print'&&t.productId&&t.productCostBefore!=null)stockItem(s,'product',t.productId).unitCost=t.productCostBefore;if(t.type==='print'){const session=(s.printSessions||[]).find(x=>x.id===t.sessionId);if(session)session.voided=new Date().toISOString();}t.voided=new Date().toISOString();}
export function saleReturns(s,saleId){return s.ledger.filter(t=>t.type==='return'&&!t.voided&&t.saleId===saleId);}
export function saleReturnedQuantities(s,saleId){const quantities={};for(const t of saleReturns(s,saleId))for(const item of t.items||[])quantities[item.lineIndex]=(quantities[item.lineIndex]||0)+item.qty;return quantities;}
export function recordReturn(s,{saleId,items=[],method='efectivo',note=''}={}){
 const sale=s.ledger.find(t=>t.id===saleId&&t.type==='sale');if(!sale||sale.voided)throw Error('La venta ya no está disponible para devolución.');
 if(!['efectivo','transferencia','tarjeta','saldo','nota_credito'].includes(method))throw Error('Forma de reembolso inválida.');
 const prior=saleReturnedQuantities(s,saleId),chosen=[];let total=0,cost=0;
 for(const item of items){const index=Number(item.lineIndex),qty=positive(item.qty,'cantidad a devolver');if(!Number.isInteger(qty))throw Error('Las devoluciones se registran en piezas enteras.');const line=sale.lines[index];if(!line)throw Error('La línea de venta no existe.');const remaining=line.qty-(prior[index]||0);if(qty>remaining)throw Error(`Solo quedan ${remaining} pieza(s) por devolver en ${line.name}.`);if(qty<1)continue;chosen.push({index,qty});}
 if(!chosen.length)throw Error('Indica al menos una pieza a devolver.');
 const restored=new Map(),restore=(kind,id,name,unit,units)=>{if(!units)return;const key=kind+':'+id,m=restored.get(key)||{kind,id,name,unit,units:0};m.units+=units;restored.set(key,m);};
 for(const item of chosen){
  const line=sale.lines[item.index];
  if(Array.isArray(line.movements)&&line.movements.length){
   for(const m of line.movements)restore(m.kind,m.id,m.name,m.unit,m.units*item.qty/line.qty);
  }else if(line.kind==='product'){const product=stockItem(s,'product',line.productId);restore('product',line.productId,product?.name||line.name,product?.unit||'pzas',item.qty);}
  else{
   const plan=salePreview(s,[{kind:'model',boxId:line.boxId,objectId:line.objectId,qty:item.qty,unitPrice:0,colors:line.colors}],true);
   for(const m of plan.movements)restore(m.kind,m.id,m.name,m.unit,m.units);
  }
  total+=item.qty*line.unitPrice;cost+=item.qty*line.unitCost;
 }
 const movements=[...restored.values()].map(m=>({...m,delta:m.units}));
 applyMovements(s,movements);
 const number=s.ledger.filter(t=>t.type==='return'&&t.saleId===saleId).length+1;
 const t={id:uid(),ticket:`${sale.ticket||'VENTA'}-D${number}`,type:'return',saleId,saleTicket:sale.ticket,date:new Date().toISOString(),currency:sale.currency,total,cost,note,customer:sale.customer||'',payment:{method,amount:total},items:chosen.map(({index,qty})=>({lineIndex:index,qty,name:sale.lines[index].name,kind:sale.lines[index].kind,unitPrice:sale.lines[index].unitPrice,unitCost:sale.lines[index].unitCost})),movements};
 s.ledger.push(t);return t;
}
export function cashCutReport(s,{type='partial',from=s.cashCutStart,to=new Date().toISOString(),note=''}={}){
 const start=Number.isFinite(Date.parse(from))?new Date(from).toISOString():new Date(0).toISOString(),end=Number.isFinite(Date.parse(to))?new Date(to).toISOString():new Date().toISOString();
 if(Date.parse(end)<Date.parse(start))throw Error('El periodo del corte no es válido.');
 const inPeriod=t=>{const d=Date.parse(t.date);return Number.isFinite(d)&&d>=Date.parse(start)&&d<=Date.parse(end);};
 const sales=s.ledger.filter(t=>t.type==='sale'&&!t.voided&&inPeriod(t)),returns=s.ledger.filter(t=>t.type==='return'&&!t.voided&&inPeriod(t)),purchases=s.ledger.filter(t=>t.type==='purchase'&&!t.voided&&inPeriod(t));
 const salesTotal=sales.reduce((n,t)=>n+t.total,0),returnsTotal=returns.reduce((n,t)=>n+t.total,0),purchasesTotal=purchases.reduce((n,t)=>n+t.total,0),saleCost=sales.reduce((n,t)=>n+t.cost,0),returnCost=returns.reduce((n,t)=>n+t.cost,0);
 const paymentNames={efectivo:'Efectivo',transferencia:'Transferencia',tarjeta:'Tarjeta',saldo:'Saldo a favor',nota_credito:'Nota de crédito',registro:'Otro'};
 const payments={};const addPayment=(method,field,amount)=>{method=method||'registro';const row=payments[method]||{method,name:paymentNames[method]||method,sales:0,refunds:0,net:0};row[field]+=amount;payments[method]=row;};
 for(const t of sales)addPayment(t.payment?.method,'sales',t.total);for(const t of returns)addPayment(t.payment?.method,'refunds',t.total);
 for(const row of Object.values(payments))row.net=row.sales-row.refunds;
 const detail=sales.slice().reverse().map(t=>({id:t.id,ticket:t.ticket,date:t.date,customer:t.customer||'',note:t.note||'',total:t.total,cost:t.cost,payment:t.payment||null,lines:(t.lines||[]).map(l=>({kind:l.kind,name:l.name,qty:l.qty,unitPrice:l.unitPrice,unitCost:l.unitCost,colorRequests:l.colorRequests||[],requestedColorName:l.requestedColorName||''}))}));
 const returnDetail=returns.slice().reverse().map(t=>({id:t.id,ticket:t.ticket,date:t.date,saleTicket:t.saleTicket||'',customer:t.customer||'',total:t.total,cost:t.cost,items:t.items||[],method:t.payment?.method||'efectivo',note:t.note||''}));
 const purchaseDetail=purchases.slice().reverse().map(t=>({id:t.id,date:t.date,total:t.total,note:t.note||''}));
 return {type,from:start,to:end,note,createdAt:end,currency:s.currency,salesTotal,returnsTotal,purchasesTotal,balance:salesTotal-returnsTotal-purchasesTotal,profit:salesTotal-returnsTotal-(saleCost-returnCost),cost:saleCost-returnCost,counts:{sales:sales.length,returns:returns.length,purchases:purchases.length,pieces:sales.reduce((n,t)=>n+(t.lines||[]).reduce((m,l)=>m+l.qty,0),0)},payments:Object.values(payments).sort((a,b)=>a.name.localeCompare(b.name,'es')),sales:detail,returns:returnDetail,purchases:purchaseDetail};
}
export function recordCashCut(s,{type='partial',note='',to=new Date().toISOString()}={}){
 if(!['partial','full'].includes(type))throw Error('Tipo de corte inválido.');const report=cashCutReport(s,{type,from:s.cashCutStart,to,note});const number='C-'+String(s.cashCuts.length+1).padStart(4,'0');const cut={id:uid(),number,type,date:report.to,from:report.from,to:report.to,note,report};s.cashCuts.push(cut);if(type==='full')s.cashCutStart=report.to;return cut;
}
export function totals(s){const ts=s.ledger.filter(t=>!t.voided&&t.currency===s.currency),sales=ts.filter(t=>t.type==='sale').reduce((n,t)=>n+t.total,0),returns=ts.filter(t=>t.type==='return').reduce((n,t)=>n+t.total,0),purchases=ts.filter(t=>t.type==='purchase').reduce((n,t)=>n+t.total,0),cost=ts.filter(t=>t.type==='sale').reduce((n,t)=>n+t.cost,0),returnCost=ts.filter(t=>t.type==='return').reduce((n,t)=>n+t.cost,0);return {sales:sales-returns,purchases,balance:sales-returns-purchases,profit:sales-returns-(cost-returnCost)};}
export function removeInventory(s,kind,id,replacement=''){
 const list=stockList(s,kind),item=stockItem(s,kind,id);if(!item)throw Error('No se encontró el artículo.');
 const unassign=replacement==='__none__';const target=replacement&&!unassign?stockItem(s,kind,replacement):null;if(replacement&&!unassign&&(!target||replacement===id))throw Error('Elige otro artículo.');
 const referenced=['material','supply'].includes(kind)&&(s.boxes.some(b=>b.objects.some(o=>kind==='material'?o.parts.some(p=>p.matId===id)||o.gcode?.filaments?.some(f=>f.matId===id):(o.extras||[]).some(e=>e.supplyId===id)))||(kind==='material'&&(s.printSessions||[]).some(ps=>['printing','paused'].includes(ps.status)&&ps.filaments?.some(f=>f.matId===id))));
 if(referenced&&!target&&!unassign)throw Error('Este artículo está asignado a objetos; elige su reemplazo.');
 if(unassign)replacement='';
 const hasHistory=s.ledger.some(t=>t.movements.some(m=>m.kind===kind&&m.id===id));
 for(const b of s.boxes)for(const o of b.objects){if(kind==='material'){for(const p of o.parts)if(p.matId===id){p.matId=replacement;p.grams=null;p.minutes=null;b.thumbnail=null;}if(o.material===id)o.material=replacement;if(o.gcode?.filaments?.some(f=>f.matId===id))o.gcode=null;}else if(kind==='supply')for(const e of o.extras||[])if(e.supplyId===id)e.supplyId=replacement;}
 if(hasHistory)item.retired=true;else list.splice(list.indexOf(item),1);syncSupplyPrices(s);
}
