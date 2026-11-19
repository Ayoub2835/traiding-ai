// YouTube: sube un vídeo de la cola cada vez que se ejecuta la rutina "youtube".
//
//  - Cola: %APPDATA%\Jarvis\youtube\pendientes. Se sube el primero por orden
//    alfabético (pon 01-, 02-… delante para decidir el orden).
//  - Título/descripción: archivo con el mismo nombre .json
//    ({"titulo","descripcion","etiquetas":[...],"privacidad"}) o .txt
//    (1.ª línea = título, resto = descripción). Si no hay, los escribe el cerebro
//    a partir del nombre del archivo; si tampoco puede, usa el nombre.
//  - Al subir, el vídeo (y su .json/.txt) pasa a youtube\subidos y se anota en
//    youtube\historial.json. Si falla, se queda en la cola para la próxima vez.
//  - Conexión: OAuth 2.0 de Google para apps de escritorio (navegador + puerto
//    local 127.0.0.1, con PKCE). Solo se pide permiso para SUBIR vídeos y leer el
//    nombre del canal. El token de refresco se guarda en el .env de Jarvis.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const rutas = require('../nucleo/rutas');
const claves = require('../nucleo/claves');
const registro = require('../seguridad/registro');

const OAUTH = () => process.env.JARVIS_GOOGLE_OAUTH_BASE || 'https://oauth2.googleapis.com';
const AUTH = () => process.env.JARVIS_GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth';
const API = () => process.env.JARVIS_YOUTUBE_BASE || 'https://www.googleapis.com';
const ALCANCES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const VIDEOS = /\.(mp4|mov|m4v|mkv|webm|avi|wmv|flv|mpeg|mpg|3gp)$/i;
const TIPOS = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo', wmv: 'video/x-ms-wmv', flv: 'video/x-flv', mpeg: 'video/mpeg', mpg: 'video/mpeg', '3gp': 'video/3gpp' };
const PRIVACIDADES = ['public', 'unlisted', 'private'];

const carpeta = (nombre) => rutas.asegurar(rutas.datos('youtube', nombre));
const historialRuta = () => rutas.datos('youtube', 'historial.json');

// ---------------------------------------------------------------------------
// Cola y metadatos
// ---------------------------------------------------------------------------
function cola() {
  const dir = carpeta('pendientes');
  return fs.readdirSync(dir)
    .filter((f) => VIDEOS.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))
    .map((f) => path.join(dir, f));
}

// YouTube no admite < ni > en título/descripción; el título tiene 100 caracteres
// como máximo y las etiquetas 500 en total.
const limpiar = (t, max) => String(t || '').replace(/[<>]/g, '').slice(0, max).trim();
function limpiarEtiquetas(lista) {
  const out = [];
  let total = 0;
  for (const e of Array.isArray(lista) ? lista : String(lista || '').split(',')) {
    const x = limpiar(e, 60).replace(/,/g, '');
    if (!x || out.includes(x)) continue;
    const coste = x.length + (/\s/.test(x) ? 2 : 0) + (out.length ? 1 : 0);
    if (total + coste > 500) break;
    out.push(x); total += coste;
  }
  return out;
}

// "01-mi_viaje-a-Marrakech.mp4" -> "mi viaje a Marrakech"
const tituloDeNombre = (archivo) => path.basename(archivo, path.extname(archivo)).replace(/^\d+[\s._-]+/, '').replace(/[_-]+/g, ' ').trim() || 'Vídeo';

function compañeros(video) {
  const base = video.slice(0, -path.extname(video).length);
  return ['.json', '.txt'].map((e) => base + e).filter((f) => fs.existsSync(f));
}

/** Lee el .json o .txt que acompaña al vídeo (o null si no hay). */
function leerMetadatos(video) {
  for (const f of compañeros(video)) {
    const texto = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
    if (f.endsWith('.json')) {
      const d = JSON.parse(texto);
      return { titulo: d.titulo || d.title, descripcion: d.descripcion || d.description, etiquetas: d.etiquetas || d.tags, privacidad: d.privacidad || d.privacy };
    }
    const [primera, ...resto] = texto.split(/\r?\n/);
    if (primera.trim()) return { titulo: primera, descripcion: resto.join('\n').trim() };
  }
  return null;
}

