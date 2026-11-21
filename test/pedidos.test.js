// Pedidos automáticos con Shopify y CJ simulados: preparar sin comprar,
// comprar solo al confirmar, fallo de pago, y seguimiento de vuelta a Shopify.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-pedidos-'));
const claves = require('../src/nucleo/claves');
const investigar = require('../src/tienda/investigar');
const pedidos = require('../src/tienda/pedidos');

claves.guardar({ SHOPIFY_TIENDA: 'mitienda.myshopify.com', SHOPIFY_TOKEN: 'shpat_x' });
investigar.escribir({ usdEur: 0.9, productos: { 'gid://shopify/Product/1': { pid: 'P1', vid: 'V1', nombre: 'Cepillo', costeEUR: 3.6, envioEUR: 1.8 } } });

const DIR = { name: 'Ana Pérez', firstName: 'Ana', lastName: 'Pérez', address1: 'Calle Mayor 1', address2: '2ºB', city: 'Madrid', province: 'Madrid', zip: '28001', country: 'Spain', countryCodeV2: 'ES', phone: '+34600000000' };
const ORDEN = (id, producto = 'gid://shopify/Product/1') => ({
  id: `gid://shopify/Order/${id}`, name: `#${id}`, createdAt: '2026-11-21T10:00:00Z', email: 'ana@ejemplo.com', phone: null,
  totalPriceSet: { shopMoney: { amount: '15.95', currencyCode: 'EUR' } }, shippingAddress: DIR,
  lineItems: { nodes: [{ id: `gid://shopify/LineItem/${id}0`, title: 'Cepillo', quantity: 2, sku: '', product: { id: producto } }] },
});

