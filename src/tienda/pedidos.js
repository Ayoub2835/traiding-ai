// Pedidos automáticos (Shopify → CJ Dropshipping → seguimiento en Shopify).
//  1. revisar(): busca pedidos PAGADOS y sin enviar en Shopify, prepara cada uno
//     (variante de CJ, envío más barato a la dirección del cliente, coste) y
//     te avisa. NO compra nada.
//  2. confirmar(id): SOLO tras tu clic (y una confirmación con el coste), crea el
//     pedido en CJ y lo paga con tu SALDO de CJ.
//  3. seguimiento(): cuando CJ da el número de seguimiento, lo pone en Shopify
//     (pedido "enviado") y Shopify avisa al cliente. Esto no gasta dinero.
'use strict';
const claves = require('../nucleo/claves');
const registro = require('../seguridad/registro');
const investigar = require('./investigar');
const cj = require('./cj');

const shopify = () => require('./shopify');

const ORDERS = `query($q: String!) {
  orders(first: 25, query: $q, sortKey: CREATED_AT, reverse: true) {
    nodes {
      id name createdAt email phone
      totalPriceSet { shopMoney { amount currencyCode } }
      shippingAddress { name firstName lastName address1 address2 city province provinceCode zip country countryCodeV2 phone }
      lineItems(first: 20) { nodes { id title quantity sku product { id } } }
    }
  }
}`;

const conectado = () => Boolean(claves.obtener('SHOPIFY_TOKEN') && claves.obtener('SHOPIFY_TIENDA'));

function guardarPedido(id, datos) {
  const e = investigar.leer();
  const pedidos = { ...(e.pedidos || {}) };
  pedidos[id] = { ...(pedidos[id] || {}), ...datos, actualizado: new Date().toISOString() };
  investigar.escribir({ ...e, pedidos });
  return pedidos[id];
}

/** Prepara (sin comprar) los pedidos pagados que aún no están en CJ. */
async function revisar({ dep = {} } = {}) {
  if (!conectado()) return { ok: true, nuevos: [], resumen: 'Shopify no está conectado' };
  const d = await (dep.graphql || shopify().graphql)(ORDERS, { q: 'financial_status:paid fulfillment_status:unfulfilled' });
  const estado = investigar.leer();
  const conocidos = estado.pedidos || {};
  const productos = estado.productos || {};
  const nuevos = [];
  for (const o of d.orders?.nodes || []) {
    if (conocidos[o.id]) continue;
    const dir = o.shippingAddress;
    const lineas = (o.lineItems?.nodes || []).map((l) => ({ id: l.id, titulo: l.title, cantidad: l.quantity, cj: productos[l.product?.id] || null }));
    const sinCj = lineas.filter((l) => !l.cj);
    let envio = null;
    let problema = '';
    if (!dir) problema = 'El pedido no tiene dirección de envío';
    else if (sinCj.length) problema = `No sé qué producto de CJ es: ${sinCj.map((l) => l.titulo).join(', ')} (no lo creó Jarvis)`;
    else {
      try { envio = await (dep.cj || cj).envio(lineas[0].cj.vid, { destino: dir.countryCodeV2 }); } catch (e) { problema = `CJ no pudo calcular el envío: ${e.message}`; }
      if (!envio && !problema) problema = `CJ no envía ese producto a ${dir.country}`;
    }
    const costeEstimado = lineas.reduce((s, l) => s + (l.cj ? (l.cj.costeEUR || 0) * l.cantidad : 0), 0) + (envio ? envio.usd * (estado.usdEur || 0.92) : 0);
    const p = guardarPedido(o.id, {
      id: o.id, nombre: o.name, fecha: o.createdAt, total: `${o.totalPriceSet?.shopMoney?.amount} ${o.totalPriceSet?.shopMoney?.currencyCode}`,
      cliente: dir ? dir.name || `${dir.firstName || ''} ${dir.lastName || ''}`.trim() : '', ciudad: dir ? `${dir.city}, ${dir.country}` : '',
      lineas, envio, costeEstimadoEUR: +costeEstimado.toFixed(2), estado: problema ? 'problema' : 'por_confirmar', problema,
    });
    nuevos.push(p);
  }
  if (nuevos.length) registro.anotar({ origen: 'pedidos', accion: `${nuevos.length} pedido(s) nuevo(s) en Shopify`, detalle: nuevos.map((n) => n.nombre) });
  return { ok: true, nuevos };
}

