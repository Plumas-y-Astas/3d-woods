import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {zipSync,strToU8} from 'three/addons/libs/fflate.module.js';
import {parseModel,embeddedThumbnail} from '../dist/models.js';
test('3MF units are converted to millimeters',async()=>{
 const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;
 const rels='<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>';
 const xml='<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="2" y="0" z="0"/><vertex x="0" y="3" z="1"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources><build><item objectid="1"/></build></model>';
 const data=zipSync({'_rels/.rels':strToU8(rels),'3D/3dmodel.model':strToU8(xml)});
 const r=await parseModel(new File([data],'sample.3mf'));assert.deepEqual(r.dims,[20,30,10]);dom.window.close();
});
test('3MF covers use the small embedded preview instead of opening the mesh',async()=>{
 const png=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3,4]);
 const big=new Uint8Array(2_000_000);
 const data=zipSync({'Metadata/thumbnail.png':png,'3D/3dmodel.model':big});
 const src=await embeddedThumbnail(new File([data],'sample.3mf'));
 assert.ok(src.startsWith('data:image/png;base64,'));
 assert.equal(src,`data:image/png;base64,${btoa(String.fromCharCode(...png))}`);
});
test('BambuStudio production extensions load geometry from separate object files',async()=>{
 const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;
 const main='<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="1" type="model"><components><component p:path="/3D/Objects/object_2.model" objectid="2"/></components></object></resources><build><item objectid="1"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></build></model>';
 const obj='<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="2" type="model"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="2" y="0" z="0"/><vertex x="0" y="3" z="1"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object></resources></model>';
 const data=zipSync({'3D/3dmodel.model':strToU8(main),'3D/Objects/object_2.model':strToU8(obj)});
 const r=await parseModel(new File([data],'bambu.3mf'));
 assert.deepEqual(r.dims,[12,3,1],'the component geometry loads from its own document and each build transform is applied');
 dom.window.close();
});
test('BambuStudio plate previews are used as covers',async()=>{
 const png=new Uint8Array([137,80,78,71,13,10,26,10,9,9,9]);
 const data=zipSync({'Metadata/plate_1_small.png':png,'Metadata/plate_1.png':new Uint8Array(1000)});
 const src=await embeddedThumbnail(new File([data],'bambu.3mf'));
 assert.equal(src,`data:image/png;base64,${btoa(String.fromCharCode(...png))}`);
});
test('Embedded GLB geometry converts meters and Y-up into millimeters and Z-up',async()=>{
 const bin=new Float32Array([0,0,0, .02,0,0, 0,.04,.01]);
 const json={asset:{version:'2.0'},buffers:[{byteLength:bin.byteLength}],bufferViews:[{buffer:0,byteOffset:0,byteLength:bin.byteLength}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[.02,.04,.01]}],meshes:[{primitives:[{attributes:{POSITION:0}}]}],nodes:[{mesh:0}],scenes:[{nodes:[0]}],scene:0};
 let text=JSON.stringify(json);while(text.length%4)text+=' ';const enc=new TextEncoder().encode(text),buf=new ArrayBuffer(12+8+enc.length+8+bin.byteLength),dv=new DataView(buf);dv.setUint32(0,0x46546c67,true);dv.setUint32(4,2,true);dv.setUint32(8,buf.byteLength,true);dv.setUint32(12,enc.length,true);dv.setUint32(16,0x4e4f534a,true);new Uint8Array(buf,20,enc.length).set(enc);let p=20+enc.length;dv.setUint32(p,bin.byteLength,true);dv.setUint32(p+4,0x004e4942,true);new Uint8Array(buf,p+8).set(new Uint8Array(bin.buffer));
 const r=await parseModel(new File([buf],'sample.glb'));for(const [i,want]of[20,10,40].entries())assert.ok(Math.abs(r.dims[i]-want)<.0001);
});
