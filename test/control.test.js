// Control de ventas y anuncios: beneficio real y regla de pausa (proponer / pausar).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-control-'));
const claves = require('../src/nucleo/claves');
const investigar = require('../src/tienda/investigar');
const control = require('../src/tienda/control');

claves.guardar({ SHOPIFY_TIENDA: 'mitienda.myshopify.com', SHOPIFY_TOKEN: 'shpat_x' });
const PRODUCTOS = { 'gid://shopify/Product/1': { costeEUR: 4, envioEUR: 2 } };
const pedido = (fecha, total = 19.95, cantidad = 1) => ({ id: `o${Math.random()}`, createdAt: fecha, totalPriceSet: { shopMoney: { amount: String(total) } }, lineItems: { nodes: [{ quantity: cantidad, product: { id: 'gid://shopify/Product/1' } }] } });

test('cuentas: ventas sin IVA − coste − comisiones − anuncios', () => {
  const c = control.cuentas([pedido('2026-11-21T10:00:00Z', 24.2, 2)], PRODUCTOS, 5);
  // 24,20 / 1,21 = 20; coste (4+2)×2 = 12; comisiones 0,726+0,25 = 0,976; anuncios 5
  assert.deepStrictEqual(c, { pedidos: 1, ventas: 24.2, coste: 12, comisiones: 0.98, gasto: 5, beneficio: 2.02 });
});

test('informe: sin ventas y gastando, PROPONE pausar (no pausa si no lo has permitido)', async () => {
  investigar.escribir({ productos: PRODUCTOS, elegido: { margenEUR: 6 }, meta: { campana: 'C1', estado: 'ACTIVE', presupuesto: 10 } });
  let pausada = false;
  const dep = { ventas: async () => [], gasto: async (p) => ({ gasto: p === 'today' ? 4 : 25, clics: 40, cpc: 0.62 }), pausar: async () => { pausada = true; return { ok: true }; } };
  const r = await control.informe({ dep });
  assert.ok(r.ok && r.urgente);
  assert.match(r.resumen, /Hoy: 0 pedido\(s\) · ventas 0,00 € · anuncios 4,00 €/);
  assert.match(r.resumen, /Ha gastado 25,00 € en 7 días sin ninguna venta\. Te recomiendo pausarla/);
  assert.strictEqual(pausada, false);

  claves.guardar({ TIENDA_AUTOPAUSA: 'si' });
  const r2 = await control.informe({ dep });
  assert.strictEqual(pausada, true);
  assert.match(r2.resumen, /La he PAUSADO/);
  claves.guardar({ TIENDA_AUTOPAUSA: '' });
});

test('informe: con ventas que dan beneficio no propone nada; si Meta falla, sigue con Shopify', async () => {
  investigar.escribir({ productos: PRODUCTOS, elegido: { margenEUR: 6 }, meta: { campana: 'C1', estado: 'ACTIVE' } });
  const hoy = new Date().toISOString();
  const dep = { ventas: async () => [pedido(hoy), pedido(hoy), pedido('2026-01-01T00:00:00Z')], gasto: async () => { throw new Error('token caducado'); } };
  const r = await control.informe({ dep });
  assert.ok(r.ok);
  assert.strictEqual(r.hoy.pedidos, 2);
  assert.strictEqual(r.semana.pedidos, 3);
  assert.ok(r.semana.beneficio > 0);
  assert.strictEqual(r.proponerPausa, '');
  assert.match(r.resumen, /no pude leer Meta: token caducado/);
  assert.strictEqual(investigar.leer().ultimoInforme.hoy.pedidos, 2);
});