async function metadatos(video, pensar) {
  let m = null;
  try { m = leerMetadatos(video); } catch (e) { throw new Error(`El archivo de texto de ${path.basename(video)} no es válido: ${e.message}`); }
  let origen = 'archivo';
  if (!m && pensar) {
    const r = await Promise.resolve(pensar(
      'Eres Jarvis y preparas vídeos para YouTube. A partir del nombre del archivo, escribe un título atractivo (máx. 90 caracteres, sin clickbait engañoso), '
      + 'una descripción de 2-4 frases y 5-10 etiquetas. Escribe en español salvo que el nombre esté claramente en otro idioma. '
      + 'Responde SOLO JSON: {"titulo":"...","descripcion":"...","etiquetas":["..."]}',
      `Archivo: ${path.basename(video)}`,
      { preferir: 'claude' },
    )).catch(() => null);
    try { if (r && r.ok) { m = JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]); origen = 'cerebro'; } } catch (_) { m = null; }
  }
  if (!m) { m = {}; origen = 'nombre'; }
  const porDefecto = claves.obtener('YOUTUBE_PRIVACIDAD');
  const privacidad = PRIVACIDADES.includes(m.privacidad) ? m.privacidad : (PRIVACIDADES.includes(porDefecto) ? porDefecto : 'public');
  return {
    titulo: limpiar(m.titulo, 100) || limpiar(tituloDeNombre(video), 100),
    descripcion: limpiar(m.descripcion, 4900),
    etiquetas: limpiarEtiquetas(m.etiquetas),
    privacidad,
    origen,
  };
}

// ---------------------------------------------------------------------------
// HTTP (módulos http/https de Node: permiten subir el vídeo sin cargarlo entero
// en memoria)
// ---------------------------------------------------------------------------
function peticion(url, { metodo = 'GET', cabeceras = {}, cuerpo = null, archivo = null, segundos = 60 } = {}) {
  return new Promise((resolver) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method: metodo, headers: cabeceras }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { texto += d; });
      res.on('end', () => {
        let datos = null;
        try { datos = texto ? JSON.parse(texto) : null; } catch (_) { /* no es JSON */ }
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        const motivo = datos && (datos.error_description || datos.error?.message || (typeof datos.error === 'string' ? datos.error : null));
        resolver({ ok, estado: res.statusCode, datos, cabeceras: res.headers, error: ok ? null : `HTTP ${res.statusCode}: ${motivo || texto.slice(0, 200)}` });
      });
    });
    req.setTimeout(segundos * 1000, () => req.destroy(new Error(`sin respuesta en ${segundos} s`)));
    req.on('error', (e) => resolver({ ok: false, sinConexion: true, error: `No se pudo conectar con Google: ${e.message}` }));
    if (archivo) {
      const s = fs.createReadStream(archivo);
      s.on('error', (e) => req.destroy(e));
      s.pipe(req);
    } else {
      req.end(cuerpo);
    }
  });
}

const formulario = (o) => new URLSearchParams(o).toString();

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------
async function tokenAcceso() {
  const refresco = claves.obtener('YOUTUBE_REFRESH_TOKEN');
  if (!refresco) throw new Error('YouTube no está conectado: pulsa «Conectar YouTube» en la rutina de YouTube');
  const r = await peticion(`${OAUTH()}/token`, {
    metodo: 'POST',
    cabeceras: { 'Content-Type': 'application/x-www-form-urlencoded' },
    cuerpo: formulario({ client_id: claves.obtener('YOUTUBE_CLIENT_ID'), client_secret: claves.obtener('YOUTUBE_CLIENT_SECRET'), refresh_token: refresco, grant_type: 'refresh_token' }),
  });
  if (!r.ok || !r.datos?.access_token) {
    if (r.datos?.error === 'invalid_grant') throw new Error('Google ha caducado el permiso de YouTube: vuelve a pulsar «Conectar YouTube» (si tu app de Google está en modo "Prueba", el permiso dura solo 7 días)');
    throw new Error(`No se pudo renovar el permiso de YouTube: ${r.error}`);
  }
  return r.datos.access_token;
}

const PAGINA = (titulo, texto) => `<!doctype html><meta charset="utf-8"><title>Jarvis</title><body style="font-family:system-ui;background:#0b1220;color:#e6edf7;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1>${titulo}</h1><p>${texto}</p></div>`;

