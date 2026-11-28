// Varias tiendas de Shopify, con y sin dropshipping: la tienda de siempre pasa
// a ser la "principal", cada tienda tiene su token y sus datos, las rutinas
// recorren todas sin mezclarlas, y en las tiendas con stock propio los pedidos
// no se compran en CJ: los envías tú y Jarvis pone tu seguimiento.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-tiendas-'));
const claves = require('../src/nucleo/claves');
const rutas = require('../src/nucleo/rutas');
const tiendas = require('../src/tienda/tiendas');
const investigar = require('../src/tienda/investigar');
const pedidos = require('../src/tienda/pedidos');
const shopify = require('../src/tienda/shopify');
const red = require('../src/nucleo/red');

test('la tienda de siempre pasa a ser la principal, con su carpeta de siempre', () => {
  claves.guardar({ SHOPIFY_TIENDA: 'vieja.myshopify.com', SHOPIFY_TOKEN: 'shpat_viejo' });
  const l = tiendas.lista();
  assert.strictEqual(l.length, 1);
  assert.deepStrictEqual(l[0], { id: 'principal', nombre: 'Principal', dominio: 'vieja.myshopify.com', tipo: 'dropshipping' });
  assert.strictEqual(tiendas.actualId(), 'principal');
  assert.ok(tiendas.conectada());
  assert.strictEqual(tiendas.carpeta(), rutas.datos('dropshipping'));
});

test('añadir otra tienda: el token va al .env y no al JSON; dirección validada', () => {
  assert.strictEqual(tiendas.agregar({ nombre: 'Mala', dominio: 'https://ejemplo.com', token: 'x' }).ok, false);
  assert.strictEqual(tiendas.agregar({ nombre: 'X', dominio: 'x.myshopify.com', tipo: 'raro' }).ok, false);
  const r = tiendas.agregar({ nombre: 'Mascotas', dominio: 'https://Mascotas-ES.myshopify.com/admin', token: 'shpat_mascotas', tipo: 'stock' });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.tienda.id, 'mascotases');
  assert.strictEqual(r.tienda.dominio, 'mascotas-es.myshopify.com');
  assert.strictEqual(claves.obtener('SHOPIFY_TOKEN_MASCOTASES'), 'shpat_mascotas');
  assert.ok(!fs.readFileSync(rutas.datos('tiendas.json'), 'utf8').includes('shpat_'), 'el token nunca se guarda en el JSON');
  assert.strictEqual(tiendas.actualId(), 'principal', 'añadir no cambia la tienda en uso');
  assert.strictEqual(tiendas.lista().length, 2);
});

test('cada tienda usa sus credenciales y sus datos, sin mezclarse', async () => {
  investigar.escribir({ elegido: { pid: 'A' } });
  await tiendas.conTienda('mascotases', async () => {
    await new Promise((r) => setTimeout(r, 5)); // también a través de los await
    const c = tiendas.credenciales();
    assert.deepStrictEqual([c.dominio, c.token], ['mascotas-es.myshopify.com', 'shpat_mascotas']);
    assert.strictEqual(investigar.leer().elegido, undefined);
    investigar.escribir({ elegido: { pid: 'B' } });
  });
  assert.strictEqual(investigar.leer().elegido.pid, 'A');
  assert.strictEqual(tiendas.credenciales().token, 'shpat_viejo');
  const todas = await tiendas.enTodas(async () => investigar.leer().elegido.pid);
  assert.deepStrictEqual(todas.map((x) => [x.tienda.id, x.r]), [['principal', 'A'], ['mascotases', 'B']]);
});

test('el filtro de red deja pasar todas tus tiendas', () => {
  assert.ok(red.permitida('https://vieja.myshopify.com/admin/api/2026-10/graphql.json', {}));
  assert.ok(red.permitida('https://mascotas-es.myshopify.com/admin/api/2026-10/graphql.json', {}));
  assert.strictEqual(red.permitida('https://otra.myshopify.com/', {}), false);
});

