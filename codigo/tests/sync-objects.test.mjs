import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {defaults,newBox} from '../dist/core.js';
import {demoModel,exportSTL} from '../dist/models.js';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const cover='data:image/webp;base64,UklGRgAAAABXRUJQ';

test('A new file found by the folder scan becomes its own object in a multi-model box',async()=>{
  const html=(await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace('<head>','<head><meta name="woods-desktop" content="1">');
  const dom=new JSDOM(html,{url:'http://127.0.0.1:31337/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
  for(const k of ['window','document','location','DOMParser'])globalThis[k]=dom.window[k];
  dom.window.scrollTo=()=>{};dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  const oldInterval=globalThis.setInterval;globalThis.setInterval=(...a)=>oldInterval(...a).unref();
  const oldFetch=globalThis.fetch,state=defaults(),box=newBox('Perros'),saved=[];
  const stl=exportSTL(demoModel('leaf'));
  state.initialized=true;box.folder='Perros';box.thumbnail=cover;
  const part=(i)=>({id:'p-'+i,name:'perro-'+i,fileId:`Perros/perro-${i}.stl`,unit:'mm',matId:'forest',qty:1,dims:[20,20,20],position:[0,0,0],rotation:[0,0,0],scale:1});
  const file=(i)=>({id:`Perros/perro-${i}.stl`,name:`perro-${i}.stl`,size:stl.size,modified:1000+i});
  box.files=[file(1),file(2)];
  box.objects=[{...box.objects[0],id:'o-1',name:'perro-1',parts:[part(1)]},{...box.objects[0],id:'o-2',name:'perro-2',parts:[part(2)]}];
  state.boxes=[box];
  const fresh={...file(3),size:stl.size+4,modified:3000};
  globalThis.fetch=async(path,options={})=>{
    const route=String(path);
    if(route.startsWith('data:'))return oldFetch(path,options);
    let data;
    if(route==='/api/state'){
      if(options.method==='POST'){saved.push(JSON.parse(options.body));data={saved:true};}
      else data={state,root:'C:\\Models'};
    }
    else if(route==='/api/scan')data={root:'C:\\Models',boxes:[{...box,files:[...box.files,fresh]}]};
    else if(route==='/api/printers')data={devices:[],statuses:{},checkedAt:new Date().toISOString()};
    else if(route==='/api/print-status')data={state:'idle'};
    else if(route.startsWith('/api/file?'))return new Response(stl,{headers:{'Content-Type':'application/octet-stream'}});
    else throw Error('Unexpected route: '+route);
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  };
  try{
    await import('../dist/app.js');await wait(1600);
    const after=saved.filter(s=>s&&s.boxes).at(-1);
    assert.ok(after,'the scan result is saved');
    const box2=after.boxes.find(b=>b.folder==='Perros');
    assert.equal(box2.objects.length,3,'the new file is added as a third object');
    assert.equal(box2.objects[0].parts.length,1,'the first model is not turned into a multi-part assembly');
    assert.ok(box2.objects.some(o=>o.name==='perro-3'&&o.parts.length===1));
    assert.equal(box2.files.length,3);
  }finally{globalThis.fetch=oldFetch;globalThis.setInterval=oldInterval;dom.window.close();}
});