/**
 * Abre el navegador para que des permiso a Jarvis en tu canal y guarda el token.
 * @param {(url:string)=>any} abrirNavegador  p. ej. shell.openExternal
 */
async function conectar(abrirNavegador, { segundos = 300 } = {}) {
  const id = claves.obtener('YOUTUBE_CLIENT_ID');
  const secreto = claves.obtener('YOUTUBE_CLIENT_SECRET');
  if (!id || !secreto) return { ok: false, error: 'Faltan el ID y el secreto de cliente de Google (Ajustes → Claves → YouTube)' };

  const verificador = crypto.randomBytes(48).toString('base64url');
  const reto = crypto.createHash('sha256').update(verificador).digest('base64url');
  const estado = crypto.randomBytes(16).toString('hex');

  const servidor = http.createServer();
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${servidor.address().port}`;

  let fin = null;
  const codigo = new Promise((resolver) => {
    fin = setTimeout(() => resolver({ error: 'Se acabó el tiempo para dar permiso en el navegador' }), segundos * 1000);
    servidor.on('request', (req, res) => {
      const q = new URL(req.url, redirect).searchParams;
      if (!q.has('code') && !q.has('error')) { res.writeHead(404); return res.end(); }
      const valido = q.get('state') === estado && q.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
      res.end(valido ? PAGINA('✔ YouTube conectado', 'Ya puedes cerrar esta pestaña y volver a Jarvis.') : PAGINA('✘ No se conectó', 'Vuelve a Jarvis e inténtalo otra vez.'));
      clearTimeout(fin);
      resolver(valido ? { code: q.get('code') } : { error: q.get('error') === 'access_denied' ? 'Has denegado el permiso' : `Google respondió: ${q.get('error') || 'estado no válido'}` });
    });
  });

  const url = `${AUTH()}?${formulario({
    client_id: id, redirect_uri: redirect, response_type: 'code', scope: ALCANCES.join(' '),
    access_type: 'offline', prompt: 'consent', code_challenge: reto, code_challenge_method: 'S256', state: estado,
  })}`;
  try {
    await abrirNavegador(url);
    const c = await codigo;
    if (c.error) return { ok: false, error: c.error };
    const r = await peticion(`${OAUTH()}/token`, {
      metodo: 'POST',
      cabeceras: { 'Content-Type': 'application/x-www-form-urlencoded' },
      cuerpo: formulario({ code: c.code, client_id: id, client_secret: secreto, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verificador }),
    });
    if (!r.ok || !r.datos?.refresh_token) return { ok: false, error: `Google no dio permiso permanente: ${r.error || 'sin refresh_token'}` };
    claves.guardar({ YOUTUBE_REFRESH_TOKEN: r.datos.refresh_token });
    const canal = await nombreCanal(r.datos.access_token);
    registro.anotar({ origen: 'youtube', accion: 'conectar canal', detalle: canal || '' });
    return { ok: true, canal };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    clearTimeout(fin);
    servidor.close();
  }
}

async function nombreCanal(token) {
  const r = await peticion(`${API()}/youtube/v3/channels?part=snippet&mine=true`, { cabeceras: { Authorization: `Bearer ${token}` } });
  return r.ok ? r.datos?.items?.[0]?.snippet?.title || null : null;
}

async function probarConexion() {
  const canal = await nombreCanal(await tokenAcceso());
  return canal ? `YouTube OK (canal ${canal})` : 'Conectado, pero esta cuenta no tiene canal de YouTube';
}

// ---------------------------------------------------------------------------
// Subida (protocolo "resumable" de la API de YouTube)
// ---------------------------------------------------------------------------
async function subirVideo(video, m) {
  const token = await tokenAcceso();
  const tamaño = fs.statSync(video).size;
  const tipo = TIPOS[path.extname(video).slice(1).toLowerCase()] || 'application/octet-stream';
  const inicio = await peticion(`${API()}/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status`, {
    metodo: 'POST',
    cabeceras: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(tamaño), 'X-Upload-Content-Type': tipo,
    },
    cuerpo: JSON.stringify({
      snippet: { title: m.titulo, description: m.descripcion, tags: m.etiquetas, categoryId: '22' },
      status: { privacyStatus: m.privacidad, selfDeclaredMadeForKids: false },
    }),
  });
  const destino = inicio.cabeceras?.location;
  if (!inicio.ok || !destino) throw new Error(`YouTube no aceptó la subida: ${inicio.error || 'sin dirección de subida'}`);
  // Hasta 2 h para vídeos grandes con conexiones lentas.
  const r = await peticion(destino, { metodo: 'PUT', cabeceras: { 'Content-Length': String(tamaño), 'Content-Type': tipo }, archivo: video, segundos: 7200 });
  if (!r.ok || !r.datos?.id) throw new Error(`Falló la subida del vídeo: ${r.error || 'YouTube no devolvió el id'}`);
  return { id: r.datos.id, url: `https://youtu.be/${r.datos.id}`, estado: r.datos.status?.privacyStatus || m.privacidad };
}

