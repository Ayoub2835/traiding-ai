// Tienda completa: políticas legales (España/UE), páginas de Contacto, Preguntas
// frecuentes y Sobre nosotros, y respuestas rápidas para el chat de la tienda.
//  1. preparar: escribe los textos con TUS datos (titular, NIF, dirección, email)
//     y el tipo de tienda (dropshipping o stock propio). Los ves antes.
//  2. aplicar: los pone en Shopify. Las páginas quedan OCULTAS (las publicas tú);
//     las políticas se ven en tu tienda en cuanto se guardan (por eso pregunta antes).
// Las políticas son plantillas orientativas según la ley española de consumidores
// (desistimiento de 14 días, garantía legal de 3 años) y el RGPD: revísalas, mejor
// con un profesional. Jarvis no es abogado.
// Comprobar: lista de lo que le falta a la tienda para vender (con datos reales).
'use strict';
const registro = require('../seguridad/registro');
const investigar = require('./investigar');

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const html = (parrafos) => parrafos.map((p) => (p.startsWith('## ') ? `<h3>${esc(p.slice(3))}</h3>` : `<p>${esc(p)}</p>`)).join('\n');

function validar(d = {}) {
  const x = {
    titular: String(d.titular || '').trim().slice(0, 120), nif: String(d.nif || '').trim().toUpperCase().slice(0, 20),
    direccion: String(d.direccion || '').trim().slice(0, 200), email: String(d.email || '').trim().slice(0, 120),
    telefono: String(d.telefono || '').trim().slice(0, 30), marca: String(d.marca || '').trim().slice(0, 60),
  };
  if (!x.titular) return { error: 'Escribe el titular de la tienda (tu nombre o el de tu empresa)' };
  if (!/^[A-Z0-9]{8,12}$/.test(x.nif.replace(/[-\s.]/g, ''))) return { error: 'Escribe un NIF/NIE/CIF válido (la ley obliga a ponerlo en el aviso legal)' };
  if (!x.direccion) return { error: 'Escribe la dirección (la ley obliga a ponerla en el aviso legal)' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x.email)) return { error: 'Escribe un email de contacto válido' };
  return { datos: x };
}

