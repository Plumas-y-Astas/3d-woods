import {moveShelfBox,reconcileShelf} from './shelf-order.js';
import {esc,btn,select} from './views.js';
export function shelfController(c){
 const {ui,render,persist,showModal,closeModal}=c,S=c.state;
 let token=0,moving=false,dragId=null,moveId=null,ignoreClickUntil=0;
 const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,reduced()?0:ms));
 const card=id=>[...document.querySelectorAll('#shelves .box-card')].find(x=>x.dataset.id===id);
 const clear=()=>{document.querySelectorAll('.rack-floating,.object-exit-frame').forEach(x=>x.remove());document.querySelectorAll('.rack-lifted,.rack-drop-target,.rack-dragging,.rack-source-hidden').forEach(x=>x.classList.remove('rack-lifted','rack-drop-target','rack-dragging','rack-source-hidden'));document.querySelector('.game-layout')?.classList.remove('is-returning');};
 function cancel(){token++;moving=false;clear();}
 function heldPlacement(){const ghost=document.createElement('div');ghost.className='game-shelf rack-held';ghost.style.visibility='hidden';document.body.append(ghost);const r=ghost.getBoundingClientRect();ghost.remove();return r.width?{x:r.left+r.width/2,y:r.top+r.height/2,scale:r.height/257}:{x:window.innerWidth/2-170,y:window.innerHeight/2,scale:1.5};}
 function portal(markup,target,source,kind){const el=document.createElement('div');el.className='game-shelf rack-floating '+kind;el.setAttribute('aria-hidden','true');el.innerHTML=markup;el.querySelectorAll('[tabindex]').forEach(x=>x.tabIndex=-1);Object.assign(el.style,{left:(target.x-120)+'px',top:(target.y-128.5)+'px',width:'240px',height:'257px',transform:`translate(${source.x-target.x}px,${source.y-target.y}px) scale(${source.scale})`});document.body.append(el);void el.offsetWidth;return el;}
 const point=el=>{const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,scale:1};};
 async function returnBox(){
  if(moving)return false;if(!ui.picked)return true;
  moving=true;const mine=++token,id=ui.selected,held=document.querySelector('.rack-held .box-card'),placement=heldPlacement(),markup=held?.outerHTML;
  try{document.querySelector('.game-layout')?.classList.add('is-returning');await delay(130);if(mine!==token||ui.view!=='shelf')return false;ui.picked=false;render();const target=card(id);if(markup&&target){target.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});const destination=point(target);target.classList.add('rack-source-hidden');target.parentElement.classList.add('rack-lifted');const p=portal(markup,destination,placement,'rack-returning');p.style.transform='translate(0,0) scale(1)';await delay(650);if(mine!==token)return false;p.remove();target.classList.remove('rack-source-hidden');target.parentElement.classList.remove('rack-lifted');target.classList.add('rack-landed');setTimeout(()=>target.classList.remove('rack-landed'),300);target.focus({preventScroll:true});}return true;}finally{if(mine===token){moving=false;clear();}}
 }
 async function takeBox(id){
  if(moving||!id||Date.now()<ignoreClickUntil)return;
  if(ui.reorder){showMove(id);return;}
  if(ui.picked){if(ui.selected===id)return;if(!await returnBox())return;}
  moving=true;const mine=++token;
  try{ui.picked=false;ui.selected=id;ui.focusId=id;ui.objectId=null;ui.partId=null;render();const source=card(id);if(source){source.scrollIntoView?.({block:'nearest',inline:'nearest',behavior:'instant'});const from=point(source),to=heldPlacement(),p=portal(source.outerHTML,to,from,'rack-taking');source.classList.add('rack-source-hidden');source.parentElement.classList.add('rack-lifted');p.querySelector('.box-card')?.classList.add('taking');p.style.transform=`translate(0,0) scale(${to.scale})`;await delay(650);p.remove();}if(mine===token&&ui.view==='shelf'&&ui.selected===id){ui.picked=true;render();}}finally{if(mine===token){moving=false;clear();}}
 }
 async function step(delta){if(moving)return;const items=c.items();if(!items.length)return;const index=Math.max(0,items.findIndex(b=>b.id===(ui.picked?ui.selected:ui.focusId))),id=items[(index+delta+items.length)%items.length].id;if(ui.picked){if(await returnBox())await takeBox(id);return;}ui.focusId=id;render();const next=card(id);next?.focus({preventScroll:true});next?.scrollIntoView?.({behavior:reduced()?'instant':'smooth',block:'nearest',inline:'nearest'});next?.classList.add('rack-focus-enter');setTimeout(()=>next?.classList.remove('rack-focus-enter'),350);}
 function showMove(id){moveId=id;const slots=reconcileShelf(S()),byId=new Map(S().boxes.map(b=>[b.id,b.name]));showModal('Mover caja',`<p>Elige el lugar de esta caja. Si está ocupado, ambas cajas intercambian sus posiciones.</p>${select('Lugar en la estantería',slots.map((box,i)=>[i,`Estante ${Math.floor(i/5)+1} · Lugar ${i%5+1} · ${byId.get(box)||'Vacío'}`]),slots.indexOf(id),'id="shelf-destination"')}`,btn('Cancelar','close-modal')+btn('Mover caja','confirm-move-box','check','primary'));}
 function move(id,index){moveShelfBox(S(),id,index);ui.sort='manual';ui.focusId=id;persist();render();card(id)?.classList.add('rack-landed');}
 const actions={
  'select-box':el=>takeBox(el.dataset.id),'take-focused':()=>takeBox((c.items().find(b=>b.id===ui.focusId)||c.items()[0])?.id),
  'return-box':returnBox,'shelf-prev':()=>step(-1),'shelf-next':()=>step(1),
  'reorder-shelf':async()=>{if(moving)return;if(ui.picked&&!await returnBox())return;ui.reorder=!ui.reorder;if(ui.reorder){ui.sort='manual';ui.list=false;ui.filter='Todo';ui.search='';S().shelfSort='manual';persist();}render();},
  'move-box':el=>showMove(el.dataset.id),'confirm-move-box':()=>{const index=+document.getElementById('shelf-destination').value;closeModal();move(moveId,index);}
 };
 document.addEventListener('dragstart',e=>{const el=e.target.closest('.box-card[draggable="true"]');if(!el||!ui.reorder||moving)return;dragId=el.dataset.id;e.dataTransfer.setData('application/x-3dwoods-box',dragId);e.dataTransfer.effectAllowed='move';el.classList.add('rack-dragging');});
 document.addEventListener('dragover',e=>{if(!dragId)return;const slot=e.target.closest('.rack-slot');if(!slot)return;e.preventDefault();e.dataTransfer.dropEffect='move';document.querySelectorAll('.rack-drop-target').forEach(x=>x.classList.remove('rack-drop-target'));slot.classList.add('rack-drop-target');});
 document.addEventListener('drop',e=>{if(!dragId)return;e.preventDefault();const slot=e.target.closest('.rack-slot'),id=dragId;dragId=null;ignoreClickUntil=Date.now()+300;clear();if(slot)move(id,+slot.dataset.slot);});
 document.addEventListener('dragend',()=>{dragId=null;clear();ignoreClickUntil=Date.now()+300;});
 return {actions,cancel,step,returnBox,isBusy:()=>moving};
}
