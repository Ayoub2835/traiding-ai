// Agenda: recordatorios que te avisan en el PC y en el móvil (ntfy y Telegram).
// Se guardan en tu PC (recordatorios.json). Se pueden repetir cada día o semana.
// Desde Telegram: «/recordar mañana 10:00 llamar al proveedor», «/recordar en 30 min …»,
// «/recordar 25/11 18:30 …» y «/agenda».
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const rutas = require('../nucleo/rutas');

const archivo = () => rutas.datos('recordatorios.json');
function leer() { try { const d = JSON.parse(fs.readFileSync(archivo(), 'utf8')); return Array.isArray(d) ? d : []; } catch (_) { return []; } }
function escribir(l) { fs.writeFileSync(archivo(), JSON.stringify(l, null, 2)); return l; }
const REPETIR = ['no', 'diario', 'semanal'];

function agregar({ texto, cuando, repetir = 'no' }, ahora = Date.now()) {
  const txt = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const fecha = new Date(cuando);
  if (!txt) return { ok: false, error: 'Escribe qué te recuerdo' };
  if (Number.isNaN(fecha.getTime())) return { ok: false, error: 'Fecha u hora no válida' };
  if (fecha.getTime() < ahora - 60000) return { ok: false, error: 'Esa hora ya ha pasado' };
  const r = { id: crypto.randomBytes(4).toString('hex'), texto: txt, cuando: fecha.toISOString(), repetir: REPETIR.includes(repetir) ? repetir : 'no', avisado: null };
  escribir([...leer(), r]);
  return { ok: true, recordatorio: r };
}

const lista = () => leer().sort((a, b) => a.cuando.localeCompare(b.cuando));
function quitar(id) { const l = leer(); const n = l.filter((r) => r.id !== id); escribir(n); return { ok: n.length < l.length }; }

/** Devuelve los que tocan ahora y los marca (o los pasa a la siguiente vez si se repiten). */
function vencidos(ahora = Date.now()) {
  const l = leer();
  const toca = [];
  const quedan = [];
  for (const r of l) {
    if (new Date(r.cuando).getTime() > ahora) { quedan.push(r); continue; }
    toca.push(r);
    if (r.repetir !== 'no') {
      const paso = r.repetir === 'diario' ? 86400000 : 7 * 86400000;
      let siguiente = new Date(r.cuando).getTime();
      while (siguiente <= ahora) siguiente += paso;
      quedan.push({ ...r, cuando: new Date(siguiente).toISOString(), avisado: new Date(ahora).toISOString() });
    }
  }
  if (toca.length) escribir(quedan);
  return toca;
}

/**
 * Entiende frases cortas en español: «en 30 min …», «en 2 horas …», «hoy 18:00 …»,
 * «mañana 10:00 …», «25/11 18:30 …», «25/11/2026 9:00 …». Añade «cada día»/«cada semana».
 */
function interpretar(frase, ahora = new Date()) {
  let s = String(frase || '').trim();
  let repetir = 'no';
  s = s.replace(/\bcada\s+(d[ií]a|semana)\b/i, (_, x) => { repetir = /semana/i.test(x) ? 'semanal' : 'diario'; return ''; }).replace(/\s+/g, ' ').trim();
  let m = s.match(/^en\s+(\d{1,4})\s*(min|minutos?|h|horas?)\b\s*(.*)$/i);
  if (m) return { cuando: new Date(ahora.getTime() + Number(m[1]) * (/^h/i.test(m[2]) ? 3600000 : 60000)), texto: m[3], repetir };
  const hora = (h, mi) => [Number(h), Number(mi || 0)];
  m = s.match(/^(hoy|mañana|manana|pasado\s+mañana)\s+(?:a\s+las\s+)?(\d{1,2})(?::(\d{2}))?\s*(.*)$/i);
  if (m) {
    const d = new Date(ahora);
    d.setDate(d.getDate() + (/pasado/i.test(m[1]) ? 2 : /ma[nñ]ana/i.test(m[1]) ? 1 : 0));
    const [h, mi] = hora(m[2], m[3]);
    d.setHours(h, mi, 0, 0);
    return { cuando: d, texto: m[4], repetir };
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\s+(?:a\s+las\s+)?(\d{1,2})(?::(\d{2}))?\s*(.*)$/);
  if (m) {
    const [h, mi] = hora(m[4], m[5]);
    const d = new Date(Number(m[3] || ahora.getFullYear()), Number(m[2]) - 1, Number(m[1]), h, mi, 0, 0);
    if (!m[3] && d.getTime() < ahora.getTime() - 60000) d.setFullYear(d.getFullYear() + 1);
    return { cuando: d, texto: m[6], repetir };
  }
  return null;
}

module.exports = { agregar, lista, quitar, vencidos, interpretar, REPETIR };
