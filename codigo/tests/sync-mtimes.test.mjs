import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {defaults,newBox} from '../dist/core.js';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const cover='data:image/webp;base64,UklGRgAAAABXRUJQ';

test('A copied folder with new timestamps does not reparse unchanged models on startup',async()=>{
  const html=(await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace('<head>','<head><meta name="woods-desktop" content="1">');
  const dom=new JSDOM(html,{url:'http://127.0.0.1:31337/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
  for(const k of ['window','document','location','DOMParser'])globalThis[k]=dom.window[k];
  dom.window.scrollTo=()=>{};dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  const oldInterval=globalThis.setInterval;globalThis.setInterval=(...a)=>oldInterval(...a).unref();
  const oldFetch=globalThis.fetch,state=defaults(),box=newBox('Caja copiada'),requested=[];
  state.initialized=true;box.folder='Caja copiada';box.thumbnail=cover;
  const file={id:'Caja copiada/modelo.stl',name:'modelo.stl',size:4096,modified:1000};
  const extra={id:'Caja copiada/extra.stl',name:'extra.stl',size:8192,modified:1000};
  box.files=[file,extra];
  box.objects[0].parts.push({id:'p-1',name:'modelo',fileId:file.id,unit:'mm',matId:'forest',qty:1,dims:[20,20,20],position:[0,0,0],rotation:[0,0,0],scale:1});
  state.boxes=[box];
  globalThis.fetch=async(path,options={})=>{
    const route=String(path);
    if(route.startsWith('data:'))return oldFetch(path,options);
    let data;
    if(route==='/api/state'){if(options.method==='POST')data={saved:true};else data={state,root:'C:\\Models'};}
    else if(route==='/api/scan')data={root:'C:\\Models',boxes:[{...box,files:[{...file,modified:9000},{...extra,modified:9000}]}]};
    else if(route==='/api/printers')data={devices:[],statuses:{},checkedAt:new Date().toISOString()};
    else if(route==='/api/print-status')data={state:'idle'};
    else if(route.startsWith('/api/file?')){requested.push(new URL('http://test'+route).searchParams.get('path'));return new Response('',{status:404});}
    else throw Error('Unexpected route: '+route);
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  };
  try{
    await import('../dist/app.js');await wait(900);
    assert.deepEqual(requested,[],'the same file size must not trigger a mesh reload just because its timestamp changed');
  }finally{globalThis.fetch=oldFetch;globalThis.setInterval=oldInterval;dom.window.close();}
});
