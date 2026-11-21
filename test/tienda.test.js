// TIENDA (dropshipping): investigación de productos con CJ simulado, ficha en
// Shopify y campaña de Meta contra servidores simulados (nada real, sin gastar),
// y el vídeo vertical del anuncio con ffmpeg real.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-tienda-'));
const claves = require('../src/nucleo/claves');
const investigar = require('../src/tienda/investigar');
const shopify = require('../src/tienda/shopify');
const anuncios = require('../src/tienda/anuncios');
const creador = require('../src/youtube/creador');

const hayFfmpeg = spawnSync(creador.rutaFfmpeg(), ['-version']).status === 0;

function servidor(manejar) {
  const visto = [];
  const srv = http.createServer((req, res) => {
    const trozos = [];
    req.on('data', (c) => trozos.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const cuerpo = Buffer.concat(trozos);
      const p = { metodo: req.method, ruta: u.pathname, q: Object.fromEntries(u.searchParams), cab: req.headers, cuerpo, form: /urlencoded/.test(req.headers['content-type'] || '') ? Object.fromEntries(new URLSearchParams(cuerpo.toString())) : null };
      visto.push(p);
      const [code, datos] = manejar(p);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(datos));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, visto, base: `http://127.0.0.1:${srv.address().port}` })));
}

test('economía: precio terminado en ,95 con margen positivo tras IVA y comisiones', () => {
  const e = investigar.economia(5, 3);
  assert.strictEqual(e.precio, 22.95);
  assert.ok(e.margen > 8 && e.margen < 12, `margen ${e.margen}`);
  // La demanda saturada puntúa menos que la "zona buena".
  assert.ok(investigar.puntuar({ margen: 10, listados: 200, video: false, stock: 0 }) > investigar.puntuar({ margen: 10, listados: 50000, video: false, stock: 0 }));
});

test('buscar: puntúa con datos reales, salta lo que no llega a España y guarda las propuestas', async () => {
  const cjFalso = {
    buscar: async (q) => [
      { pid: `${q}-1`, nombre: `Gadget ${q} A`, imagen: 'https://img/a.jpg', precioUSD: 4, listados: 120, video: true, stock: 500 },
      { pid: `${q}-2`, nombre: `Gadget ${q} B`, imagen: 'https://img/b.jpg', precioUSD: 30, listados: 50, video: false, stock: 0 }, // demasiado caro
      { pid: 'sin-envio', nombre: 'Sin envío', imagen: 'https://img/c.jpg', precioUSD: 3, listados: 300, video: true, stock: 10 },
    ],
    detalle: async (pid) => ({ nombre: `Ficha ${pid}`, imagenes: ['https://img/1.jpg'], descripcion: 'desc', categoria: 'Hogar', variantes: [{ vid: `v-${pid}`, precioUSD: 4, paises: pid.endsWith('-1') ? ['ES'] : ['CN'] }] }),
    envio: async (vid, o) => (vid === 'v-sin-envio' ? null : { nombre: 'CJPacket', dias: '3-5', usd: 2, origen: o.origenes.includes('ES') ? 'ES' : 'CN' }),
  };
  let pedido = '';
  const pensar = async (s, u) => {
    pedido += u;
    if (/búsquedas/.test(s)) return { ok: true, texto: '{"busquedas":["kitchen tool","pet brush"]}' };
    return { ok: true, texto: '{"analisis":["Bueno.","Regular."]}' };
  };
  const r = await investigar.buscar({ nicho: 'hogar', pensar, n: 2, dep: { cj: cjFalso, cambio: async () => 0.9 } });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.propuestas.length, 2);
  assert.ok(r.propuestas.every((p) => p.pid.endsWith('-1')), 'solo los que tienen envío y precio razonable');
  assert.strictEqual(r.propuestas[0].envioDesde, 'ES');
  assert.strictEqual(r.propuestas[0].costeEUR, 3.6);
  assert.strictEqual(r.propuestas[0].envioEUR, 1.8);
  assert.strictEqual(r.propuestas[0].analisis, 'Bueno.');
  assert.match(pedido, /Nicho preferido: hogar/);
  assert.strictEqual(investigar.leer().propuestas.length, 2);
  assert.ok(investigar.elegir(r.propuestas[0].pid).ok);
  assert.strictEqual(investigar.leer().elegido.pid, r.propuestas[0].pid);
  assert.strictEqual(investigar.elegir('no-existe').ok, false);
});