function moverASubidos(video) {
  const dir = carpeta('subidos');
  const marca = new Date().toISOString().slice(0, 10);
  for (const f of [video, ...compañeros(video)]) {
    let destino = path.join(dir, `${marca}_${path.basename(f)}`);
    if (fs.existsSync(destino)) destino = path.join(dir, `${marca}_${Date.now()}_${path.basename(f)}`);
    fs.renameSync(f, destino);
  }
}

function historial() {
  try { return JSON.parse(fs.readFileSync(historialRuta(), 'utf8')); } catch (_) { return []; }
}

const estaConectado = () => Boolean(claves.obtener('YOUTUBE_REFRESH_TOKEN'));

/**
 * Ejecuta la rutina: sube el siguiente vídeo de la cola.
 * Devuelve { ok, novedad, resumen, url? } como los monitores.
 */
async function ejecutar({ pensar, crear } = {}) {
  if (!estaConectado()) return { ok: false, error: 'YouTube no está conectado: pulsa «Conectar YouTube» en la pestaña Rutinas' };
  let lista = cola();
  // Cola vacía: si está activado (por defecto sí), Jarvis crea el vídeo del día.
  if (!lista.length && crear && claves.obtener('YOUTUBE_CREAR') !== 'no') {
    const c = await crear();
    if (!c.ok) return { ok: false, error: c.error };
    lista = cola();
  }
  if (!lista.length) {
    return { ok: true, novedad: true, resumen: `No hay vídeos en la cola de YouTube. Añade alguno en ${carpeta('pendientes')}` };
  }
  const video = lista[0];
  try {
    const m = await metadatos(video, pensar);
    const r = await subirVideo(video, m);
    moverASubidos(video);
    const h = historial();
    h.push({ fecha: new Date().toISOString(), archivo: path.basename(video), titulo: m.titulo, id: r.id, url: r.url, privacidad: r.estado, metadatos: m.origen });
    fs.writeFileSync(historialRuta(), JSON.stringify(h.slice(-500), null, 2));
    registro.anotar({ origen: 'youtube', accion: `subir vídeo «${m.titulo}»`, decision: 'hecho', detalle: r.url });
    const quedan = lista.length - 1;
    const aviso = r.estado === 'private' && m.privacidad !== 'private'
      ? ' Ojo: YouTube lo ha dejado PRIVADO (tu proyecto de Google aún no ha pasado la auditoría de la API).' : '';
    return { ok: true, novedad: true, url: r.url, resumen: `Subido «${m.titulo}» (${r.estado}): ${r.url}. Quedan ${quedan} en la cola.${aviso}` };
  } catch (e) {
    registro.anotar({ origen: 'youtube', accion: `subir ${path.basename(video)}`, decision: 'fallo', motivo: e.message });
    return { ok: false, error: e.message };
  }
}

function estado() {
  return {
    conectado: estaConectado(),
    configurado: Boolean(claves.obtener('YOUTUBE_CLIENT_ID') && claves.obtener('YOUTUBE_CLIENT_SECRET')),
    pendientes: cola().length,
    carpeta: carpeta('pendientes'),
    ultimos: historial().slice(-5).reverse(),
  };
}

module.exports = { cola, leerMetadatos, metadatos, limpiarEtiquetas, tituloDeNombre, conectar, probarConexion, subirVideo, ejecutar, estado, carpeta };
