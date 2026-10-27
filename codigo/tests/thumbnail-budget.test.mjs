import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {defaults,newBox} from '../dist/core.js';
import {demoModel,exportSTL} from '../dist/models.js';

const wait=ms=>new Promise(r=>setTimeout(r,ms));

test('Generating a missing cover loads one piece instead of the whole assembly',async()=>{
  const html=(await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace('<head>','<head><meta name="woods-desktop" content="1">');
  const dom=new JSDOM(html,{url:'http://127.0.0.1:31337/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
  for(const k of ['window','document','location','DOMParser'])globalThis[k]=dom.window[k];
  dom.window.scrollTo=()=>{};dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  const oldInterval=globalThis.setInterval;globalThis.setInterval=(...a)=>oldInterval(...a).unref();
  const oldFetch=globalThis.fetch,state=defaults(),box=newBox('Montaje grande'),requested=[];
  state.initialized=true;box.folder='Montaje grande';box.thumbnail=null;
  const stl=exportSTL(demoModel('leaf'));
  for(let i=0;i<30;i++){
    const file={id:`Montaje grande/pieza-${i}.stl`,name:`pieza-${i}.stl`,size:stl.size,modified:1000+i};
    box.files.push(file);
    box.objects[0].parts.push({id:`p-${i}`,name:`pieza-${i}`,fileId:file.id,unit:'mm',matId:'forest',qty:1,dims:[20,20,20],position:[i*25,0,0],rotation:[0,0,0],scale:1});
  }
  state.boxes=[box];
  globalThis.fetch=async(path,options={})=>{
    const route=String(path);
    if(route.startsWith('data:'))return oldFetch(path,options);
    let data;
    if(route==='/api/state'){if(options.method==='POST')data={saved:true};else data={state,root:'C:\\Models'};}
    else if(route==='/api/scan')data={root:'C:\\Models',boxes:[]};
    else if(route==='/api/printers')data={devices:[],statuses:{},checkedAt:new Date().toISOString()};
    else if(route==='/api/print-status')data={state:'idle'};
    else if(route.startsWith('/api/file?')){requested.push(new URL('http://test'+route).searchParams.get('path'));return new Response(stl,{headers:{'Content-Type':'application/octet-stream'}});}
    else throw Error('Unexpected route: '+route);
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  };
  try{
    await import('../dist/app.js');await wait(1200);
    assert.equal(requested.length,1,'only the representative piece is opened for the cover');
    assert.equal(requested[0],'Montaje grande/pieza-0.stl');
  }finally{globalThis.fetch=oldFetch;globalThis.setInterval=oldInterval;dom.window.close();}
});
