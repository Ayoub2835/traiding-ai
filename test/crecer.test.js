// Herramientas para vender más: ganadores de la Biblioteca de anuncios de Meta,
// tienda completa (textos legales, páginas, lo que falta), resumen del negocio
// y campañas de VENTAS con el Píxel y varias versiones del anuncio (A/B).
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-crecer-'));
const claves = require('../src/nucleo/claves');
const investigar = require('../src/tienda/investigar');
const espia = require('../src/tienda/espia');
const paginas = require('../src/tienda/paginas');
const manana = require('../src/tienda/manana');
const anuncios = require('../src/tienda/anuncios');

claves.guardar({ SHOPIFY_TIENDA: 'mitienda.myshopify.com', SHOPIFY_TOKEN: 'shpat_x' });
const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();

test('ganadores: agrupa por anunciante, puntúa por días y anuncios y no guarda el token', async () => {
  const visto = [];
  const datos = [
    { id: '111', page_id: 'P1', page_name: 'Gadgets Casa', ad_delivery_start_time: hace(45), ad_creative_bodies: ['El cepillo que quita los pelos del sofá'], ad_snapshot_url: 'https://www.facebook.com/ads/archive/render_ad/?id=111&access_token=SECRETO', eu_total_reach: 50000 },
    { id: '112', page_id: 'P1', page_name: 'Gadgets Casa', ad_delivery_start_time: hace(20), ad_creative_bodies: ['Otra versión'] },
    { id: '113', page_id: 'P1', page_name: 'Gadgets Casa', ad_delivery_start_time: hace(10) },
    { id: '221', page_id: 'P2', page_name: 'Nuevo', ad_delivery_start_time: hace(3), ad_creative_bodies: ['Recién empezado'] },
  ];
  const dep = { peticion: async (url) => { visto.push(url); return { ok: true, datos: { data: datos } }; } };
  assert.match((await espia.buscar({ dep })).error, /Conecta antes Facebook/);
  claves.guardar({ META_ADS_TOKEN: 'ADS' });
  const pensar = async (_s, u) => {
    assert.match(u, /Gadgets Casa/);
    return { texto: '{"productos":[{"producto":"Cepillo quitapelos","busqueda":"pet hair remover"}]}' };
  };
  const r = await espia.buscar({ terminos: 'mascotas', pensar, dep });
  assert.ok(r.ok, r.error);
  const q = new URL(visto[0]).searchParams;
  assert.deepStrictEqual([q.get('search_terms'), q.get('ad_reached_countries'), q.get('ad_active_status')], ['mascotas', '["ES"]', 'ACTIVE']);
  assert.strictEqual(r.ganadores.length, 1, 'el anunciante con 3 días no cuenta');
  const g = r.ganadores[0];
  assert.deepStrictEqual([g.pagina, g.anuncios, g.diasMax, g.busqueda, g.producto], ['Gadgets Casa', 3, 45, 'pet hair remover', 'Cepillo quitapelos']);
  assert.strictEqual(g.enlace, 'https://www.facebook.com/ads/library/?id=111');
  assert.ok(!JSON.stringify(investigar.leer()).includes('SECRETO'), 'el token del enlace nunca se guarda');
  const sinId = await espia.buscar({ dep: { peticion: async () => ({ ok: false, datos: { error: { message: 'Application does not have permission for this action' } } }) } });
  assert.match(sinId.error, /confirma tu identidad/);
});

test('textos legales: exigen titular, NIF, dirección y email; ley española; según el tipo de tienda', () => {
  assert.match(paginas.validar({}).error, /titular/);
  assert.match(paginas.validar({ titular: 'Ana', nif: 'x' }).error, /NIF/);
  const datos = { titular: 'Ana Pérez', nif: '12345678Z', direccion: 'Calle Mayor 1, 28001 Madrid', email: 'hola@mitienda.es' };
  const drop = paginas.plantillas(paginas.validar(datos).datos, { tipo: 'dropshipping' });
  assert.match(drop.politicas.REFUND_POLICY, /14 días naturales/);
  assert.match(drop.politicas.REFUND_POLICY, /3 años/);
  assert.match(drop.politicas.LEGAL_NOTICE, /12345678Z/);
  assert.match(drop.politicas.SHIPPING_POLICY, /7-15/);
  assert.match(drop.politicas.SHIPPING_POLICY, /fuera de España/);
  const stock = paginas.plantillas(paginas.validar(datos).datos, { tipo: 'stock' });
  assert.match(stock.politicas.SHIPPING_POLICY, /1-3 días/);
  const raro = paginas.plantillas(paginas.validar({ ...datos, titular: '<script>x</script>' }).datos, {});
  assert.ok(!raro.politicas.LEGAL_NOTICE.includes('<script>'), 'los datos se escapan');
  assert.ok(drop.respuestas.length >= 5);
});

