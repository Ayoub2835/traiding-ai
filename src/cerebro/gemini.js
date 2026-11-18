// Gemini (Google AI Studio, plan GRATUITO) para preguntas difíciles, informes y
// la caza de oportunidades (con búsqueda de Google integrada y fuentes reales).
//
// Límites del plan gratuito: Jarvis cuenta las peticiones del día y no pasa de
// GEMINI_LIMITE_DIARIO. Si Google responde 429 (límite alcanzado), Gemini se
// "duerme" un rato (o hasta el día siguiente) y el router pasa a Ollama.
'use strict';
const fs = require('fs');
const claves = require('../nucleo/claves');
const rutas = require('../nucleo/rutas');
const { pedir } = require('../nucleo/http');
const registro = require('../seguridad/registro');

const base = () => process.env.JARVIS_GEMINI_BASE || 'https://generativelanguage.googleapis.com/v1beta'; // la variable solo se usa en pruebas
const archivoUso = () => rutas.datos('gemini-uso.json');
const hoy = () => new Date().toISOString().slice(0, 10);

function leerUso() {
  try {
    const u = JSON.parse(fs.readFileSync(archivoUso(), 'utf8'));
    return u.fecha === hoy() ? u : { fecha: hoy(), usadas: 0, dormidoHasta: u.dormidoHasta || null };
  } catch (_) {
    return { fecha: hoy(), usadas: 0, dormidoHasta: null };
  }
}
const guardarUso = (u) => { try { fs.writeFileSync(archivoUso(), JSON.stringify(u)); } catch (_) { /* no crítico */ } };

const limite = () => Math.max(1, Number(claves.obtener('GEMINI_LIMITE_DIARIO')) || 200);

/** ¿Se puede usar Gemini ahora? */
function disponible() {
  if (!claves.tiene('GEMINI_API_KEY')) return false;
  const u = leerUso();
  if (u.dormidoHasta && Date.now() < new Date(u.dormidoHasta).getTime()) return false;
  return u.usadas < limite();
}

function estado() {
  const u = leerUso();
  if (!claves.tiene('GEMINI_API_KEY')) return 'Falta GEMINI_API_KEY';
  if (u.dormidoHasta && Date.now() < new Date(u.dormidoHasta).getTime()) {
    return `En pausa por límite de Google hasta las ${new Date(u.dormidoHasta).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
  }
  return `${u.usadas}/${limite()} peticiones hoy`;
}

// Tras un 429: si es el límite diario, hasta que Google lo reinicia (medianoche
// del Pacífico ≈ 09:00 en España); si es por minuto, lo que diga Google o 60 s.
function dormir(datos) {
  const texto = JSON.stringify(datos || {});
  let hasta;
  if (/PerDay|per day|daily/i.test(texto)) {
    hasta = new Date();
    hasta.setUTCHours(8, 5, 0, 0);
    if (hasta <= new Date()) hasta.setUTCDate(hasta.getUTCDate() + 1);
  } else {
    const m = texto.match(/"retryDelay"\s*:\s*"(\d+)s"/);
    hasta = new Date(Date.now() + (m ? Number(m[1]) : 60) * 1000);
  }
  const u = leerUso();
  u.dormidoHasta = hasta.toISOString();
  guardarUso(u);
  registro.anotar({ origen: 'cerebro', accion: 'Gemini en pausa por límite (429)', motivo: `hasta ${u.dormidoHasta}` });
}

// Si el modelo configurado ya no existe, se busca el "flash" más reciente.
let modeloResuelto = null;
async function resolverModelo(clave) {
  const r = await pedir(`${base()}/models?pageSize=200&key=${encodeURIComponent(clave)}`, {}, 20);
  const nombres = (r.datos?.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /flash/.test(n) && !/lite|image|tts|live|audio|thinking|exp/.test(n))
    .sort()
    .reverse();
  return nombres[0] || null;
}

/**
 * @param {{sistema:string, mensajes:{role:string, content:string}[], buscar?:boolean, contar?:boolean, segundos?:number}} p
 *   buscar: activa la búsqueda de Google integrada (devuelve fuentes reales).
 * @returns {Promise<{ok:boolean, texto?:string, fuentes?:{titulo:string,url:string}[], motor?:string, error?:string, limite?:boolean}>}
 */
async function chat({ sistema, mensajes, buscar = false, contar = true, segundos = 90 }) {
  const clave = claves.obtener('GEMINI_API_KEY');
  if (!clave) return { ok: false, error: 'Falta la clave de Gemini (Ajustes → Claves)' };
  if (contar && !disponible()) return { ok: false, limite: true, error: `Gemini no disponible ahora (${estado()})` };
  const modelo = modeloResuelto || claves.obtener('GEMINI_MODELO');
  const cuerpo = {
    systemInstruction: { parts: [{ text: sistema }] },
    contents: mensajes.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: String(m.content) }] })),
    generationConfig: { temperature: 0.5 },
  };
  if (buscar) cuerpo.tools = [{ google_search: {} }];
  const r = await pedir(`${base()}/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(clave)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
  }, segundos);
  if (contar) { const u = leerUso(); u.usadas++; guardarUso(u); }

  if (!r.ok) {
    if (r.estado === 429) { dormir(r.datos); return { ok: false, limite: true, error: 'Gemini: límite gratuito alcanzado; sigo con el modelo local' }; }
    if (r.estado === 404 && !modeloResuelto) {
      const otro = await resolverModelo(clave);
      if (otro && otro !== modelo) { modeloResuelto = otro; return chat({ sistema, mensajes, buscar, contar: false, segundos }); }
    }
    if (r.estado === 400 && /API key not valid/i.test(r.error)) return { ok: false, error: 'La clave de Gemini no es válida' };
    return { ok: false, error: `Gemini: ${r.error}`, sinConexion: r.sinConexion };
  }
  const cand = r.datos?.candidates?.[0];
  const texto = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!texto) return { ok: false, error: `Gemini respondió vacío${cand?.finishReason ? ` (${cand.finishReason})` : ''}` };
  const fuentes = (cand?.groundingMetadata?.groundingChunks || [])
    .map((c) => c.web).filter(Boolean).map((w) => ({ titulo: w.title || w.uri, url: w.uri }));
  return { ok: true, texto, fuentes, motor: `Gemini · ${modelo}` };
}

module.exports = { chat, disponible, estado, _dormir: dormir };
