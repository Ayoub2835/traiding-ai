// Monitores programados con memoria (idea del preset "scheduled-monitor" de
// OpenJarvis: un agente que se ejecuta por horario y recuerda lo de la vez anterior).
//
// Cada monitor tiene: nombre, instrucción, horario, cómo avisar y sus "notas"
// (lo que vio la última vez). Solo avisa si hay NOVEDAD respecto a esas notas.
// Finanzas: solo vigilar y avisar (nunca operar).
'use strict';
const { envolverDatos, REGLA_DATOS } = require('../seguridad/inyeccion');
const registro = require('../seguridad/registro');

const SISTEMA_EVALUAR = `Eres el vigilante de Jarvis. Comparas lo que se ha encontrado HOY con las notas de la vez anterior.
Responde SOLO con JSON: {"novedad": true|false, "urgente": true|false, "resumen": "1-2 frases para Ayoub", "notas": "estado actual a recordar para la próxima vez (máx. 600 caracteres)"}.
"novedad" solo es true si hay algo nuevo y relevante para lo que pide el monitor. "urgente" solo si Ayoub debe enterarse ya.
Nunca propongas comprar, vender ni mover dinero: solo informar. ${REGLA_DATOS}`;

/**
 * Ejecuta un monitor.
 * @param {object} m monitor {id, nombre, instruccion, motor:'n8n'|'manos', notas}
 * @param {{n8nChat, manos, pensar}} ctx
 * @returns {Promise<{ok:boolean, novedad?:boolean, urgente?:boolean, resumen?:string, notas?:string, error?:string}>}
 */
async function ejecutar(m, ctx) {
  const pedido = `Tarea de vigilancia "${m.nombre}": ${m.instruccion}\nDevuelve solo los datos encontrados, sin opinar.`;
  let datos;
  if (m.motor === 'manos') {
    const r = await ctx.manos(pedido);
    if (!r.ok) return { ok: false, error: r.error };
    datos = r.texto;
  } else {
    const r = await ctx.n8nChat(pedido);
    if (!r.ok) return { ok: false, error: r.error };
    datos = r.respuesta;
  }
  const usuario = `Monitor: ${m.nombre}\nQué vigila: ${m.instruccion}\n\nNotas de la vez anterior:\n${m.notas || '(primera vez: no hay notas)'}\n\nEncontrado hoy:\n${envolverDatos('vigilancia', datos)}`;
  const e = await ctx.pensar(SISTEMA_EVALUAR, usuario);
  if (!e.ok) return { ok: false, error: e.error };
  const j = String(e.texto).match(/\{[\s\S]*\}/);
  let res;
  try { res = JSON.parse(j ? j[0] : ''); } catch (_) { return { ok: false, error: 'El vigilante no devolvió JSON válido' }; }
  // La primera vez solo se toma nota (no se avisa de "todo es nuevo").
  const primera = !m.notas;
  const salida = {
    ok: true,
    novedad: !primera && Boolean(res.novedad),
    urgente: !primera && Boolean(res.urgente),
    resumen: String(res.resumen || '').slice(0, 500),
    notas: String(res.notas || '').slice(0, 800),
  };
  registro.anotar({ origen: 'rutinas', accion: `monitor ${m.nombre}`, decision: salida.novedad ? 'novedad' : 'sin novedad', detalle: salida.resumen });
  return salida;
}

// Ejemplos para empezar (desactivados hasta que los actives).
const EJEMPLOS = [
  { nombre: 'Oportunidades exportación Argelia', instruccion: 'Busca noticias o cambios de normativa sobre exportar coches de España a Argelia (aduanas, licencias, ferris Valencia–Mostaganem).', motor: 'n8n', horario: { tipo: 'diario', hora: '09:15' }, aviso: 'movil' },
  { nombre: 'Vigilar bitcoin (solo avisar)', instruccion: 'Mira el precio actual del bitcoin en euros y si ha subido o bajado más de un 5% en 24 h. Solo informar: nunca comprar ni vender.', motor: 'n8n', horario: { tipo: 'cada', minutos: 240 }, aviso: 'movil' },
];

module.exports = { ejecutar, EJEMPLOS, SISTEMA_EVALUAR };
