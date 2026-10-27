import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,seedBoxes,calculate} from '../dist/core.js';
import {migrate,salePreview,recordSale,recordPurchase,recordProduction,recordAdjustment,voidTransaction,totals,alerts,removeInventory,setPrinter,saveActivePrinter,validateWorkshop,claimTicket,peekTicket,recordReturn,saleReturns,saleReturnedQuantities,cashCutReport,recordCashCut} from '../dist/workshop.js';
const fixture=()=>{const s=defaults();s.boxes=seedBoxes();return migrate(s);};
const leaf=s=>s.boxes.find(b=>b.id==='leaf');
const cart=(s,qty=10)=>[{boxId:'leaf',objectId:leaf(s).objects[0].id,qty,unitPrice:50}];
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('Migration keeps original stock, links accessories, and is idempotent',()=>{const s=fixture();const id=s.supplies[0].id;assert.equal(s.supplies[0].stock,0);assert.equal(leaf(s).objects[0].extras[0].supplyId,id);migrate(s);assert.equal(s.supplies.length,1);assert.equal(s.supplies[0].id,id);assert.equal(s.materials[0].stock,750);assert.equal(s.printers[0].bedX,220);});
test('Multi-object order consumes all shared supplies and colors once; no insufficient sale commits',()=>{const s=fixture(),before=structuredClone(s);assert.throws(()=>recordSale(s,cart(s)),/Stock insuficiente/);assert.deepEqual(s,before);recordPurchase(s,{kind:'supply',id:s.supplies[0].id,packs:1,packUnits:100,total:150});const order=[...cart(s),{boxId:'jackalope',objectId:s.boxes[0].objects[0].id,qty:2,unitPrice:250}],p=salePreview(s,order,true);near(p.movements.find(m=>m.id==='forest').units,(70+16)*1.1);const t=recordSale(s,order);near(s.materials[0].stock,750-94.6);assert.equal(s.supplies[0].stock,90);assert.equal(t.total,1000);assert.equal(s.ledger.length,2);assert.equal(t.lines.length,2);assert.equal(t.currency,'MXN');});
test('Purchases add full packages and reduce cash once; estimated margin stays separate',()=>{const s=fixture();recordPurchase(s,{kind:'supply',id:s.supplies[0].id,packs:2,packUnits:100,total:300});assert.equal(s.supplies[0].stock,200);recordSale(s,cart(s));const t=totals(s);assert.equal(t.sales,500);assert.equal(t.purchases,300);assert.equal(t.balance,200);near(t.profit,500-s.ledger[1].cost);s.materials[0].price=10000;assert.equal(s.ledger[1].cost,500-t.profit);s.currency='USD';assert.deepEqual(totals(s),{sales:0,purchases:0,balance:0,profit:0});});
test('Void sales restores exact movements; purchase cannot reverse consumed units or be voided twice',()=>{const s=fixture(),purchase=recordPurchase(s,{kind:'supply',id:s.supplies[0].id,packs:1,packUnits:10,total:15}),sale=recordSale(s,cart(s),{reserve:false});assert.throws(()=>voidTransaction(s,purchase.id),/consumió/);near(s.materials[0].stock,680);voidTransaction(s,sale.id);near(s.materials[0].stock,750);assert.equal(s.supplies[0].stock,10);voidTransaction(s,purchase.id);assert.equal(s.supplies[0].stock,0);assert.throws(()=>voidTransaction(s,sale.id));assert.deepEqual(totals(s),{sales:0,purchases:0,balance:0,profit:0});});
test('Deletion requires replacement when used, invalidates measurements, preserves historical identities',()=>{const s=fixture();assert.throws(()=>removeInventory(s,'material','forest'),/reemplazo/);recordPurchase(s,{kind:'material',id:'forest',packs:1,packUnits:1000,total:350});removeInventory(s,'material','forest','ivory');assert.equal(s.materials.find(m=>m.id==='forest').retired,true);assert.equal(leaf(s).objects[0].parts[0].matId,'ivory');assert.equal(leaf(s).objects[0].parts[0].grams,null);assert.equal(s.ledger[0].movements[0].id,'forest');assert.ok(!alerts(s).some(m=>m.id==='forest'));voidTransaction(s,s.ledger[0].id);});
test('Printer profiles retain their own sizes and hourly costs when switching',()=>{const s=fixture(),a=s.printers[0];s.printers.push({...a,id:'other',printer:'Otra',bedX:300,power:200});setPrinter(s,'other');assert.equal(s.settings.bedX,300);s.settings.power=250;saveActivePrinter(s);setPrinter(s,a.id);assert.equal(s.settings.power,120);setPrinter(s,'other');assert.equal(s.settings.power,250);});
test('Invalid transactions and backups do not turn inventory negative or accept non-finite values',()=>{const s=fixture(),before=structuredClone(s);for(const packs of [-1,0,0.5,NaN,Infinity])assert.throws(()=>recordPurchase(s,{kind:'material',id:'forest',packs,packUnits:1000,total:5}));assert.deepEqual(s,before);s.supplies[0].stock=-1;assert.throws(()=>validateWorkshop(s));});
test('Supply purchase price is explicit and calculator follows shared per-unit cost edits',()=>{const s=fixture(),o=leaf(s).objects[0];s.supplies[0].unitCost=3;migrate(s);near(calculate(o,s.materials,s.settings).extras,3);assert.equal(alerts(s)[0].name,'Argolla de llavero');});

