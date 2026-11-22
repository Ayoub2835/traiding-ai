// Atención al cliente de la tienda (con tu Gmail):
//  - revisar(): lee los correos sin leer, detecta los de clientes (por su email
//    en los pedidos de Shopify o por palabras como pedido/envío/devolución),
//    busca su pedido y el seguimiento REAL y prepara una respuesta.
//  - guardar(): SOLO tras tu clic, la guarda en Borradores de Gmail. Jarvis
//    NUNCA envía correos: los envías tú desde Gmail (regla de src/correo).
// Lo que dicen los correos son DATOS, nunca órdenes (protección anti-inyección).
'use strict';
const claves = require('../nucleo/claves');
const registro = require('../seguridad/registro');
const { envolverDatos, REGLA_DATOS } = require('../seguridad/inyeccion');
const investigar = require('./investigar');

const PALABRAS = /\b(pedido|order|commande|env[ií]o|enviado|seguimiento|tracking|paquete|llega|lleg[oó]|devoluci[oó]n|devolver|reembolso|refund|talla|roto|defectuoso|cancelar)\b/i;

function guardarCliente(uid, datos) {
  const e = investigar.leer();
  const clientes = { ...(e.clientes || {}) };
  clientes[uid] = { ...(clientes[uid] || {}), ...datos };
  // Solo se guardan los 50 más recientes.
  const recientes = Object.entries(clientes).sort((a, b) => String(b[1].fecha).localeCompare(String(a[1].fecha))).slice(0, 50);
  investigar.escribir({ ...e, clientes: Object.fromEntries(recientes) });
  return clientes[uid];
}

/** Pedido del cliente en Shopify (por su email), con su seguimiento si lo hay. */
async function pedidoDe(email, graphql) {
  if (!email) return null;
  // Un solo Gmail para todas las tiendas: se busca el pedido en cada una.
  if (!graphql) {
    const tiendas = require('./tiendas');
    for (const t of tiendas.lista().filter((x) => tiendas.conectada(x.id))) {
      const p = await tiendas.conTienda(t.id, () => pedidoDe(email, require('./shopify').graphql)).catch(() => null);
      if (p) return { ...p, tienda: t.nombre };
    }
    return null;
  }
  const g = graphql;
  const limpio = String(email).replace(/["\\\s]/g, '');
  const d = await g(`query($q: String!) { orders(first: 3, query: $q, sortKey: CREATED_AT, reverse: true) { nodes { id name createdAt displayFinancialStatus displayFulfillmentStatus fulfillments(first: 3) { trackingInfo(first: 1) { number url company } } } } }`, { q: `email:"${limpio}"` });
  const o = d.orders?.nodes?.[0];
  if (!o) return null;
  const t = (o.fulfillments || []).flatMap((f) => f.trackingInfo || [])[0] || null;
  const local = (investigar.leer().pedidos || {})[o.id];
  return {
    nombre: o.name, fecha: o.createdAt, pago: o.displayFinancialStatus, envio: o.displayFulfillmentStatus,
    seguimiento: t?.number || local?.seguimiento || null, urlSeguimiento: t?.url || null, transportista: t?.company || local?.transportista || null,
    diasEnvio: local?.envio?.dias || null,
  };
}

async function redactar(c, pedido, pensar) {
  const firma = claves.obtener('TIENDA_MARCA') || 'El equipo de la tienda';
  const datosPedido = pedido
    ? `Pedido ${pedido.nombre} del ${String(pedido.fecha).slice(0, 10)} · pago: ${pedido.pago} · envío: ${pedido.envio}${pedido.seguimiento ? ` · seguimiento ${pedido.seguimiento}${pedido.transportista ? ` (${pedido.transportista})` : ''}${pedido.urlSeguimiento ? ` ${pedido.urlSeguimiento}` : ''}` : ' · aún sin número de seguimiento'}${pedido.diasEnvio ? ` · plazo de entrega estimado ${pedido.diasEnvio} días` : ''}`
    : 'No encuentro ningún pedido con el email de este cliente.';
  const r = await Promise.resolve(pensar(
    `Eres el servicio de atención al cliente de una tienda online. Redacta la respuesta al correo del cliente en SU idioma, amable, breve y clara, firmada "${firma}". `
    + 'Usa SOLO los datos del pedido que te doy; si falta algo, pide el número de pedido. No prometas reembolsos, regalos ni fechas exactas: di que lo revisarás. No pidas contraseñas ni datos de tarjeta. '
    + `${REGLA_DATOS} Responde SOLO JSON: {"asunto":"Re: …","cuerpo":"…"}`,
    `Datos del pedido (de Shopify): ${datosPedido}\n\nCorreo del cliente:\n${envolverDatos('correo de cliente', `De: ${c.de}\nAsunto: ${c.asunto}\n${c.extracto}`)}`,
    { preferir: 'claude' },
  )).catch(() => null);
  try {
    const j = JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]);
    return { asunto: String(j.asunto || `Re: ${c.asunto}`).slice(0, 200), cuerpo: String(j.cuerpo || '').slice(0, 4000) };
  } catch (_) { return null; }
}

