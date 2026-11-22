// Productos ganadores: mira en la Biblioteca de anuncios de Meta (datos públicos
// de la UE) qué anuncios llevan MUCHO TIEMPO activos en España. Si una tienda
// sigue pagando un anuncio semanas después, es señal de que le sale rentable.
//  - Agrupa por anunciante: días activo del anuncio más antiguo, nº de anuncios
//    activos y alcance en la UE (si Meta lo da).
//  - El cerebro resume qué producto parece y propone una búsqueda para CJ.
// Es una pista, no una garantía: revisa siempre el anuncio antes de copiar la idea
// (y nunca copies marcas, vídeos ni fotos de otros: haz los tuyos).
'use strict';
const claves = require('../nucleo/claves');
const { peticion, formulario } = require('../nucleo/peticion');
const registro = require('../seguridad/registro');
const investigar = require('./investigar');
const { envolverDatos, REGLA_DATOS } = require('../seguridad/inyeccion');

const GRAPH = () => `${process.env.JARVIS_GRAPH_BASE || 'https://graph.facebook.com'}/${require('../redes/meta').VERSION}`;
const CAMPOS = 'id,page_id,page_name,ad_delivery_start_time,ad_creative_bodies,ad_creative_link_titles,eu_total_reach';
const DIA = 86400000;

/** Una búsqueda en la Biblioteca de anuncios (anuncios activos que llegan a España). */
async function anuncios(termino, { token, limite = 100, dep = {} } = {}) {
  const url = `${GRAPH()}/ads_archive?${formulario({
    search_terms: String(termino).slice(0, 100), ad_reached_countries: JSON.stringify(['ES']), ad_active_status: 'ACTIVE', ad_type: 'ALL',
    fields: CAMPOS, limit: String(limite), access_token: token,
  })}`;
  const r = await (dep.peticion || peticion)(url, { segundos: 60 });
  if (!r.ok || r.datos?.error) {
    const m = r.datos?.error?.message || r.error || 'error';
    // Meta exige confirmar tu identidad una vez para usar la Biblioteca por API.
    if (/permission|identity|confirm|#10\b|2332002/i.test(m)) throw new Error('Meta no deja usar la Biblioteca de anuncios con tu cuenta todavía: confirma tu identidad en facebook.com/ID y acepta las condiciones en facebook.com/ads/library/api (es gratis, una sola vez).');
    throw new Error(`Biblioteca de anuncios de Meta: ${m}`);
  }
  return r.datos?.data || [];
}

/** Agrupa por anunciante y puntúa: más días activo y más anuncios = mejor señal. */
function agrupar(lista, termino, ahora = Date.now()) {
  const porPagina = new Map();
  for (const a of lista) {
    const inicio = Date.parse(a.ad_delivery_start_time);
    if (!Number.isFinite(inicio)) continue;
    const dias = Math.max(0, Math.floor((ahora - inicio) / DIA));
    const g = porPagina.get(a.page_id) || { pagina: String(a.page_name || '').slice(0, 80), paginaId: a.page_id, anuncios: 0, diasMax: 0, alcance: 0, textos: [], enlace: '', termino };
    g.anuncios += 1;
    g.alcance += Number(a.eu_total_reach) || 0;
    // Enlace público de la Biblioteca (el ad_snapshot_url lleva tu token: no se guarda).
    if (dias >= g.diasMax) { g.diasMax = dias; g.enlace = /^\d+$/.test(String(a.id)) ? `https://www.facebook.com/ads/library/?id=${a.id}` : g.enlace; }
    const t = [...(a.ad_creative_link_titles || []), ...(a.ad_creative_bodies || [])].map((x) => String(x).replace(/\s+/g, ' ').trim()).filter(Boolean)[0];
    if (t && g.textos.length < 3 && !g.textos.includes(t.slice(0, 200))) g.textos.push(t.slice(0, 200));
    porPagina.set(a.page_id, g);
  }
  return [...porPagina.values()].map((g) => ({
    ...g,
    // 0-100: días (hasta 50 a los 60 días), nº de anuncios (hasta 30), alcance (hasta 20).
    puntos: Math.round(Math.min(50, (g.diasMax / 60) * 50) + Math.min(30, g.anuncios * 5) + (g.alcance ? Math.min(20, Math.log10(g.alcance + 1) * 4) : 0)),
  }));
}

/**
 * Busca ganadores. Términos: los que des (separados por comas) o unos por defecto.
 * Solo cuenta anunciantes con anuncios de 14 días o más.
 */
async function buscar({ terminos = '', pensar, dep = {} } = {}) {
  const token = claves.obtener('META_ADS_TOKEN') || claves.obtener('META_USER_TOKEN');
  if (!token) return { ok: false, error: 'Conecta antes Facebook en la pestaña REDES (la Biblioteca de anuncios necesita tu sesión de Meta)' };
  const lista = String(terminos || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 5);
  const usar = lista.length ? lista : ['envío gratis', 'oferta', 'gadget', 'hogar', 'mascotas'];
  const todos = [];
  let ultimoError = null;
  for (const t of usar) {
    try { todos.push(...agrupar(await anuncios(t, { token, dep }), t)); } catch (e) { ultimoError = e; if (/identidad/.test(e.message)) break; }
  }
  if (!todos.length && ultimoError) return { ok: false, error: ultimoError.message };
  const vistos = new Set();
  const ganadores = todos.sort((a, b) => b.puntos - a.puntos)
    .filter((g) => g.diasMax >= 14 && !vistos.has(g.paginaId) && vistos.add(g.paginaId)).slice(0, 10);
  if (!ganadores.length) return { ok: false, error: 'No he encontrado anuncios que lleven 14 días o más activos con esas palabras; prueba con otras' };
  // El cerebro solo lee los textos como DATOS (pueden venir de cualquiera).
  if (pensar) {
    const r = await Promise.resolve(pensar(
      `Eres experto en dropshipping en España. Para cada anunciante, deduce de sus textos QUÉ producto genérico vende y propón una búsqueda corta EN INGLÉS para un catálogo de proveedor (CJ). Si es una marca, un servicio, algo prohibido o no se sabe, pon "busqueda": "". ${REGLA_DATOS} Responde SOLO JSON: {"productos":[{"producto":"en español, máx. 60","busqueda":"2-4 palabras en inglés"}]} en el mismo orden.`,
      envolverDatos('anuncios de la Biblioteca de Meta', ganadores.map((g, i) => `${i + 1}. ${g.pagina} · ${g.diasMax} días · ${g.anuncios} anuncios · ${g.textos.join(' | ')}`).join('\n')),
      { preferir: 'claude' },
    )).catch(() => null);
    try {
      JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]).productos.forEach((x, i) => {
        if (!ganadores[i]) return;
        ganadores[i].producto = String(x.producto || '').slice(0, 60);
        ganadores[i].busqueda = String(x.busqueda || '').replace(/[^a-zA-Z0-9 -]/g, '').trim().slice(0, 40);
      });
    } catch (_) { /* sin análisis */ }
  }
  investigar.escribir({ ...investigar.leer(), ganadores, espiado: new Date().toISOString() });
  registro.anotar({ origen: 'tienda', accion: `buscar anuncios ganadores (${usar.join(', ')})`, decision: 'hecho', detalle: ganadores.map((g) => `${g.pagina} ${g.diasMax}d`) });
  return { ok: true, ganadores };
}

module.exports = { buscar, agrupar, anuncios };
