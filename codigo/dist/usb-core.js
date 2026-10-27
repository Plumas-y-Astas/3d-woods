export function usbSelection(p,devices,manualPort=p.usbPort){
 if(p.usbManual){const port=String(manualPort||'').trim().toUpperCase();if(!/^COM[1-9][0-9]{0,3}$/.test(port))throw Error('Escribe un puerto como COM3. Puedes consultarlo en el Administrador de dispositivos de Windows.');return {port,deviceID:'',manual:true};}
 const id=String(p.deviceId||'').toLowerCase(),device=devices.find(d=>d.port&&[d.id,d.hardwareId].some(x=>x&&x.toLowerCase()===id));
 if(!device)throw Error('Selecciona el puerto USB de la impresora. Pulsa Actualizar puertos o elige Puerto COM manual.');
 return {port:device.port,deviceID:device.id,manual:false};
}

export function usbOptions(devices,p){
 const options=[['','Selecciona el puerto USB'],...devices.filter(d=>d.port).map(d=>[d.id,`${d.port} · ${d.name}`])];
 if(p.deviceId&&!p.usbManual&&!devices.some(d=>d.id===p.deviceId||d.hardwareId===p.deviceId))options.push([p.deviceId,'Puerto guardado · desconectado']);
 options.push(['__manual__','Puerto COM manual…']);return options;
}
