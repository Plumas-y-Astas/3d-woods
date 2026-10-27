import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,seedBoxes} from '../dist/core.js';
import {reconcileShelf,moveShelfBox} from '../dist/shelf-order.js';
test('Full backup restoration remaps shelf positions to the restored box identities',async()=>{globalThis.location={hostname:'127.0.0.1'};globalThis.document={querySelector:()=>null};const {restoreBackup}=await import('../dist/storage.js');const s=defaults();s.boxes=seedBoxes();reconcileShelf(s);moveShelfBox(s,'leaf',8);const restored=await restoreBackup(s),leaf=restored.boxes.find(b=>b.name==='Llavero hoja');assert.notEqual(leaf.id,'leaf');assert.equal(restored.shelfSlots[8],leaf.id);assert.equal(restored.shelfSlots[3],null);reconcileShelf(restored);assert.equal(restored.shelfSlots[8],leaf.id);});
