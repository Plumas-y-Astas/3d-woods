export const uid = () => globalThis.crypto?.randomUUID?.() ?? `w-${Date.now()}-${Math.random().toString(16).slice(2)}`;
export const APP_VERSION = '0.8.2';
export const APP_PUBLISHER = 'Plumas y Astas Studio';
export const UPDATE_REPO = 'plumasyastas/3d-woods';
export const finite = (v, fallback = 0) => Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : fallback;
export const MULTIPLIERS = [
  { value: 2, name: 'Alto volumen', detail: 'Descuento por volumen' },
  { value: 2.5, name: 'Volumen medio', detail: 'Tiradas medianas' },
  { value: 3, name: 'Mayorista', detail: 'Precio de mayoreo' },
  { value: 3.5, name: 'Intermedio', detail: 'Pedidos especiales' },
  { value: 4, name: 'Minorista', detail: 'Venta al público' },
  { value: 5, name: 'Piezas chicas', detail: 'Llaveros y miniaturas' }
];
export const defaults = () => ({
  version: 1, theme: 'light', currency: 'MXN', boxes: [], quotes: [], printSessions: [],
  ticketSerial: 0, posDrafts: [], cashCuts: [], cashCutStart: null,
  categories: ['Sin categoría', 'Figuras', 'Decoración', 'Funcionales', 'Llaveros'],
  settings: { printer: 'Creality Ender 3 V3 SE', bedX: 220, bedY: 220, bedZ: 250,
    power: 120, nominalPower: 350, kwh: 3, machineCost: 5000, lifeHours: 8000,
    replacements: 600, replacementHours: 2000, error: 10, laborRate: 60,
    margin: 5, gap: 4, diameter: 1.75, density: 1.24, baud: 115200,
    slicerPath: '', slicerName: 'Laminador externo',
    bridgeFolder: '', bridgeWatch: true,
    updateRepo: UPDATE_REPO, updateAuto: true, updateSkippedVersion: '',
    businessName: '3D-Woods', businessTagline: 'Un bosque de ideas',
    businessPhone: '', businessEmail: '', businessAddress: '',
    receiptFooter: 'Gracias por apoyar el trabajo del taller.' },
  materials: [
    { id: 'forest', name: 'PLA · Verde bosque', color: '#4c6b51', price: 350, spoolGrams: 1000, stock: 750, density: 1.24 },
    { id: 'ivory', name: 'PLA · Marfil', color: '#e0d3b5', price: 350, spoolGrams: 1000, stock: 900, density: 1.24 },
    { id: 'terracotta', name: 'PLA · Terracota', color: '#b76a4a', price: 380, spoolGrams: 1000, stock: 500, density: 1.24 },
    { id: 'charcoal', name: 'PETG · Carbón', color: '#42494a', price: 420, spoolGrams: 1000, stock: 1000, density: 1.27 }
  ]
});
export function newObject(name = 'Objeto sin título', material = 'forest') {
  return { id: uid(), name, kind: '3D', sizeClass: 'regular', assembly: false, parts: [], extras: [],
    laborMinutes: 0, setupCost: 0, multiplier: 4, orderQty: 1, notes: '', gcode: null, material };
}
export function newBox(name = 'Nueva caja') {
  return { id: uid(), name, category: 'Sin categoría', description: '', createdAt: new Date().toISOString(),
    objects: [newObject(name)], files: [], favorite: false, thumbnail: null, demo: false };
}
// Automatic folder scans must not turn a box full of separate models into one
// giant assembly. Only a box that already is a single multi-part assembly keeps
// adding new files as components; every other box gets one object per file.
export function scanGroup(box){
  return box&&box.objects.length===1&&box.objects[0].parts.length>1?'parts':'objects';
}
export function seedBoxes() {
  const make = (id,name,category,kind,parts,extras=[]) => {
    const box=newBox(name); box.id=id; box.demo=true; box.category=category;
    const o=box.objects[0];o.id=`${id}-object`;o.kind=kind;o.assembly=parts.length>1;
    o.parts=parts.map((p,i)=>({id:`${id}-part-${i}`,name:p[0],demo:p[1],matId:p[2],grams:p[3],minutes:p[4],dims:p[5],qty:p[6]||1,position:p[7]||[0,0,0],rotation:[0,0,0],scale:1}));
    o.extras=extras; o.laborMinutes=5; return box;
  };
  return [
    make('jackalope','Jackalope del bosque','Figuras','3D',[
      ['Cuerpo','rabbit','ivory',48,145,[63,57,110]],['Cornamenta','antlers','forest',8,40,[75,24,55],1,[0,0,97]]]),
    make('planter','Maceta panal','Decoración','3D',[['Maceta','planter','terracotta',82,220,[100,100,95]]]),
    make('mushrooms','Pequeño bosque','Decoración','3D',[
      ['Base','base','forest',30,75,[100,80,12]],['Tallos','stems','ivory',18,60,[65,45,65],1,[0,0,10]],['Sombreros','caps','terracotta',32,90,[95,75,35],1,[0,0,65]]]),
    make('leaf','Llavero hoja','Llaveros','2D',[['Relieve de una cara','leaf','forest',7,22,[38,55,4]]],[{id:'ring',name:'Argolla de llavero',qty:1,price:1.5}]),
    make('stand','Soporte de escritorio','Funcionales','3D',[['Soporte','stand','charcoal',95,280,[80,85,100]]]),
    make('deer','Ciervo geométrico','Figuras','3D',[['Cuerpo','deer','forest',55,180,[95,40,115]],['Cornamenta','antlers','ivory',8,40,[75,24,55],1,[33,0,104]]])
  ];
}

