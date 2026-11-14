// Modelo local con Ollama (ya instalado en el PC). Rápido y gratis para
// preguntas sencillas. Modelo por defecto: qwen2.5:3b (≈2 GB, va bien en un
// portátil y entiende español, francés y árabe).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const claves = require('../nucleo/claves');
const { pedir } = require('../nucleo/http');
const registro = require('../seguridad/registro');

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

// ¿Responde el servidor de Ollama (aunque falte el modelo)?
async function abierto() {
  return (await pedir(`${claves.obtener('OLLAMA_URL')}/api/tags`, {}, 3)).ok;
}

// Dónde buscar el programa: el comando "ollama" o la ruta de instalación de Windows.
function ejecutable() {
  if (process.env.JARVIS_OLLAMA) return process.env.JARVIS_OLLAMA;
  if (process.platform === 'win32') {
    const instalado = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Programs', 'Ollama', 'ollama.exe');
    if (fs.existsSync(instalado)) return instalado;
  }
  return 'ollama';
}

/**
 * Si Ollama no está abierto, lo abre ("ollama serve" en segundo plano) y
 * espera hasta 15 s a que responda. Solo si la dirección es de este PC.
 * @returns {Promise<{ok:boolean, abiertoPorJarvis?:boolean, error?:string}>}
 */
async function asegurarAbierto(segundos = 15) {
  if (await abierto()) return { ok: true, abiertoPorJarvis: false };
  let url;
  try { url = new URL(claves.obtener('OLLAMA_URL')); } catch (_) { return { ok: false, error: 'OLLAMA_URL no válida' }; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return { ok: false, error: 'Ollama está en otro equipo: no se puede abrir desde aquí' };
  const env = { ...process.env, OLLAMA_HOST: `${url.hostname}:${url.port || 11434}` };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    const p = spawn(ejecutable(), ['serve'], { detached: true, stdio: 'ignore', windowsHide: true, env });
    p.on('error', () => {}); // si no está instalado, lo detecta la espera de abajo
    p.unref();
  } catch (e) {
    return { ok: false, error: `No se pudo abrir Ollama: ${e.message}` };
  }
  for (let i = 0; i < segundos * 2; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await abierto()) {
      registro.anotar({ origen: 'cerebro', accion: 'abrir Ollama (ollama serve)', decision: 'hecho' });
      return { ok: true, abiertoPorJarvis: true };
    }
  }
  registro.anotar({ origen: 'cerebro', accion: 'abrir Ollama (ollama serve)', decision: 'fallo', motivo: 'no respondió' });
  return { ok: false, error: 'Ollama no se ha podido abrir. ¿Está instalado? (ollama.com/download)' };
}

module.exports = { chat, disponible, modelo, abierto, asegurarAbierto };