test('tienda sin dropshipping: el pedido queda «por enviar» y tu seguimiento va a Shopify', async () => {
  const llamadas = [];
  const graphql = async (q, v) => {
    llamadas.push({ q, v });
    if (/orders\(first/.test(q)) {
      return { orders: { nodes: [{ id: 'gid://shopify/Order/5', name: '#5', createdAt: '2026-11-21T10:00:00Z', totalPriceSet: { shopMoney: { amount: '24.95', currencyCode: 'EUR' } }, shippingAddress: { name: 'Ana', city: 'Sevilla', country: 'Spain', countryCodeV2: 'ES' }, lineItems: { nodes: [{ id: 'L1', title: 'Collar', quantity: 1, product: { id: 'gid://shopify/Product/77' } }] } }] } };
    }
    if (/fulfillmentOrders/.test(q)) return { order: { fulfillmentOrders: { nodes: [{ id: 'FO1', status: 'OPEN' }] } } };
    if (/fulfillmentCreate/.test(q)) return { fulfillmentCreate: { fulfillment: { id: 'F1', status: 'SUCCESS' }, userErrors: [] } };
    throw new Error('consulta inesperada');
  };
  const cj = { envio: async () => { throw new Error('no debe usar CJ'); } };
  await tiendas.conTienda('mascotases', async () => {
    const r = await pedidos.revisar({ dep: { graphql, cj } });
    assert.ok(r.ok);
    assert.strictEqual(r.nuevos[0].estado, 'por_enviar');
    assert.strictEqual((await pedidos.enviadoPorMi('gid://shopify/Order/5', { numero: '' }, { dep: { graphql } })).ok, false);
    const e = await pedidos.enviadoPorMi('gid://shopify/Order/5', { numero: 'PQ123ES', empresa: 'Correos', url: 'javascript:alert(1)' }, { dep: { graphql } });
    assert.ok(e.ok, e.error);
    const f = llamadas.find((x) => /fulfillmentCreate/.test(x.q)).v.f;
    assert.deepStrictEqual(f.trackingInfo, { number: 'PQ123ES', company: 'Correos' }, 'un enlace que no es https no se envía');
    assert.strictEqual(f.notifyCustomer, true);
    assert.strictEqual(pedidos.lista().find((p) => p.id === 'gid://shopify/Order/5').estado, 'enviado');
  });
  assert.strictEqual(pedidos.lista().length, 0, 'los pedidos de una tienda no aparecen en otra');
});

test('producto propio: valida nombre y precio antes de tocar Shopify', async () => {
  assert.match((await shopify.crearPropio({ nombre: '', precio: 10 })).error, /nombre/);
  assert.match((await shopify.crearPropio({ nombre: 'Collar', precio: 'gratis' })).error, /precio/);
});

test('quitar una tienda borra su token y vuelve a la principal', () => {
  assert.ok(tiendas.elegir('mascotases').ok);
  assert.strictEqual(tiendas.actual().tipo, 'stock');
  assert.ok(tiendas.quitar('mascotases').ok);
  assert.strictEqual(claves.obtener('SHOPIFY_TOKEN_MASCOTASES'), '');
  assert.strictEqual(tiendas.actualId(), 'principal');
  assert.strictEqual(tiendas.elegir('nada').ok, false);
});

test('apps nuevas de dev.shopify.com: pide el token con ID y clave, lo reutiliza 24 h y no lo guarda en disco', async () => {
  const r = tiendas.agregar({ nombre: 'Nueva', dominio: 'jji06e-kf.myshopify.com', clientId: 'cid123', secreto: 'sec456', tipo: 'dropshipping' });
  assert.ok(r.ok, r.error);
  assert.ok(tiendas.conectada(r.tienda.id), 'con ID y clave cuenta como conectada');
  const llamadas = [];
  const pedir = async (url, o) => { llamadas.push({ url, o }); return { ok: true, datos: { access_token: 'shpat_temporal', scope: 'read_orders', expires_in: 86399 } }; };
  assert.strictEqual(await tiendas.acceso(r.tienda.id, { dep: { pedir } }), 'shpat_temporal');
  assert.strictEqual(await tiendas.acceso(r.tienda.id, { dep: { pedir } }), 'shpat_temporal');
  assert.strictEqual(llamadas.length, 1, 'el token se reutiliza mientras no caduque');
  assert.strictEqual(llamadas[0].url, 'https://jji06e-kf.myshopify.com/admin/oauth/access_token');
  assert.strictEqual(llamadas[0].o.method, 'POST');
  assert.deepStrictEqual(Object.fromEntries(new URLSearchParams(llamadas[0].o.body)), { grant_type: 'client_credentials', client_id: 'cid123', client_secret: 'sec456' });
  assert.ok(!fs.readFileSync(rutas.datos('tiendas.json'), 'utf8').includes('sec456'), 'la clave secreta nunca va al JSON');
  const otra = tiendas.agregar({ nombre: 'Otra', dominio: 'otra-es.myshopify.com', clientId: 'x', secreto: 'y' });
  await assert.rejects(tiendas.acceso(otra.tienda.id, { dep: { pedir: async () => ({ ok: false, datos: { error: 'shop_not_permitted' } }) } }), /misma organización/);
  assert.ok(tiendas.quitar(otra.tienda.id).ok);
  assert.ok(tiendas.quitar(r.tienda.id).ok);
  assert.strictEqual(claves.obtener(tiendas.nombres(r.tienda.id).secreto), '');
});
