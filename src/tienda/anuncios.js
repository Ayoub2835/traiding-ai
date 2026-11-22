// Anuncios del producto elegido:
//  1. crearAnuncio: vídeo VERTICAL (1080x1920, ~20 s) con las fotos del producto,
//     textos en pantalla, voz y precio, + 3 textos de anuncio y un titular.
//     Queda en Documentos de Jarvis (dropshipping/<producto>) listo también para
//     subirlo a TikTok Ads Manager.
//  2. crearCampanaMeta: sube el vídeo a tu cuenta publicitaria de Meta y crea
//     campaña + conjunto + anuncio, TODO EN PAUSA (no gasta nada).
//  3. activarMeta / pausarMeta: solo cuando tú lo pides.
'use strict';
const fs = require('fs');
const path = require('path');
const rutas = require('../nucleo/rutas');
const claves = require('../nucleo/claves');
const { pedir } = require('../nucleo/http');
const { peticion, formulario } = require('../nucleo/peticion');
const registro = require('../seguridad/registro');
const investigar = require('./investigar');

const V = 1080;
const VH = 1920;
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const F = 'Segoe UI, Arial, Helvetica, DejaVu Sans, sans-serif';
const slug = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'producto';
const euros = (x) => `${Number(x).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
function partir(t, max) { const o = []; let a = ''; for (const p of String(t).split(/\s+/).filter(Boolean)) { if ((a + ' ' + p).trim().length > max && a) { o.push(a); a = p; } else a = `${a} ${p}`.trim(); } if (a) o.push(a); return o; }

/** Descarga una foto y la deja lista para meterla en el SVG (JPEG en base64). */
async function fotoDataUri(url) {
  const sharp = require('sharp');
  const r = await pedir(url, { binario: true }, 30);
  if (!r.ok || !r.buffer?.length) throw new Error(`No se pudo descargar la foto ${url}`);
  const jpg = await sharp(r.buffer).resize(1000, 1000, { fit: 'inside', withoutEnlargement: false }).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${jpg.toString('base64')}`;
}