/** Textos según la tienda (sin cerebro: plantillas revisables). */
function plantillas(d, { tipo = 'dropshipping', envioDias = '' } = {}) {
  const marca = d.marca || d.titular;
  const dias = envioDias || (tipo === 'stock' ? '1-3' : '7-15');
  const desde = tipo === 'stock' ? 'desde España' : 'desde los almacenes de nuestros proveedores (algunos fuera de España)';
  const contacto = `${d.email}${d.telefono ? ` · ${d.telefono}` : ''}`;
  const politicas = {
    LEGAL_NOTICE: html([
      `En cumplimiento de la Ley 34/2002 (LSSI-CE), te informamos de que esta tienda online pertenece a: ${d.titular}, con NIF ${d.nif} y domicilio en ${d.direccion}. Contacto: ${contacto}.`,
      'El uso de esta web implica la aceptación de estas condiciones. Los contenidos son de su titular o se usan con permiso.',
    ]),
    REFUND_POLICY: html([
      '## Derecho de desistimiento (14 días)',
      'Puedes devolver tu pedido sin dar ninguna explicación en un plazo de 14 días naturales desde que lo recibes. Para hacerlo, escríbenos a ' + d.email + ' con tu número de pedido.',
      'Te devolveremos todo lo pagado, incluido el envío estándar, en un máximo de 14 días desde que nos comuniques el desistimiento, por el mismo medio de pago. Podemos esperar a recibir el producto (o la prueba de que lo has enviado) antes de reembolsar.',
      'El coste de enviarnos el producto de vuelta corre a tu cargo, salvo que el producto llegue defectuoso o no sea el que pediste. Te indicaremos la dirección de devolución al escribirnos.',
      'No se pueden devolver productos precintados que se hayan desprecintado por motivos de higiene o salud, ni productos personalizados.',
      '## Garantía legal (3 años)',
      'Todos los productos tienen la garantía legal de 3 años desde la entrega. Si un producto es defectuoso, escríbenos y lo reparamos, sustituimos o reembolsamos sin coste para ti.',
    ]),
    SHIPPING_POLICY: html([
      `Enviamos a toda España peninsular y Baleares. Los pedidos se envían ${desde}.`,
      `Plazo de entrega habitual: ${dias} días laborables desde la confirmación del pedido. Cuando se envía, recibes un email con el número de seguimiento.`,
      'El coste del envío se muestra antes de pagar. Los precios incluyen IVA.',
      `Si tu pedido se retrasa o llega dañado, escríbenos a ${d.email} y lo solucionamos.`,
    ]),
    PRIVACY_POLICY: html([
      `Responsable del tratamiento: ${d.titular} (NIF ${d.nif}), ${d.direccion}. Contacto: ${d.email}.`,
      'Finalidad: gestionar tu pedido, el envío, la atención al cliente y, si lo aceptas, enviarte novedades. Base legal: el contrato de compra y tu consentimiento.',
      'Destinatarios: la plataforma de la tienda (Shopify), la pasarela de pago, la empresa de transporte' + (tipo === 'stock' ? '' : ' y el proveedor que prepara el envío') + ', solo con los datos necesarios. Algunos de ellos pueden estar fuera de la UE con las garantías que exige el RGPD.',
      'Conservación: el tiempo necesario para el pedido y los plazos que exige la ley (fiscales y de garantía).',
      `Derechos: puedes pedir acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${d.email}. Si no te atendemos bien, puedes reclamar ante la Agencia Española de Protección de Datos (aepd.es).`,
    ]),
    TERMS_OF_SERVICE: html([
      `Estas condiciones regulan las compras en la tienda online de ${marca}, cuyo titular es ${d.titular} (NIF ${d.nif}).`,
      'Al hacer un pedido recibes un email de confirmación. El contrato se formaliza en español. Los precios incluyen IVA; el envío se indica antes de pagar.',
      'Devoluciones y garantía: según nuestra política de devoluciones (14 días de desistimiento y 3 años de garantía legal).',
      'Resolución de conflictos: puedes contactarnos en ' + d.email + '. También puedes usar la plataforma europea de resolución de litigios en línea: https://ec.europa.eu/consumers/odr. Ley aplicable: la española.',
    ]),
    CONTACT_INFORMATION: html([`${d.titular} · NIF ${d.nif} · ${d.direccion} · ${contacto}`]),
  };
  const preguntas = [
    ['¿Cuánto tarda en llegar mi pedido?', `Normalmente ${dias} días laborables. Cuando se envía te llega un email con el seguimiento.`],
    ['¿Cómo sigo mi pedido?', 'Con el enlace de seguimiento del email de envío. Si no lo encuentras, escríbenos con tu número de pedido.'],
    ['¿Puedo devolverlo?', `Sí, tienes 14 días desde que lo recibes. Escríbenos a ${d.email} con tu número de pedido.`],
    ['¿Tiene garantía?', 'Sí, la garantía legal de 3 años. Si llega con un defecto, lo solucionamos sin coste.'],
    ['¿Qué formas de pago aceptáis?', 'Las que ves al pagar (tarjeta y las demás que muestra la tienda). El pago es seguro.'],
    ['¿Enviáis a Canarias, Ceuta o Melilla?', 'Escríbenos antes de comprar y te decimos si es posible y el coste.'],
    ['¿Cómo os contacto?', `En ${contacto}. Respondemos en 24-48 h laborables.`],
  ];
  const paginas = [
    { title: 'Contacto', body: html([`¿Tienes alguna duda? Escríbenos a ${d.email}${d.telefono ? ` o llámanos al ${d.telefono}` : ''}. Respondemos en 24-48 h laborables.`, `${d.titular} · ${d.direccion}`]) },
    { title: 'Preguntas frecuentes', body: preguntas.map(([p, r]) => `<h3>${esc(p)}</h3><p>${esc(r)}</p>`).join('\n') },
    { title: 'Sobre nosotros', body: html([`En ${marca} buscamos productos prácticos que hacen el día a día más fácil, a buen precio y con atención cercana en español.`, `Si tienes cualquier duda, escríbenos a ${d.email}.`]) },
  ];
  return { politicas, paginas, respuestas: preguntas.map(([pregunta, respuesta]) => ({ pregunta, respuesta })) };
}

/** Prepara los textos (los guarda para que los revises). */
function preparar(datos) {
  const v = validar(datos);
  if (v.error) return { ok: false, error: v.error };
  const t = require('./tiendas').actual();
  const e = investigar.leer();
  const textos = plantillas(v.datos, { tipo: t?.tipo, envioDias: e.elegido?.envioDias });
  investigar.escribir({ ...e, datosLegales: v.datos, paginas: { ...textos, preparado: new Date().toISOString(), aplicado: null } });
  return { ok: true, ...textos };
}

const POLICY = 'mutation($p: ShopPolicyInput!) { shopPolicyUpdate(shopPolicy: $p) { shopPolicy { id type } userErrors { field message } } }';
const PAGE = 'mutation($page: PageCreateInput!) { pageCreate(page: $page) { page { id handle title } userErrors { field message } } }';

