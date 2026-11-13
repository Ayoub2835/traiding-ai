// Peticiones HTTP comunes con tiempo máximo y errores legibles.
// Dentro de Electron usa net.fetch (pila de red de Chromium, respeta el proxy del
// sistema); fuera (pruebas) usa fetch de Node.
let netFetch = null;
try {
  const e = require('electron');
  if (typeof e === 'object' && e.net) netFetch = (...a) => e.net.fetch(...a);
} catch (_) { /* fuera de Electron */ }

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

/**
 * @returns {Promise<{ok:boolean, estado?:number, datos?:any, texto?:string, error?:string, sinConexion?:boolean}>}
 */
async function pedir(url, opciones = {}, segundos = 30) {
  const control = new AbortController();
  const t = setTimeout(() => control.abort(), segundos * 1000);
  const f = netFetch || fetch;
  try {
    const resp = await f(url, {
      ...opciones,
      headers: { 'User-Agent': USER_AGENT, ...(opciones.headers || {}) },
      signal: control.signal,
    });
    const tipo = resp.headers.get('content-type') || '';
    if (opciones.binario) {
      const buf = Buffer.from(await resp.arrayBuffer());
      if (!resp.ok) return { ok: false, estado: resp.status, error: `HTTP ${resp.status}: ${buf.toString('utf8').slice(0, 200)}` };
      return { ok: true, estado: resp.status, buffer: buf, tipo };
    }
    const texto = await resp.text();
    let datos = null;
    if (/json/.test(tipo) || /^\s*[[{]/.test(texto)) {
      try { datos = JSON.parse(texto); } catch (_) { /* no es JSON */ }
    }
    if (!resp.ok) {
      const msg = (datos && (datos.error?.message || datos.message || datos.error)) || texto.slice(0, 200) || resp.statusText;
      return { ok: false, estado: resp.status, datos, texto, error: `HTTP ${resp.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg).slice(0, 200)}` };
    }
    return { ok: true, estado: resp.status, datos, texto };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, sinConexion: true, error: `No respondió en ${segundos} s (tiempo agotado)` };
    return { ok: false, sinConexion: true, error: `No se pudo conectar: ${e.cause?.code || e.message}` };
  } finally {
    clearTimeout(t);
  }
}

module.exports = { pedir, USER_AGENT };