function svgEscena({ foto, texto, abajo, destacado }) {
  const lineas = partir(texto, 20).slice(0, 3);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${V}" height="${VH}">
<defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#101828"/><stop offset="1" stop-color="#1d2939"/></linearGradient></defs>
<rect width="${V}" height="${VH}" fill="url(#f)"/>
${foto ? `<rect x="40" y="430" width="1000" height="1000" rx="36" fill="#ffffff"/><image x="40" y="430" width="1000" height="1000" preserveAspectRatio="xMidYMid meet" href="${foto}" xlink:href="${foto}"/>` : ''}
<rect x="40" y="90" width="1000" height="${lineas.length * 100 + 80}" rx="32" fill="${destacado ? '#f97316' : '#000000'}" fill-opacity="${destacado ? 1 : 0.6}"/>
${lineas.map((l, i) => `<text x="540" y="${190 + i * 100}" text-anchor="middle" font-family="${F}" font-size="84" font-weight="800" fill="#ffffff">${esc(l)}</text>`).join('')}
${abajo ? `<rect x="140" y="1560" width="800" height="150" rx="75" fill="#22c55e"/><text x="540" y="1658" text-anchor="middle" font-family="${F}" font-size="64" font-weight="800" fill="#ffffff">${esc(abajo)}</text>` : ''}
</svg>`;
}

async function guionAnuncio(p, titulo, pensar) {
  const base = {
    gancho: '¿Conoces esto?',
    escenas: [{ pantalla: titulo.slice(0, 40), narracion: `Mira esto: ${titulo}.` }, { pantalla: `Solo ${euros(p.precioVenta)}`, narracion: `Ahora por solo ${euros(p.precioVenta)}.` }],
    cta: 'Pídelo ya',
    textos: [`${titulo}. Envío a España en ${p.envioDias || '7-15'} días.`],
    titular: titulo.slice(0, 40),
  };
  if (!pensar) return base;
  const r = await Promise.resolve(pensar(
    'Eres creativo de anuncios de TikTok y Facebook para e-commerce en España. Escribe el guion de un vídeo vertical de 15-20 segundos y los textos del anuncio, en español. '
    + 'HONESTO: solo lo que dicen los datos; nada de promesas médicas, antes/después falsos, precios tachados, "gratis" si no lo es, ni urgencias falsas. '
    + 'Responde SOLO JSON: {"gancho":"máx. 6 palabras para los 2 primeros segundos","escenas":[{"pantalla":"máx. 35 caracteres","narracion":"1 frase"}] (3 escenas),"cta":"máx. 18 caracteres","textos":["3 textos de anuncio de máx. 125 caracteres"],"titular":"máx. 40 caracteres"}',
    `Producto: ${titulo}\nDatos del proveedor: ${String(p.descripcionProveedor || '').slice(0, 1500)}\nPrecio: ${euros(p.precioVenta)}\nEnvío a España: ${p.envioDias || '7-15'} días`,
    { preferir: 'claude' },
  )).catch(() => null);
  try {
    const g = JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]);
    const t = (x, m) => String(x || '').replace(/[<>]/g, '').trim().slice(0, m);
    const escenas = (Array.isArray(g.escenas) ? g.escenas : []).slice(0, 4).map((e) => ({ pantalla: t(e.pantalla, 40), narracion: t(e.narracion, 200) })).filter((e) => e.pantalla && e.narracion);
    if (!escenas.length) return base;
    return { gancho: t(g.gancho, 40) || base.gancho, escenas, cta: t(g.cta, 20) || base.cta, textos: (Array.isArray(g.textos) ? g.textos : base.textos).map((x) => t(x, 125)).filter(Boolean).slice(0, 3), titular: t(g.titular, 40) || base.titular };
  } catch (_) { return base; }
}

/** Crea el vídeo vertical del anuncio y sus textos. */
async function crearAnuncio({ pensar, dep = {} } = {}) {
  const estado = investigar.leer();
  const p = estado.elegido;
  if (!p) return { ok: false, error: 'Primero elige un producto' };
  const titulo = estado.shopify?.titulo || p.nombre;
  try {
    const g = await guionAnuncio(p, titulo, pensar);
    const fotos = [];
    for (const u of (p.imagenes || [p.imagen]).filter(Boolean).slice(0, 4)) {
      try { fotos.push(await (dep.foto || fotoDataUri)(u)); } catch (_) { /* foto rota: se salta */ }
    }
    if (!fotos.length) return { ok: false, error: 'No se pudo descargar ninguna foto del producto' };
    const foto = (i) => fotos[i % fotos.length];
    const lista = [
      { svg: svgEscena({ foto: foto(0), texto: g.gancho, destacado: true }), texto: g.gancho },
      ...g.escenas.map((e, i) => ({ svg: svgEscena({ foto: foto(i + 1), texto: e.pantalla }), texto: e.narracion })),
      { svg: svgEscena({ foto: foto(0), texto: titulo.slice(0, 40), abajo: `${g.cta} · ${euros(p.precioVenta)}` }), texto: `${g.cta}. Por ${euros(p.precioVenta)}.` },
    ];
    const carpeta = rutas.asegurar(path.join(require('./tiendas').carpeta(), slug(p.nombre)));
    const creador = require('../youtube/creador');
    const textos = { titular: g.titular, textos: g.textos, cta: g.cta, producto: titulo, precio: p.precioVenta };
    const video = await creador.montar({ lista, nombre: 'anuncio', carpeta, meta: textos, tam: { ancho: V, alto: VH }, dep });
    fs.writeFileSync(path.join(carpeta, 'textos.txt'), [`Titular: ${g.titular}`, '', 'Textos del anuncio:', ...g.textos.map((x, i) => `${i + 1}. ${x}`), '', `Llamada a la acción: ${g.cta}`, `Enlace: ${estado.shopify?.tiendaUrl || '(publica el producto en Shopify)'}`].join('\n'));
    const anuncio = { video, carpeta, ...textos, portada: (p.imagenes || [p.imagen])[0] };
    investigar.escribir({ ...investigar.leer(), anuncio });
    registro.anotar({ origen: 'tienda', accion: `crear anuncio de «${titulo}»`, decision: 'hecho', detalle: video });
    return { ok: true, ...anuncio };
  } catch (e) {
    return { ok: false, error: `No se pudo crear el anuncio: ${e.message}` };
  }
}

// ---------------------------------------------------------------------------
// Meta Ads (campañas en PAUSA)
// ---------------------------------------------------------------------------
const GRAPH = () => `${process.env.JARVIS_GRAPH_BASE || 'https://graph.facebook.com'}/${require('../redes/meta').VERSION}`;
const cuenta = () => {
  const c = String(claves.obtener('META_AD_ACCOUNT_ID') || '').replace(/^act_/, '').trim();
  if (!/^\d+$/.test(c)) throw new Error('Falta el ID de tu cuenta publicitaria de Meta (Ajustes → Claves → Tienda → META_AD_ACCOUNT_ID)');
  return c;
};
const tokenAds = () => {
  const t = claves.obtener('META_ADS_TOKEN');
  if (!t) throw new Error('Falta el permiso de anuncios de Meta: vuelve a conectar Facebook en REDES con el permiso ads_management');
  return t;
};
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function graphPost(ruta, campos) {
  const cuerpo = formulario(Object.fromEntries(Object.entries({ ...campos, access_token: tokenAds() }).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])));
  const r = await peticion(`${GRAPH()}/${ruta}`, { metodo: 'POST', cabeceras: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': String(Buffer.byteLength(cuerpo)) }, cuerpo });
  if (!r.ok || r.datos?.error) throw new Error(`Meta (${ruta.split('/').pop()}): ${r.datos?.error?.error_user_msg || r.datos?.error?.message || r.error}`);
  return r.datos;
}

/** Sube el vídeo a la cuenta publicitaria (multipart) y espera a que esté listo. */
async function subirVideo(archivo, { esperaMs = 5000, intentos = 60 } = {}) {
  const limite = `----Jarvis${Date.now().toString(16)}`;
  const partes = [
    Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="access_token"\r\n\r\n${tokenAds()}\r\n`),
    Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="name"\r\n\r\n${path.basename(archivo)}\r\n`),
    Buffer.from(`--${limite}\r\nContent-Disposition: form-data; name="source"; filename="${path.basename(archivo)}"\r\nContent-Type: video/mp4\r\n\r\n`),
    fs.readFileSync(archivo),
    Buffer.from(`\r\n--${limite}--\r\n`),
  ];
  const cuerpo = Buffer.concat(partes);
  const r = await peticion(`${GRAPH()}/act_${cuenta()}/advideos`, { metodo: 'POST', cabeceras: { 'Content-Type': `multipart/form-data; boundary=${limite}`, 'Content-Length': String(cuerpo.length) }, cuerpo, segundos: 900 });
  const id = r.datos?.id || r.datos?.video_id;
  if (!r.ok || !id) throw new Error(`Meta no aceptó el vídeo: ${r.datos?.error?.message || r.error}`);
  for (let i = 0; i < intentos; i++) {
    const e = await peticion(`${GRAPH()}/${id}?${formulario({ fields: 'status', access_token: tokenAds() })}`);
    const st = e.datos?.status?.video_status;
    if (st === 'ready') return id;
    if (st === 'error') throw new Error('Meta no pudo procesar el vídeo');
    await esperar(esperaMs);
  }
  throw new Error('Meta tarda demasiado en procesar el vídeo; inténtalo en unos minutos');
}

/** Crea campaña + conjunto + anuncio en PAUSA. Presupuesto diario en euros. */
async function crearCampanaMeta({ presupuestoDiario = 10, edadMin = 18, edadMax = 65, dep = {} } = {}) {
  const estado = investigar.leer();
  if (!estado.anuncio?.video || !fs.existsSync(estado.anuncio.video)) return { ok: false, error: 'Primero crea el anuncio (vídeo)' };
  const presupuesto = Math.round(Number(presupuestoDiario) * 100) / 100;
  if (!(presupuesto >= 1 && presupuesto <= 1000)) return { ok: false, error: 'El presupuesto diario debe estar entre 1 € y 1000 €' };
  const pagina = claves.obtener('META_PAGE_ID');
  if (!pagina) return { ok: false, error: 'Conecta antes Facebook en la pestaña REDES (hace falta tu Página)' };
  const creados = {};
  try {
    const prod = await (dep.estadoProducto || require('./shopify').estadoProducto)();
    if (!prod.ok) return prod;
    if (!prod.publicado) return { ok: false, error: 'El producto aún está en borrador: revísalo y publícalo en Shopify antes de crear la campaña' };
    const nombre = `Jarvis · ${estado.anuncio.producto}`.slice(0, 200);
    creados.campana = (await graphPost(`act_${cuenta()}/campaigns`, { name: nombre, objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: [], buying_type: 'AUCTION', is_adset_budget_sharing_enabled: false })).id;
    creados.conjunto = (await graphPost(`act_${cuenta()}/adsets`, {
      name: `${nombre} · España`, campaign_id: creados.campana, daily_budget: Math.round(presupuesto * 100), billing_event: 'IMPRESSIONS', optimization_goal: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting: { geo_locations: { countries: ['ES'] }, age_min: Number(edadMin) || 18, age_max: Number(edadMax) || 65 },
      status: 'PAUSED', start_time: new Date(Date.now() + 15 * 60000).toISOString(),
    })).id;
    creados.video = await (dep.subirVideo || subirVideo)(estado.anuncio.video);
    creados.creatividad = (await graphPost(`act_${cuenta()}/adcreatives`, {
      name: nombre,
      object_story_spec: { page_id: pagina, video_data: { video_id: creados.video, image_url: estado.anuncio.portada, message: estado.anuncio.textos[0] || estado.anuncio.producto, title: estado.anuncio.titular, call_to_action: { type: 'SHOP_NOW', value: { link: prod.url } } } },
    })).id;
    creados.anuncio = (await graphPost(`act_${cuenta()}/ads`, { name: nombre, adset_id: creados.conjunto, creative: { creative_id: creados.creatividad }, status: 'PAUSED' })).id;
    const meta = { ...creados, presupuesto, estado: 'PAUSED', url: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${cuenta()}&selected_campaign_ids=${creados.campana}` };
    investigar.escribir({ ...investigar.leer(), meta });
    registro.anotar({ origen: 'tienda', accion: `crear campaña de Meta EN PAUSA (${presupuesto} €/día)`, decision: 'hecho', detalle: meta });
    return { ok: true, ...meta };
  } catch (e) {
    registro.anotar({ origen: 'tienda', accion: 'crear campaña de Meta', decision: 'fallo', motivo: e.message, detalle: creados });
    return { ok: false, error: `${e.message}${creados.campana ? ' (lo creado hasta ahora está en pausa y no gasta nada)' : ''}` };
  }
}

/** Activa o pausa la campaña (los tres niveles). Activar gasta dinero: solo tras tu confirmación. */
async function cambiarMeta(activo) {
  const m = investigar.leer().meta;
  if (!m?.campana) return { ok: false, error: 'No hay ninguna campaña de Meta creada' };
  try {
    const status = activo ? 'ACTIVE' : 'PAUSED';
    for (const id of activo ? [m.anuncio, m.conjunto, m.campana] : [m.campana, m.conjunto, m.anuncio]) await graphPost(id, { status });
    investigar.escribir({ ...investigar.leer(), meta: { ...m, estado: status } });
    registro.anotar({ origen: 'tienda', accion: `${activo ? 'ACTIVAR' : 'pausar'} campaña de Meta (${m.presupuesto} €/día)`, decision: 'hecho' });
    return { ok: true, estado: status };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { crearAnuncio, crearCampanaMeta, activarMeta: () => cambiarMeta(true), pausarMeta: () => cambiarMeta(false), svgEscena, guionAnuncio };