function falsos() {
  const llamadas = { cj: [], shopify: [] };
  const cj = {
    envio: async (vid, o) => ({ nombre: 'CJPacket Ordinary', dias: '5-8', usd: 2, origen: 'CN', destino: o.destino }),
    llamar: async (ruta, o = {}) => {
      llamadas.cj.push({ ruta, cuerpo: o.cuerpo });
      if (ruta.includes('createOrderV2')) return { orderId: 'CJ-777', orderStatus: 'CREATED' };
      if (ruta.includes('payBalance')) { if (cj.sinSaldo) throw new Error('CJ: Insufficient balance'); return null; }
      if (ruta.includes('getOrderDetail')) return { orderId: 'CJ-777', orderStatus: 'SHIPPED', trackNumber: 'LP123456789CN', trackingProvider: 'Correos', trackingUrl: 'https://t.17track.net/LP123456789CN' };
      throw new Error(`ruta inesperada ${ruta}`);
    },
  };
  const graphql = async (q, v) => {
    llamadas.shopify.push({ q, v });
    if (/orders\(first/.test(q)) return { orders: { nodes: [ORDEN(1001), ORDEN(1002, 'gid://shopify/Product/999')] } };
    if (/fulfillmentOrders/.test(q)) return { order: { fulfillmentOrders: { nodes: [{ id: 'gid://shopify/FulfillmentOrder/9', status: 'OPEN' }, { id: 'gid://shopify/FulfillmentOrder/8', status: 'CLOSED' }] } } };
    if (/fulfillmentCreate/.test(q)) return { fulfillmentCreate: { fulfillment: { id: 'F1', status: 'SUCCESS' }, userErrors: [] } };
    if (/order\(id/.test(q)) return { order: { ...ORDEN(1001), displayFulfillmentStatus: 'UNFULFILLED' } };
    throw new Error('consulta inesperada');
  };
  return { cj, graphql, llamadas };
}

test('rutina: prepara los pedidos SIN comprar nada y avisa', async () => {
  const f = falsos();
  const r = await pedidos.rutina({ dep: f });
  assert.ok(r.ok && r.novedad);
  assert.match(r.resumen, /1 pedido\(s\) nuevo\(s\) para confirmar en TIENDA: #1001 \(15\.95 EUR\)/);
  assert.match(r.resumen, /#1002: No sé qué producto de CJ es: Cepillo/);
  assert.strictEqual(f.llamadas.cj.length, 0, 'no se ha creado ni pagado nada en CJ');
  const p = pedidos.lista().find((x) => x.nombre === '#1001');
  assert.deepStrictEqual([p.estado, p.costeEstimadoEUR, p.ciudad], ['por_confirmar', 9, 'Madrid, Spain']);
  assert.strictEqual(p.email, undefined, 'no guarda el email ni la dirección completa del cliente');
  // La segunda vez no vuelve a avisar del mismo pedido.
  assert.strictEqual((await pedidos.rutina({ dep: falsos() })).novedad, false);
});

test('confirmar: crea el pedido en CJ con la dirección de Shopify y lo paga con el saldo', async () => {
  const f = falsos();
  const id = 'gid://shopify/Order/1001';
  const r = await pedidos.confirmar(id, { dep: f });
  assert.ok(r.ok, r.error);
  const crear = f.llamadas.cj.find((x) => x.ruta.includes('createOrderV2')).cuerpo;
  assert.deepStrictEqual(
    [crear.shippingCountryCode, crear.shippingCustomerName, crear.shippingAddress, crear.shippingZip, crear.logisticName, crear.fromCountryCode, crear.payType],
    ['ES', 'Ana Pérez', 'Calle Mayor 1', '28001', 'CJPacket Ordinary', 'CN', 3],
  );
  assert.deepStrictEqual(crear.products, [{ vid: 'V1', quantity: 2, storeLineItemId: '10010' }]);
  assert.deepStrictEqual(f.llamadas.cj.find((x) => x.ruta.includes('payBalance')).cuerpo, { orderId: 'CJ-777' });
  assert.strictEqual(pedidos.lista().find((x) => x.id === id).estado, 'pagado');
  assert.match((await pedidos.confirmar(id, { dep: f })).error, /ya está pagado/, 'no se puede comprar dos veces');
  assert.match((await pedidos.confirmar('gid://shopify/Order/1002', { dep: f })).error, /No sé qué producto/);
});

test('seguimiento: pone el número de CJ en Shopify y avisa al cliente', async () => {
  const f = falsos();
  const r = await pedidos.seguimiento({ dep: f });
  assert.deepStrictEqual(r.enviados, [{ nombre: '#1001', seguimiento: 'LP123456789CN' }]);
  const m = f.llamadas.shopify.find((x) => /fulfillmentCreate/.test(x.q)).v.f;
  assert.deepStrictEqual(m.lineItemsByFulfillmentOrder, [{ fulfillmentOrderId: 'gid://shopify/FulfillmentOrder/9' }], 'solo las órdenes de envío abiertas');
  assert.deepStrictEqual(m.trackingInfo, { number: 'LP123456789CN', company: 'Correos', url: 'https://t.17track.net/LP123456789CN' });
  assert.strictEqual(m.notifyCustomer, true);
  assert.strictEqual(pedidos.lista().find((x) => x.nombre === '#1001').estado, 'enviado');
});

test('confirmar: si no hay saldo en CJ, lo dice claro y no lo marca como pagado', async () => {
  const e = investigar.leer();
  const nuevo = { ...e.pedidos['gid://shopify/Order/1001'], id: 'gid://shopify/Order/2000', nombre: '#2000', estado: 'por_confirmar', cjOrderId: undefined };
  investigar.escribir({ ...e, pedidos: { ...e.pedidos, [nuevo.id]: nuevo } });
  const f = falsos();
  f.cj.sinSaldo = true;
  const r = await pedidos.confirmar(nuevo.id, { dep: f });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /se creó en CJ pero no se pudo pagar.*saldo/);
  assert.strictEqual(pedidos.lista().find((x) => x.id === nuevo.id).estado, 'creado_en_cj');
  assert.ok(pedidos.marcarManual(nuevo.id).ok);
  assert.strictEqual(pedidos.lista().find((x) => x.id === nuevo.id).estado, 'manual');
});
