// TikTok: Content Posting API (publicación directa de un archivo local).
//
//  - Conexión: Login Kit para escritorio. En developers.tiktok.com creas una app
//    con los productos "Login Kit" (Desktop) y "Content Posting API" (Direct Post),
//    registras como redirect URI  http://127.0.0.1:*/callback/  y pegas en Jarvis
//    el Client key y el Client secret.
//  - PKCE de TikTok para escritorio: el code_challenge es el SHA-256 en HEXADECIMAL
//    (no base64url como en el estándar).
//  - El token de refresco dura 180 días y CAMBIA en cada renovación: se guarda el nuevo.
//  - Mientras TikTok no audite tu app, todo lo que publique queda en PRIVADO
//    ("solo yo"): es una norma de TikTok, no de Jarvis.
'use strict';
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const claves = require('../nucleo/claves');
const registro = require('../seguridad/registro');
const { peticion, formulario } = require('../nucleo/peticion');

const API = () => process.env.JARVIS_TIKTOK_BASE || 'https://open.tiktokapis.com';
const AUTH = () => process.env.JARVIS_TIKTOK_AUTH || 'https://www.tiktok.com/v2/auth/authorize/';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const MB = 1024 * 1024;

const estado = () => ({ tiktok: Boolean(claves.obtener('TIKTOK_REFRESH_TOKEN')), usuario: claves.obtener('TIKTOK_USUARIO') || null });

const PAGINA = (t, x) => `<!doctype html><meta charset="utf-8"><title>Jarvis</title><body style="font-family:system-ui;background:#0b1220;color:#e6edf7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>${t}</h1><p>${x}</p></div>`;

async function guardarTokens(d) {
  if (d.refresh_token) claves.guardar({ TIKTOK_REFRESH_TOKEN: d.refresh_token });
  return d.access_token;
}