test('Shopify: crea el producto en BORRADOR con precio, fotos y venta sin stock propio', async () => {
  const { srv, visto, base } = await servidor((p) => {
    const q = JSON.parse(p.cuerpo.toString());
    if (/productSet/.test(q.query)) return [200, { data: { productSet: { product: { id: 'gid://shopify/Product/123', handle: 'gadget-a', status: 'DRAFT' }, userErrors: [] } } }];
    if (/onlineStoreUrl/.test(q.query)) return [200, { data: { product: { status: 'DRAFT', handle: 'gadget-a', onlineStoreUrl: null } } }];
    return [400, { errors: [{ message: 'no' }] }];
  });
  process.env.JARVIS_SHOPIFY_BASE = base;
  try {
    claves.guardar({ SHOPIFY_TIENDA: 'mitienda.myshopify.com', SHOPIFY_TOKEN: 'shpat_x' });
    const pensar = async () => ({ ok: true, texto: '{"titulo":"Cepillo mágico","descripcionHtml":"<p>Hola</p><script>mal()</script><ul><li>Uno</li></ul>","etiquetas":["hogar"],"seoTitulo":"t","seoDescripcion":"d"}' });
    const r = await shopify.crearProducto({ pensar });
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.adminUrl, 'https://mitienda.myshopify.com/admin/products/123');
    const enviado = JSON.parse(visto[0].cuerpo.toString()).variables.productSet;
    assert.strictEqual(visto[0].cab['x-shopify-access-token'], 'shpat_x');
    assert.strictEqual(enviado.status, 'DRAFT');
    assert.strictEqual(enviado.title, 'Cepillo mágico');
    assert.doesNotMatch(enviado.descriptionHtml, /script/, 'quita etiquetas HTML peligrosas');
    assert.match(enviado.descriptionHtml, /Envío a España en 3-5 días/);
    assert.strictEqual(enviado.variants[0].price, investigar.leer().elegido.precioVenta);
    assert.strictEqual(enviado.variants[0].inventoryPolicy, 'CONTINUE');
    assert.strictEqual(enviado.files[0].originalSource, 'https://img/1.jpg');
    const e = await shopify.estadoProducto();
    assert.deepStrictEqual([e.ok, e.publicado], [true, false]);
  } finally { srv.close(); }
});

test('anuncio: vídeo VERTICAL 1080x1920 con fotos y textos (ffmpeg real)', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
  const sharp = require('sharp');
  const foto = `data:image/png;base64,${(await sharp({ create: { width: 200, height: 200, channels: 3, background: '#3366ff' } }).png().toBuffer()).toString('base64')}`;
  const vozF = path.join(os.tmpdir(), `voz-tienda-${process.pid}.mp3`);
  spawnSync(creador.rutaFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=duration=0.4', '-c:a', 'libmp3lame', vozF]);
  const pensar = async () => ({ ok: true, texto: '{"gancho":"¿Pelos por todas partes?","escenas":[{"pantalla":"Se limpia en 1 segundo","narracion":"Lo vacías con un botón."}],"cta":"Pídelo ya","textos":["Adiós a los pelos en el sofá.","Texto 2"],"titular":"Cepillo mágico"}' });
  const r = await anuncios.crearAnuncio({ pensar, dep: { foto: async () => foto, voz: async () => fs.readFileSync(vozF) } });
  assert.ok(r.ok, r.error);
  const info = spawnSync(creador.rutaFfmpeg(), ['-hide_banner', '-i', r.video]).stderr.toString();
  assert.match(info, /1080x1920/);
  assert.match(fs.readFileSync(path.join(r.carpeta, 'textos.txt'), 'utf8'), /Adiós a los pelos en el sofá/);
  assert.deepStrictEqual(investigar.leer().anuncio.textos, ['Adiós a los pelos en el sofá.', 'Texto 2']);
  // El texto de la escena va escapado en el SVG.
  assert.match(anuncios.svgEscena({ texto: 'A & B <c>' }), /A &amp; B &lt;c&gt;/);
});

