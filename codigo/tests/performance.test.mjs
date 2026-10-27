import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,newBox} from '../dist/core.js';
import {demoModel,exportSTL,partModel,modelCacheStats,invalidateModel,disposeObject,THREE} from '../dist/models.js';
import {renderApp,filteredBoxes} from '../dist/views.js';

const materials=[{id:'forest',color:'#738b5e',name:'PLA'}];
const part=(id,fileId)=>({id,name:'Pieza',fileId,unit:'mm',matId:'forest',qty:1,dims:[10,10,10],position:[0,0,0],rotation:[0,0,0],scale:1});

test('Model cache keeps a bounded number of meshes instead of growing with the library',async()=>{
  const stl=exportSTL(demoModel('leaf')),files=new Map();
  const getFile=async id=>files.get(id);
  const ids=Array.from({length:20},(_,i)=>'cache-test-'+i);
  for(const id of ids)files.set(id,new File([stl],id+'.stl'));
  for(const id of ids)await partModel(part('p-'+id,id),materials,getFile);
  const stats=modelCacheStats();
  assert.ok(stats.models<=16,'cache keeps at most 16 models');
  assert.ok(stats.vertices<=6000000,'cache keeps at most six million vertices');
  const before=modelCacheStats().models;
  await partModel(part('reuse-1','cache-test-19'),materials,getFile);
  await partModel(part('reuse-2','cache-test-19'),materials,getFile);
  assert.equal(modelCacheStats().models,before,'a repeated file is not parsed twice');
  for(const id of ids)invalidateModel(id);
});

test('Disposing a viewer group releases its materials and uncached geometry',()=>{
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  const material=new THREE.MeshBasicMaterial();
  let geometryDisposed=false,materialDisposed=false;
  geometry.addEventListener('dispose',()=>{geometryDisposed=true;});
  material.addEventListener('dispose',()=>{materialDisposed=true;});
  const group=new THREE.Group();group.add(new THREE.Mesh(geometry,material));
  disposeObject(group);
  assert.ok(geometryDisposed);
  assert.ok(materialDisposed);

  const shared=new THREE.BufferGeometry();
  shared.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  shared.userData.cached=true;
  let sharedDisposed=false;
  shared.addEventListener('dispose',()=>{sharedDisposed=true;});
  const sharedGroup=new THREE.Group();sharedGroup.add(new THREE.Mesh(shared,new THREE.MeshBasicMaterial()));
  disposeObject(sharedGroup);
  assert.equal(sharedDisposed,false,'cached geometry stays available for other boxes');
});

test('Shelf cards use stored thumbnails for large collections without loading meshes',()=>{
  const state=defaults(),thumb='data:image/webp;base64,UklGRgAAAABXRUJQ';
  state.boxes=Array.from({length:200},(_,i)=>{
    const b=newBox('Caja '+i);
    b.id='bulk-'+i;b.category='Colección';b.thumbnail=thumb;
    b.objects[0].parts.push(part('part-'+i,'file-'+i+'.stl'));
    return b;
  });
  const ui={view:'shelf',selected:null,focusId:null,filter:'Todo',search:'',sort:'manual',list:false,picked:false,devices:[],printerStatus:{}};
  const html=renderApp(state,ui,'C:\\Modelos');
  assert.equal(filteredBoxes().length,200);
  assert.equal((html.match(/data-thumb=/g)||[]).length,200);
  assert.ok(!html.includes('data:image/svg+xml'),'every card shows its saved cover instead of the fallback');
  assert.ok(!html.includes('file-0.stl'),'shelf markup does not expose mesh files');
});
