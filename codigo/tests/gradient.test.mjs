import test from 'node:test';
import assert from 'node:assert/strict';
import {partModel,THREE} from '../dist/models.js';

const part={id:'p1',name:'Hoja',demo:'leaf',matId:'multi',unit:'mm',qty:1,dims:[30,20,10],position:[0,0,0],rotation:[0,0,0],scale:1};
const material=colors=>({id:'multi',name:'Arcoíris',color:colors[0],colors});

function meshes(group){
  const list=[];
  group.traverse(m=>{if(m.isMesh)list.push(m);});
  return list;
}

test('A multi-color filament paints every mesh with a gradient of all its colors',async()=>{
  const colors=['#ff0000','#00ff00','#0000ff','#ffff00'];
  const group=await partModel(part,[material(colors)],async()=>null);
  const list=meshes(group);
  assert.ok(list.length>0);
  for(const mesh of list){
    assert.equal(mesh.material.userData.filamentGradient,true,'the mesh uses the gradient material');
    assert.notEqual(mesh.material.color.getHex(),new THREE.Color(colors[0]).getHex(),'the flat first color is not used alone');
    const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};
    mesh.material.onBeforeCompile(shader);
    assert.ok(shader.vertexShader.includes('uGradMatrix'),'the vertex shader receives the part-space matrix');
    assert.ok(shader.fragmentShader.includes('uGradColors'),'the fragment shader mixes the palette');
    assert.equal(shader.uniforms.uGradCount.value,colors.length);
    assert.equal(shader.uniforms.uGradColors.value.length,48,'the palette is padded to sixteen vec3 stops');
    const ramp=shader.uniforms.uGradColors.value;
    assert.ok(Math.abs(ramp[0]-1)<1e-6&&Math.abs(ramp[1])<1e-6,'the first stop is the first filament color');
  }
});

test('A single-color filament keeps the original flat material',async()=>{
  const group=await partModel(part,[{id:'multi',name:'Verde',color:'#738b5e',colors:['#738b5e']}],async()=>null);
  for(const mesh of meshes(group)){
    assert.notEqual(mesh.material.userData.filamentGradient,true);
    assert.equal(mesh.material.color.getHex(),new THREE.Color('#738b5e').getHex());
  }
});

test('Changing the palette recolors the next mount without touching cached geometry',async()=>{
  const first=await partModel(part,[material(['#ff0000','#00ff00'])],async()=>null);
  const second=await partModel(part,[material(['#000000','#ffffff'])],async()=>null);
  const shaderA={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};
  const shaderB={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>'};
  meshes(first)[0].material.onBeforeCompile(shaderA);
  meshes(second)[0].material.onBeforeCompile(shaderB);
  assert.notDeepEqual(Array.from(shaderA.uniforms.uGradColors.value),Array.from(shaderB.uniforms.uGradColors.value));
  assert.equal(meshes(first)[0].geometry,meshes(second)[0].geometry,'both mounts reuse the shared geometry');
});
