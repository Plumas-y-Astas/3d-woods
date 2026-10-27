export function reconcileShelf(s){
 const ids=s.boxes.filter(b=>!b.archived).map(b=>b.id),available=new Set(ids),seen=new Set();
 const slots=(Array.isArray(s.shelfSlots)?s.shelfSlots:ids).slice(0,15000).map(id=>{if(!available.has(id)||seen.has(id))return null;seen.add(id);return id;});
 for(const id of ids)if(!seen.has(id)){const empty=slots.indexOf(null);if(empty<0)slots.push(id);else slots[empty]=id;seen.add(id);}
 while(slots.length&&!slots.at(-1))slots.pop();
 while(slots.length%5)slots.push(null);
 s.shelfSlots=slots;return slots;
}
export function moveShelfBox(s,id,destination){
 const slots=reconcileShelf(s),from=slots.indexOf(id);
 if(from<0||!Number.isInteger(destination)||destination<0||destination>=slots.length)throw Error('Elige un espacio disponible en la estantería.');
 [slots[from],slots[destination]]=[slots[destination],slots[from]];
 s.shelfSort='manual';return slots;
}
export function orderedBoxes(s,sort='manual'){
 const boxes=s.boxes.filter(b=>!b.archived);
 if(sort==='name')return boxes.slice().sort((a,b)=>a.name.localeCompare(b.name,'es'));
 if(sort==='recent')return boxes.slice().sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0));
 const byId=new Map(boxes.map(b=>[b.id,b]));return reconcileShelf(s).filter(Boolean).map(id=>byId.get(id));
}
