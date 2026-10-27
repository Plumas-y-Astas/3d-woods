import {usbOptions} from './usb-core.js';
import {esc,btn,field,select,icon} from './views.js';
import {formatTime,dimensions} from './core.js';
import {activePrintSessions,printHistory} from './workshop.js';
import {remainingSeconds,sessionConsumedGrams,sessionFilaments,sessionTotalGrams,timeProgress} from './bridge-core.js';

const ago = iso => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '—';
  return new Date(t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' });
};
const size = n => n > 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const stateName = { printing: 'En impresión', paused: 'Pausada', completed: 'Completada', stopped: 'Detenida', interrupted: 'Interrumpida' };
const statusClass = s => s === 'completed' ? 'ok' : s === 'printing' ? 'active' : s === 'paused' ? 'warn' : 'danger';

function sessionCard(session, state) {
  const total = sessionTotalGrams(session), consumed = sessionConsumedGrams(session);
  const active = ['printing', 'paused'].includes(session.status);
  const progress = active && session.track === 'time' ? timeProgress(session) : (session.progress || 0);
  const remaining = remainingSeconds(session);
  return `<div class="panel print-session ${statusClass(session.status)}">
    <div class="between"><div><div class="eyebrow">SESIÓN ACTIVA</div><h3>${esc(session.name)}</h3></div><span class="badge">${stateName[session.status] || esc(session.status)}</span></div>
    <div class="print-progress-line"><progress max="100" value="${(progress * 100).toFixed(1)}"></progress><b>${(progress * 100).toFixed(0)} %</b></div>
    <div class="mini-stats"><div><b>${consumed.toFixed(1)} / ${total.toFixed(1)} g</b><span>Filamento descontado</span></div><div><b>${session.seconds ? formatTime(session.seconds / 60) : '—'}</b><span>${active ? (remaining != null ? 'Restante estimado' : 'Duración') : 'Duración'}</span></div><div><b>${ago(session.startedAt)}</b><span>Inicio</span></div></div>
    <div class="print-filament-list">${sessionFilaments(session.filaments, state.materials).map(f => `<div class="between cost-row"><span><i class="color-dot" style="background:${esc(f.color)}"></i> ${esc(f.material)}</span><span>${f.grams.toFixed(1)} g · ${(100 * (f.consumed || 0) / Math.max(.001, f.grams)).toFixed(0)} %</span></div>`).join('')}</div>
    ${active ? `<div class="flex section-space">${session.track !== 'usb' ? btn('25 %','print-progress','clock','small','data-value="0.25"') + btn('50 %','print-progress','clock','small','data-value="0.50"') + btn('75 %','print-progress','clock','small','data-value="0.75"') : ''}${btn('Completar impresión','print-complete','check','primary small')}${btn('Detener','print-stop','close','danger small')}</div><p class="short-note">${session.track === 'usb' ? 'El avance usa los comandos confirmados por el puerto USB. El filamento se descuenta mientras la impresora avanza.' : session.track === 'time' ? 'El avance se estima con el tiempo del G-code. Si la impresión termina antes, pulsa Completar; el 100 % solo se aplica al confirmar.' : 'Actualiza el avance con los botones o confirma al terminar. El consumo se descuenta de forma proporcional.'}</p>` : ''}
  </div>`;
}

function historyCard(s) {
  const consumed = sessionConsumedGrams(s), total = sessionTotalGrams(s);
  return `<div class="print-history-row ${s.voided ? 'voided' : ''}"><div><b>${esc(s.name)}</b><p class="small muted">${ago(s.startedAt)} · ${stateName[s.status] || esc(s.status)}${s.voided ? ' · Anulada' : ''}${s.source ? ' · ' + esc(s.source) : ''}</p></div><div class="print-history-numbers"><b>${consumed.toFixed(1)} g</b><span>${total ? (100 * consumed / total).toFixed(0) + ' %' : ''}</span></div>${!s.voided && s.ledgerId ? btn('Anular','print-void','back','small danger',`data-id="${esc(s.id)}"`) : ''}</div>`;
}

