// Control de ventas y anuncios: cada noche (rutina «Ventas y anuncios») calcula
// con datos reales de Shopify y Meta las ventas, el gasto en anuncios y el
// BENEFICIO de hoy y de los últimos 7 días, y te lo manda al móvil.
// Si la campaña gasta y no vende, propone pausarla. Solo la pausa sola si has
// puesto TIENDA_AUTOPAUSA=si (pausar no gasta dinero; activar, nunca solo).
'use strict';
const claves = require('../nucleo/claves');
const registro = require('../seguridad/registro');
const { peticion, formulario } = require('../nucleo/peticion');
const investigar = require('./investigar');

const eur = (x) => `${Number(x || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dia = (d) => new Date(d).toISOString().slice(0, 10);

/** Ventas pagadas de Shopify desde `desde` (fecha YYYY-MM-DD). */
async function ventasShopify(desde, { graphql } = {}) {
  const g = graphql || require('./shopify').graphql;
  const d = await g(`query($q: String!) { orders(first: 250, query: $q) { nodes { id createdAt totalPriceSet { shopMoney { amount } } lineItems(first: 20) { nodes { quantity product { id } } } } } }`, { q: `created_at:>=${desde} financial_status:paid` });
  return d.orders?.nodes || [];
}

/** Gasto y clics de la campaña de Jarvis (o de toda la cuenta) en Meta. */
async function gastoMeta(preset) {
  const token = claves.obtener('META_ADS_TOKEN');
  const cuenta = String(claves.obtener('META_AD_ACCOUNT_ID') || '').replace(/^act_/, '');
  if (!token || !cuenta) return null;
  const base = `${process.env.JARVIS_GRAPH_BASE || 'https://graph.facebook.com'}/${require('../redes/meta').VERSION}`;
  const r = await peticion(`${base}/act_${cuenta}/insights?${formulario({ fields: 'spend,clicks,impressions,ctr,cpc', date_preset: preset, access_token: token })}`);
  if (!r.ok) throw new Error(`Meta (estadísticas): ${r.datos?.error?.message || r.error}`);
  const x = (r.datos?.data || [])[0] || {};
  return { gasto: Number(x.spend) || 0, clics: Number(x.clicks) || 0, impresiones: Number(x.impressions) || 0, ctr: Number(x.ctr) || 0, cpc: Number(x.cpc) || 0 };
}

/** Beneficio: ventas sin IVA − coste de producto y envío − comisiones de pago − anuncios. */
function cuentas(pedidos, productos, gasto) {
  let ventas = 0;
  let coste = 0;
  for (const o of pedidos) {
    const total = Number(o.totalPriceSet?.shopMoney?.amount) || 0;
    ventas += total;
    for (const l of o.lineItems?.nodes || []) {
      const p = productos[l.product?.id];
      if (p) coste += ((p.costeEUR || 0) + (p.envioEUR || 0)) * l.quantity;
    }
  }
  const comisiones = ventas * 0.03 + pedidos.length * 0.25;
  const beneficio = ventas / 1.21 - coste - comisiones - (gasto || 0);
  return { pedidos: pedidos.length, ventas: +ventas.toFixed(2), coste: +coste.toFixed(2), comisiones: +comisiones.toFixed(2), gasto: +(gasto || 0).toFixed(2), beneficio: +beneficio.toFixed(2) };
}

/**
 * Informe de hoy y de 7 días. Devuelve { ok, novedad, resumen, hoy, semana, proponerPausa }.
 */
async function informe({ dep = {} } = {}) {
  const shopifyOk = require('./tiendas').conectada();
  if (!shopifyOk) return { ok: true, novedad: false, resumen: 'Shopify no está conectado' };
  try {
    const estado = investigar.leer();
    const productos = estado.productos || {};
    const ahora = Date.now();
    const pedidos7 = await (dep.ventas || ventasShopify)(dia(ahora - 6 * 86400000), dep);
    const hoyStr = dia(ahora);
    const pedidosHoy = pedidos7.filter((o) => dia(o.createdAt) === hoyStr);
    let metaHoy = null;
    let meta7 = null;
    let avisoMeta = '';
    try {
      metaHoy = await (dep.gasto || gastoMeta)('today');
      meta7 = await (dep.gasto || gastoMeta)('last_7d');
    } catch (e) { avisoMeta = ` (no pude leer Meta: ${e.message})`; }
    const hoy = cuentas(pedidosHoy, productos, metaHoy?.gasto);
    const semana = cuentas(pedidos7, productos, meta7?.gasto);

    // Regla de pausa: campaña activa que en 7 días ha gastado más que el margen
    // de 2 ventas y no ha vendido nada, o que pierde dinero con al menos 30 € gastados.
    const m = estado.meta;
    const margen = estado.elegido?.margenEUR || 5;
    let proponerPausa = '';
    if (m?.estado === 'ACTIVE' && meta7) {
      if (semana.pedidos === 0 && meta7.gasto >= Math.max(2 * margen, 15)) proponerPausa = `Ha gastado ${eur(meta7.gasto)} en 7 días sin ninguna venta.`;
      else if (meta7.gasto >= 30 && semana.beneficio < 0) proponerPausa = `Pierde dinero: ${eur(semana.beneficio)} en 7 días con ${eur(meta7.gasto)} de anuncios.`;
    }
    let accion = '';
    if (proponerPausa && claves.obtener('TIENDA_AUTOPAUSA') === 'si') {
      const r = await (dep.pausar || require('./anuncios').pausarMeta)();
      accion = r.ok ? ' ⏸ La he PAUSADO (TIENDA_AUTOPAUSA=si).' : ` No pude pausarla: ${r.error}`;
    } else if (proponerPausa) {
      accion = ' Te recomiendo pausarla en TIENDA → paso 4 (o pon TIENDA_AUTOPAUSA=si para que lo haga yo).';
    }

    const linea = (t, c, mm) => `${t}: ${c.pedidos} pedido(s) · ventas ${eur(c.ventas)} · anuncios ${eur(c.gasto)}${mm && mm.clics ? ` (${mm.clics} clics, ${eur(mm.cpc)}/clic)` : ''} · beneficio ${c.beneficio >= 0 ? '🟢' : '🔴'} ${eur(c.beneficio)}`;
    const resumen = [linea('Hoy', hoy, metaHoy), linea('7 días', semana, meta7), ...(proponerPausa ? [`⚠ Campaña de Meta: ${proponerPausa}${accion}`] : [])].join('\n') + avisoMeta;
    investigar.escribir({ ...investigar.leer(), ultimoInforme: { fecha: new Date().toISOString(), hoy, semana, proponerPausa } });
    registro.anotar({ origen: 'tienda', accion: 'informe de ventas y anuncios', detalle: { hoy, semana, proponerPausa } });
    return { ok: true, novedad: true, urgente: Boolean(proponerPausa), resumen, hoy, semana, proponerPausa };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { informe, cuentas, gastoMeta, ventasShopify };