/** Datos de la dirección para CJ (solo lo necesario para el envío). */
function cuerpoCJ(o, p) {
  const a = o.shippingAddress;
  return {
    orderNumber: `${o.name.replace('#', '')}-${o.id.split('/').pop()}`.slice(0, 50),
    shippingCountryCode: a.countryCodeV2, shippingCountry: a.country, shippingProvince: a.province || a.city, shippingCity: a.city,
    shippingCustomerName: a.name || `${a.firstName || ''} ${a.lastName || ''}`.trim(), shippingAddress: a.address1, shippingAddress2: a.address2 || '',
    shippingZip: a.zip || '', shippingPhone: a.phone || o.phone || '', email: o.email || '',
    logisticName: p.envio.nombre, fromCountryCode: p.envio.origen, payType: 3,
    products: p.lineas.map((l) => ({ vid: l.cj.vid, quantity: l.cantidad, storeLineItemId: l.id.split('/').pop() })),
  };
}

/** Crea y PAGA el pedido en CJ. Llamar SOLO tras la confirmación del usuario. */
async function confirmar(id, { dep = {} } = {}) {
  const p = (investigar.leer().pedidos || {})[id];
  if (!p) return { ok: false, error: 'No encuentro ese pedido' };
  if (p.estado !== 'por_confirmar') return { ok: false, error: p.estado === 'problema' ? p.problema : `Ese pedido ya está ${p.estado.replace('_', ' ')}` };
  const api = dep.cj || cj;
  try {
    // Se vuelve a leer la dirección en Shopify en el momento de comprar (no se guarda).
    const d = await (dep.graphql || shopify().graphql)(`query($id: ID!) { order(id: $id) { id name email phone displayFulfillmentStatus shippingAddress { name firstName lastName address1 address2 city province zip country countryCodeV2 phone } } }`, { id });
    const o = d.order;
    if (!o?.shippingAddress) return { ok: false, error: 'Shopify no devolvió la dirección del pedido' };
    const creado = await api.llamar('/shopping/order/createOrderV2', { metodo: 'POST', cuerpo: cuerpoCJ(o, p) });
    if (!creado?.orderId) throw new Error('CJ no devolvió el número de pedido');
    guardarPedido(id, { estado: 'creado_en_cj', cjOrderId: creado.orderId });
    await api.llamar('/shopping/pay/payBalance', { metodo: 'POST', cuerpo: { orderId: creado.orderId } });
    guardarPedido(id, { estado: 'pagado', pagado: new Date().toISOString() });
    registro.anotar({ origen: 'pedidos', accion: `comprar en CJ el pedido ${p.nombre}`, decision: 'aprobado por el usuario', detalle: { cjOrderId: creado.orderId, coste: p.costeEstimadoEUR } });
    return { ok: true, cjOrderId: creado.orderId };
  } catch (e) {
    const ahora = (investigar.leer().pedidos || {})[id];
    registro.anotar({ origen: 'pedidos', accion: `comprar en CJ el pedido ${p.nombre}`, decision: 'fallo', motivo: e.message });
    return { ok: false, error: ahora?.estado === 'creado_en_cj' ? `El pedido se creó en CJ pero no se pudo pagar (${e.message}). ¿Tienes saldo en CJ? Puedes pagarlo en cjdropshipping.com → Pedidos.` : e.message };
  }
}

