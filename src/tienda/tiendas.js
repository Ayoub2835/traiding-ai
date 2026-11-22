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

function credenciales(id = actualId()) {
  if (id === 'principal') return { dominio: limpiarDominio(claves.obtener('SHOPIFY_TIENDA')), token: claves.obtener('SHOPIFY_TOKEN') };
  const t = lista().find((x) => x.id === id);
  return { dominio: t ? t.dominio : '', token: claves.obtener(`SHOPIFY_TOKEN_${String(id).toUpperCase()}`) };
}
const conectada = (id = actualId()) => { const c = credenciales(id); return Boolean(c.dominio && c.token); };

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
function agregar({ nombre, dominio, token, tipo = 'dropshipping' }) {
  const dom = limpiarDominio(dominio);
  if (!/^[a-z0-9-]+\.myshopify\.com$/.test(dom)) return { ok: false, error: 'La dirección debe ser del tipo mitienda.myshopify.com' };
  if (!TIPOS.includes(tipo)) return { ok: false, error: 'Tipo de tienda no válido' };
  const d = leer();
  const existente = d.lista.find((t) => t.dominio === dom);
  const id = existente ? existente.id : (d.lista.length || claves.obtener('SHOPIFY_TIENDA') ? dom.split('.')[0].replace(/[^a-z0-9]/g, '').slice(0, 20) || `t${Date.now()}` : 'principal');
  const t = { id, nombre: String(nombre || dom.split('.')[0]).slice(0, 40), dominio: dom, tipo };
  if (token) {
    if (id === 'principal') claves.guardar({ SHOPIFY_TIENDA: dom, SHOPIFY_TOKEN: String(token).trim() });
    else claves.guardar({ [`SHOPIFY_TOKEN_${id.toUpperCase()}`]: String(token).trim() });
  } else if (id === 'principal') claves.guardar({ SHOPIFY_TIENDA: dom });
  const nueva = existente ? d.lista.map((x) => (x.id === id ? t : x)) : [...d.lista, t];
  escribir({ ...d, lista: nueva, actual: d.lista.length ? d.actual : id });
  return { ok: true, tienda: t };
}

/** Quita la tienda de Jarvis (no toca nada en Shopify) y borra su token. */
function quitar(id) {
  const d = leer();
  if (!d.lista.some((t) => t.id === id)) return { ok: false, error: 'Esa tienda no existe' };
  if (id === 'principal') claves.guardar({ SHOPIFY_TIENDA: '', SHOPIFY_TOKEN: '' });
  else claves.guardar({ [`SHOPIFY_TOKEN_${id.toUpperCase()}`]: '' });
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

module.exports = { leer, lista, actual, actualId, credenciales, conectada, carpeta, elegir, agregar, quitar, conTienda, enTodas, TIPOS };