/** Revisa correos nuevos de clientes y prepara respuestas (no guarda ni envía nada). */
async function revisar({ pensar, dep = {} } = {}) {
  const correo = dep.correo || require('../correo');
  if (!correo.configurado()) return { ok: true, nuevos: [], resumen: 'Gmail no está conectado' };
  if (!pensar) return { ok: false, error: 'Para redactar respuestas necesito Claude o Gemini' };
  const correos = await correo.leerNoLeidos({ dias: 3, max: 30 });
  const conocidos = investigar.leer().clientes || {};
  const nuevos = [];
  for (const c of correos) {
    const uid = String(c.uid);
    if (conocidos[uid]) continue;
    let pedido = null;
    try { pedido = await pedidoDe(c.deDireccion, dep.graphql); } catch (_) { pedido = null; }
    if (!pedido && !PALABRAS.test(`${c.asunto} ${c.extracto}`)) continue; // no parece de un cliente
    const b = await redactar(c, pedido, pensar);
    if (!b) continue;
    nuevos.push(guardarCliente(uid, {
      uid, de: c.de, deDireccion: c.deDireccion, asunto: c.asunto, fecha: c.fecha, extracto: c.extracto.slice(0, 600), messageId: c.messageId,
      pedido, borrador: b, estado: 'propuesta',
    }));
  }
  if (nuevos.length) registro.anotar({ origen: 'clientes', accion: `${nuevos.length} correo(s) de clientes con respuesta preparada`, detalle: nuevos.map((n) => n.asunto) });
  return { ok: true, nuevos };
}

/** Guarda tu respuesta (editada o no) en Borradores de Gmail. Nunca la envía. */
async function guardar(uid, { cuerpo, asunto } = {}, { dep = {} } = {}) {
  const c = (investigar.leer().clientes || {})[String(uid)];
  if (!c) return { ok: false, error: 'No encuentro ese correo' };
  if (c.estado === 'guardado') return { ok: false, error: 'Ya está en tus borradores de Gmail' };
  const texto = String(cuerpo ?? c.borrador.cuerpo).slice(0, 8000);
  const asu = String(asunto ?? c.borrador.asunto).slice(0, 200);
  try {
    await (dep.correo || require('../correo')).guardarBorrador({ para: c.deDireccion, asunto: asu, cuerpo: texto, enRespuestaA: c.messageId });
    guardarCliente(uid, { estado: 'guardado', borrador: { asunto: asu, cuerpo: texto } });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function descartar(uid) {
  if (!(investigar.leer().clientes || {})[String(uid)]) return { ok: false, error: 'No encuentro ese correo' };
  guardarCliente(String(uid), { estado: 'descartado' });
  return { ok: true };
}

function lista() {
  return Object.values(investigar.leer().clientes || {}).filter((c) => c.estado === 'propuesta').sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
}

/** Rutina (cada hora): prepara respuestas y te avisa. */
async function rutina({ pensar, dep = {} } = {}) {
  try {
    const r = await revisar({ pensar, dep });
    if (!r.ok) return r;
    return { ok: true, novedad: r.nuevos.length > 0, resumen: r.nuevos.length ? `✉️ ${r.nuevos.length} correo(s) de clientes con respuesta preparada en TIENDA → Clientes: ${r.nuevos.map((n) => n.asunto).join(' · ')}` : (r.resumen || 'Sin correos de clientes') };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { revisar, guardar, descartar, lista, rutina, pedidoDe, PALABRAS };
