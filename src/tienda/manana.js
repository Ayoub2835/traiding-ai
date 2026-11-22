// «Resumen del negocio» (rutina de la mañana, al móvil): en un solo mensaje,
// lo que pasó en cada tienda (ventas y beneficio de 7 días, pedidos pendientes),
// las respuestas a clientes por aprobar, los vídeos por revisar y el mercado cripto.
// El día 1 de cada mes añade las cuentas del mes anterior (30 días).
'use strict';
const tiendas = require('./tiendas');
const investigar = require('./investigar');
const control = require('./control');

const eur = (x) => `${Number(x || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const dia = (d) => new Date(d).toISOString().slice(0, 10);

async function cuentasDe(dias, dep) {
  const pedidos = await (dep.ventas || control.ventasShopify)(dia(Date.now() - (dias - 1) * 86400000), dep);
  let gasto = null;
  try { gasto = (await (dep.gasto || control.gastoMeta)(dias >= 30 ? 'last_30d' : 'last_7d'))?.gasto; } catch (_) { gasto = null; }
  return control.cuentas(pedidos, investigar.leer().productos || {}, gasto);
}

/** Texto del resumen. dep: { ventas, gasto, mercado, revision, hoy } para pruebas. */
async function resumen({ dep = {} } = {}) {
  const partes = [];
  const mes = (dep.hoy || new Date()).getDate() === 1;
  for (const t of tiendas.lista().filter((x) => tiendas.conectada(x.id))) {
    const linea = await tiendas.conTienda(t.id, async () => {
      try {
        const c = await cuentasDe(7, dep);
        const pend = require('./pedidos').lista().filter((p) => ['por_confirmar', 'problema', 'por_enviar', 'creado_en_cj'].includes(p.estado)).length;
        const cli = require('./clientes').lista().length;
        let txt = `🛍️ ${t.nombre}: 7 días ${c.pedidos} pedido(s) · ventas ${eur(c.ventas)} · beneficio ${c.beneficio >= 0 ? '🟢' : '🔴'} ${eur(c.beneficio)}`;
        if (pend) txt += ` · ⚠ ${pend} pedido(s) esperan por ti`;
        if (cli) txt += ` · ✉️ ${cli} respuesta(s) a clientes por aprobar`;
        if (mes) {
          const m = await cuentasDe(30, dep);
          txt += `\n   📅 Últimos 30 días: ${m.pedidos} pedido(s) · ventas ${eur(m.ventas)} · anuncios ${eur(m.gasto)} · beneficio ${eur(m.beneficio)}`;
        }
        return txt;
      } catch (e) { return `🛍️ ${t.nombre}: no pude leer los datos (${e.message})`; }
    });
    partes.push(linea);
  }
  try {
    const n = (dep.revision || (() => require('../redes/revision').lista()))().length;
    if (n) partes.push(`🎬 ${n} vídeo(s) esperan tu revisión en REDES`);
  } catch (_) { /* sin vídeos */ }
  try {
    const m = await (dep.mercado || require('../youtube/creador').mercado)();
    const top = m.monedas.slice(0, 3).map((x) => `${x.simbolo} ${x.precio.toLocaleString('es-ES', { maximumFractionDigits: 0 })} $ (${x.cambio24h >= 0 ? '+' : ''}${x.cambio24h.toFixed(1)} %)`).join(' · ');
    partes.push(`📈 ${top}${m.sentimiento ? ` · miedo/codicia ${m.sentimiento.valor}` : ''}`);
  } catch (_) { /* sin mercado */ }
  if (!partes.length) return { ok: true, novedad: false, resumen: 'Nada que contar (no hay tiendas conectadas)' };
  return { ok: true, novedad: true, resumen: `☀️ Buenos días. Así va tu negocio:\n${partes.join('\n')}` };
}

module.exports = { resumen };
