// Modelo local con Ollama (ya instalado en el PC). Rápido y gratis para
// preguntas sencillas. Modelo por defecto: qwen2.5:3b (≈2 GB, va bien en un
// portátil y entiende español, francés y árabe).
'use strict';
const claves = require('../nucleo/claves');
const { pedir } = require('../nucleo/http');

const modelo = () => claves.obtener('OLLAMA_MODELO');

async function disponible() {
  const r = await pedir(`${claves.obtener('OLLAMA_URL')}/api/tags`, {}, 4);
  if (!r.ok) return { ok: false, error: 'Ollama no está abierto' };
  const nombres = (r.datos?.models || []).map((m) => m.name);
  const m = modelo();
  const tiene = nombres.some((n) => n === m || n === `${m}:latest`);
  return tiene ? { ok: true } : { ok: false, error: `Falta el modelo ${m} en Ollama (ollama pull ${m})` };
}

/**
 * @param {{sistema:string, mensajes:{role:string, content:string}[], temperatura?:number, segundos?:number}} p
 */
async function chat({ sistema, mensajes, temperatura = 0.4, segundos = 90 }) {
  const r = await pedir(`${claves.obtener('OLLAMA_URL')}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: modelo(),
      stream: false,
      keep_alive: '15m',
      options: { temperature: temperatura, num_ctx: 4096 },
      messages: [{ role: 'system', content: sistema }, ...mensajes],
    }),
  }, segundos);
  if (!r.ok) return { ok: false, error: `Ollama: ${r.error}` };
  const texto = r.datos?.message?.content?.trim();
  if (!texto) return { ok: false, error: 'Ollama respondió vacío' };
  return { ok: true, texto, motor: `Ollama · ${modelo()}` };
}

module.exports = { chat, disponible, modelo };
