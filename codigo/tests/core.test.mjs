import {migrate,recordSale,recordReturn,recordCashCut} from '../dist/workshop.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,newObject,calculate,bedCapacity,parseGcode,requirements,seedBoxes,validateState,previewParts,newBox,scanGroup} from '../dist/core.js';
import {renderApp,field} from '../dist/views.js';
import {demoModel,bounds,parseModel,exportSTL} from '../dist/models.js';
import {ticketDocument,returnDocument,cutDocument,standaloneDocument} from '../dist/documents.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('All cost components, quantity and markup are calculated once',()=>{
 const s=defaults(),o=newObject();s.settings={...s.settings,power:100,kwh:2,machineCost:4000,lifeHours:8000,replacements:500,replacementHours:1000,error:10,laborRate:60};
 o.parts=[{qty:1,grams:100,minutes:120,matId:'forest',dims:[20,20,20],scale:1}];o.extras=[{qty:2,price:3}];o.laborMinutes=10;o.setupCost=20;
 const c=calculate(o,s.materials,s.settings,10,4);
 near(c.filament,35);near(c.energy,.4);near(c.depreciation,1);near(c.maintenance,1);near(c.contingency,3.74);near(c.extras,6);near(c.labor,10);near(c.setup,2);near(c.cost,59.14);near(c.price,236.56);near(c.total,2365.6);assert.equal(c.missing,false);
 near(c.requirements.rows[0].grams,1000);near(c.requirements.rows[0].reserve,1100);assert.equal(c.requirements.rows[0].spools,2);assert.equal(c.requirements.rows[0].buySpools,1);
});
test('Missing slicer values are not silently treated as a complete quote',()=>{
 const s=defaults(),o=newObject();o.parts=[{matId:'forest',qty:1,grams:null,minutes:null,dims:[20,20,20]}];assert.equal(calculate(o,s.materials,s.settings).missing,true);
 o.parts[0].grams=10;o.parts[0].minutes=30;assert.equal(calculate(o,s.materials,s.settings).missing,false);
 o.parts[0].matId='unknown';assert.equal(calculate(o,s.materials,s.settings).missing,true);
});
test('Multi-part assemblies sum quantities and keep filament colors separate',()=>{
 const s=defaults(),o=newObject();o.parts=[{id:'a',qty:4,grams:10,minutes:30,matId:'forest',dims:[30,30,40]},{id:'b',qty:2,grams:20,minutes:60,matId:'ivory',dims:[10,30,10]}];
 const c=calculate(o,s.materials,s.settings,10);near(c.grams,80);near(c.hours,4);near(c.requirements.minutes,2400);assert.equal(c.requirements.rows.length,2);assert.equal(c.plans[0].units,40);
});
test('G-code totals override individual manual fields without double counting',()=>{
 const s=defaults(),o=newObject();o.parts=[{grams:100,minutes:900,qty:4,matId:'forest',dims:[10,10,10]}];o.gcode={valid:true,minutes:60,filaments:[{matId:'ivory',grams:20}]};
 const c=calculate(o,s.materials,s.settings,3);near(c.grams,20);near(c.hours,1);near(c.requirements.minutes,180);near(c.requirements.rows[0].grams,60);
});
test('Bed grid accounts for gaps, margin, rotated footprints, height and oversized parts',()=>{
 const s={bedX:220,bedY:220,bedZ:250,margin:5,gap:4};assert.equal(bedCapacity([38,55,4],s).count,15);assert.equal(bedCapacity([221,20,4],s).count,0);assert.equal(bedCapacity([20,20,251],s).count,0);assert.equal(bedCapacity([0,20,5],s).count,0);assert.equal(bedCapacity([20,20,150],s,2).count,0);
 const r=bedCapacity([120,70,5],{...s,bedX:200,bedY:300});assert.equal(r.rotated,true);assert.equal(r.count,4);
});
test('Cura meter consumption converts to grams and handles multiple materials',()=>{
 const r=parseGcode(';FLAVOR:Marlin\n;TIME:7265\n;Filament used: 1.34122m, 0.25m\n;MINX:16.302\n;MAXX:56.302\n;MINY:3\n;MAXY:23\n;MINZ:0.2\n;MAXZ:10.2\n');
 assert.equal(r.valid,true);near(r.minutes,7265/60);near(r.grams[0],1341.22*Math.PI*(1.75/2)**2/1000*1.24);assert.equal(r.grams.length,2);assert.deepEqual(r.dims,[40,20,10]);
});
test('Prusa/Orca headers parse grams and long durations; missing time remains missing',()=>{
 const r=parseGcode('; filament used [g] = 23.5, 5.5\n; estimated printing time (normal mode) = 1d 2h 3m 4s');near(r.minutes,1563+4/60);assert.deepEqual(r.grams,[23.5,5.5]);assert.equal(r.valid,true);
 assert.equal(parseGcode(';TIME:3600').valid,false);assert.equal(parseGcode('G1 X1 Y2').valid,false);
});
test('All demo meshes have finite positive dimensions and export valid binary STL',async()=>{
 for(const b of seedBoxes())for(const p of b.objects[0].parts){const g=demoModel(p.demo);const d=bounds(g);assert.ok(d.every(v=>Number.isFinite(v)&&v>0),p.demo);const blob=exportSTL(g);assert.ok(blob.size>84);}
});
test('STL loader honors explicit units and normalizes the bounding box',async()=>{
 const g=demoModel('leaf'),stl=exportSTL(g),file=new File([stl],'leaf.stl');
 const mm=await parseModel(file,'mm'),cm=await parseModel(file,'cm');mm.dims.forEach((v,i)=>near(cm.dims[i],v*10));
 const read=await parseModel(new File(['v 0 0 0\nv 10 0 0\nv 0 20 5\nf 1 2 3\n'],'part.obj'));assert.deepEqual(read.dims,[10,20,5]);
});
test('Every page renders, data is escaped and coordinate fields allow negative values',()=>{
 const s=defaults();s.boxes=seedBoxes();migrate(s);s.boxes[0].name='<script>alert(1)</script>';const u={view:'shelf',selected:s.boxes[0].id,objectId:null,partId:null,filter:'Todo',search:'',sort:'recent',tab:'overview'};
 for(const view of ['shelf','calculator','materials','printer','settings','help','workspace','pos','print']){u.view=view;const html=renderApp(s,u,'C:\\Models');assert.ok(html.includes('3D-Woods'));assert.ok(!html.includes('<script>alert(1)</script>'));}
 for(const tab of ['overview','parts','cost','files']){u.view='workspace';u.tab=tab;assert.ok(renderApp(s,u,'C:\\Models').length>1000);}
 const f=field('x',-5,'min="-100" step="1"');assert.equal((f.match(/min=/g)||[]).length,1);assert.equal((f.match(/step=/g)||[]).length,1);
});
test('Backup validation rejects invalid structures',()=>{assert.throws(()=>validateState({version:1,boxes:[]}));const s=defaults();s.boxes=seedBoxes();assert.equal(validateState(s),s);});

