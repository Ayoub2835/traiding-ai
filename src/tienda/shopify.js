// Shopify (Admin GraphQL): crea la ficha del producto elegido como BORRADOR,
// con título/descripción en español, fotos del proveedor y precio. Tú la revisas
// y la publicas en tu tienda; Jarvis no la publica solo.
'use strict';
const claves = require('../nucleo/claves');
const { pedir } = require('../nucleo/http');
const registro = require('../seguridad/registro');
const investigar = require('./investigar');

const VERSION = '2026-10';
// Tienda en uso (pestaña TIENDA, o la que recorre una rutina).
const url = () => {
  const { dominio: tienda, token } = require('./tiendas').credenciales();
  if (!tienda || !token) throw new Error('Falta conectar esta tienda de Shopify (TIENDA → ＋ Añadir tienda, o Ajustes → Claves → SHOPIFY_TIENDA y SHOPIFY_TOKEN)');
  return { tienda, token, api: process.env.JARVIS_SHOPIFY_BASE ? `${process.env.JARVIS_SHOPIFY_BASE}/admin/api/${VERSION}/graphql.json` : `https://${tienda}/admin/api/${VERSION}/graphql.json` };
};

async function graphql(query, variables) {
  const { api, token } = url();
  const r = await pedir(api, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token }, body: JSON.stringify({ query, variables }) }, 60);
  if (!r.ok) throw new Error(`Shopify: ${r.error}`);
  if (r.datos?.errors?.length) throw new Error(`Shopify: ${r.datos.errors.map((e) => e.message).join('; ')}`);
  return r.datos.data;
}

/** Comprueba que el token de la tienda en uso funciona (nombre de la tienda). */
async function probarTienda() {
  try { const d = await graphql('{ shop { name myshopifyDomain } }'); return { ok: true, nombre: d.shop?.name, dominio: d.shop?.myshopifyDomain }; } catch (e) { return { ok: false, error: e.message }; }
}

const esc = (t) => String(t || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Textos de la ficha en español (el cerebro, o una plantilla si no hay). */
async function textos(p, pensar) {
  const envio = `Envío a España en ${p.envioDias || '7-15'} días.`;
  const base = {
    titulo: p.nombre.slice(0, 70),
    descripcionHtml: `<p>${esc(p.nombre)}</p><p>${esc(envio)}</p>`,
    etiquetas: [p.categoria, p.busqueda].filter(Boolean),
    seoTitulo: p.nombre.slice(0, 70), seoDescripcion: `${p.nombre}. ${envio}`.slice(0, 160),
  };
  if (!pensar) return base;
  const r = await Promise.resolve(pensar(
    'Eres copywriter de e-commerce en España. Escribe la ficha de producto en español, clara y persuasiva pero HONESTA: usa solo lo que dicen los datos del proveedor; no inventes certificaciones, garantías, materiales, medidas ni beneficios médicos; no uses precios tachados ni falsas urgencias. '
    + 'Responde SOLO JSON: {"titulo":"máx. 70 caracteres","descripcionHtml":"<p>gancho</p><ul><li>beneficio</li>…(4-6)</ul><p>qué incluye / cómo se usa</p>","etiquetas":["5-8"],"seoTitulo":"máx. 70","seoDescripcion":"máx. 160"}',
    `Producto (proveedor, en inglés): ${p.nombre}\nCategoría: ${p.categoria}\nDescripción del proveedor: ${String(p.descripcionProveedor || '').slice(0, 2000)}\nEnvío real: ${envio}`,
    { preferir: 'claude' },
  )).catch(() => null);
  try {
    const g = JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]);
    // Solo etiquetas HTML seguras en la descripción.
    const html = String(g.descripcionHtml || '').replace(/<(?!\/?(p|ul|ol|li|strong|em|br)\b)[^>]*>/gi, '').slice(0, 6000);
    return {
      titulo: String(g.titulo || base.titulo).slice(0, 70),
      descripcionHtml: `${html || base.descripcionHtml}<p>${esc(envio)}</p>`,
      etiquetas: (Array.isArray(g.etiquetas) ? g.etiquetas : base.etiquetas).map(String).slice(0, 10),
      seoTitulo: String(g.seoTitulo || base.seoTitulo).slice(0, 70),
      seoDescripcion: String(g.seoDescripcion || base.seoDescripcion).slice(0, 160),
    };
  } catch (_) { return base; }
}

const PRODUCT_SET = `mutation productSet($synchronous: Boolean!, $productSet: ProductSetInput!) {
  productSet(synchronous: $synchronous, input: $productSet) {
    product { id handle status }
    userErrors { code field message }
  }
}`;

