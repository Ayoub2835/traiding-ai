// Claves y conexiones de servicios externos (.env).
//
// Se leen de (lo último manda):
//   1. .env en la carpeta del proyecto (modo desarrollo)
//   2. %APPDATA%\Jarvis\.env  (donde guarda la pantalla "Claves" de Ajustes)
// Los dos están en .gitignore: el repositorio es PÚBLICO y nunca lleva claves.
const fs = require('fs');
const path = require('path');
const rutas = require('./rutas');
const { pedir } = require('./http');

// Catálogo de claves que entiende Jarvis.
const CATALOGO = [
  { clave: 'ANTHROPIC_API_KEY', grupo: 'Cerebro', etiqueta: 'Clave de Claude (Anthropic)', secreta: true, ayuda: 'console.anthropic.com → API Keys. Para preguntas difíciles, habilidades y resúmenes.' },
  { clave: 'CLAUDE_MODELO', grupo: 'Cerebro', etiqueta: 'Modelo de Claude', defecto: 'claude-opus-5-5' },
  { clave: 'CLAUDE_ESFUERZO', grupo: 'Cerebro', etiqueta: 'Esfuerzo de Claude (low/medium/high)', defecto: 'medium' },
  { clave: 'OLLAMA_URL', grupo: 'Cerebro', etiqueta: 'Dirección de Ollama', defecto: 'http://127.0.0.1:11434' },
  { clave: 'OLLAMA_MODELO', grupo: 'Cerebro', etiqueta: 'Modelo local de Ollama', defecto: 'qwen2.5:3b' },
  { clave: 'OPENAI_API_KEY', grupo: 'Voz', etiqueta: 'Clave de OpenAI', secreta: true, ayuda: 'platform.openai.com → API keys. Voz en tiempo real (Realtime), transcripción y voz de Jarvis.' },
  { clave: 'OPENAI_REALTIME_MODELO', grupo: 'Voz', etiqueta: 'Modelo OpenAI Realtime', defecto: 'gpt-realtime' },
  { clave: 'OPENAI_VOZ', grupo: 'Voz', etiqueta: 'Voz de OpenAI', defecto: 'onyx' },
  { clave: 'GEMINI_API_KEY', grupo: 'Voz', etiqueta: 'Clave de Gemini (Google AI Studio)', secreta: true, ayuda: 'aistudio.google.com → Get API key. Alternativa a OpenAI para la voz en tiempo real.' },
  { clave: 'GEMINI_LIVE_MODELO', grupo: 'Voz', etiqueta: 'Modelo Gemini Live', defecto: 'gemini-2.5-flash-native-audio-preview-09-2025' },
  { clave: 'NTFY_TEMA', grupo: 'Avisos', etiqueta: 'Tema de ntfy (tu canal privado)', secreta: true, ayuda: 'Instala la app ntfy en el móvil y suscríbete a un tema difícil de adivinar, p. ej. jarvis-ayoub-8f3k2.' },
  { clave: 'NTFY_SERVIDOR', grupo: 'Avisos', etiqueta: 'Servidor ntfy', defecto: 'https://ntfy.sh' },
  { clave: 'NTFY_TOKEN', grupo: 'Avisos', etiqueta: 'Token de ntfy (opcional)', secreta: true },
  { clave: 'TWILIO_SID', grupo: 'Avisos', etiqueta: 'Twilio Account SID', secreta: true, ayuda: 'console.twilio.com. Solo para llamadas urgentes (opcional).' },
  { clave: 'TWILIO_TOKEN', grupo: 'Avisos', etiqueta: 'Twilio Auth Token', secreta: true },
  { clave: 'TWILIO_DESDE', grupo: 'Avisos', etiqueta: 'Número Twilio (desde)', ayuda: 'Formato internacional, p. ej. +34600000000' },
  { clave: 'TWILIO_A', grupo: 'Avisos', etiqueta: 'Tu teléfono (a quién llamar)', secreta: true },
  { clave: 'SHOPIFY_TIENDA', grupo: 'Manos', etiqueta: 'Tienda Shopify (xxx.myshopify.com)' },
  { clave: 'SHOPIFY_TOKEN', grupo: 'Manos', etiqueta: 'Token Admin API de Shopify', secreta: true, ayuda: 'Shopify → Configuración → Apps → Desarrollar apps → token de Admin API.' },
  { clave: 'N8N_MCP_URL', grupo: 'Manos', etiqueta: 'URL MCP de n8n (opcional)', ayuda: 'n8n → Settings → MCP access. Deja que las manos lean/editen flujos.' },
  { clave: 'N8N_MCP_TOKEN', grupo: 'Manos', etiqueta: 'Token MCP de n8n', secreta: true },
  { clave: 'CLAUDE_CODE_RUTA', grupo: 'Manos', etiqueta: 'Comando de Claude Code', defecto: 'claude' },
  { clave: 'ANTHROPIC_BASE_URL', grupo: 'Avanzado', etiqueta: 'URL base de la API de Anthropic (solo pruebas)' },
  { clave: 'OPENAI_BASE_URL', grupo: 'Avanzado', etiqueta: 'URL base de la API de OpenAI (solo pruebas)' },
];

const rutaUsuario = () => rutas.datos('.env');
const rutaProyecto = () => path.join(rutas.RAIZ, '.env');

// Lector sencillo de archivos .env (CLAVE=valor, comillas opcionales, # comentarios).
function parsear(texto) {
  const r = {};
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    r[m[1]] = v;
  }
  return r;
}

function leerArchivo(ruta) {
  try { return parsear(fs.readFileSync(ruta, 'utf8')); } catch (_) { return {}; }
}