test('poner en Shopify: políticas guardadas, páginas OCULTAS y no pisa las que ya existen', async () => {
  assert.ok(paginas.preparar({ titular: 'Ana Pérez', nif: '12345678Z', direccion: 'Calle Mayor 1', email: 'hola@mitienda.es' }).ok);
  const llamadas = [];
  const graphql = async (q, v) => {
    llamadas.push({ q, v });
    if (/shopPolicyUpdate/.test(q)) return { shopPolicyUpdate: { shopPolicy: { id: 'x', type: v.p.type }, userErrors: [] } };
    if (/pages\(first/.test(q)) return { pages: { nodes: [{ title: 'Contacto' }] } };
    if (/pageCreate/.test(q)) return { pageCreate: { page: { id: 'p', handle: 'h', title: v.page.title }, userErrors: [] } };
    throw new Error('inesperada');
  };
  const r = await paginas.aplicar({ dep: { graphql } });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(llamadas.filter((x) => /shopPolicyUpdate/.test(x.q)).map((x) => x.v.p.type).sort(), ['CONTACT_INFORMATION', 'LEGAL_NOTICE', 'PRIVACY_POLICY', 'REFUND_POLICY', 'SHIPPING_POLICY', 'TERMS_OF_SERVICE']);
  const creadas = llamadas.filter((x) => /pageCreate/.test(x.q)).map((x) => x.v.page);
  assert.deepStrictEqual(creadas.map((p) => p.title), ['Preguntas frecuentes', 'Sobre nosotros'], '«Contacto» ya existía');
  assert.ok(creadas.every((p) => p.isPublished === false));
  assert.ok(investigar.leer().paginas.aplicado);
});

test('qué le falta a la tienda: políticas, páginas, píxel, carritos abandonados, reseñas y chat', async () => {
  const graphql = async (q) => {
    if (/shopPolicies/.test(q)) return { shop: { shopPolicies: [{ type: 'REFUND_POLICY', body: '<p>x</p>' }, { type: 'PRIVACY_POLICY', body: '' }] }, pages: { nodes: [{ title: 'Contacto', isPublished: false }] } };
    if (/abandonedCheckouts/.test(q)) return { abandonedCheckouts: { nodes: [{ totalPriceSet: { shopMoney: { amount: '20.00' } } }, { totalPriceSet: { shopMoney: { amount: '5.50' } } }] } };
    throw new Error('inesperada');
  };
  const r = await paginas.comprobar({ dep: { graphql } });
  assert.ok(r.ok);
  const por = (t) => r.items.find((x) => x.texto.includes(t));
  assert.strictEqual(por('devoluciones').ok, true);
  assert.strictEqual(por('privacidad').ok, false, 'una política vacía cuenta como que falta');
  assert.match(por('Contacto').texto, /oculta/);
  assert.strictEqual(por('Píxel').ok, false);
  assert.match(por('carrito').texto, /2 carrito\(s\).*25\.50 €/);
  assert.ok(por('Reseñas') && por('Chat'));
});

test('resumen del negocio: ventas, pendientes y mercado; el día 1 añade el mes', async () => {
  investigar.escribir({ ...investigar.leer(), productos: { P: { costeEUR: 2, envioEUR: 1 } }, pedidos: { a: { id: 'a', estado: 'por_confirmar', fecha: hace(0) } } });
  const ventas = async () => [{ createdAt: hace(1), totalPriceSet: { shopMoney: { amount: '24.20' } }, lineItems: { nodes: [{ quantity: 1, product: { id: 'P' } }] } }];
  const dep = { ventas, gasto: async () => ({ gasto: 5 }), revision: () => [1, 2], mercado: async () => ({ monedas: [{ simbolo: 'BTC', precio: 95000, cambio24h: 1.25 }], sentimiento: { valor: 60 } }) };
  const r = await manana.resumen({ dep: { ...dep, hoy: new Date('2026-11-15') } });
  assert.ok(r.ok && r.novedad);
  assert.match(r.resumen, /Principal: 7 días 1 pedido/);
  assert.match(r.resumen, /1 pedido\(s\) esperan por ti/);
  assert.match(r.resumen, /2 vídeo\(s\)/);
  assert.match(r.resumen, /BTC/);
  assert.doesNotMatch(r.resumen, /30 días/);
  assert.match((await manana.resumen({ dep: { ...dep, hoy: new Date('2026-12-01') } })).resumen, /Últimos 30 días/);
});

test('campaña con Píxel: de VENTAS, con todas las versiones en el mismo conjunto y TODO en pausa', async () => {
  const visto = [];
  let n = 0;
  const srv = http.createServer((req, res) => {
    const t = [];
    req.on('data', (c) => t.push(c));
    req.on('end', () => {
      const ruta = new URL(req.url, 'http://x').pathname;
      visto.push({ ruta, form: Object.fromEntries(new URLSearchParams(Buffer.concat(t).toString())) });
      n += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(/\/(A|S|C)\d+$/.test(ruta) ? { success: true } : { id: `${ruta.endsWith('/campaigns') ? 'C' : ruta.endsWith('/adsets') ? 'S' : ruta.endsWith('/ads') ? 'A' : 'K'}${n}` }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.JARVIS_GRAPH_BASE = `http://127.0.0.1:${srv.address().port}`;
  try {
    const v = path.join(process.env.JARVIS_DATOS, 'v.mp4');
    fs.writeFileSync(v, 'x');
    claves.guardar({ META_AD_ACCOUNT_ID: '555', META_ADS_TOKEN: 'ADS', META_PAGE_ID: 'P1', META_PIXEL_ID: '999' });
    investigar.escribir({ ...investigar.leer(), anuncio: { video: v, producto: 'Cepillo', titular: 'T', textos: ['a'], portada: 'https://x/f.jpg' }, variantes: [{ video: v, titular: 'V1', textos: ['b'] }, { video: v, titular: 'V2', textos: ['c'] }, { video: '/no/existe.mp4' }] });
    const r = await anuncios.crearCampanaMeta({ presupuestoDiario: 10, dep: { estadoProducto: async () => ({ ok: true, publicado: true, url: 'https://mitienda.myshopify.com/products/c' }), subirVideo: async () => 'VID' } });
    assert.ok(r.ok, r.error);
    const camp = visto.find((x) => x.ruta.endsWith('/campaigns')).form;
    assert.deepStrictEqual([camp.objective, camp.status], ['OUTCOME_SALES', 'PAUSED']);
    const conj = visto.find((x) => x.ruta.endsWith('/adsets')).form;
    assert.strictEqual(conj.optimization_goal, 'OFFSITE_CONVERSIONS');
    assert.deepStrictEqual(JSON.parse(conj.promoted_object), { pixel_id: '999', custom_event_type: 'PURCHASE' });
    const ads = visto.filter((x) => x.ruta.endsWith('/ads'));
    assert.strictEqual(ads.length, 3, 'principal + 2 versiones (la que no existe se salta)');
    assert.ok(ads.every((a) => a.form.status === 'PAUSED' && a.form.adset_id === r.conjunto));
    assert.strictEqual(r.tipo, 'ventas');
    visto.length = 0;
    assert.ok((await anuncios.activarMeta()).ok);
    assert.deepStrictEqual(visto.map((x) => x.ruta.split('/').pop()), [...r.anuncios, r.conjunto, r.campana], 'activa los 3 anuncios, luego conjunto y campaña');
  } finally { srv.close(); delete process.env.JARVIS_GRAPH_BASE; }
});