test('Removing the last linked supply can leave assignment pending without recreating deleted stock',()=>{const s=fixture(),id=s.supplies[0].id;removeInventory(s,'supply',id,'__none__');migrate(s);assert.equal(s.supplies.length,0);assert.equal(leaf(s).objects[0].extras[0].supplyId,'');assert.ok(calculate(leaf(s).objects[0],s.materials,s.settings).missing);});

test('Production consumes the bill of materials; finished product sales do not consume it twice',()=>{const s=fixture(),o=leaf(s).objects[0];recordPurchase(s,{kind:'supply',id:s.supplies[0].id,packs:1,packUnits:100,total:150});s.products.push({id:'keychain',name:'Llavero',sku:'LL-01',sourceBoxId:'leaf',sourceObjectId:o.id,stock:0,minStock:3,unitCost:0,packUnits:1,price:50,unit:'pzas'});const production=recordProduction(s,{productId:'keychain',qty:10});near(s.materials[0].stock,750-77);assert.equal(s.supplies[0].stock,90);assert.equal(s.products[0].stock,10);const materials=s.materials[0].stock;const sale=recordSale(s,[{kind:'product',productId:'keychain',qty:3,unitPrice:50}],{customer:'Ana',payment:{method:'efectivo',received:200}});assert.equal(s.products[0].stock,7);assert.equal(s.materials[0].stock,materials);assert.equal(s.supplies[0].stock,90);assert.equal(sale.ticket,'W-000001');assert.equal(sale.payment.change,50);near(sale.cost,production.cost/10*3);assert.throws(()=>voidTransaction(s,production.id),/posteriores/);voidTransaction(s,sale.id);voidTransaction(s,production.id);assert.equal(s.products[0].stock,0);assert.equal(s.products[0].unitCost,0);near(s.materials[0].stock,750);assert.equal(s.supplies[0].stock,100);});

test('Finished stock shortages and insufficient payment reject the entire ticket',()=>{const s=fixture();s.products.push({id:'p',name:'Figura',stock:2,minStock:1,unitCost:10,packUnits:1,price:50,unit:'pzas'});const before=structuredClone(s);assert.throws(()=>recordSale(s,[{kind:'product',productId:'p',qty:3,unitPrice:50}]),/Stock insuficiente/);assert.deepEqual(s,before);assert.throws(()=>recordSale(s,[{kind:'product',productId:'p',qty:1,unitPrice:50}],{payment:{method:'efectivo',received:49}}),/no cubre/);assert.deepEqual(s,before);});

test('Physical counts are non-cash adjustments; purchases of equipment reduce the balance',()=>{const s=fixture();s.assets.push({id:'tool',name:'Pinzas',stock:0,minStock:1,unitCost:40,packUnits:1,unit:'pzas'});const adjustment=recordAdjustment(s,'asset','tool',2);assert.equal(s.assets[0].stock,2);assert.equal(totals(s).balance,0);recordPurchase(s,{kind:'asset',id:'tool',packs:2,packUnits:1,total:80});assert.equal(s.assets[0].stock,4);assert.equal(totals(s).balance,-80);voidTransaction(s,adjustment.id);assert.equal(s.assets[0].stock,2);assert.equal(totals(s).balance,-80);validateWorkshop(s);});

test('Multicolor filaments can be chosen per sale line and keep validation and cost correct',()=>{
 const s=fixture();s.supplies[0].stock=10;const ivory=s.materials.find(m=>m.id==='ivory');ivory.colors=['#111111','#e0d3b5'];ivory.color='#111111';ivory.price=400;
 const base=salePreview(s,cart(s,1),true),picked=salePreview(s,[{...cart(s,1)[0],colors:['ivory']}],true);
 assert.deepEqual(picked.lines[0].colors,['ivory']);assert.equal(picked.lines[0].colorRequests[0].name,'PLA · Marfil');assert.deepEqual(picked.lines[0].colorRequests[0].colors,['#111111','#e0d3b5']);
 near(picked.movements.find(m=>m.id==='ivory').units,7.7);assert.ok(!picked.movements.some(m=>m.id==='forest'));
 near(picked.lines[0].unitCost,base.lines[0].unitCost+.385);
 const sale=recordSale(s,[{...cart(s,1)[0],colors:['ivory']}],{reserve:false});assert.equal(sale.lines[0].colorRequests[0].matId,'ivory');assert.ok(s.materials.find(m=>m.id==='ivory').stock<900);assert.ok(s.materials.find(m=>m.id==='forest').stock===750);
 ivory.colors=['naranja'];assert.throws(()=>validateWorkshop(s),/Colores del filamento/);
});