let cache = null;
function todas() {
  if (!cache) {
    const desarrollo = rutas.enDesarrollo() && !process.env.JARVIS_DATOS ? leerArchivo(rutaProyecto()) : {};
    cache = { ...desarrollo, ...leerArchivo(rutaUsuario()) };
  }
  return cache;
}

function obtener(clave) {
  const v = todas()[clave];
  if (v !== undefined && v !== '') return v;
  const def = CATALOGO.find((c) => c.clave === clave);
  return def && def.defecto ? def.defecto : '';
}

const tiene = (clave) => Boolean(todas()[clave]);

// Guarda cambios en %APPDATA%\Jarvis\.env. Un valor vacío borra la clave.
function guardar(cambios) {
  const actual = leerArchivo(rutaUsuario());
  for (const [k, v] of Object.entries(cambios || {})) {
    if (!/^[A-Z0-9_]+$/.test(k)) continue;
    const limpio = String(v ?? '').replace(/[\r\n]/g, '').trim();
    if (limpio) actual[k] = limpio; else delete actual[k];
  }
  const lineas = ['# Claves de Jarvis (privado: no compartir ni subir a GitHub)'];
  for (const [k, v] of Object.entries(actual)) lineas.push(`${k}=${/[\s#"']/.test(v) ? JSON.stringify(v) : v}`);
  fs.writeFileSync(rutaUsuario(), lineas.join('\n') + '\n', { mode: 0o600 });
  cache = null;
  return paraInterfaz();
}

// Para la pantalla de Ajustes: las secretas solo se muestran enmascaradas.
function paraInterfaz() {
  const t = todas();
  return CATALOGO.map((c) => {
    const valor = t[c.clave] || '';
    return {
      ...c,
      configurada: Boolean(valor),
      valor: c.secreta ? (valor ? `••••${valor.slice(-4)}` : '') : valor,
    };
  });
}

// ---------------------------------------------------------------------------
// Pruebas de cada servicio (botón "Probar" en Ajustes → Claves)
// ---------------------------------------------------------------------------
const PRUEBAS = {
  async ANTHROPIC_API_KEY() {
    const base = obtener('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com';
    const r = await pedir(`${base}/v1/models?limit=1`, { headers: { 'x-api-key': obtener('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' } }, 20);
    return r.ok ? 'Claude responde' : r.error;
  },
  async OPENAI_API_KEY() {
    const base = obtener('OPENAI_BASE_URL') || 'https://api.openai.com';
    const r = await pedir(`${base}/v1/models`, { headers: { Authorization: `Bearer ${obtener('OPENAI_API_KEY')}` } }, 20);
    return r.ok ? 'OpenAI responde' : r.error;
  },
  async GEMINI_API_KEY() {
    const r = await pedir(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=${encodeURIComponent(obtener('GEMINI_API_KEY'))}`, {}, 20);
    return r.ok ? 'Gemini responde' : r.error;
  },
  async OLLAMA_URL() {
    const r = await pedir(`${obtener('OLLAMA_URL')}/api/tags`, {}, 10);
    if (!r.ok) return `Ollama no responde (${r.error}). ¿Está abierto?`;
    const modelos = (r.datos?.models || []).map((m) => m.name);
    const buscado = obtener('OLLAMA_MODELO');
    return modelos.some((m) => m === buscado || m.startsWith(buscado + ':'))
      ? `Ollama OK con ${buscado}`
      : `Ollama responde, pero falta el modelo ${buscado}. Ejecuta: ollama pull ${buscado}`;
  },
  async NTFY_TEMA() {
    const avisos = require('../avisos');
    const r = await avisos.ntfy({ titulo: 'Jarvis', mensaje: 'Prueba de aviso: si lees esto, funciona.', prioridad: 'default' });
    return r.ok ? 'Aviso enviado: mira el móvil' : r.error;
  },
  async TWILIO_SID() {
    const sid = obtener('TWILIO_SID');
    const r = await pedir(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${obtener('TWILIO_TOKEN')}`).toString('base64') },
    }, 20);
    return r.ok ? `Twilio OK (${r.datos?.friendly_name || 'cuenta'})` : r.error;
  },
  async SHOPIFY_TOKEN() {
    const r = await pedir(`https://${obtener('SHOPIFY_TIENDA')}/admin/api/2025-07/shop.json`, { headers: { 'X-Shopify-Access-Token': obtener('SHOPIFY_TOKEN') } }, 20);
    return r.ok ? `Shopify OK (${r.datos?.shop?.name || 'tienda'})` : r.error;
  },
};
PRUEBAS.OLLAMA_MODELO = PRUEBAS.OLLAMA_URL;
PRUEBAS.TWILIO_TOKEN = PRUEBAS.TWILIO_SID;
PRUEBAS.SHOPIFY_TIENDA = PRUEBAS.SHOPIFY_TOKEN;

async function probar(clave) {
  const prueba = PRUEBAS[clave];
  if (!prueba) return { ok: true, mensaje: 'Sin prueba automática para esta clave' };
  if (!obtener(clave)) return { ok: false, mensaje: 'Está vacía' };
  try {
    const mensaje = await prueba();
    const ok = /OK|responde|enviado/i.test(mensaje) && !/no responde|falta|HTTP|No se pudo/i.test(mensaje);
    return { ok, mensaje };
  } catch (e) {
    return { ok: false, mensaje: e.message };
  }
}

const recargar = () => { cache = null; };

module.exports = { CATALOGO, obtener, tiene, guardar, paraInterfaz, probar, parsear, recargar };
