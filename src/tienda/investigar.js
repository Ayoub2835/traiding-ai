// Busca productos para dropshipping en España y los puntúa con DATOS REALES:
//  - Ideas de búsqueda del cerebro (o tu nicho).
//  - Precio de coste y envío a España de CJ; cambio USD→EUR del BCE (frankfurter).
//  - Precio de venta sugerido (≈ x2,5 del coste total, terminado en ,95) y margen
//    tras comisiones de pago (~3 %) e IVA (21 % incluido en el precio).
//  - Demanda: cuántas tiendas lo tienen en CJ (algunas = demanda; demasiadas = saturado).
// Ningún programa puede garantizar que un producto venda: esto ordena candidatos.
'use strict';
const fs = require('fs');
const rutas = require('../nucleo/rutas');
const { pedir } = require('../nucleo/http');
const registro = require('../seguridad/registro');
const cj = require('./cj');

// Cada tienda tiene su propio estado (la principal, la carpeta de siempre).
const archivo = () => require('path').join(require('./tiendas').carpeta(), 'estado.json');
function leer() { try { return JSON.parse(fs.readFileSync(archivo(), 'utf8')); } catch (_) { return {}; } }
function escribir(d) { fs.writeFileSync(archivo(), JSON.stringify(d, null, 2)); return d; }

async function cambioUSD() {
  const r = await pedir('https://api.frankfurter.dev/v1/latest?base=USD&symbols=EUR', {}, 15).catch(() => null);
  const x = r && r.ok && r.datos?.rates?.EUR;
  return Number(x) > 0 ? Number(x) : 0.92;
}

const redondear95 = (x) => Math.max(9.95, Math.ceil(x) - 0.05);

/** Precio y margen (todo en euros, IVA del 21 % incluido en el precio de venta). */
function economia(costeEUR, envioEUR) {
  const total = costeEUR + envioEUR;
  const precio = redondear95(Math.max(total * 2.5, total + 15));
  const sinIva = precio / 1.21;
  const comision = precio * 0.03 + 0.25;
  const margen = sinIva - total - comision;
  return { precio, margen: +margen.toFixed(2), margenPct: Math.round((margen / sinIva) * 100) };
}

/** Puntos 0-100: margen (50), demanda sin saturar (30), vídeo y stock (20). */
function puntuar({ margen, listados, video, stock }) {
  const pMargen = Math.max(0, Math.min(50, margen * 2.5));
  // La mejor zona de demanda: lo venden entre 30 y 500 tiendas.
  const pDemanda = listados <= 0 ? 0 : listados < 30 ? (listados / 30) * 20 : listados <= 500 ? 30 : Math.max(5, 30 - Math.log10(listados / 500) * 20);
  return Math.round(pMargen + pDemanda + (video ? 12 : 0) + (stock > 100 ? 8 : stock > 0 ? 4 : 0));
}

async function ideas(nicho, pensar) {
  const base = ['gadget cocina', 'organizador hogar', 'accesorio mascota', 'gadget coche', 'cuidado personal', 'fitness casa'];
  if (!pensar) return nicho ? [nicho] : base;
  const r = await Promise.resolve(pensar(
    'Eres experto en dropshipping para España. Propón 6 búsquedas cortas EN INGLÉS (2-3 palabras, como se buscarían en un catálogo de proveedor) de productos innovadores que resuelvan un problema, se entiendan en un vídeo de 15 s, cuesten menos de 15 $ y no sean marcas, réplicas, armas, medicamentos, cosméticos con promesas médicas ni electrónica con normativa complicada. '
    + 'Responde SOLO JSON: {"busquedas":["...","..."]}',
    nicho ? `Nicho preferido: ${nicho}` : 'Sin nicho: elige categorías variadas con demanda en España.',
    { preferir: 'claude' },
  )).catch(() => null);
  try { const b = JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]).busquedas; if (Array.isArray(b) && b.length) return b.slice(0, 6).map(String); } catch (_) { /* plantilla */ }
  return nicho ? [nicho] : base;
}

/**
 * Busca y devuelve las mejores propuestas (por defecto 5).
 * @param {{nicho?:string, pensar?:Function, n?:number, dep?:{cj?:object, cambio?:Function}}} o
 */