test('Open tickets claim stable sequential numbers and survive migration',()=>{
 const s=fixture();recordPurchase(s,{kind:'supply',id:s.supplies[0].id,packs:1,packUnits:100,total:150});assert.equal(peekTicket(s),'W-000001');const first=claimTicket(s);assert.equal(first,'W-000001');
 s.posDrafts.push({id:'draft-1',number:first,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),customer:'Ana',note:'',reserve:true,cart:[{kind:'model',boxId:'leaf',objectId:leaf(s).objects[0].id,name:'Llavero hoja',qty:1,unitPrice:50}]});
 assert.equal(peekTicket(s),'W-000002');const second=claimTicket(s);const sale=recordSale(s,cart(s,1),{ticket:second,reserve:false});
 assert.equal(sale.ticket,'W-000002');assert.equal(peekTicket(s),'W-000003');assert.throws(()=>recordSale(s,cart(s,1),{ticket:second}),/ya fue cobrado/);
 const reloaded=structuredClone(s);migrate(reloaded);assert.equal(reloaded.posDrafts[0].number,'W-000001');assert.equal(reloaded.ticketSerial,2);assert.equal(peekTicket(reloaded),'W-000003');
});

test('Partial returns restore stock and cash without deleting the sale and can be voided',()=>{
 const s=fixture();recordPurchase(s,{kind:'supply',id:s.supplies[0].id,packs:1,packUnits:100,total:150});
 const sale=recordSale(s,cart(s,4),{reserve:false,payment:{method:'efectivo',received:200},customer:'Luis'}),matAfter=s.materials.find(m=>m.id==='forest').stock,supAfter=s.supplies[0].stock;
 const ret=recordReturn(s,{saleId:sale.id,items:[{lineIndex:0,qty:2}],method:'efectivo',note:'Talla'});
 assert.equal(ret.type,'return');assert.equal(ret.total,100);assert.equal(ret.saleTicket,sale.ticket);assert.equal(saleReturns(s,sale.id).length,1);assert.equal(saleReturnedQuantities(s,sale.id)[0],2);
 near(s.materials.find(m=>m.id==='forest').stock,matAfter+14);assert.equal(s.supplies[0].stock,supAfter+2);near(totals(s).sales,100);near(s.ledger.find(t=>t.id===sale.id).total,200);
 assert.throws(()=>voidTransaction(s,sale.id),/devoluciones/);assert.throws(()=>recordReturn(s,{saleId:sale.id,items:[{lineIndex:0,qty:3}]}),/Solo quedan 2/);
 const ret2=recordReturn(s,{saleId:sale.id,items:[{lineIndex:0,qty:2}],method:'efectivo'});assert.equal(ret2.total,100);assert.throws(()=>recordReturn(s,{saleId:sale.id,items:[{lineIndex:0,qty:1}]}),/Solo quedan 0|Todas las piezas/);
 voidTransaction(s,ret2.id);near(s.materials.find(m=>m.id==='forest').stock,matAfter+14);voidTransaction(s,ret.id);near(s.materials.find(m=>m.id==='forest').stock,matAfter);voidTransaction(s,sale.id);near(totals(s).sales,0);validateWorkshop(s);
});

test('Partial cuts inform without resetting while full cuts start a new period and keep sales',()=>{
 const s=fixture();s.supplies[0].stock=10;const sale=recordSale(s,cart(s,2),{reserve:false,payment:{method:'efectivo',received:100}});const start=s.cashCutStart;
 recordReturn(s,{saleId:sale.id,items:[{lineIndex:0,qty:1}],method:'efectivo'});
 const partial=recordCashCut(s,{type:'partial',note:'Turno mañana'});
 assert.equal(partial.report.counts.sales,1);near(partial.report.salesTotal,100);near(partial.report.returnsTotal,50);near(partial.report.balance,50);assert.equal(partial.report.payments[0].net,50);assert.equal(s.cashCutStart,start);assert.equal(s.ledger.filter(t=>t.type==='sale').length,1);
 const full=recordCashCut(s,{type:'full',note:'Cierre'});near(full.report.balance,50);assert.notEqual(s.cashCutStart,start);assert.equal(s.cashCuts.length,2);assert.equal(s.ledger.filter(t=>t.type==='sale').length,1);
 const after=cashCutReport(s,{type:'partial'});assert.equal(after.counts.sales,0);near(after.salesTotal,0);assert.equal(after.payments.length,0);validateWorkshop(s);
});

test('Custom categories migrate without duplicates, reserved names or orphaned boxes',()=>{
 const s=fixture();
 s.categories=['Figuras',' figuras ','Decoración','Todo','Armables','Funcionales','Funcionales','Llaveros'];
 s.boxes[0].category='llaveros';s.boxes[1].category='Inexistente';s.boxes[2].category='';
 migrate(s);
 assert.deepEqual(s.categories,['Sin categoría','Figuras','Decoración','Funcionales','Llaveros','Inexistente']);
 assert.equal(s.boxes[0].category,'Llaveros');
 assert.equal(s.boxes[1].category,'Inexistente');
 assert.equal(s.boxes[2].category,'Sin categoría');
 const snapshot=structuredClone(s.categories);migrate(s);
 assert.deepEqual(s.categories,snapshot);
 assert.equal(s.boxes[0].category,'Llaveros');
});

