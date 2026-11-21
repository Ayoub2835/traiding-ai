// Facebook (Reels de tu Página) e Instagram (Reels de tu cuenta profesional
// vinculada a esa Página) con la Graph API de Meta.
//
// Conexión (una vez): en developers.facebook.com creas una app, y con el
// Explorador de la Graph API sacas un token de usuario con los permisos
// pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic,
// instagram_content_publish y business_management. Lo pegas en Jarvis junto al
// ID y la clave secreta de la app y pulsas «Conectar Facebook e Instagram»:
// Jarvis lo cambia por un token de larga duración y guarda el token de tu
// Página, que NO caduca.
'use strict';
const fs = require('fs');
const claves = require('../nucleo/claves');
const registro = require('../seguridad/registro');
const { peticion, formulario } = require('../nucleo/peticion');

const VERSION = 'v27.0';
const GRAPH = () => `${process.env.JARVIS_GRAPH_BASE || 'https://graph.facebook.com'}/${VERSION}`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const estado = () => ({
  facebook: Boolean(claves.obtener('META_PAGE_TOKEN') && claves.obtener('META_PAGE_ID')),
  instagram: Boolean(claves.obtener('META_PAGE_TOKEN') && claves.obtener('META_IG_ID')),
  pagina: claves.obtener('META_PAGINA') || null,
});

/** Cambia el token de usuario por el token (permanente) de la Página y guarda las IDs. */
async function conectar() {
  const appId = claves.obtener('META_APP_ID');
  const secreto = claves.obtener('META_APP_SECRET');
  const corto = claves.obtener('META_USER_TOKEN');
  if (!appId || !secreto || !corto) return { ok: false, error: 'Faltan el ID de la app, su clave secreta o el token de usuario de Meta (Ajustes → Claves → Redes sociales)' };
  const largo = await peticion(`${GRAPH()}/oauth/access_token?${formulario({ grant_type: 'fb_exchange_token', client_id: appId, client_secret: secreto, fb_exchange_token: corto })}`);
  if (!largo.ok || !largo.datos?.access_token) return { ok: false, error: `Meta no aceptó el token: ${largo.error || 'sin access_token'}` };
  const paginas = await peticion(`${GRAPH()}/me/accounts?${formulario({ fields: 'id,name,access_token,instagram_business_account{id,username}', access_token: largo.datos.access_token })}`);
  const lista = paginas.datos?.data || [];
  if (!paginas.ok || !lista.length) return { ok: false, error: `No encuentro ninguna Página de Facebook tuya: ${paginas.error || 'el token no tiene el permiso pages_show_list o no administras ninguna Página'}` };
  const buscada = (claves.obtener('META_PAGINA') || '').toLowerCase();
  const p = lista.find((x) => buscada && x.name.toLowerCase() === buscada) || lista[0];
  const ig = p.instagram_business_account || null;
  // META_ADS_TOKEN: token de usuario de larga duración (~60 días) para crear
  // campañas (necesita el permiso ads_management). El de la Página no sirve para anuncios.
  claves.guardar({ META_PAGE_TOKEN: p.access_token, META_PAGE_ID: p.id, META_IG_ID: ig ? ig.id : '', META_PAGINA: p.name, META_USER_TOKEN: '', META_ADS_TOKEN: largo.datos.access_token });
  registro.anotar({ origen: 'redes', accion: 'conectar Facebook/Instagram', detalle: { pagina: p.name, instagram: ig?.username || null } });
  return { ok: true, pagina: p.name, instagram: ig?.username || null, otras: lista.length - 1 };
}

const token = () => {
  const t = claves.obtener('META_PAGE_TOKEN');
  if (!t) throw new Error('Facebook/Instagram no están conectados');
  return t;
};