export function printPage(s, u) {
  const p = s.printers.find(x => x.id === s.activePrinterId) || s.printers[0];
  const active = activePrintSessions(s);
  const current = active.find(x => x.id === u.printSessionId) || active[0] || null;
  const pv = u.printPreview;
  const files = u.bridgeFiles || [];
  const image = pv?.thumbnail || u.printObjectImage || '';
  const history = printHistory(s, 12);
  const manualDims = pv?.dims ? dimensions(pv.dims) + ' cm' : 'Sin medidas';
  const totalGrams = pv?.filaments?.reduce((n, f) => n + (+f.grams || 0), 0) || 0;
  return `<div class="page-heading"><div><div class="eyebrow">MODELO → G-CODE → INVENTARIO</div><h1>Puente de impresión.</h1><p>Usa el laminador que prefieras. 3D-Woods lee su G-code, captura la imagen, las medidas, el tiempo y el filamento, y descuenta el inventario mientras imprime.</p></div><div class="heading-actions">${btn('Buscar en la carpeta','print-refresh','refresh')}${btn('Abrir G-code','bridge-import','upload','primary')}</div></div>
  ${u.printError ? `<div class="hint-strip warning">${icon('info')}<div>${esc(u.printError)}</div></div>` : ''}
  <div class="two-col print-layout"><div class="stack">
    <div class="panel"><div class="section-header"><h3>Puente de impresión</h3><span class="badge ${u.bridgeFiles?.length ? 'ok' : ''}">${u.bridgeFiles?.length || 0} archivo(s)</span></div>
      <div class="form-grid">${field('Programa laminador',s.settings.slicerName,'data-setting="slicerName"','text')}${field('Ejecutable (opcional)',s.settings.slicerPath,'data-setting="slicerPath"','text','Si queda vacío, se intenta detectar Cura, PrusaSlicer, OrcaSlicer, Bambu Studio o Simplify3D.')}</div>
      <div class="flex section-space">${btn('Elegir programa','pick-slicer','folder','small')}${btn('Enviar STL al laminador','launch-slicer','external','small')}</div>
      <div class="form-grid section-space">${field('Carpeta que observa el puente',s.settings.bridgeFolder,'data-setting="bridgeFolder"','text','Cura, PrusaSlicer, OrcaSlicer y Bambu Studio pueden guardar aquí sus G-code.')}</div>
      <div class="flex section-space">${btn('Elegir carpeta','bridge-pick','folder','small')}${btn('Abrir carpeta','bridge-open','external','small')}${btn('Actualizar lista','print-refresh','refresh','small')}<label class="field inline"><input type="checkbox" data-setting="bridgeWatch" ${s.settings.bridgeWatch !== false ? 'checked' : ''}> Vigilar nuevos G-code</label></div>
      <p class="short-note">${u.desktop ? (s.settings.bridgeFolder ? 'El puente revisa esta carpeta cada pocos segundos. Al aparecer un G-code nuevo lo marca como listo para revisar.' : 'Elige la carpeta de salida de tu laminador. También puedes arrastrar un G-code directamente aquí.') : 'La carpeta vigilada necesita la aplicación de Windows. En el navegador puedes arrastrar el G-code o abrirlo con el botón Abrir G-code.'}</p>
      ${files.length ? `<div class="bridge-files">${files.slice(0, 12).map(f => `<div class="bridge-file ${u.printPreview?.path === f.path ? 'active' : ''}"><div>${icon('file')}<div><b>${esc(f.name)}</b><p class="small muted">${esc(f.rel || '')} · ${size(f.size)} · ${new Date(f.modified).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</p></div></div>${btn('Usar','bridge-load','arrow','small',`data-path="${esc(f.path)}" data-name="${esc(f.name)}"`)}</div>`).join('')}</div>` : '<p class="short-note section-space">Todavía no hay G-code en la carpeta. Lamina un modelo en tu programa y guarda el archivo ahí.</p>'}
    </div>
    ${current ? sessionCard(current, s) : ''}
    ${pv ? `<div class="panel print-preview"><div class="print-preview-head"><div class="print-thumb">${image ? `<img src="${esc(image)}" alt="Vista del modelo">` : `<div class="print-thumb-empty">${icon('box')}<span>Sin imagen</span></div>`}</div><div class="print-preview-info"><div class="eyebrow">G-CODE LISTO</div><h3>${esc(pv.name)}</h3><p class="small muted">${esc(pv.source)}${pv.layers ? ' · ' + pv.layers + ' capas' : ''}${u.printFilePath ? ' · ' + esc(u.printFilePath) : ''}</p><div class="mini-stats"><div><b>${pv.minutes != null ? formatTime(pv.minutes) : 'Sin tiempo'}</b><span>Tiempo del archivo</span></div><div><b>${totalGrams.toFixed(1)} g</b><span>Filamento total</span></div><div><b>${manualDims}</b><span>Medidas del G-code</span></div></div></div></div>
      ${(pv.warnings || []).length ? `<p class="danger-text small">${pv.warnings.map(esc).join(' · ')}</p>` : ''}
      <div class="print-filaments section-space"><div class="section-header"><h3>Color y filamento</h3>${btn('Capturar imagen del modelo','print-capture','camera','small')}</div>${pv.filaments.map((f, i) => `<div class="print-filament"><div class="print-color">${f.declaredColor ? `<i class="color-dot" style="background:${esc(f.declaredColor)}"></i>` : icon('spool')}<span>${f.declaredColor ? esc(f.declaredColor.toUpperCase()) : 'Sin color declarado'}</span></div>${select(`Filamento ${i + 1}`, [['','Elegir material'],...s.materials.filter(m => !m.retired).map(m => [m.id, m.name])], f.matId, `data-print-material="${i}"`)}${field('Gramos', f.grams, `data-print-grams="${i}" min="0" step="0.01"`)}${field('Color manual', /^#[0-9a-f]{6}$/i.test(f.color || '') ? f.color : '#999999', `data-print-color="${i}"`,'color')}</div>`).join('')}</div>
      <div class="form-grid section-space">${field('Unidades incluidas en este G-code', pv.units || 1, 'id="print-units" min="1" step="1"')}${field('Minutos totales', pv.minutes ?? 0, 'id="print-minutes" min="0" step="0.1"','number','Si el laminador no lo informa, introdúcelo aquí.')}${field('Ancho X (mm)', pv.dims?.[0] ?? '', 'id="print-dim-x" min="0"')}${field('Fondo Y (mm)', pv.dims?.[1] ?? '', 'id="print-dim-y" min="0"')}${field('Alto Z (mm)', pv.dims?.[2] ?? '', 'id="print-dim-z" min="0"')}</div>
      <div class="flex section-space">${btn('Guardar en el objeto','print-apply','save','primary')}${btn('Copiar G-code a la caja','print-copy','download')}${btn('Iniciar seguimiento','print-start-track','clock')}${btn('Enviar por USB','print-start','printer')}${btn('Descartar','print-clear','close','small')}</div>
      <p class="short-note">Guardar en el objeto aplica tiempo, gramos y medidas a la calculadora sin descontar inventario. Iniciar seguimiento crea la sesión y descuenta el filamento según el avance. Enviar por USB usa el mismo G-code y enlaza su progreso real.</p>
    </div>` : `<div class="panel empty print-empty">${icon('layers')}<h3>El puente espera un G-code.</h3><p>Lamina en tu programa favorito y guarda el archivo en la carpeta vigilada, o ábrelo con el botón Abrir G-code. También puedes arrastrarlo sobre esta ventana.</p></div>`}
    <div class="panel usb-panel"><div class="section-header"><h3>Enviar por USB</h3><span class="badge outline">Marlin compatible</span></div><div class="form-grid">${select('Puerto de la impresora',usbOptions(u.devices || [],p),p.usbManual ? '__manual__' : p.deviceId || '','id="print-device"')}${p.usbManual ? field('Puerto COM de Windows',p.usbPort || '','id="usb-manual-port" placeholder="COM3"','text') : ''}${select('Velocidad del puerto',[[115200,'115200'],[250000,'250000'],[230400,'230400'],[57600,'57600']],s.settings.baud || 115200,'data-setting="baud"')}</div><div class="flex section-space">${btn('Actualizar puertos','probe-printers','refresh','small')}${btn('Probar conexión','test-usb','printer','small')}${btn('Revisar e imprimir','print-start','printer','primary')}</div><p class="short-note">Probar conexión abre el puerto y consulta M115, sin mover ni calentar. La impresora puede reiniciarse. Cierra otros programas que usen ese puerto.</p><p id="usb-error" class="usb-error" ${u.printError ? '' : 'hidden'}>${esc(u.printError || '')}</p><div id="print-monitor"><p data-print-status class="section-space">${esc(u.printStatus?.message || 'Sin impresión USB activa')}</p><progress data-print-progress max="100" value="${u.printStatus?.total ? 100 * (u.printStatus.sent || 0) / u.printStatus.total : 0}"></progress></div><div class="flex section-space">${btn('Pausar envío','usb-pause','clock','small')}${btn('Continuar','usb-resume','arrow','small')}${btn('Detener · M112','usb-stop','close','danger small')}</div><details class="section-space"><summary>Diagnóstico USB</summary><pre id="usb-log" class="usb-log">${esc((u.printError ? u.printError + '\n' : '') + (u.printStatus?.log || 'El intercambio USB aparecerá aquí.'))}</pre>${btn('Guardar diagnóstico','export-usb-diagnostic','download','small')}</details></div>
  </div><aside class="stack">
    <div class="panel"><div class="between"><h3>Imagen del objeto</h3>${btn('Capturar','print-capture','camera','small')}</div><div class="print-object-viewer" id="print-viewer"></div><p class="short-note">La imagen se toma del visor 3D y se guarda con el G-code. Si el laminador incluye miniatura, se usa la del propio archivo.</p></div>
    <div class="panel"><div class="section-header"><h3>Historial de impresión</h3><span class="badge">${history.length}</span></div>${history.length ? history.map(historyCard).join('') : '<p class="small muted">Todavía no hay sesiones registradas.</p>'}<p class="short-note">Cada sesión crea un movimiento de inventario. Anular una sesión devuelve el filamento consumido y las piezas terminadas, si las hubo.</p></div>
    <div class="panel"><h3>Cómo se actualiza el inventario</h3><div class="cost-row"><span>1 · Laminar</span><b>${esc(s.settings.slicerName)}</b></div><div class="cost-row"><span>2 · Capturar</span><b>Imagen, medidas, tiempo y filamento</b></div><div class="cost-row"><span>3 · Imprimir</span><b>Consumo proporcional al avance</b></div><p class="short-note">Con USB se usan los comandos confirmados. Sin USB puedes seguir el tiempo estimado o actualizar el avance a mano. El filamento se descuenta del stock real y queda en Movimientos.</p></div>
  </aside></div>`;
}
