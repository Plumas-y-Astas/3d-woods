import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,seedBoxes} from '../dist/core.js';
import {migrate} from '../dist/workshop.js';
import {renderApp} from '../dist/views.js';

test('Settings show the installed version, publisher and verified GitHub update flow',()=>{
  const s=defaults();s.boxes=seedBoxes();migrate(s);
  const u={view:'settings',selected:null,objectId:null,partId:null,filter:'Todo',search:'',sort:'recent',tab:'overview',devices:[],printerStatus:{},desktop:true,
    update:{status:'ready',current:'0.8.0',publisher:'Plumas y Astas Studio',repo:'plumasyastas/3d-woods',latest:'0.9.0',available:true,ready:true,notes:'Novedades de la versión',size:123,sha256:'abc',error:''}};
  let html=renderApp(s,u,'C:\\Models');
  assert.ok(html.includes('Actualizaciones'));
  assert.ok(html.includes('Plumas y Astas Studio'));
  assert.ok(html.includes('v0.8.0'));
  assert.ok(html.includes('plumasyastas/3d-woods'));
  assert.ok(html.includes('data-setting="updateRepo"'));
  assert.ok(html.includes('data-setting="updateAuto"'));
  assert.ok(html.includes('data-action="check-updates"'));
  assert.ok(!html.includes('data-action="download-update"'));
  assert.ok(html.includes('Instalar 0.9.0'));
  assert.ok(html.includes('data-action="install-update"'));
  assert.ok(html.includes('SHA-256'));
  u.update={...u.update,status:'available',ready:false};
  html=renderApp(s,u,'C:\\Models');
  assert.ok(html.includes('data-action="download-update"'));
  assert.ok(!html.includes('data-action="install-update"'));
  u.update={...u.update,status:'latest',available:false,ready:false,latest:'0.8.0'};
  html=renderApp(s,u,'C:\\Models');
  assert.ok(html.includes('Tienes la última versión (0.8.0).'));
  assert.ok(!html.includes('data-action="install-update"'));
  u.update={...u.update,status:'error',error:'<b>sin conexión</b>'};
  html=renderApp(s,u,'C:\\Models');
  assert.ok(html.includes('&lt;b&gt;sin conexión&lt;/b&gt;'));
  u.desktop=false;
  html=renderApp(s,u,'C:\\Models');
  assert.ok(html.includes('disponible en la aplicación de Windows'));
});