/** Pone los textos en Shopify (llamar solo tras confirmar). Páginas ocultas. */
async function aplicar({ dep = {} } = {}) {
  const e = investigar.leer();
  if (!e.paginas?.politicas) return { ok: false, error: 'Primero prepara los textos' };
  const g = dep.graphql || require('./shopify').graphql;
  const hechas = [];
  const fallos = [];
  for (const [type, body] of Object.entries(e.paginas.politicas)) {
    try {
      const r = await g(POLICY, { p: { type, body } });
      const err = r.shopPolicyUpdate?.userErrors || [];
      if (err.length) fallos.push(`${type}: ${err.map((x) => x.message).join('; ')}`); else hechas.push(type);
    } catch (x) { fallos.push(`${type}: ${x.message}`); }
  }
  let existentes = [];
  try { existentes = ((await g('{ pages(first: 100) { nodes { title } } }')).pages?.nodes || []).map((p) => p.title.toLowerCase()); } catch (_) { /* sin lista */ }
  for (const p of e.paginas.paginas) {
    if (existentes.includes(p.title.toLowerCase())) { hechas.push(`${p.title} (ya existía, no la toco)`); continue; }
    try {
      const r = await g(PAGE, { page: { title: p.title, body: p.body, isPublished: false } });
      const err = r.pageCreate?.userErrors || [];
      if (err.length) fallos.push(`${p.title}: ${err.map((x) => x.message).join('; ')}`); else hechas.push(`${p.title} (oculta)`);
    } catch (x) { fallos.push(`${p.title}: ${x.message}`); }
  }
  investigar.escribir({ ...investigar.leer(), paginas: { ...e.paginas, aplicado: new Date().toISOString() } });
  registro.anotar({ origen: 'tienda', accion: 'poner políticas y páginas en Shopify', decision: fallos.length ? 'parcial' : 'hecho', detalle: { hechas, fallos } });
  const permisos = fallos.some((f) => /access|scope|permission|denied/i.test(f)) ? ' Faltan permisos en la app de Shopify: añade write_legal_policies y write_content (o write_online_store_pages) y vuelve a instalarla.' : '';
  return { ok: hechas.length > 0, hechas, fallos, error: hechas.length ? undefined : `No se pudo poner nada: ${fallos[0] || ''}${permisos}`, aviso: fallos.length ? `${fallos.length} cosa(s) no se pudieron poner.${permisos}` : '' };
}

/** Lo que le falta a la tienda para vender, con datos reales de Shopify. */
async function comprobar({ dep = {} } = {}) {
  const g = dep.graphql || require('./shopify').graphql;
  const claves = require('../nucleo/claves');
  const e = investigar.leer();
  const items = [];
  const add = (ok, texto, ayuda = '') => items.push({ ok: Boolean(ok), texto, ayuda });
  let politicas = [];
  let paginas = [];
  try {
    const d = await g('{ shop { shopPolicies { type body } } pages(first: 100) { nodes { title isPublished } } }');
    politicas = (d.shop?.shopPolicies || []).filter((p) => String(p.body || '').trim()).map((p) => p.type);
    paginas = d.pages?.nodes || [];
  } catch (x) { return { ok: false, error: x.message }; }
  for (const [t, n] of [['REFUND_POLICY', 'Política de devoluciones'], ['PRIVACY_POLICY', 'Política de privacidad'], ['TERMS_OF_SERVICE', 'Términos del servicio'], ['SHIPPING_POLICY', 'Política de envíos'], ['LEGAL_NOTICE', 'Aviso legal']]) {
    add(politicas.includes(t), n, 'TIENDA → Tienda completa → Preparar textos legales');
  }
  for (const n of ['Contacto', 'Preguntas frecuentes']) {
    const p = paginas.find((x) => x.title.toLowerCase() === n.toLowerCase());
    add(p?.isPublished, `Página «${n}»${p && !p.isPublished ? ' (creada pero oculta: publícala en Shopify → Tienda online → Páginas)' : ''}`, 'TIENDA → Tienda completa');
  }
  add(/^\d+$/.test(String(claves.obtener('META_PIXEL_ID') || '')), 'Píxel de Meta (para campañas de VENTAS)', 'Shopify → Apps → Facebook & Instagram (conecta tu píxel) y copia su número en Ajustes → Claves → META_PIXEL_ID');
  // Carritos abandonados de los últimos 7 días (dinero que se escapa).
  try {
    const desde = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const d = await g('query($q: String!) { abandonedCheckouts(first: 100, query: $q) { nodes { totalPriceSet { shopMoney { amount } } } } }', { q: `created_at:>=${desde}` });
    const n = d.abandonedCheckouts?.nodes || [];
    const total = n.reduce((s, x) => s + (Number(x.totalPriceSet?.shopMoney?.amount) || 0), 0);
    items.push({ ok: null, texto: `${n.length} carrito(s) abandonado(s) en 7 días (${total.toFixed(2)} €)`, ayuda: 'Actívalo gratis en Shopify → Marketing → Automatizaciones → «Recuperar carrito abandonado»: Shopify manda el correo, no Jarvis.' });
  } catch (_) {
    items.push({ ok: null, texto: 'Carritos abandonados', ayuda: 'Actívalo gratis en Shopify → Marketing → Automatizaciones → «Recuperar carrito abandonado».' });
  }
  items.push({ ok: null, texto: 'Reseñas de clientes', ayuda: 'Instala una app de reseñas gratuita (p. ej. Judge.me o Shopify Product Reviews): pide la reseña sola tras la entrega. Nunca pongas reseñas inventadas: es ilegal.' });
  items.push({ ok: null, texto: 'Chat en la tienda', ayuda: 'Instala Shopify Inbox (gratis) y pega allí las «Respuestas rápidas» que prepara Jarvis: el chat contesta solo las preguntas frecuentes las 24 h y lo demás te llega a ti.' });
  return { ok: true, items, respuestas: e.paginas?.respuestas || [] };
}

module.exports = { preparar, aplicar, comprobar, plantillas, validar };