/** Abre el navegador para que autorices a Jarvis en tu cuenta de TikTok. */
async function conectar(abrirNavegador, { segundos = 300 } = {}) {
  const clave = claves.obtener('TIKTOK_CLIENT_KEY');
  const secreto = claves.obtener('TIKTOK_CLIENT_SECRET');
  if (!clave || !secreto) return { ok: false, error: 'Faltan el Client key y el Client secret de TikTok (Ajustes → Claves → Redes sociales)' };
  const verificador = crypto.randomBytes(48).toString('base64url'); // 64 caracteres [A-Za-z0-9-_]
  const reto = crypto.createHash('sha256').update(verificador).digest('hex');
  const estadoOauth = crypto.randomBytes(16).toString('hex');
  const servidor = http.createServer();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${servidor.address().port}/callback/`;
  let fin = null;
  const codigo = new Promise((resolver) => {
    fin = setTimeout(() => resolver({ error: 'Se acabó el tiempo para dar permiso en el navegador' }), segundos * 1000);
    servidor.on('request', (req, res) => {
      const u = new URL(req.url, redirect);
      if (u.pathname !== '/callback/') { res.writeHead(404); return res.end(); }
      const q = u.searchParams;
      const valido = q.get('state') === estadoOauth && q.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      res.end(valido ? PAGINA('✔ TikTok conectado', 'Ya puedes cerrar esta pestaña y volver a Jarvis.') : PAGINA('✘ No se conectó', 'Vuelve a Jarvis e inténtalo otra vez.'));
      clearTimeout(fin);
      resolver(valido ? { code: q.get('code') } : { error: q.get('error_description') || q.get('error') || 'estado no válido' });
    });
  });
  const url = `${AUTH()}?${formulario({ client_key: clave, scope: 'user.info.basic,video.publish', response_type: 'code', redirect_uri: redirect, state: estadoOauth, code_challenge: reto, code_challenge_method: 'S256' })}`;
  try {
    await abrirNavegador(url);
    const c = await codigo;
    if (c.error) return { ok: false, error: `TikTok: ${c.error}` };
    const r = await peticion(`${API()}/v2/oauth/token/`, {
      metodo: 'POST', cabeceras: { 'Content-Type': 'application/x-www-form-urlencoded' },
      cuerpo: formulario({ client_key: clave, client_secret: secreto, code: c.code, grant_type: 'authorization_code', redirect_uri: redirect, code_verifier: verificador }),
    });
    if (!r.ok || !r.datos?.access_token || !r.datos?.refresh_token) return { ok: false, error: `TikTok no dio permiso: ${r.error || r.datos?.error_description || 'sin token'}` };
    await guardarTokens(r.datos);
    const info = await infoCreador(r.datos.access_token).catch(() => null);
    if (info?.creator_username) claves.guardar({ TIKTOK_USUARIO: info.creator_username });
    registro.anotar({ origen: 'redes', accion: 'conectar TikTok', detalle: info?.creator_username || '' });
    return { ok: true, usuario: info?.creator_username || null };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(fin);
    servidor.close();
  }
}

async function tokenAcceso() {
  const refresco = claves.obtener('TIKTOK_REFRESH_TOKEN');
  if (!refresco) throw new Error('TikTok no está conectado');
  const r = await peticion(`${API()}/v2/oauth/token/`, {
    metodo: 'POST', cabeceras: { 'Content-Type': 'application/x-www-form-urlencoded' },
    cuerpo: formulario({ client_key: claves.obtener('TIKTOK_CLIENT_KEY'), client_secret: claves.obtener('TIKTOK_CLIENT_SECRET'), grant_type: 'refresh_token', refresh_token: refresco }),
  });
  if (!r.ok || !r.datos?.access_token) {
    throw new Error(/invalid_grant|expired/i.test(JSON.stringify(r.datos || {})) ? 'El permiso de TikTok ha caducado: vuelve a pulsar «Conectar TikTok»' : `No se pudo renovar el permiso de TikTok: ${r.error}`);
  }
  return guardarTokens(r.datos);
}

const cabeceras = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json; charset=UTF-8' });

async function infoCreador(t) {
  const r = await peticion(`${API()}/v2/post/publish/creator_info/query/`, { metodo: 'POST', cabeceras: cabeceras(t), cuerpo: '{}' });
  if (!r.ok || !r.datos?.data) throw new Error(`TikTok (info de la cuenta): ${r.error || r.datos?.error?.message}`);
  return r.datos.data;
}

/** Reparte el archivo en trozos según las reglas de TikTok (5-64 MB; el último absorbe el resto). */
function trozos(tamaño) {
  if (tamaño < 5 * MB) return { chunk: tamaño, total: 1, rangos: [[0, tamaño - 1]] };
  const chunk = 10 * MB;
  const total = Math.floor(tamaño / chunk);
  const rangos = [];
  for (let i = 0; i < total; i++) rangos.push([i * chunk, i === total - 1 ? tamaño - 1 : (i + 1) * chunk - 1]);
  return { chunk, total, rangos };
}

/**
 * Publica el vídeo. Usa la privacidad TIKTOK_PRIVACIDAD (por defecto pública) si la
 * cuenta la permite; si TikTok obliga a privado (app sin auditar), reintenta en privado.
 */
async function publicar(archivo, titulo, { esperaMs = 5000, intentos = 120 } = {}) {
  const t = await tokenAcceso();
  const info = await infoCreador(t);
  const opciones = info.privacy_level_options || ['SELF_ONLY'];
  const deseada = claves.obtener('TIKTOK_PRIVACIDAD') || 'PUBLIC_TO_EVERYONE';
  const tamaño = fs.statSync(archivo).size;
  const { chunk, total, rangos } = trozos(tamaño);
  const iniciar = (privacidad) => peticion(`${API()}/v2/post/publish/video/init/`, {
    metodo: 'POST', cabeceras: cabeceras(t),
    cuerpo: JSON.stringify({
      post_info: { title: titulo.slice(0, 2200), privacy_level: privacidad, disable_duet: false, disable_stitch: false, disable_comment: Boolean(info.comment_disabled), brand_content_toggle: false, brand_organic_toggle: false, is_aigc: true },
      source_info: { source: 'FILE_UPLOAD', video_size: tamaño, chunk_size: chunk, total_chunk_count: total },
    }),
  });
  let privacidad = opciones.includes(deseada) ? deseada : 'SELF_ONLY';
  let ini = await iniciar(privacidad);
  if (!ini.ok && privacidad !== 'SELF_ONLY' && /unaudited|private/i.test(JSON.stringify(ini.datos || ini.error))) {
    privacidad = 'SELF_ONLY';
    ini = await iniciar(privacidad);
  }
  const d = ini.datos?.data;
  if (!ini.ok || !d?.upload_url || !d?.publish_id) throw new Error(`TikTok no aceptó la subida: ${ini.error || ini.datos?.error?.message}`);
  for (const [a, b] of rangos) {
    const r = await peticion(d.upload_url, { metodo: 'PUT', cabeceras: { 'Content-Type': 'video/mp4', 'Content-Length': String(b - a + 1), 'Content-Range': `bytes ${a}-${b}/${tamaño}` }, archivo, inicio: a, fin: b, segundos: 1800 });
    if (!r.ok) throw new Error(`Falló la subida a TikTok (bytes ${a}-${b}): ${r.error}`);
  }
  for (let i = 0; i < intentos; i++) {
    const s = await peticion(`${API()}/v2/post/publish/status/fetch/`, { metodo: 'POST', cabeceras: cabeceras(t), cuerpo: JSON.stringify({ publish_id: d.publish_id }) });
    const st = s.datos?.data?.status;
    if (st === 'PUBLISH_COMPLETE') {
      const id = (s.datos.data.publicaly_available_post_id || [])[0];
      const usuario = claves.obtener('TIKTOK_USUARIO');
      return { id: d.publish_id, privacidad, url: id && usuario ? `https://www.tiktok.com/@${usuario}/video/${id}` : null };
    }
    if (st === 'FAILED') throw new Error(`TikTok rechazó el vídeo: ${s.datos.data.fail_reason || 'sin motivo'}`);
    await esperar(esperaMs);
  }
  // Sigue en moderación: está subido, TikTok lo publicará al terminar.
  return { id: d.publish_id, privacidad, url: null, pendiente: true };
}

async function probar() {
  const info = await infoCreador(await tokenAcceso());
  return `TikTok OK (@${info.creator_username})`;
}

module.exports = { conectar, estado, publicar, probar, trozos };