test('Shelves grow in groups of five slots and the selected box leaves its original slot',()=>{const s=defaults();s.boxes=Array.from({length:11},(_,i)=>{const b=seedBoxes()[0];b.id='box-'+i;b.name='Caja '+i;return b;});migrate(s);const u={view:'shelf',selected:'box-0',focusId:'box-0',filter:'Todo',search:'',sort:'name',list:false,picked:false,devices:[],printerStatus:{}};let html=renderApp(s,u,'local');assert.equal((html.match(/class="rack-row"/g)||[]).length,3);assert.equal((html.match(/data-slot=/g)||[]).length,15);assert.equal((html.match(/class="box-card /g)||[]).length,11);assert.ok(!html.includes('id="inspector"'));u.picked=true;html=renderApp(s,u,'local');assert.equal((html.match(/class="rack-placeholder"/g)||[]).length,1);assert.equal((html.match(/class="box-card /g)||[]).length,11);assert.ok(html.includes('id="inspector"'));});

test('Settings host printers and branding; tickets, returns and cuts carry the brand and full detail',()=>{
 const s=defaults();s.boxes=seedBoxes();migrate(s);s.settings.businessName='Taller Roble';s.settings.businessPhone='555 0101';s.supplies[0].stock=10;
 const u={view:'settings',selected:s.boxes[0].id,objectId:null,partId:null,filter:'Todo',search:'',sort:'recent',tab:'overview',devices:[],printerStatus:{}};
 let html=renderApp(s,u,'C:\\Models');assert.ok(html.includes('Mis impresoras'));assert.ok(html.includes('Marca de tickets y cortes'));assert.ok(html.includes('data-setting="businessName"'));assert.ok(!html.includes('data-view="printer"'));
 const leaf=s.boxes.find(b=>b.id==='leaf'),object=leaf.objects[0],draftCart=[{kind:'model',boxId:'leaf',objectId:object.id,name:object.name,qty:1,unitPrice:50,colors:['ivory']}];
 s.posDrafts.push({id:'draft',number:'W-000042',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),customer:'Ana',note:'Pintar',reserve:true,cart:draftCart});
 u.view='pos';u.cart=draftCart;html=renderApp(s,u,'C:\\Models');assert.ok(html.includes('W-000042'));assert.ok(html.includes('Tickets sin cobrar'));assert.ok(html.includes('Color 1'));assert.ok(html.includes('data-pos-color'));
 const sale=recordSale(s,[{boxId:'leaf',objectId:object.id,qty:1,unitPrice:50,colors:['ivory']}],{reserve:false,payment:{method:'efectivo',received:50},customer:'Ana'});
 assert.equal(sale.ticket,'W-000043');
 const doc=ticketDocument(sale,s.settings,[]);assert.ok(doc.includes('Taller Roble'));assert.ok(doc.includes('555 0101'));assert.ok(doc.includes('W-000043'));assert.ok(doc.includes('doc-logo'));assert.ok(doc.includes('PLA · Marfil'));
 const ret=recordReturn(s,{saleId:sale.id,items:[{lineIndex:0,qty:1}],method:'efectivo',note:'Regreso'});const rd=returnDocument(ret,sale,s.settings);assert.ok(rd.includes('DEVOLUCIÓN'));assert.ok(rd.includes(ret.ticket));assert.ok(rd.includes('Regreso'));
 const cut=recordCashCut(s,{type:'partial',note:'Turno'});const cd=cutDocument(cut,s.settings);assert.ok(cd.includes('CORTE DE CAJA PARCIAL'));assert.ok(cd.includes('Detalle de ventas'));assert.ok(cd.includes('Devoluciones'));assert.ok(cd.includes('Taller Roble'));
 const virtual=standaloneDocument('Ticket',doc,s.settings);assert.ok(virtual.startsWith('<!doctype html>'));assert.ok(virtual.includes('Taller Roble'));
});

