import {finite} from './core.js';

// El puente no lamina: recibe G-code y traduce sus metadatos a inventario.
export const PRINT_STATES = ['printing', 'paused', 'completed', 'stopped', 'interrupted'];

const rgb = value => {
  const m = String(value || '').match(/^#?([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// Distancia perceptual aproximada (rojo-media ponderada). Devuelve 0–1.
export function colorDistance(a, b) {
  const x = rgb(a), y = rgb(b);
  if (!x || !y) return 1;
  const rMean = (x[0] + y[0]) / 2;
  const dr = x[0] - y[0], dg = x[1] - y[1], db = x[2] - y[2];
  const value = Math.sqrt((2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db);
  return Math.min(1, value / 765);
}

// Busca el filamento activo más parecido al color que declara el laminador.
export function matchMaterial(color, materials, tolerance = 0.16) {
  let best = null, bestDistance = Infinity;
  for (const material of materials || []) {
    if (material.retired || !material.color) continue;
    const distance = colorDistance(color, material.color);
    if (distance < bestDistance) { bestDistance = distance; best = material; }
  }
  return best && bestDistance <= tolerance ? best : null;
}

const firstMaterial = materials => (materials || []).find(m => !m.retired) || null;

// Une cada filamento del G-code con un material y conserva el color detectado.
export function filamentPlan(data, materials, choices = {}) {
  const colors = data?.colors || [];
  const grams = data?.grams || [];
  const lengths = data?.lengths || [];
  return grams.map((value, index) => {
    const declared = colors[index] || '';
    const chosen = choices[index]?.matId || choices[index] || '';
    let material = (materials || []).find(m => m.id === chosen && !m.retired);
    if (!material) material = matchMaterial(declared, materials) || firstMaterial(materials);
    return {
      index,
      matId: material?.id || '',
      material: material?.name || 'Sin filamento',
      color: chosen ? (material?.color || declared) : (declared || material?.color || '#999999'),
      declaredColor: declared,
      matched: !chosen && !!material && !!declared && colorDistance(declared, material.color) <= 0.16,
      grams: Math.max(0, finite(value)),
      lengthMm: lengths[index] != null ? Math.max(0, finite(lengths[index])) : null,
      diameter: null
    };
  });
}

// Resumen listo para la interfaz y para guardar en el objeto.
export function bridgePreview(data, name, materials, choices = {}) {
  const filaments = filamentPlan(data, materials, choices);
  if (!filaments.length) {
    const material = firstMaterial(materials);
    filaments.push({ index: 0, matId: material?.id || '', material: material?.name || 'Sin filamento', color: (data?.colors || [])[0] || material?.color || '#999999', declaredColor: (data?.colors || [])[0] || '', matched: false, grams: 0, lengthMm: null, diameter: null });
  }
  const grams = filaments.reduce((n, f) => n + f.grams, 0);
  return {
    name: name || 'impresion.gcode',
    source: data?.source || 'G-code',
    minutes: data?.minutes ?? null,
    seconds: data?.seconds || (data?.minutes != null ? data.minutes * 60 : 0),
    grams,
    lengths: filaments.map(f => f.lengthMm),
    dims: Array.isArray(data?.dims) && data.dims.some(v => v != null) ? data.dims : null,
    layers: data?.layers || 0,
    colors: data?.colors || [],
    filaments,
    thumbnail: data?.thumbnail || null,
    warnings: data?.warnings || [],
    valid: !!data?.valid && filaments.some(f => f.grams > 0),
    units: 1
  };
}

// Avance estimado por tiempo. Se detiene en 99 % hasta que el usuario confirma.
export function timeProgress(session, now = Date.now()) {
  if (!session || session.track !== 'time' || session.status !== 'printing') return finite(session?.progress);
  if (!session.seconds) return finite(session.progress);
  const started = Date.parse(session.startedAt || '') || now;
  return Math.min(0.99, Math.max(finite(session.progress), (now - started) / 1000 / session.seconds));
}

export function remainingSeconds(session, now = Date.now()) {
  if (!session?.seconds) return null;
  if (session.status === 'completed') return 0;
  const started = Date.parse(session.lastProgressAt || session.startedAt || '') || now;
  const progress = Math.max(finite(session.progress), 0);
  return Math.max(0, session.seconds * (1 - progress));
}

export function sessionTotalGrams(session) {
  return (session?.filaments || []).reduce((n, f) => n + finite(f.grams), 0);
}

export function sessionConsumedGrams(session) {
  return (session?.filaments || []).reduce((n, f) => n + finite(f.consumed), 0);
}

// Filamentos visibles para una sesión: mezcla los del G-code con el material real.
export function sessionFilaments(filaments, materials) {
  return (filaments || []).map((f, index) => {
    const material = (materials || []).find(m => m.id === f.matId);
    return { ...f, index, material: material?.name || 'Filamento retirado', color: f.color || material?.color || '#999999' };
  });
}
