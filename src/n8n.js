// Llamadas a tu n8n Cloud (chat y panel de memoria).
// Se hacen desde el proceso principal con net.fetch (pila de red de Chromium)
// y devuelven siempre { ok, ... } o { ok:false, error } con un motivo legible,
// para poder mostrarlo en pantalla.
const { net } = require('electron');

// El webhook del panel tiene activado "Ignorar bots" en n8n: con un
// User-Agent que no parezca de navegador responde 403. Usamos uno normal.
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function pedir(url, opciones, segundos) {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), segundos * 1000);
  try {
    const resp = await net.fetch(url, {
      ...opciones,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...(opciones.headers || {}) },
      signal: control.signal,
    });
    const texto = await resp.text();
    if (!resp.ok) {
      return { ok: false, error: `n8n respondió HTTP ${resp.status}: ${texto.slice(0, 160) || resp.statusText}` };
    }
    try {
      return { ok: true, datos: JSON.parse(texto) };
    } catch (_) {
      return { ok: false, error: `n8n no devolvió JSON válido: ${texto.slice(0, 160)}` };
    }
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, error: `n8n no respondió en ${segundos} s (tiempo agotado)` };
    return { ok: false, error: `No se pudo conectar con n8n: ${e.message}` };
  } finally {
    clearTimeout(temporizador);
  }
}

// Envía un mensaje al chat de Jarvis. Respuesta esperada: { output }
async function enviarMensaje(cfg, sessionId, texto) {
  const r = await pedir(
    cfg.n8n.chatUrl,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'sendMessage', sessionId, chatInput: texto }),
    },
    cfg.n8n.timeoutChatSegundos || 90
  );
  if (!r.ok) return r;
  const salida = r.datos && (r.datos.output ?? r.datos.text);
  if (typeof salida !== 'string' || !salida.trim()) {
    return { ok: false, error: 'n8n respondió sin campo "output"' };
  }
  return { ok: true, respuesta: salida };
}

// Lee el panel de memoria. Respuesta esperada: { items:[...] }
async function leerPanel(cfg) {
  const r = await pedir(cfg.n8n.panelUrl, { method: 'GET' }, cfg.n8n.timeoutPanelSegundos || 30);
  if (!r.ok) return r;
  if (!r.datos || !Array.isArray(r.datos.items)) {
    return { ok: false, error: 'El panel de n8n no devolvió una lista "items"' };
  }
  return { ok: true, items: r.datos.items, ahora: r.datos.ahora || null };
}

module.exports = { enviarMensaje, leerPanel };
