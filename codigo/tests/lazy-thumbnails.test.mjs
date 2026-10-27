import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {defaults,newBox} from '../dist/core.js';

const wait=ms=>new Promise(r=>setTimeout(r,ms));
const cover='data:image/webp;base64,UklGRgAAAABXRUJQ';

function library(count){
  const state=defaults();
  state.initialized=true;
  state.boxes=Array.from({length:count},(_,i)=>{
    const b=newBox('Guardada '+i);
    b.id='saved-'+i;b.thumbnail=i===0?null:cover;
    b.objects[0].parts.push({id:'p-'+i,name:'Modelo',fileId:'Carpeta/modelo-'+i+'.stl',unit:'mm',matId:'forest',qty:1,dims:[20,20,20],position:[0,0,0],rotation:[0,0,0],scale:1});
    return b;
  });
  return state;
}

test('Opening the shelf uses each stored cover and only loads the one box that lacks it',async()=>{
  const html=(await fs.readFile(new URL('../dist/index.html',import.meta.url),'utf8')).replace('<head>','<head><meta name="woods-desktop" content="1">');
  const dom=new JSDOM(html,{url:'http://127.0.0.1:31337/',pretendToBeVisual:true,virtualConsole:new VirtualConsole()});
  for(const k of ['window','document','location','DOMParser'])globalThis[k]=dom.window[k];
  dom.window.scrollTo=()=>{};dom.window.HTMLCanvasElement.prototype.getContext=()=>null;
  globalThis.ResizeObserver=class{observe(){}disconnect(){}};
  const oldInterval=globalThis.setInterval;globalThis.setInterval=(...a)=>oldInterval(...a).unref();
  const oldFetch=globalThis.fetch,state=library(40),requested=[];
  globalThis.fetch=async(path,options={})=>{
    const route=String(path);
    if(route.startsWith('data:'))return oldFetch(path,options);
    let data;
    if(route==='/api/state'){if(options.method==='POST')data={saved:true};else data={state,root:'C:\\Models'};}
    else if(route==='/api/scan')data={root:'C:\\Models',boxes:[]};
    else if(route==='/api/printers')data={devices:[],statuses:{},checkedAt:new Date().toISOString()};
    else if(route==='/api/print-status')data={state:'idle'};
    else if(route.startsWith('/api/file?')){requested.push(new URL('http://test'+route).searchParams.get('path'));return new Response('',{status:404});}
    else throw Error('Unexpected route: '+route);
    return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
  };
  try{
    await import('../dist/app.js');await wait(900);
    const cards=[...document.querySelectorAll('img.cube-art')];
    assert.equal(document.querySelectorAll('.box-card').length,40);
    assert.equal(cards.length,40);
    assert.equal(cards.filter(img=>img.src===cover).length,39,'closed boxes show their saved covers');
    assert.equal(cards.filter(img=>img.src.startsWith('data:image/svg+xml')).length,1,'only the box without a cover uses the illustration');
    assert.deepEqual(requested,['Carpeta/modelo-0.stl'],'no other stored mesh is opened');
  }finally{globalThis.fetch=oldFetch;globalThis.setInterval=oldInterval;dom.window.close();}
});
