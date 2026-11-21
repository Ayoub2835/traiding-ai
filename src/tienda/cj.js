// CJ Dropshipping (API v2): buscar productos, ver su ficha y calcular el envío.
//  - Clave: CJ_API_KEY (cjdropshipping.com → Mi cuenta → Autorización → API).
//  - El token dura 180 días y CJ pide no pedirlo en cada llamada: se guarda en
//    CJ_ACCESS_TOKEN / CJ_TOKEN_CADUCA y se reutiliza.
//  - CJ limita a ~1 petición por segundo: se espera entre llamadas.
'use strict';
const claves = require('../nucleo/claves');
const { pedir } = require('../nucleo/http');

const BASE = () => process.env.JARVIS_CJ_BASE || 'https://developers.cjdropshipping.com/api2.0/v1';
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let ultima = 0;
async function turno() {
  const espera = Number(process.env.JARVIS_CJ_PAUSA_MS ?? 1100) - (Date.now() - ultima);
  if (espera > 0) await esperar(espera);
  ultima = Date.now();
}

async function token() {
  const guardado = claves.obtener('CJ_ACCESS_TOKEN');
  const caduca = Date.parse(claves.obtener('CJ_TOKEN_CADUCA') || '');
  if (guardado && caduca && caduca - Date.now() > 86400000) return guardado;
  const apiKey = claves.obtener('CJ_API_KEY');
  if (!apiKey) throw new Error('Falta la clave de CJ Dropshipping (Ajustes → Claves → Tienda → CJ_API_KEY)');
  await turno();
  const r = await pedir(`${BASE()}/authentication/getAccessToken`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey }) }, 30);
  const d = r.datos?.data;
  if (!r.ok || !d?.accessToken) throw new Error(`CJ no aceptó la clave: ${r.datos?.message || r.error || 'sin token'}`);
  claves.guardar({ CJ_ACCESS_TOKEN: d.accessToken, CJ_TOKEN_CADUCA: new Date(d.accessTokenExpiryDate || Date.now() + 170 * 86400000).toISOString() });
  return d.accessToken;
}

async function llamar(ruta, { metodo = 'GET', cuerpo } = {}) {
  const t = await token();
  await turno();
  const r = await pedir(`${BASE()}${ruta}`, {
    method: metodo,
    headers: { 'CJ-Access-Token': t, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
    ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
  }, 40);
  if (!r.ok || (r.datos && r.datos.result === false)) {
    const msg = r.datos?.message || r.error || 'error desconocido';
    if (/1600001|authentication/i.test(JSON.stringify(r.datos || ''))) claves.guardar({ CJ_ACCESS_TOKEN: '' });
    throw new Error(`CJ: ${msg}`);
  }
  return r.datos?.data;
}

/** Busca productos (V2). Devuelve [{pid, nombre, imagen, precioUSD, listados, categoria, video, stock}]. */
async function buscar(palabra, { tamaño = 20 } = {}) {
  const q = new URLSearchParams({ keyWord: palabra, page: '1', size: String(tamaño), orderBy: '1', sort: 'desc' });
  const d = await llamar(`/product/listV2?${q}`);
  const lista = (d?.content || []).flatMap((c) => c.productList || []);
  return lista.map((p) => ({
    pid: String(p.id), nombre: p.nameEn, imagen: p.bigImage, precioUSD: parseFloat(p.nowPrice || p.sellPrice) || 0,
    listados: Number(p.listedNum) || 0, categoria: p.threeCategoryName || p.twoCategoryName || '', video: Boolean(p.isVideo),
    stock: Number(p.warehouseInventoryNum) || 0,
  })).filter((p) => p.pid && p.nombre && p.precioUSD > 0);
}

/** Ficha completa: imágenes, descripción y variantes (con stock por país). */
async function detalle(pid) {
  const d = await llamar(`/product/query?pid=${encodeURIComponent(pid)}`);
  if (!d) throw new Error('CJ no devolvió la ficha del producto');
  return {
    pid: d.pid, nombre: d.productNameEn, imagenes: (Array.isArray(d.productImageSet) ? d.productImageSet : [d.bigImage]).filter(Boolean).slice(0, 8),
    descripcion: String(d.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 3000),
    pesoG: Number(d.productWeight) || 0, categoria: d.categoryName || '',
    variantes: (d.variants || []).map((v) => ({
      vid: v.vid, nombre: v.variantNameEn, precioUSD: Number(v.variantSellPrice) || 0,
      paises: (v.inventories || []).filter((i) => Number(i.totalInventory) > 0).map((i) => i.countryCode),
    })),
  };
}

/** Envío más barato a `destino` (España por defecto) para una variante. */
async function envio(vid, { destino = 'ES', origenes = [] } = {}) {
  // Mejor un almacén europeo (llega antes) si la variante tiene stock allí.
  const europa = ['ES', 'DE', 'FR', 'IT', 'NL', 'PL', 'CZ', 'GB'];
  const origen = origenes.find((p) => p === destino) || origenes.find((p) => europa.includes(p)) || 'CN';
  const d = await llamar('/logistic/freightCalculate', { metodo: 'POST', cuerpo: { startCountryCode: origen, endCountryCode: destino, products: [{ quantity: 1, vid }] } });
  const opciones = (Array.isArray(d) ? d : []).map((o) => ({ nombre: o.logisticName, dias: o.logisticAging, usd: Number(o.totalPostageFee ?? o.logisticPrice) })).filter((o) => o.usd >= 0 && Number.isFinite(o.usd));
  if (!opciones.length) return null;
  opciones.sort((a, b) => a.usd - b.usd);
  return { ...opciones[0], origen };
}

async function probar() {
  await token();
  return 'CJ Dropshipping OK';
}

module.exports = { buscar, detalle, envio, probar, token };
