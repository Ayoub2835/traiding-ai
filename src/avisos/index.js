// Avisos al móvil:
//   - ntfy (gratis): notificación push en el móvil (app ntfy suscrita a tu tema).
//   - Twilio (opcional, de pago): llamada de voz para lo URGENTE.
// Solo se usan si hay claves en Ajustes → Claves.
'use strict';
const claves = require('../nucleo/claves');
const { pedir } = require('../nucleo/http');
const registro = require('../seguridad/registro');

const PRIORIDADES = { baja: 'low', normal: 'default', default: 'default', alta: 'high', urgente: 'urgent' };

// Las cabeceras HTTP solo admiten ASCII: el título va codificado (RFC 2047).
const cabecera = (t) => (/^[\x20-\x7e]*$/.test(t) ? t : `=?UTF-8?B?${Buffer.from(t, 'utf8').toString('base64')}?=`);

/** Notificación push con ntfy. */
async function ntfy({ titulo = 'Jarvis', mensaje, prioridad = 'default', etiquetas = [], enlace } = {}) {
  const tema = claves.obtener('NTFY_TEMA');
  if (!tema) return { ok: false, error: 'Falta NTFY_TEMA (Ajustes → Claves)' };
  const servidor = claves.obtener('NTFY_SERVIDOR').replace(/\/+$/, '');
  const headers = {
    Title: cabecera(titulo),
    Priority: PRIORIDADES[prioridad] || 'default',
    'Content-Type': 'text/plain; charset=utf-8',
  };
  if (etiquetas.length) headers.Tags = etiquetas.join(',');
  if (enlace) headers.Click = enlace;
  if (claves.obtener('NTFY_TOKEN')) headers.Authorization = `Bearer ${claves.obtener('NTFY_TOKEN')}`;
  const r = await pedir(`${servidor}/${encodeURIComponent(tema)}`, { method: 'POST', headers, body: String(mensaje || '').slice(0, 3500) }, 15);
  registro.anotar({ origen: 'avisos', accion: `ntfy: ${titulo}`, decision: r.ok ? 'hecho' : 'fallo', motivo: r.ok ? undefined : r.error });
  return r.ok ? { ok: true } : { ok: false, error: `ntfy: ${r.error}` };
}

const xml = (t) => String(t).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

/** Llamada de voz con Twilio (solo para avisos urgentes). */
async function llamar(mensaje, idioma = 'es-ES') {
  const sid = claves.obtener('TWILIO_SID');
  const token = claves.obtener('TWILIO_TOKEN');
  const desde = claves.obtener('TWILIO_DESDE');
  const a = claves.obtener('TWILIO_A');
  if (!sid || !token || !desde || !a) return { ok: false, error: 'Faltan claves de Twilio (SID, token, número desde y tu teléfono)' };
  const twiml = `<Response><Say language="${xml(idioma)}">${xml(String(mensaje).slice(0, 900))}</Say></Response>`;
  const cuerpo = new URLSearchParams({ To: a, From: desde, Twiml: twiml });
  const base = process.env.JARVIS_TWILIO_BASE || 'https://api.twilio.com';
  const r = await pedir(`${base}/2010-04-01/Accounts/${encodeURIComponent(sid)}/Calls.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo.toString(),
  }, 20);
  registro.anotar({ origen: 'avisos', accion: 'llamada Twilio', decision: r.ok ? 'hecho' : 'fallo', motivo: r.ok ? undefined : r.error });
  return r.ok ? { ok: true, sid: r.datos && r.datos.sid } : { ok: false, error: `Twilio: ${r.error}` };
}

/**
 * Aviso completo según la urgencia:
 *   normal  -> ntfy (si hay tema)
 *   urgente -> ntfy urgente + llamada (si hay Twilio y está permitido en ajustes)
 */
async function avisar({ titulo, mensaje, urgencia = 'normal', permitirLlamada = false }) {
  const res = { ntfy: null, llamada: null };
  if (claves.tiene('NTFY_TEMA')) {
    res.ntfy = await ntfy({ titulo, mensaje, prioridad: urgencia === 'urgente' ? 'urgente' : 'normal', etiquetas: urgencia === 'urgente' ? ['rotating_light'] : ['robot'] });
  }
  if (urgencia === 'urgente' && permitirLlamada && claves.tiene('TWILIO_SID')) {
    res.llamada = await llamar(`Aviso de Jarvis. ${titulo}. ${mensaje}`);
  }
  return res;
}

module.exports = { ntfy, llamar, avisar };
