import {money} from './core.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect x="1" y="1" width="98" height="98" rx="29" fill="#b7ca94"/><g stroke="#254435" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M34 41 22 27 20 13M24 28 12 25M24 28 32 18M66 41 78 27 80 13M76 28 88 25M76 28 68 18" fill="none"/><path d="M39 50C26 26 30 16 36 20 44 26 47 40 47 46M61 50C74 26 70 16 64 20 56 26 53 40 53 46" fill="#b7ca94"/><path d="M50 44C30 44 25 62 34 74L50 85 66 74C75 62 70 44 50 44Z" fill="#254435" stroke="none"/></g><path d="m36 59 7 4m21-4-7 4" stroke="#b7ca94" stroke-width="3" stroke-linecap="round"/><path d="m46 70 4 5 4-5" fill="#b7ca94"/></svg>`;
const logo = () => 'data:image/svg+xml,' + encodeURIComponent(LOGO);
const date = value => new Date(value).toLocaleString('es-MX', {dateStyle:'medium', timeStyle:'short'});
const brand = s => ({name:s?.businessName || '3D-Woods', tagline:s?.businessTagline || 'Un bosque de ideas', phone:s?.businessPhone || '', email:s?.businessEmail || '', address:s?.businessAddress || '', footer:s?.receiptFooter || 'Gracias por apoyar el trabajo del taller.'});
const colorDots = (colors = []) => colors.length ? `<span class="doc-colors">${colors.map(c => `<i style="background:${esc(c)}"></i>`).join('')}</span>` : '';

function header(s, eyebrow = 'COMPROBANTE') {
  const b = brand(s);
  return `<header class="doc-brand"><img src="${logo()}" alt="" class="doc-logo"><div><div class="doc-eyebrow">${esc(eyebrow)}</div><h1>${esc(b.name)}</h1><div class="doc-tagline">${esc(b.tagline)}</div></div></header><div class="doc-business">${[b.address,b.phone,b.email].filter(Boolean).map(esc).join(' · ')}</div>`;
}

function saleLines(lines = [], currency = 'MXN') {
  return lines.map(line => {
    const colors = line.colorRequests?.length
      ? line.colorRequests.map(c => `<span class="doc-color-name">${colorDots(c.colors)} ${esc(c.name)}</span>`).join(' · ')
      : line.requestedColorName ? `<span class="doc-color-name">${colorDots(line.requestedColors)} ${esc(line.requestedColorName)}</span>` : '';
    return `<div class="doc-line"><div><b>${line.qty} × ${esc(line.name)}</b>${colors?`<small>${colors}</small>`:''}<small>${money(line.unitPrice, currency)} c/u</small></div><strong>${money(line.qty * line.unitPrice, currency)}</strong></div>`;
  }).join('');
}

export function ticketDocument(t, settings = {}, returns = []) {
  const refunded = returns.filter(r => !r.voided);
  const returned = refunded.reduce((n, r) => n + r.total, 0);
  return `<article class="doc doc-ticket">
    ${header(settings, 'TICKET DE VENTA')}
    <div class="doc-meta"><div><span>Ticket</span><b>${esc(t.ticket || t.id)}</b></div><div><span>Fecha y hora</span><b>${date(t.date)}</b></div><div><span>Cliente</span><b>${esc(t.customer || 'Venta al público')}</b></div></div>
    <div class="doc-lines">${saleLines(t.lines || [], t.currency)}</div>
    <div class="doc-total"><span>Total</span><b>${money(t.total, t.currency)}</b></div>
    ${returned ? `<div class="doc-total refund"><span>Devuelto</span><b>− ${money(returned, t.currency)}</b></div><div class="doc-total net"><span>Neto del ticket</span><b>${money(t.total - returned, t.currency)}</b></div>` : ''}
    <div class="doc-payment"><div><span>Forma de pago</span><b>${esc(t.payment?.method || 'Registro')}</b></div><div><span>Recibido</span><b>${money(t.payment?.received ?? t.total, t.currency)}</b></div><div><span>Cambio</span><b>${money(t.payment?.change || 0, t.currency)}</b></div></div>
    ${t.note ? `<p class="doc-note">${esc(t.note)}</p>` : ''}
    ${refunded.length ? `<section class="doc-returns"><h2>Devoluciones</h2>${refunded.map(r => `<div class="doc-line"><div><b>${esc(r.ticket)}</b><small>${date(r.date)} · ${esc(r.payment?.method || '')}</small></div><strong>− ${money(r.total, t.currency)}</strong></div>`).join('')}</section>` : ''}
    ${t.voided ? '<div class="doc-stamp">ANULADO</div>' : ''}
    <footer><p>${esc(brand(settings).footer)}</p><small>Comprobante de control interno · Sin valor fiscal</small></footer>
  </article>`;
}

