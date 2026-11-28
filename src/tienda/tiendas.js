// Varias tiendas de Shopify, con o sin dropshipping.
//  - tipo "dropshipping": productos de CJ y pedidos que se compran en CJ.
//  - tipo "stock": productos tuyos; los pedidos los envías tú y pones el seguimiento.
// La tienda "principal" usa las claves de siempre (SHOPIFY_TIENDA / SHOPIFY_TOKEN) y
// su carpeta de datos de siempre, para no perder nada. Las demás guardan su token
// en el .env como SHOPIFY_TOKEN_<ID> y sus datos en dropshipping/<id>/.
//
// "Tienda en uso": la que eliges en la pestaña TIENDA. Las rutinas recorren todas
// usando conTienda(id, fn), que fija la tienda solo dentro de esa tarea (también
// a través de los await), sin cambiar la que tienes elegida.
'use strict';
const fs = require('fs');
const { AsyncLocalStorage } = require('async_hooks');
const rutas = require('../nucleo/rutas');
const claves = require('../nucleo/claves');

const contexto = new AsyncLocalStorage();
const archivo = () => rutas.datos('tiendas.json');
const TIPOS = ['dropshipping', 'stock'];
const limpiarDominio = (d) => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

function leer() {
  let d = null;
  try { d = JSON.parse(fs.readFileSync(archivo(), 'utf8')); } catch (_) { d = null; }
  if (!d || !Array.isArray(d.lista)) d = { actual: 'principal', lista: [] };
  // Migración: la tienda de siempre pasa a ser la "principal".
  if (!d.lista.some((t) => t.id === 'principal') && claves.obtener('SHOPIFY_TIENDA')) {
    d.lista.unshift({ id: 'principal', nombre: 'Principal', dominio: limpiarDominio(claves.obtener('SHOPIFY_TIENDA')), tipo: 'dropshipping' });
  }
  if (!d.lista.some((t) => t.id === d.actual)) d.actual = d.lista[0]?.id || 'principal';
  return d;
}
function escribir(d) { fs.writeFileSync(archivo(), JSON.stringify(d, null, 2)); return d; }

const lista = () => leer().lista;
const actualId = () => contexto.getStore() || leer().actual;
const actual = () => lista().find((t) => t.id === actualId()) || null;

// Nombres en el .env. Dos formas de conectar una tienda:
//  - token fijo (apps antiguas de «Desarrollar apps»): SHOPIFY_TOKEN
//  - ID y clave secreta de una app del Dev Dashboard (dev.shopify.com): Jarvis
//    pide con ellos un token que dura 24 h y lo renueva solo (client credentials).
function nombres(id) {
  const s = id === 'principal' ? '' : `_${String(id).toUpperCase()}`;
  return { token: `SHOPIFY_TOKEN${s}`, clientId: `SHOPIFY_CLIENT_ID${s}`, secreto: `SHOPIFY_CLIENT_SECRET${s}` };
}
function credenciales(id = actualId()) {
  const n = nombres(id);
  const t = lista().find((x) => x.id === id);
  const dominio = id === 'principal' ? limpiarDominio(claves.obtener('SHOPIFY_TIENDA')) : (t ? t.dominio : '');
  return { dominio, token: claves.obtener(n.token), clientId: claves.obtener(n.clientId), secreto: claves.obtener(n.secreto) };
}
const conectada = (id = actualId()) => { const c = credenciales(id); return Boolean(c.dominio && (c.token || (c.clientId && c.secreto))); };