async function buscar({ nicho = '', pensar, n = 5, dep = {} } = {}) {
  const api = dep.cj || cj;
  const usdEur = await (dep.cambio || cambioUSD)();
  const busquedas = await ideas(String(nicho).slice(0, 80), pensar);
  const vistos = new Map();
  for (const q of busquedas) {
    let lista = [];
    try { lista = await api.buscar(q, { tamaño: 20 }); } catch (e) { if (!vistos.size && q === busquedas[busquedas.length - 1]) throw e; }
    for (const p of lista) if (!vistos.has(p.pid) && p.precioUSD <= 25) vistos.set(p.pid, { ...p, busqueda: q });
  }
  if (!vistos.size) return { ok: false, error: 'CJ no devolvió productos para esas búsquedas; prueba con otro nicho' };
  // Primera criba con envío estimado (aún sin calcular): se calcula solo para los mejores.
  const pre = [...vistos.values()].map((p) => ({ ...p, puntosPre: puntuar({ ...economia(p.precioUSD * usdEur, 4), listados: p.listados, video: p.video, stock: p.stock }) }))
    .sort((a, b) => b.puntosPre - a.puntosPre).slice(0, n * 2);
  const propuestas = [];
  for (const p of pre) {
    if (propuestas.length >= n) break;
    try {
      const d = await api.detalle(p.pid);
      const v = d.variantes[0];
      if (!v) continue;
      const e = await api.envio(v.vid, { destino: 'ES', origenes: v.paises });
      if (!e) continue; // no llega a España
      const costeEUR = +((v.precioUSD || p.precioUSD) * usdEur).toFixed(2);
      const envioEUR = +(e.usd * usdEur).toFixed(2);
      const ec = economia(costeEUR, envioEUR);
      propuestas.push({
        pid: p.pid, vid: v.vid, nombre: d.nombre || p.nombre, imagen: p.imagen, imagenes: d.imagenes, descripcionProveedor: d.descripcion,
        categoria: d.categoria || p.categoria, busqueda: p.busqueda, listados: p.listados, video: p.video,
        costeEUR, envioEUR, envioDias: e.dias, envioDesde: e.origen, envioMetodo: e.nombre,
        precioVenta: ec.precio, margenEUR: ec.margen, margenPct: ec.margenPct,
        puntos: puntuar({ margen: ec.margen, listados: p.listados, video: p.video, stock: p.stock }) + (e.origen !== 'CN' ? 6 : 0),
      });
    } catch (_) { /* producto sin ficha o sin envío: se salta */ }
  }
  if (!propuestas.length) return { ok: false, error: 'Ningún producto encontrado se puede enviar a España; prueba con otro nicho' };
  propuestas.sort((a, b) => b.puntos - a.puntos);
  // Opinión breve del cerebro (con los números reales).
  if (pensar) {
    const r = await Promise.resolve(pensar(
      'Eres experto en dropshipping en España. Para cada producto da en 1-2 frases por qué podría venderse y su mayor riesgo (saturación, devoluciones, envío lento, normativa). Sé honesto: si no lo ves, dilo. Responde SOLO JSON: {"analisis":["...", "..."]} en el mismo orden.',
      propuestas.map((p, i) => `${i + 1}. ${p.nombre} · coste ${p.costeEUR} € + envío ${p.envioEUR} € (${p.envioDias} días desde ${p.envioDesde}) · venta ${p.precioVenta} € · margen ${p.margenEUR} € · lo venden ${p.listados} tiendas`).join('\n'),
      { preferir: 'claude' },
    )).catch(() => null);
    try { JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]).analisis.forEach((a, i) => { if (propuestas[i]) propuestas[i].analisis = String(a).slice(0, 400); }); } catch (_) { /* sin análisis */ }
  }
  const estado = leer();
  escribir({ ...estado, propuestas, buscado: new Date().toISOString(), nicho, usdEur });
  registro.anotar({ origen: 'tienda', accion: `buscar productos${nicho ? ` (${nicho})` : ''}`, decision: 'hecho', detalle: propuestas.map((p) => p.nombre) });
  return { ok: true, propuestas };
}

function elegir(pid) {
  const estado = leer();
  const p = (estado.propuestas || []).find((x) => x.pid === String(pid));
  if (!p) return { ok: false, error: 'Ese producto ya no está en las propuestas' };
  escribir({ ...estado, elegido: p, shopify: null, anuncio: null, meta: null, variantes: null, ugc: null });
  return { ok: true, elegido: p };
}

module.exports = { buscar, elegir, leer, escribir, economia, puntuar };