export function returnDocument(t, sale, settings = {}) {
  return `<article class="doc doc-ticket">
    ${header(settings, 'DEVOLUCIÓN')}
    <div class="doc-meta"><div><span>Folio</span><b>${esc(t.ticket)}</b></div><div><span>Venta original</span><b>${esc(sale?.ticket || t.saleTicket || '')}</b></div><div><span>Fecha y hora</span><b>${date(t.date)}</b></div><div><span>Cliente</span><b>${esc(t.customer || 'Venta al público')}</b></div></div>
    <div class="doc-lines">${saleLines((t.items || []).map(item => ({...item, qty:item.qty, name:item.name, unitPrice:item.unitPrice})), t.currency)}</div>
    <div class="doc-total"><span>Reembolso</span><b>${money(t.total, t.currency)}</b></div>
    <div class="doc-payment"><div><span>Forma de reembolso</span><b>${esc(t.payment?.method || 'efectivo')}</b></div></div>
    ${t.note ? `<p class="doc-note">${esc(t.note)}</p>` : ''}
    <footer><p>Conserva este folio para cualquier aclaración.</p><small>Comprobante de control interno · Sin valor fiscal</small></footer>
  </article>`;
}

function cutDetail(cut, settings) {
  const r = cut.report || {};
  const cash = value => money(value, r.currency || 'MXN');
  const sales = (r.sales || []).map(t => `<tr><td><b>${esc(t.ticket)}</b><small>${date(t.date)}</small></td><td>${esc(t.customer || 'Público')}</td><td class="doc-detail">${(t.lines || []).map(l => `${l.qty} × ${esc(l.name)}`).join('<br>')}</td><td class="num">${cash(t.total)}</td></tr>`).join('') || '<tr><td colspan="4">Sin ventas en el periodo.</td></tr>';
  const returns = (r.returns || []).map(t => `<tr><td><b>${esc(t.ticket)}</b><small>${date(t.date)}</small></td><td>${esc(t.customer || 'Público')}</td><td class="doc-detail">${(t.items || []).map(i => `${i.qty} × ${esc(i.name)}`).join('<br>')}</td><td class="num">− ${cash(t.total)}</td></tr>`).join('');
  const purchases = (r.purchases || []).map(t => `<tr><td>${date(t.date)}</td><td colspan="2">${esc(t.note || 'Compra de inventario')}</td><td class="num">${cash(t.total)}</td></tr>`).join('');
  return `<article class="doc doc-cut">
    ${header(settings, cut.type === 'full' ? 'CORTE DE CAJA TOTAL' : 'CORTE DE CAJA PARCIAL')}
    <div class="doc-meta"><div><span>Folio</span><b>${esc(cut.number)}</b></div><div><span>Generado</span><b>${date(cut.date)}</b></div><div><span>Periodo</span><b>${date(cut.from)} — ${date(cut.to)}</b></div><div><span>Ventas</span><b>${r.counts?.sales || 0} · ${r.counts?.pieces || 0} pieza(s)</b></div></div>
    <div class="doc-kpis"><div><span>Ventas</span><b>${cash(r.salesTotal)}</b></div><div><span>Devoluciones</span><b>− ${cash(r.returnsTotal)}</b></div><div><span>Compras</span><b>− ${cash(r.purchasesTotal)}</b></div><div><span>Neto de caja</span><b>${cash(r.balance)}</b></div><div><span>Utilidad estimada</span><b>${cash(r.profit)}</b></div></div>
    <section><h2>Detalle de ventas</h2><table><thead><tr><th>Ticket / hora</th><th>Cliente</th><th>Artículos y precios</th><th class="num">Importe</th></tr></thead><tbody>${sales}</tbody></table></section>
    ${returns ? `<section><h2>Devoluciones</h2><table><thead><tr><th>Folio / hora</th><th>Cliente</th><th>Artículos</th><th class="num">Importe</th></tr></thead><tbody>${returns}</tbody></table></section>` : ''}
    ${purchases ? `<section><h2>Compras y reposiciones</h2><table><thead><tr><th>Hora</th><th colspan="2">Detalle</th><th class="num">Importe</th></tr></thead><tbody>${purchases}</tbody></table></section>` : ''}
    ${r.payments?.length ? `<section><h2>Formas de pago</h2><table><thead><tr><th>Método</th><th class="num">Ventas</th><th class="num">Reembolsos</th><th class="num">Neto</th></tr></thead><tbody>${r.payments.map(p => `<tr><td>${esc(p.name)}</td><td class="num">${cash(p.sales)}</td><td class="num">− ${cash(p.refunds)}</td><td class="num">${cash(p.net)}</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${cut.note ? `<p class="doc-note">${esc(cut.note)}</p>` : ''}
    <footer><p>${cut.type === 'full' ? 'El corte total inicia un nuevo periodo. Las ventas no se borran.' : 'Corte informativo: no reinicia el periodo ni modifica ventas.'}</p><small>${esc(brand(settings).footer)} · Comprobante interno sin valor fiscal</small></footer>
  </article>`;
}

export function cutDocument(cut, settings = {}) { return cutDetail(cut, settings); }

const standaloneCSS = `
*{box-sizing:border-box}body{margin:0;background:#eef2e7;color:#20352a;font-family:Georgia,'Times New Roman',serif}
.doc{width:min(820px,100%);margin:24px auto;background:#fff;border:1px solid #cfd8c5;padding:34px 40px;box-shadow:0 18px 70px #20352a18}
.doc-brand{display:flex;align-items:center;gap:18px;border-bottom:3px double #203d31;padding-bottom:18px}.doc-logo{width:72px;height:72px}.doc-eyebrow{font:700 10px Arial,sans-serif;letter-spacing:2px;color:#6d7c63}.doc h1{font-size:32px;margin:4px 0;letter-spacing:-1px}.doc-tagline{color:#6d7c63;font:12px Arial,sans-serif}.doc-business{font:11px Arial,sans-serif;color:#6d7c63;text-align:right;margin:8px 0 18px}
.doc-meta{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;border:1px solid #d9e0d0;background:#f7f9f3;padding:14px;border-radius:8px;font:12px Arial,sans-serif}.doc-meta span,.doc-kpis span,.doc-payment span{display:block;color:#708067;font-size:10px;text-transform:uppercase;letter-spacing:1px}.doc-meta b{display:block;margin-top:3px}
.doc-lines{margin:22px 0;border-top:1px dashed #aab7a0;border-bottom:1px dashed #aab7a0;padding:10px 0}.doc-line{display:flex;justify-content:space-between;gap:24px;padding:8px 0;font:13px Arial,sans-serif}.doc-line small{display:block;color:#71806a;margin-top:3px}.doc-colors{display:inline-flex;gap:3px;vertical-align:middle}.doc-colors i{display:inline-block;width:10px;height:10px;border-radius:50%;border:1px solid #0002}
.doc-total{display:flex;justify-content:space-between;align-items:center;font:16px Arial,sans-serif;border-bottom:1px solid #d9e0d0;padding:9px 0}.doc-total b{font-size:22px}.doc-total.refund{color:#a75748}.doc-total.net{font-weight:700}.doc-payment{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0;font:12px Arial,sans-serif}.doc-note{background:#f7f9f3;border-left:3px solid #7f9b6d;padding:10px 13px;font:12px Arial,sans-serif}.doc-stamp{font:800 38px Arial,sans-serif;color:#b44f41;border:3px solid #b44f41;width:max-content;padding:4px 16px;transform:rotate(-7deg);margin:-90px auto 30px;opacity:.65}
.doc h2{font:700 13px Arial,sans-serif;text-transform:uppercase;letter-spacing:1.5px;margin:25px 0 10px}.doc-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin:20px 0}.doc-kpis>div{border:1px solid #d9e0d0;border-radius:7px;padding:10px}.doc-kpis b{display:block;margin-top:5px;font:15px Arial,sans-serif}
.doc table{width:100%;border-collapse:collapse;font:12px Arial,sans-serif}.doc th{text-align:left;background:#f2f5ed;color:#607257;font-size:10px;text-transform:uppercase;padding:8px}.doc td{border-top:1px solid #e0e5d9;padding:8px;vertical-align:top}.doc td small{display:block;color:#7b8a73;margin-top:2px}.doc .num{text-align:right;white-space:nowrap}.doc .doc-detail{line-height:1.45}.doc footer{margin-top:28px;border-top:3px double #203d31;padding-top:14px;text-align:center;font:11px Arial,sans-serif;color:#6d7c63}.doc footer p{margin:0 0 4px}
@media print{body{background:#fff}.doc{margin:0;border:0;box-shadow:none;width:100%;padding:5mm}@page{size:auto;margin:8mm}}
`;

export function standaloneDocument(title, body, settings = {}) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · ${esc(brand(settings).name)}</title><style>${standaloneCSS}</style></head><body>${body}</body></html>`;
}

export function printDocument(body) {
  const root = document.getElementById('print-root');
  if (!root || typeof window.print !== 'function') throw Error('La impresión no está disponible en esta ventana. Descarga el documento virtual.');
  root.innerHTML = `<style>${standaloneCSS}</style>${body}`;
  window.print();
}
