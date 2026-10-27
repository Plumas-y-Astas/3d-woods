export function objectMotion(update,direction=1){
 const reduced=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,old=document.querySelector('#model-viewer,#print-viewer');let ghost;
 if(!reduced&&old?.querySelector('canvas'))try{const rect=old.getBoundingClientRect(),img=document.createElement('img');img.src=old.querySelector('canvas').toDataURL('image/png');img.className='object-exit-frame';img.setAttribute('aria-hidden','true');Object.assign(img.style,{left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px','--object-direction':direction});document.body.append(img);ghost=img;}catch{}
 update();if(reduced)return;
 const target=document.querySelector('#model-viewer,#print-viewer,.calc-layout');if(target){target.style.setProperty('--object-direction',direction);target.classList.add('object-enter');setTimeout(()=>target.classList.remove('object-enter'),500);}
 setTimeout(()=>ghost?.remove(),380);
}