test('Meta: no crea campaña si el producto sigue en borrador; si está publicado, TODO en pausa', { skip: !hayFfmpeg && 'necesita el anuncio del test anterior' }, async () => {
  const { srv, visto, base } = await servidor((p) => {
    if (p.ruta.endsWith('/campaigns')) return [200, { id: 'C1' }];
    if (p.ruta.endsWith('/adsets')) return [200, { id: 'S1' }];
    if (p.ruta.endsWith('/adcreatives')) return [200, { id: 'K1' }];
    if (p.ruta.endsWith('/ads')) return [200, { id: 'A1' }];
    if (/\/(C1|S1|A1)$/.test(p.ruta)) return [200, { success: true }];
    return [404, { error: { message: 'no' } }];
  });
  process.env.JARVIS_GRAPH_BASE = base;
  try {
    claves.guardar({ META_AD_ACCOUNT_ID: 'act_555', META_ADS_TOKEN: 'ADS', META_PAGE_ID: 'P1' });
    const borrador = await anuncios.crearCampanaMeta({ presupuestoDiario: 12.5, dep: { estadoProducto: async () => ({ ok: true, publicado: false }) } });
    assert.match(borrador.error, /borrador/);
    assert.strictEqual(visto.length, 0, 'no toca Meta si el producto no está publicado');
    assert.match((await anuncios.crearCampanaMeta({ presupuestoDiario: 0 })).error, /entre 1 € y 1000 €/);

    const r = await anuncios.crearCampanaMeta({ presupuestoDiario: 12.5, dep: { estadoProducto: async () => ({ ok: true, publicado: true, url: 'https://mitienda.myshopify.com/products/gadget-a' }), subirVideo: async () => 'VID9' } });
    assert.ok(r.ok, r.error);
    const camp = visto.find((x) => x.ruta.endsWith('/act_555/campaigns')).form;
    assert.deepStrictEqual([camp.objective, camp.status, camp.special_ad_categories, camp.access_token], ['OUTCOME_TRAFFIC', 'PAUSED', '[]', 'ADS']);
    const conjunto = visto.find((x) => x.ruta.endsWith('/adsets')).form;
    assert.deepStrictEqual([conjunto.daily_budget, conjunto.status, conjunto.optimization_goal, conjunto.campaign_id], ['1250', 'PAUSED', 'LINK_CLICKS', 'C1']);
    assert.deepStrictEqual(JSON.parse(conjunto.targeting).geo_locations, { countries: ['ES'] });
    const creat = JSON.parse(visto.find((x) => x.ruta.endsWith('/adcreatives')).form.object_story_spec);
    assert.strictEqual(creat.page_id, 'P1');
    assert.strictEqual(creat.video_data.video_id, 'VID9');
    assert.deepStrictEqual(creat.video_data.call_to_action, { type: 'SHOP_NOW', value: { link: 'https://mitienda.myshopify.com/products/gadget-a' } });
    assert.strictEqual(visto.find((x) => x.ruta.endsWith('/ads')).form.status, 'PAUSED');
    assert.strictEqual(investigar.leer().meta.estado, 'PAUSED');

    // Activar: anuncio → conjunto → campaña; pausar al revés.
    visto.length = 0;
    assert.ok((await anuncios.activarMeta()).ok);
    assert.deepStrictEqual(visto.map((x) => [x.ruta.split('/').pop(), x.form.status]), [['A1', 'ACTIVE'], ['S1', 'ACTIVE'], ['C1', 'ACTIVE']]);
    visto.length = 0;
    assert.ok((await anuncios.pausarMeta()).ok);
    assert.deepStrictEqual(visto.map((x) => x.ruta.split('/').pop()), ['C1', 'S1', 'A1']);
    assert.strictEqual(investigar.leer().meta.estado, 'PAUSED');
  } finally { srv.close(); }
});