/** Pasa a Shopify el seguimiento de los pedidos pagados que CJ ya ha enviado. */
async function seguimiento({ dep = {} } = {}) {
  const pedidos = Object.values(investigar.leer().pedidos || {}).filter((p) => p.estado === 'pagado' && p.cjOrderId);
  const enviados = [];
  for (const p of pedidos) {
    try {
      const det = await (dep.cj || cj).llamar(`/shopping/order/getOrderDetail?orderId=${encodeURIComponent(p.cjOrderId)}`);
      if (!det?.trackNumber) continue;
      const g = dep.graphql || shopify().graphql;
      const fo = await g(`query($id: ID!) { order(id: $id) { fulfillmentOrders(first: 5) { nodes { id status } } } }`, { id: p.id });
      const abiertos = (fo.order?.fulfillmentOrders?.nodes || []).filter((f) => ['OPEN', 'IN_PROGRESS', 'SCHEDULED'].includes(f.status));
      if (!abiertos.length) { guardarPedido(p.id, { estado: 'enviado', seguimiento: det.trackNumber }); continue; }
      const r = await g(`mutation($f: FulfillmentInput!) { fulfillmentCreate(fulfillment: $f) { fulfillment { id status } userErrors { field message } } }`, {
        f: {
          lineItemsByFulfillmentOrder: abiertos.map((f) => ({ fulfillmentOrderId: f.id })),
          trackingInfo: { number: det.trackNumber, company: det.trackingProvider || det.logisticName || 'Otro', ...(det.trackingUrl ? { url: det.trackingUrl } : {}) },
          notifyCustomer: true,
        },
      });
      const err = r.fulfillmentCreate?.userErrors || [];
      if (err.length) throw new Error(err.map((x) => x.message).join('; '));
      guardarPedido(p.id, { estado: 'enviado', seguimiento: det.trackNumber, transportista: det.trackingProvider || '' });
      enviados.push({ nombre: p.nombre, seguimiento: det.trackNumber });
      registro.anotar({ origen: 'pedidos', accion: `marcar como enviado ${p.nombre} (seguimiento ${det.trackNumber})`, decision: 'hecho' });
    } catch (e) {
      registro.anotar({ origen: 'pedidos', accion: `seguimiento de ${p.nombre}`, decision: 'fallo', motivo: e.message });
    }
  }
  return { ok: true, enviados };
}

/** Lo que ejecuta la rutina cada 30 minutos (no gasta dinero). */
async function rutina({ dep = {} } = {}) {
  if (!conectado()) return { ok: true, novedad: false, resumen: 'Shopify no está conectado' };
  try {
    const r = await revisar({ dep });
    const s = await seguimiento({ dep });
    const partes = [];
    const porConfirmar = r.nuevos.filter((n) => n.estado === 'por_confirmar');
    const problemas = r.nuevos.filter((n) => n.estado === 'problema');
    if (porConfirmar.length) partes.push(`🛒 ${porConfirmar.length} pedido(s) nuevo(s) para confirmar en TIENDA: ${porConfirmar.map((n) => `${n.nombre} (${n.total})`).join(', ')}`);
    if (problemas.length) partes.push(`⚠ ${problemas.map((n) => `${n.nombre}: ${n.problema}`).join(' · ')}`);
    if (s.enviados.length) partes.push(`📦 Enviado(s) con seguimiento: ${s.enviados.map((x) => `${x.nombre} (${x.seguimiento})`).join(', ')}`);
    return { ok: true, novedad: partes.length > 0, resumen: partes.join('\n') || 'Sin pedidos nuevos' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function lista() {
  return Object.values(investigar.leer().pedidos || {}).sort((a, b) => String(b.fecha).localeCompare(String(a.fecha))).slice(0, 30);
}

/** Lo marcas como hecho a mano (p. ej. lo compraste tú en CJ). */
function marcarManual(id) {
  const p = (investigar.leer().pedidos || {})[id];
  if (!p) return { ok: false, error: 'No encuentro ese pedido' };
  guardarPedido(id, { estado: 'manual' });
  return { ok: true };
}

module.exports = { revisar, confirmar, seguimiento, rutina, lista, marcarManual, cuerpoCJ };