/** Crea el producto elegido en Shopify como borrador. */
async function crearProducto({ pensar } = {}) {
  const estado = investigar.leer();
  const p = estado.elegido;
  if (!p) return { ok: false, error: 'Primero elige un producto' };
  try {
    const { tienda } = url();
    const t = await textos(p, pensar);
    const d = await graphql(PRODUCT_SET, {
      synchronous: true,
      productSet: {
        title: t.titulo, descriptionHtml: t.descripcionHtml, status: 'DRAFT', vendor: claves.obtener('TIENDA_MARCA') || tienda.split('.')[0], tags: t.etiquetas,
        seo: { title: t.seoTitulo, description: t.seoDescripcion },
        productOptions: [{ name: 'Title', position: 1, values: [{ name: 'Default Title' }] }],
        // En dropshipping el stock lo tiene el proveedor: se sigue vendiendo sin stock propio.
        variants: [{ optionValues: [{ optionName: 'Title', name: 'Default Title' }], price: p.precioVenta, inventoryPolicy: 'CONTINUE' }],
        files: (p.imagenes || [p.imagen]).filter(Boolean).slice(0, 8).map((src, i) => ({ originalSource: src, contentType: 'IMAGE', alt: `${t.titulo} ${i + 1}` })),
      },
    });
    const res = d.productSet;
    if (res.userErrors?.length) return { ok: false, error: `Shopify: ${res.userErrors.map((e) => e.message).join('; ')}` };
    const id = res.product.id;
    const shopify = { id, handle: res.product.handle, titulo: t.titulo, adminUrl: `https://${tienda}/admin/products/${id.split('/').pop()}`, tiendaUrl: `https://${tienda}/products/${res.product.handle}` };
    // Relación producto de Shopify → variante de CJ (la usan los pedidos automáticos).
    const productos = { ...(estado.productos || {}), [id]: { pid: p.pid, vid: p.vid, nombre: t.titulo, costeEUR: p.costeEUR, envioEUR: p.envioEUR } };
    investigar.escribir({ ...estado, shopify, productos });
    registro.anotar({ origen: 'tienda', accion: `crear producto en Shopify «${t.titulo}» (borrador)`, decision: 'hecho', detalle: shopify.adminUrl });
    return { ok: true, ...shopify };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Tienda SIN dropshipping: tu propio producto (lo envías tú). Queda como el
 * producto elegido (para hacer su anuncio) y se crea en Shopify como borrador.
 */
async function crearPropio({ nombre, precio, coste = 0, descripcion = '', imagenes = [], envioDias = '1-3', pensar } = {}) {
  const n = String(nombre || '').trim().slice(0, 120);
  const pr = Number(String(precio).replace(',', '.'));
  if (!n) return { ok: false, error: 'Escribe el nombre del producto' };
  if (!(pr > 0 && pr < 100000)) return { ok: false, error: 'Escribe un precio válido (en euros)' };
  const fotos = (Array.isArray(imagenes) ? imagenes : String(imagenes).split(/\s+/)).map((u) => String(u).trim()).filter((u) => /^https:\/\/\S+$/.test(u)).slice(0, 8);
  const estado = investigar.leer();
  const elegido = { pid: `propio-${Date.now()}`, vid: null, propio: true, nombre: n, imagenes: fotos, imagen: fotos[0] || '', descripcionProveedor: String(descripcion).slice(0, 3000), categoria: '', busqueda: '', precioVenta: +pr.toFixed(2), costeEUR: Math.max(0, Number(String(coste).replace(',', '.')) || 0), envioEUR: 0, envioDias: String(envioDias).slice(0, 10) };
  investigar.escribir({ ...estado, elegido, shopify: null, anuncio: null, meta: null, variantes: null, ugc: null });
  return crearProducto({ pensar });
}

/** ¿Está publicado en la tienda online? Devuelve la URL pública si lo está. */
async function estadoProducto() {
  const s = investigar.leer().shopify;
  if (!s) return { ok: false, error: 'Aún no has creado el producto en Shopify' };
  const d = await graphql('query($id: ID!) { product(id: $id) { status handle onlineStoreUrl } }', { id: s.id });
  const p = d.product;
  if (!p) return { ok: false, error: 'El producto ya no existe en Shopify' };
  return { ok: true, estado: p.status, publicado: p.status === 'ACTIVE' && Boolean(p.onlineStoreUrl), url: p.onlineStoreUrl || s.tiendaUrl };
}

module.exports = { crearProducto, crearPropio, estadoProducto, textos, graphql, probarTienda, VERSION };
