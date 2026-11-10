// Llamadas a tu n8n Cloud: chat, panel de memoria y voz.
// Se hacen desde el proceso principal con net.fetch (pila de red de Chromium)
// y devuelven siempre { ok, ... } o { ok:false, error } con un motivo legible,
// para poder mostrarlo en pantalla.
const crypto = require('crypto');
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
      return { ok: false, error: `n8n no devolvió JSON válido: ${texto.slice(0, 160) || '(respuesta vacía)'}` };
    }
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, sinConexion: true, error: `n8n no respondió en ${segundos} s (tiempo agotado)` };
    return { ok: false, sinConexion: true, error: `No se pudo conectar con n8n: ${e.message}` };
  } finally {
    clearTimeout(temporizador);
  }
}

// Envía un mensaje al chat de Jarvis (solo texto). Respuesta esperada: { output }
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

// Construye un cuerpo multipart/form-data a mano (campos de texto + 1 archivo).
function multipart(campos, archivo) {
  const limite = '----JarvisLimite' + crypto.randomBytes(12).toString('hex');
  const partes = [];
  for (const [nombre, valor] of Object.entries(campos)) {
    partes.push(Buffer.from(
      `--${limite}\r\nContent-Disposition: form-data; name="${nombre}"\r\n\r\n${valor}\r\n`, 'utf8'));
  }
  if (archivo) {
    partes.push(Buffer.from(
      `--${limite}\r\nContent-Disposition: form-data; name="${archivo.campo}"; filename="${archivo.nombre}"\r\n`
      + `Content-Type: ${archivo.tipo}\r\n\r\n`, 'utf8'));
    partes.push(archivo.datos);
    partes.push(Buffer.from('\r\n', 'utf8'));
  }
  partes.push(Buffer.from(`--${limite}--\r\n`, 'utf8'));
  return { cuerpo: Buffer.concat(partes), tipo: `multipart/form-data; boundary=${limite}` };
}

// Extensión de archivo según el tipo de audio grabado.
function extension(mime) {
  if (/ogg/.test(mime)) return 'ogg';
  if (/mpeg|mp3/.test(mime)) return 'mp3';
  if (/wav/.test(mime)) return 'wav';
  return 'webm';
}

/**
 * Habla con Jarvis por el endpoint de voz.
 *   { audio: Buffer, mime }  -> envía tu voz grabada
 *   { texto }                -> envía texto escrito
 * Respuesta esperada: { ok, pregunta, respuesta, audio_base64, audio_mime }
 */
async function voz(cfg, sessionId, { audio, mime, texto }) {
  const campos = { sessionId };
  let archivo = null;
  if (audio && audio.length) {
    const tipo = String(mime || 'audio/webm').split(';')[0];
    archivo = { campo: 'audio', nombre: `voz.${extension(tipo)}`, tipo, datos: audio };
  } else if (texto && texto.trim()) {
    campos.texto = texto.trim();
  } else {
    return { ok: false, error: 'No hay ni audio ni texto que enviar' };
  }
  const { cuerpo, tipo } = multipart(campos, archivo);
  const r = await pedir(cfg.n8n.vozUrl, { method: 'POST', headers: { 'Content-Type': tipo }, body: cuerpo },
    cfg.n8n.timeoutVozSegundos || 120);
  if (!r.ok) return r;
  const d = r.datos || {};
  if (d.ok === false) return { ok: false, error: `n8n (voz): ${d.error || d.mensaje || 'respondió ok:false'}` };
  if (typeof d.respuesta !== 'string' || !d.respuesta.trim()) {
    return { ok: false, error: 'El endpoint de voz respondió sin "respuesta"' };
  }
  return {
    ok: true,
    // n8n marca lo dictado con "[VOZ] "; para mostrarlo lo quitamos.
    pregunta: String(d.pregunta || texto || '').replace(/^\s*\[VOZ\]\s*/i, ''),
    respuesta: d.respuesta,
    audioBase64: typeof d.audio_base64 === 'string' ? d.audio_base64 : '',
    audioMime: d.audio_mime || 'audio/mpeg',
  };
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

module.exports = { enviarMensaje, leerPanel, voz };