// Best of two rectangular grids. This is deliberately an estimate, not polygon nesting.
export function bedCapacity(dims, settings, scale = 1) {
  const [x,y,z]=(dims||[0,0,0]).map(v=>finite(v)*finite(scale,1));
  const gap=finite(settings.gap), margin=finite(settings.margin);
  const bx=Math.max(0,finite(settings.bedX)-2*margin),by=Math.max(0,finite(settings.bedY)-2*margin);
  if(!x||!y||z>finite(settings.bedZ))return {count:0,columns:0,rows:0,rotated:false,x,y,z};
  const a={columns:Math.floor((bx+gap)/(x+gap)),rows:Math.floor((by+gap)/(y+gap)),rotated:false};
  const b={columns:Math.floor((bx+gap)/(y+gap)),rows:Math.floor((by+gap)/(x+gap)),rotated:true};
  a.count=a.columns*a.rows;b.count=b.columns*b.rows;
  return {...(b.count>a.count?b:a),x,y,z};
}
export function requirements(object, materials, settings, quantity = 1) {
  const qty=Math.max(1,Math.floor(finite(quantity,1)));
  const rows=new Map(); let minutes=0, missing=false;
  const add=(id,grams)=>{let m=materials.find(m=>m.id===id);if(!m){missing=true;m={id:id||'unknown',name:'Material sin asignar',price:0,spoolGrams:1000,stock:0,color:'#999999'};}const r=rows.get(m.id)||{...m,grams:0};r.grams+=finite(grams)*qty;rows.set(m.id,r);};
  if(object.gcode?.valid){
    minutes=finite(object.gcode.minutes)*qty;
    for(const f of object.gcode.filaments||[])add(f.matId,f.grams);
  } else {
    for(const p of object.parts||[]){
      const n=Math.max(1,Math.floor(finite(p.qty,1)));
      if(p.grams==null||p.minutes==null)missing=true;
      add(p.matId,finite(p.grams)*n);minutes+=finite(p.minutes)*n*qty;
    }
  }
  if(!object.parts?.length && !object.gcode?.valid)missing=true;
  return {minutes,missing,rows:[...rows.values()].map(r=>{
    const reserve=r.grams*(1+finite(settings.error)/100);
    return {...r,reserve,spools:Math.ceil(reserve/Math.max(1,finite(r.spoolGrams,1000))),
      buySpools:Math.ceil(Math.max(0,reserve-finite(r.stock))/Math.max(1,finite(r.spoolGrams,1000)))};
  })};
}
export function calculate(object, materials, settings, quantity = 1, multiplier = object.multiplier || 4) {
  const qty=Math.max(1,Math.floor(finite(quantity,1))), req=requirements(object,materials,settings,1);
  const hours=req.minutes/60;
  const filament=req.rows.reduce((s,r)=>s+r.grams*finite(r.price)/Math.max(1,finite(r.spoolGrams,1000)),0);
  const energy=hours*finite(settings.power)/1000*finite(settings.kwh);
  const depreciation=hours*finite(settings.machineCost)/Math.max(1,finite(settings.lifeHours,1));
  const maintenance=hours*finite(settings.replacements)/Math.max(1,finite(settings.replacementHours,1));
  const manufacture=filament+energy+depreciation+maintenance;
  const contingency=manufacture*finite(settings.error)/100;
  const extras=(object.extras||[]).reduce((s,e)=>s+finite(e.qty)*finite(e.price),0);
  const labor=finite(object.laborMinutes)*finite(settings.laborRate)/60;
  const setup=finite(object.setupCost)/qty;
  const cost=manufacture+contingency+extras+labor+setup;
  const price=cost*finite(multiplier,4);
  return {qty,hours,filament,energy,depreciation,maintenance,contingency,extras,labor,setup,cost,
    price,total:price*qty,profit:price-cost,multiplier,missing:req.missing||(object.extras||[]).some(e=>e.qty>0&&Object.hasOwn(e,'supplyId')&&!e.supplyId),
    grams:req.rows.reduce((s,r)=>s+r.grams,0),requirements:requirements(object,materials,settings,qty),
    plans:(object.parts||[]).map(p=>{const cap=bedCapacity(p.dims,settings,p.scale??1),units=Math.max(1,Math.floor(finite(p.qty,1)))*qty;return{partId:p.id,name:p.name,units,...cap,beds:cap.count?Math.ceil(units/cap.count):null};})};
}
const gcodeHex=v=>{const m=String(v||'').trim().match(/^#?([0-9a-f]{6})$/i);return m?'#'+m[1].toLowerCase():'';};
const gcodeDuration=v=>{
  const s=String(v||'').trim();if(!s)return null;
  let total=0,found=false;
  for(const m of s.matchAll(/([\d.]+)\s*(d|h|m|s)\b/gi)){found=true;total+=+m[1]*({d:86400,h:3600,m:60,s:1}[m[2].toLowerCase()]);}
  if(found)return total;
  const clock=s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  return clock?+clock[1]*3600+(+clock[2])*60+(clock[3]?+clock[3]:0):null;
};
const gcodeValues=(text,units)=>{
  const values=[];for(const part of String(text||'').split(/[,;]/)){
    const m=part.match(/(-?\d+(?:\.\d+)?)\s*(kg|mg|g|mm|cm|m)?/i);if(!m)continue;
    let n=+m[1];const u=(m[2]||'').toLowerCase();
    if(u==='kg')n*=1000;else if(u==='mg')n/=1000;else if(u==='m')n*=1000;else if(u==='cm')n*=10;
    if(Number.isFinite(n))values.push({value:Math.max(0,n),unit:u||units});
  }return values;
};
function gcodeMovementBounds(text){
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  let x=0,y=0,z=0,absolute=true,unit=1,seen=false;
  for(const raw of text.split(/\r?\n/)){
    const line=raw.split(';',1)[0].trim();if(!line)continue;
    if(/^G20\b/i.test(line)){unit=25.4;continue;}
    if(/^G21\b/i.test(line)){unit=1;continue;}
    if(/^G90\b/i.test(line)){absolute=true;continue;}
    if(/^G91\b/i.test(line)){absolute=false;continue;}
    if(/^G92\b/i.test(line)){
      for(const m of line.matchAll(/([XYZ])\s*(-?(?:\d+\.?\d*|\.\d+))/gi)){const v=+m[2]*unit,axis=m[1].toUpperCase();if(axis==='X')x=v;else if(axis==='Y')y=v;else z=v;}
      continue;
    }
    if(!/^(?:N\d+\s*)?G[01]\b/i.test(line))continue;
    for(const m of line.matchAll(/([XYZ])\s*(-?(?:\d+\.?\d*|\.\d+))/gi)){
      const v=+m[2]*unit,axis=m[1].toUpperCase();
      if(axis==='X')x=absolute?v:x+v;else if(axis==='Y')y=absolute?v:y+v;else z=absolute?v:z+v;
      seen=true;
      const coords=[x,y,z];
      for(let i=0;i<3;i++){min[i]=Math.min(min[i],coords[i]);max[i]=Math.max(max[i],coords[i]);}
    }
  }
  if(!seen)return [null,null,null];
  return max.map((v,i)=>v-min[i]);
}
function gcodeThumbnail(text){
  let best=null,bestArea=0;
  for(const block of text.matchAll(/^[ \t]*;[ \t]*thumbnail(?:_qoi)?[ \t]+begin(?:[ \t]+([^\r\n]*))?\r?\n([\s\S]*?)^[ \t]*;[ \t]*thumbnail(?:_qoi)?[ \t]+end/gim)){
    const header=(block[1]||'').trim(),size=header.match(/(\d+)\s*[x×]\s*(\d+)/i),area=size?(+size[1])*(+size[2]):0;
    const qoi=/qoi/i.test(block[0].slice(0,80));
    if(qoi)continue;
    const body=block[2].split(/\r?\n/).map(line=>line.replace(/^[ \t]*;[ \t]?/,'').trim()).join('').replace(/[^a-z0-9+/=]/gi,'');
    if(body.length<80||body.length>1200000)continue;
    const mime=body.startsWith('iVBORw0KGgo')?'image/png':body.startsWith('/9j/')?'image/jpeg':'';
    if(!mime)continue;
    const url='data:'+mime+';base64,'+body;
    if(area>=bestArea){bestArea=area;best=url;}
  }
  return best;
}
export function parseGcode(text, {diameter=1.75,density=1.24}={}) {
  const value=re=>text.match(re)?.[1];
  let seconds=Number(value(/^;TIME:\s*([\d.]+)/im));
  if(!Number.isFinite(seconds)||seconds<=0){
    const t=value(/^;\s*(?:estimated\s+printing\s+time|total\s+estimated\s+time|estimated\s+print\s+time|model\s+printing\s+time|print\s+time)(?:[^\r\n=:]*)?\s*[=:]\s*([^\r\n]+)/im)||'';
    seconds=gcodeDuration(t)||0;
  }
  const gramsText=value(/^;\s*(?:filament used \[g\]|total filament weight \[g\]|total filament used \[g\]|filament weight)\s*[=:]\s*([^\r\n]+)/im);
  const volumeText=value(/^;\s*(?:filament used \[cm3\]|total filament volume \[cm3\])\s*[=:]\s*([^\r\n]+)/im);
  const lengthText=value(/^;\s*Filament used:\s*([^\r\n]+)/im)||value(/^;\s*(?:filament used \[mm\]|total filament length \[mm\])\s*[=:]\s*([^\r\n]+)/im);
  let grams=[],lengths=[];
  if(gramsText)grams=gcodeValues(gramsText,'g').map(v=>v.value);
  if(volumeText)grams=gcodeValues(volumeText,'cm3').map(v=>v.value*density);
  if(lengthText)lengths=gcodeValues(lengthText,'mm').map(v=>v.value);
  if(!grams.length&&lengths.length)grams=lengths.map(mm=>mm*Math.PI*(diameter/2)**2/1000*density);
  if(grams.length&&!lengths.length)lengths=grams.map(g=>g/(Math.max(.01,Math.PI*(diameter/2)**2/1000*density)));
  let dims=['X','Y','Z'].map(axis=>{const hi=Number(value(new RegExp('^;MAX'+axis+':\\s*([\\d.\\-]+)','m'))),lo=Number(value(new RegExp('^;MIN'+axis+':\\s*([\\d.\\-]+)','m')));return Number.isFinite(hi)&&Number.isFinite(lo)?hi-lo:null;});
  if(dims.some(v=>v==null)){const scanned=gcodeMovementBounds(text);dims=dims.map((v,i)=>v==null?scanned[i]:v);}
  const colorText=value(/^;\s*(?:filament_colour|filament_colors?|extruder_colour|filament color)\s*[=:]\s*([^\r\n]+)/im)||'';
  const colors=[...colorText.matchAll(/#([0-9a-f]{6})/gi)].map(m=>'#'+m[1].toLowerCase()).filter(Boolean);
  const layers=Math.max(0,Number(value(/^;LAYER_COUNT:\s*(\d+)/m))||0)||[...text.matchAll(/^;LAYER:(\d+)/gm)].reduce((n,m)=>Math.max(n,+m[1]+1),0);
  const source=/PrusaSlicer/i.test(text)?'PrusaSlicer':/OrcaSlicer/i.test(text)?'OrcaSlicer':/Bambu\s*Studio|BambuStudio/i.test(text)?'Bambu Studio':/Simplify3D/i.test(text)?'Simplify3D':/Cura_SteamEngine|UltiMaker Cura|Ultimaker Cura|SuperSlicer/i.test(text)?'Cura':/^;FLAVOR:/m.test(text)?'G-code genérico':'G-code';
  return {minutes:seconds>0?seconds/60:null,seconds,grams:grams.map(g=>Math.max(0,g)),lengths,dims,
    valid:seconds>0&&grams.some(g=>g>0),source,colors,thumbnail:gcodeThumbnail(text),layers,
    warnings:[]};
}
export const formatTime = m => {if(m==null)return 'Sin laminar'; const n=Math.round(finite(m));return `${Math.floor(n/60)} h ${String(n%60).padStart(2,'0')} min`;};
export const dimensions = dims => (dims||[0,0,0]).map(v=>(finite(v)/10).toLocaleString('es-MX',{maximumFractionDigits:1})).join(' × ');
export function previewParts(parts=[], sizes={}, budget=Infinity, preferredId=null){
  const all=(parts||[]).filter(Boolean);
  const preferred=preferredId?all.find(p=>p.id===preferredId):null;
  const order=preferred?[preferred,...all.filter(p=>p!==preferred)]:all;
  const chosen=[];let bytes=0;
  for(const p of order){
    const size=Number(sizes[p.fileId]||0);
    if(chosen.length&&bytes+size>budget)continue;
    chosen.push(p);bytes+=size;
  }
  const keep=new Set(chosen);
  return {parts:all.filter(p=>keep.has(p)),bytes,total:all.length,full:chosen.length===all.length};
}
export const money = (v,currency='MXN')=>new Intl.NumberFormat('es-MX',{style:'currency',currency,maximumFractionDigits:2}).format(finite(v));
export const materialColors = m => {
  const valid = value => /^#[0-9a-f]{6}$/i.test(String(value || ''));
  const list = [m?.color, ...(Array.isArray(m?.colors) ? m.colors : [])].filter(valid).map(value => String(value).toLowerCase());
  return [...new Set(list)].length ? [...new Set(list)] : ['#738b5e'];
};
export function validateState(value) {
  if(!value || value.version!==1 || !Array.isArray(value.boxes)||!Array.isArray(value.materials)||!value.settings)throw Error('El archivo no es un catálogo válido de 3D-Woods.');
  if(value.boxes.length>10000||value.materials.length>10000)throw Error('Catálogo demasiado grande.');
  if(value.categories!=null){
    if(!Array.isArray(value.categories)||value.categories.length>100||value.categories.some(c=>typeof c!=='string'||!c.trim()||c.length>60))throw Error('Categorías de cajas inválidas.');
    const seen=new Set();for(const c of value.categories){const key=c.trim().toLocaleLowerCase('es');if(seen.has(key)||['todo','favoritos','armables'].includes(key))throw Error('Categorías de cajas inválidas o repetidas.');seen.add(key);}
  }
  const number=(n,nullable=false)=>{if(n==null&&nullable)return;if(typeof n!=='number'||!Number.isFinite(n)||n<0)throw Error('El catálogo contiene un valor numérico inválido.');};
  for(const k of ['bedX','bedY','bedZ','power','nominalPower','kwh','machineCost','lifeHours','replacements','replacementHours','error','laborRate','margin','gap','diameter','density','baud'])if(value.settings[k]!=null)number(value.settings[k]);
  for(const k of ['slicerName','slicerPath','bridgeFolder','businessName','businessTagline','businessPhone','businessEmail','businessAddress','receiptFooter'])if(value.settings[k]!=null&&typeof value.settings[k]!=='string')throw Error('Configuración del taller inválida.');
  if(value.settings.bridgeWatch!=null&&typeof value.settings.bridgeWatch!=='boolean')throw Error('Configuración del puente inválida.');
  for(const m of value.materials){if(typeof m.id!=='string'||typeof m.name!=='string'||!/^#[0-9a-f]{6}$/i.test(m.color))throw Error('Filamento inválido.');if(m.colors!=null&&(!Array.isArray(m.colors)||m.colors.length>16||m.colors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c))))throw Error('Colores del filamento inválidos.');for(const k of ['price','spoolGrams','stock','density'])number(m[k]);if(!m.spoolGrams||!m.density)throw Error('Peso y densidad del filamento deben ser mayores que cero.');}
  for(const b of value.boxes){
    if(typeof b.id!=='string'||typeof b.name!=='string'||!Array.isArray(b.objects))throw Error('Caja inválida.');
    if(b.category!=null&&typeof b.category!=='string')throw Error('Categoría de caja inválida.');
    if(b.thumbnail&&!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(b.thumbnail))b.thumbnail=null;
    for(const o of b.objects){
      if(typeof o.id!=='string'||typeof o.name!=='string'||!Array.isArray(o.parts))throw Error('Objeto inválido.');
      for(const k of ['laborMinutes','setupCost','multiplier','orderQty'])if(o[k]!=null)number(o[k]);
      for(const p of o.parts){if(typeof p.id!=='string'||typeof p.name!=='string'||!Array.isArray(p.dims)||p.dims.length!==3)throw Error('Componente inválido.');p.dims.forEach(n=>number(n));for(const k of ['qty','grams','minutes','scale'])number(p[k],true);for(const k of ['position','rotation'])if(p[k]&&(!Array.isArray(p[k])||p[k].length!==3||p[k].some(n=>typeof n!=='number'||!Number.isFinite(n))))throw Error('Montaje inválido.');}
      for(const e of o.extras||[]){if(typeof e.name!=='string')throw Error('Insumo inválido.');number(e.qty);number(e.price);}
      if(o.gcode?.valid){number(o.gcode.minutes);number(o.gcode.units,true);if(!Array.isArray(o.gcode.filaments))throw Error('G-code inválido.');for(const f of o.gcode.filaments)number(f.grams,true);if(o.gcode.image!=null&&!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(o.gcode.image))o.gcode.image=null;if(o.gcode.dims!=null&&(!Array.isArray(o.gcode.dims)||o.gcode.dims.length!==3))o.gcode.dims=null;}
    }
  }
  if(value.currency&&!['MXN','USD','EUR'].includes(value.currency))throw Error('Moneda inválida.');
  if(value.printSessions!=null){
    if(!Array.isArray(value.printSessions)||value.printSessions.length>10000)throw Error('Historial de impresión inválido.');
    for(const ps of value.printSessions){
      if(typeof ps.id!=='string'||!['printing','paused','completed','stopped','interrupted'].includes(ps.status))throw Error('Sesión de impresión inválida.');
      for(const k of ['progress','units','seconds','cost'])number(ps[k],true);
      if(ps.progress!=null&&ps.progress>1)throw Error('Avance de impresión inválido.');
      if(!Array.isArray(ps.filaments))throw Error('Filamentos de impresión inválidos.');
      for(const f of ps.filaments){number(f.grams,true);number(f.consumed,true);if(f.matId!=null&&typeof f.matId!=='string')throw Error('Filamento de impresión inválido.');}
      if(ps.image!=null&&!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(ps.image))ps.image=null;
    }
  }
  for(const q of value.quotes||[]){for(const k of ['qty','multiplier','cost','unit','total','minutes'])number(q[k]);if(!['MXN','USD','EUR'].includes(q.currency))throw Error('Cotización inválida.');}
  return value;
}