// Tokens de 24 h, solo en memoria (nunca en disco).
const cache = new Map();
/** Token para la Admin API de la tienda (fijo, o pedido con ID y clave secreta). */
async function acceso(id = actualId(), { dep = {} } = {}) {
  const c = credenciales(id);
  if (!c.dominio) throw new Error('Falta la dirección de esta tienda');
  if (c.token) return c.token;
  if (!c.clientId || !c.secreto) throw new Error('Falta conectar esta tienda de Shopify (TIENDA → ＋ Añadir tienda)');
  const guardado = cache.get(id);
  if (guardado && guardado.clientId === c.clientId && guardado.caduca - Date.now() > 10 * 60000) return guardado.token;
  const base = process.env.JARVIS_SHOPIFY_BASE || `https://${c.dominio}`;
  const r = await (dep.pedir || require('../nucleo/http').pedir)(`${base}/admin/oauth/access_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.secreto }).toString(),
  }, 30);
  const token = r.ok && r.datos?.access_token;
  if (!token) {
    const e = JSON.stringify(r.datos || r.error || '');
    if (/shop_not_permitted/.test(e)) throw new Error('Shopify no deja usar esa app en esta tienda: la app y la tienda tienen que estar en la misma organización de dev.shopify.com, y la app instalada en la tienda.');
    if (/invalid_client|unauthorized|401/i.test(e)) throw new Error('Shopify no acepta el ID o la clave secreta de la app: cópialos otra vez de dev.shopify.com → tu app → Configuración.');
    throw new Error(`Shopify no dio acceso: ${r.datos?.error_description || r.datos?.error || r.error || 'error'}`);
  }
  cache.set(id, { token, clientId: c.clientId, caduca: Date.now() + (Number(r.datos.expires_in) || 86399) * 1000 });
  return token;
}

/** Carpeta de datos de la tienda (la principal mantiene la de siempre). */
function carpeta(id = actualId()) {
  return rutas.asegurar(id === 'principal' ? rutas.datos('dropshipping') : rutas.datos('dropshipping', id));
}

function elegir(id) {
  const d = leer();
  if (!d.lista.some((t) => t.id === id)) return { ok: false, error: 'Esa tienda no existe' };
  escribir({ ...d, actual: id });
  return { ok: true };
}

/** Añade (o actualiza) una tienda. El token va al .env, nunca al JSON. */
function agregar({ nombre, dominio, token, clientId, secreto, tipo = 'dropshipping' }) {
  const dom = limpiarDominio(dominio);
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(dom)) return { ok: false, error: 'La dirección debe ser del tipo mitienda.myshopify.com' };
  if (!TIPOS.includes(tipo)) return { ok: false, error: 'Tipo de tienda no válido' };
  const d = leer();
  const existente = d.lista.find((t) => t.dominio === dom);
  const id = existente ? existente.id : (d.lista.length || claves.obtener('SHOPIFY_TIENDA') ? dom.split('.')[0].replace(/[^a-z0-9]/g, '').slice(0, 20) || `t${Date.now()}` : 'principal');
  const t = { id, nombre: String(nombre || dom.split('.')[0]).slice(0, 40), dominio: dom, tipo };
  const n = nombres(id);
  const cambios = {};
  if (id === 'principal') cambios.SHOPIFY_TIENDA = dom;
  if (token) cambios[n.token] = String(token).trim();
  if (clientId && secreto) { cambios[n.clientId] = String(clientId).trim(); cambios[n.secreto] = String(secreto).trim(); }
  if (Object.keys(cambios).length) claves.guardar(cambios);
  cache.delete(id);
  const nueva = existente ? d.lista.map((x) => (x.id === id ? t : x)) : [...d.lista, t];
  escribir({ ...d, lista: nueva, actual: d.lista.length ? d.actual : id });
  return { ok: true, tienda: t };
}

/** Quita la tienda de Jarvis (no toca nada en Shopify) y borra su token. */
function quitar(id) {
  const d = leer();
  if (!d.lista.some((t) => t.id === id)) return { ok: false, error: 'Esa tienda no existe' };
  const n = nombres(id);
  claves.guardar({ ...(id === 'principal' ? { SHOPIFY_TIENDA: '' } : {}), [n.token]: '', [n.clientId]: '', [n.secreto]: '' });
  cache.delete(id);
  const restantes = d.lista.filter((t) => t.id !== id);
  escribir({ actual: d.actual === id ? (restantes[0]?.id || 'principal') : d.actual, lista: restantes });
  return { ok: true };
}

/** Ejecuta fn con `id` como tienda en uso (solo dentro de esa tarea). */
const conTienda = (id, fn) => contexto.run(id, fn);

/** Ejecuta fn en cada tienda conectada y junta los resultados. */
async function enTodas(fn) {
  const res = [];
  for (const t of lista().filter((x) => conectada(x.id))) res.push({ tienda: t, r: await conTienda(t.id, fn) });
  return res;
}

module.exports = { leer, lista, actual, actualId, credenciales, conectada, acceso, nombres, carpeta, elegir, agregar, quitar, conTienda, enTodas, TIPOS };