test('Custom categories drive filters, box assignment and the settings manager',()=>{
 const s=defaults();s.boxes=seedBoxes();s.categories=['Sin categoría','Figuras','Decoración','Funcionales','Llaveros','Prototipos'];s.boxes[0].category='Prototipos';migrate(s);
 const u={view:'shelf',selected:null,objectId:null,partId:null,filter:'Prototipos',search:'',sort:'recent',list:false,picked:false,devices:[],printerStatus:{}};
 let html=renderApp(s,u,'local');
 assert.ok(html.includes('data-filter="Prototipos"'));
 assert.ok(html.includes('data-action="new-category"'));
 assert.equal((html.match(/class="box-card /g)||[]).length,1);
 assert.ok(html.includes('class="rack-unit"'));
 assert.equal((html.match(/class="rack-post /g)||[]).length,2);
 u.filter='No existe';html=renderApp(s,u,'local');assert.equal(u.filter,'Todo');
 u.view='workspace';u.selected=s.boxes[0].id;u.tab='overview';
 html=renderApp(s,u,'local');assert.ok(html.includes('data-box-field="category"'));assert.ok(html.includes('<option value="Prototipos" selected>'));
 u.view='settings';html=renderApp(s,u,'local');assert.ok(html.includes('Categorías de cajas'));assert.ok(html.includes('data-action="rename-category" data-name="Prototipos"'));assert.ok(html.includes('1 caja(s)'));
 for(const bad of [['Todo'],['Figuras','figuras'],[''],['x'.repeat(61)]])assert.throws(()=>validateState({...defaults(),categories:bad}),/Categorías/);
 assert.doesNotThrow(()=>validateState({...defaults(),categories:['Sin categoría','Prototipos','Nueva']}));
});


test('Huge assemblies get a bounded preview and keep every part for calculations',()=>{
 const parts=Array.from({length:30},(_,i)=>({id:'p'+i,fileId:'f'+i}));
 const sizes=Object.fromEntries(parts.map((p,i)=>[p.fileId,50*1024*1024]));
 const limited=previewParts(parts,sizes,160*1024*1024);
 assert.equal(limited.full,false);
 assert.equal(limited.parts.length,3);
 assert.deepEqual(limited.parts.map(p=>p.id),['p0','p1','p2']);
 assert.ok(limited.bytes<=160*1024*1024);
 const selected=previewParts(parts,sizes,160*1024*1024,'p29');
 assert.ok(selected.parts.some(p=>p.id==='p29'),'the selected piece is always included');
 assert.equal(selected.parts.length,3);
 const full=previewParts(parts,Object.fromEntries(parts.map(p=>[p.fileId,1])),160*1024*1024);
 assert.equal(full.full,true);
 assert.equal(full.parts.length,30);
});

test('Automatic folder scans keep assemblies together and every other file as its own object',()=>{
 const single=newBox('Caja');single.objects[0].parts.push({id:'p1'},{id:'p2'});
 assert.equal(scanGroup(single),'parts','a single multi-part assembly keeps receiving components');
 const many=newBox('Perros');many.objects.push(newObject('Otro'));
 assert.equal(scanGroup(many),'objects','a box with separate models does not merge new files into the first one');
 const one=newBox('Un modelo');one.objects[0].parts.push({id:'p1'});
 assert.equal(scanGroup(one),'objects','a single one-part model receives new models as objects');
 assert.equal(scanGroup(newBox('Vacía')),'objects');
});
