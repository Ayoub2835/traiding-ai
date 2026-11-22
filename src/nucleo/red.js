// Red permitida: la ventana de Jarvis solo puede conectarse a estos hosts.
// (Ollama y Claude Code son programas aparte; a esos los controla la política
// de permisos, no este filtro.)
const claves = require('./claves');
const { hostsPermitidos: hostsN8n } = require('./config');

function host(url) {
  try { return new URL(url).host; } catch (_) { return null; }
}

function hostsPermitidos(cfg) {
  // n8n solo cuenta si está activado (es opcional).
  let usarN8n = false;
  try { usarN8n = Boolean(require('./ajustes').leer().usarN8n); } catch (_) { /* fuera de Electron */ }
  const h = new Set(usarN8n ? hostsN8n(cfg) : []);
  const add = (u) => { const x = host(u); if (x) h.add(x); };
  if (claves.tiene('ANTHROPIC_API_KEY')) add(claves.obtener('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com');
  if (claves.tiene('OPENAI_API_KEY')) add(claves.obtener('OPENAI_BASE_URL') || 'https://api.openai.com');
  if (claves.tiene('GEMINI_API_KEY')) add('https://generativelanguage.googleapis.com');
  if (claves.tiene('NTFY_TEMA')) add(claves.obtener('NTFY_SERVIDOR'));
  if (claves.tiene('TWILIO_SID')) add('https://api.twilio.com');
  if (claves.tiene('SHOPIFY_TIENDA')) add(`https://${claves.obtener('SHOPIFY_TIENDA')}`);
  for (const u of (cfg && cfg.noticias) || []) add(u.url || u);
  add('https://news.google.com'); // búsqueda gratis de las rutinas (Google News RSS)
  // Vídeos y tienda: datos públicos sin clave (precios cripto, miedo/codicia, cambio €).
  add('https://api.coingecko.com');
  add('https://api.alternative.me');
  add('https://api.frankfurter.dev');
  if (claves.tiene('CJ_API_KEY')) add('https://developers.cjdropshipping.com');
  if (claves.tiene('TELEGRAM_BOT_TOKEN')) add('https://api.telegram.org');
  if (claves.tiene('META_PAGE_TOKEN') || claves.tiene('META_ADS_TOKEN') || claves.tiene('META_USER_TOKEN')) add('https://graph.facebook.com');
  return h;
}

// Dominios con muchos subdominios (las fotos de CJ vienen de varios CDN suyos).
function porSufijo(hostName) {
  if (!claves.tiene('CJ_API_KEY')) return false;
  return ['cjdropshipping.com', 'alicdn.com'].some((d) => hostName === d || hostName.endsWith(`.${d}`));
}

// Ollama local: se permite http solo hacia este mismo PC.
function esLocal(u) {
  return ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
}

function permitida(urlTexto, cfg) {
  let u;
  try { u = new URL(urlTexto); } catch (_) { return false; }
  if (['jarvis:', 'file:', 'data:', 'blob:', 'devtools:', 'chrome-extension:'].includes(u.protocol)) return true;
  if ((u.protocol === 'http:' || u.protocol === 'ws:') && esLocal(u)) return true;
  if (u.protocol === 'https:' || u.protocol === 'wss:') return hostsPermitidos(cfg).has(u.host) || (u.protocol === 'https:' && porSufijo(u.hostname));
  return false;
}

module.exports = { hostsPermitidos, permitida };
