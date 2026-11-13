// Resumen de la mañana hablado: correo y agenda (vía tu n8n), noticias (RSS),
// ideas/informes del panel de n8n y tareas pendientes de Jarvis.
//
// Las reglas del texto final están adaptadas de OpenJarvis —
// src/openjarvis/agents/morning_digest.py (Copyright 2025 The OpenJarvis Authors,
// Apache 2.0; ver NOTICE): solo datos recogidos, nada inventado, por orden de
// importancia, sin markdown y como mucho 200 palabras. Cambios: traducido y
// adaptado a las fuentes de Jarvis.
'use strict';
const { envolverDatos, REGLA_DATOS } = require('../seguridad/inyeccion');
const noticias = require('./noticias');
const registro = require('../seguridad/registro');

function sistema(nombre, ahora = new Date()) {
  return [
    'Eres Jarvis, el asistente personal de Ayoub. Preparas su resumen hablado de la mañana.',
    `Hoy es ${ahora.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, son las ${ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}.`,
    'Los datos YA están recogidos en el mensaje del usuario. Tú no buscas nada.',
    'Haz un resumen hablado y conciso, de lo más importante a lo menos: 1) correos importantes, 2) agenda de hoy, 3) ideas e informes de n8n, 4) tareas pendientes, 5) 2 o 3 noticias relevantes.',
    `Empieza con "Buenos días, ${nombre}." y termina tras el último punto con datos.`,
    'REGLAS ABSOLUTAS:',
    '- SOLO hechos de los datos. Cero invenciones.',
    '- No menciones fuentes que no han dado datos ni errores técnicos.',
    '- No inventes contexto personal ni ofrezcas acciones.',
    '- Sin markdown, emojis, viñetas ni títulos: es para leer en voz alta.',
    '- MÁXIMO 200 palabras. En español.',
    REGLA_DATOS,
  ].join('\n');
}

/**
 * @param {{nombre:string, n8nChat:(t:string)=>Promise<{ok,respuesta?,error?}>, panel:()=>{items:any[]}, tareasPendientes:()=>any[], pensar:(s:string,u:string)=>Promise<{ok,texto?,motor?,error?}>, fuentesNoticias?:any[]}} ctx
 */
async function generar(ctx) {
  const partes = [];
  const fuentes = [];

  const [correo, titulares] = await Promise.all([
    ctx.n8nChat('Para mi resumen de la mañana dame SOLO datos, sin saludar ni opinar: correos importantes sin leer de las últimas 24 h (remitente y asunto) y los eventos de mi agenda de hoy con hora. Si no tienes agenda, dilo en una línea.')
      .catch((e) => ({ ok: false, error: e.message })),
    noticias.titulares(ctx.fuentesNoticias || noticias.POR_DEFECTO, 3).catch(() => []),
  ]);
  if (correo.ok) { partes.push(envolverDatos('correo y agenda (n8n)', correo.respuesta)); fuentes.push('correo'); }

  const items = (ctx.panel().items || []).filter((i) => /pendiente/i.test(String(i.estado || '')));
  if (items.length) {
    partes.push(envolverDatos('panel n8n', items.map((i) => `- [${i.tipo}] ${i.titulo}${i.euros ? ` (~${i.euros} €)` : ''}`).join('\n')));
    fuentes.push('panel');
  }
  const tareas = ctx.tareasPendientes();
  if (tareas.length) { partes.push(`Tareas de Jarvis sin terminar:\n${tareas.map((t) => `- ${t.titulo} (${t.estado})`).join('\n')}`); fuentes.push('tareas'); }
  const tn = noticias.comoTexto(titulares);
  if (tn) { partes.push(envolverDatos('noticias', tn)); fuentes.push('noticias'); }

  if (!partes.length) return { ok: false, error: 'No hay datos para el resumen (¿sin conexión?)' };
  const r = await ctx.pensar(sistema(ctx.nombre), partes.join('\n\n'));
  registro.anotar({ origen: 'rutinas', accion: 'resumen de la mañana', decision: r.ok ? 'hecho' : 'fallo', motivo: r.ok ? fuentes.join(', ') : r.error });
  return r.ok ? { ok: true, texto: r.texto, motor: r.motor, fuentes } : r;
}

module.exports = { generar, sistema };