/** Reel de Instagram: contenedor → subida a rupload → esperar → publicar. */
async function publicarInstagram(archivo, texto, { esperaMs = 10000, intentos = 60 } = {}) {
  const ig = claves.obtener('META_IG_ID');
  if (!ig) throw new Error('No hay cuenta de Instagram profesional vinculada a tu Página de Facebook');
  const t = token();
  const c = await peticion(`${GRAPH()}/${ig}/media?${formulario({ media_type: 'REELS', upload_type: 'resumable', caption: texto.slice(0, 2200), share_to_feed: 'true', access_token: t })}`, { metodo: 'POST' });
  if (!c.ok || !c.datos?.id || !c.datos?.uri) throw new Error(`Instagram no creó el reel: ${c.error || 'respuesta incompleta'}`);
  const tamaño = fs.statSync(archivo).size;
  const s = await peticion(c.datos.uri, { metodo: 'POST', cabeceras: { Authorization: `OAuth ${t}`, offset: '0', file_size: String(tamaño), 'Content-Type': 'application/octet-stream', 'Content-Length': String(tamaño) }, archivo, segundos: 3600 });
  if (!s.ok) throw new Error(`Falló la subida a Instagram: ${s.error}`);
  for (let i = 0; i < intentos; i++) {
    const e = await peticion(`${GRAPH()}/${c.datos.id}?${formulario({ fields: 'status_code,status', access_token: t })}`);
    const codigo = e.datos?.status_code;
    if (codigo === 'FINISHED') break;
    if (codigo === 'ERROR' || codigo === 'EXPIRED') throw new Error(`Instagram rechazó el vídeo: ${e.datos?.status || codigo}`);
    if (i === intentos - 1) throw new Error('Instagram tarda demasiado en procesar el vídeo');
    await esperar(esperaMs);
  }
  const p = await peticion(`${GRAPH()}/${ig}/media_publish?${formulario({ creation_id: c.datos.id, access_token: t })}`, { metodo: 'POST' });
  if (!p.ok || !p.datos?.id) throw new Error(`Instagram no publicó el reel: ${p.error}`);
  const l = await peticion(`${GRAPH()}/${p.datos.id}?${formulario({ fields: 'permalink', access_token: t })}`);
  return { id: p.datos.id, url: l.datos?.permalink || null };
}

/** Reel de la Página de Facebook: start → subida a rupload → finish (publicado). */
async function publicarFacebook(archivo, { titulo, texto }) {
  const pagina = claves.obtener('META_PAGE_ID');
  const t = token();
  const ini = await peticion(`${GRAPH()}/${pagina}/video_reels`, { metodo: 'POST', cabeceras: { 'Content-Type': 'application/json' }, cuerpo: JSON.stringify({ upload_phase: 'start', access_token: t }) });
  if (!ini.ok || !ini.datos?.video_id || !ini.datos?.upload_url) throw new Error(`Facebook no inició el reel: ${ini.error || 'respuesta incompleta'}`);
  const tamaño = fs.statSync(archivo).size;
  const s = await peticion(ini.datos.upload_url, { metodo: 'POST', cabeceras: { Authorization: `OAuth ${t}`, offset: '0', file_size: String(tamaño), 'Content-Type': 'application/octet-stream', 'Content-Length': String(tamaño) }, archivo, segundos: 3600 });
  if (!s.ok) throw new Error(`Falló la subida a Facebook: ${s.error}`);
  const fin = await peticion(`${GRAPH()}/${pagina}/video_reels?${formulario({ access_token: t, video_id: ini.datos.video_id, upload_phase: 'finish', video_state: 'PUBLISHED', title: titulo.slice(0, 250), description: texto.slice(0, 5000) })}`, { metodo: 'POST' });
  if (!fin.ok || fin.datos?.success === false) throw new Error(`Facebook no publicó el reel: ${fin.error || 'success=false'}`);
  return { id: ini.datos.video_id, url: `https://www.facebook.com/reel/${ini.datos.video_id}` };
}

async function probar() {
  const r = await peticion(`${GRAPH()}/me?${formulario({ fields: 'id,name', access_token: token() })}`);
  return r.ok ? `Meta OK (Página ${r.datos?.name})${claves.obtener('META_IG_ID') ? ' con Instagram' : ', sin Instagram vinculado'}` : r.error;
}

module.exports = { conectar, estado, publicarInstagram, publicarFacebook, probar, VERSION };
