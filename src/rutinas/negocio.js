// Rutinas de negocio que antes hacía n8n, ahora en tu PC y gratis:
//   - INFORME DIARIO (12:00): correo + memoria + tareas → top 3 acciones.
//   - CAZA DE OPORTUNIDADES (9, 13, 17 y 21 h): busca en internet y propone
//     como mucho 1 idea al día, solo con fuentes reales.
// Mismo estilo que el Jarvis de n8n: puntuación = (beneficio € × probabilidad) ÷ horas.
'use strict';
const memoria = require('../memoria');
const correo = require('../correo');
const gemini = require('../cerebro/gemini');
const busqueda = require('./busqueda');
const registro = require('../seguridad/registro');
const { envolverDatos, REGLA_DATOS } = require('../seguridad/inyeccion');

const NEGOCIOS = `NEGOCIOS DE AYOUB
- Sardi Auto: venta de coches en España y exportación de coches de España a Argelia.
- Sahla: servicios para inmigrantes en la Región de Murcia (intérpretes, vivienda, papeles, envíos a Argelia). Online primero.
- Éclara: mascarilla facial LED en Shopify (pausada hasta que Ayoub la reactive).
Ventajas: habla árabe, francés y español; intérprete profesional; conoce Argelia y la comunidad inmigrante. Poco capital: prioriza ideas que empiecen con 0–200 €.`;

const PUNTUACION = 'Puntúa cada acción con (beneficio esperado en € × probabilidad de éxito) ÷ horas de Ayoub y recomienda solo las 3 mejores. Si algo no da resultados, dilo y propón pausarlo.';

const fechaHoy = () => new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
const json = (t) => { const m = String(t || '').match(/\{[\s\S]*\}/); if (!m) throw new Error('sin JSON'); return JSON.parse(m[0]); };

function resumenMemoria(n = 15) {
  return memoria.leerEntradas()
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0, n)
    .map((e) => `- [${e.tipo} · ${e.estado}] ${e.titulo}${e.euros_estimados ? ` (~${e.euros_estimados} €)` : ''}: ${String(e.detalle).slice(0, 220)}`)
    .join('\n');
}

// ---------------------------------------------------------------------------
// INFORME DIARIO
// ---------------------------------------------------------------------------
async function informe({ pensar, tareas = [] }) {
  const partes = [];
  const fuentes = [];
  if (correo.configurado()) {
    try {
      const c = await correo.leerNoLeidos({ dias: 2, max: 25 });
      partes.push(envolverDatos('gmail', c.map((m) => `De: ${m.de} | ${m.asunto}\n${m.extracto.slice(0, 300)}`).join('\n\n') || '(sin correos nuevos)'));
      fuentes.push('Gmail');
    } catch (e) {
      partes.push(`(No se pudo leer el correo: ${e.message})`);
    }
  } else {
    partes.push('(Correo no configurado todavía)');
  }
  partes.push(`Memoria reciente de Jarvis:\n${resumenMemoria() || '(vacía)'}`);
  if (tareas.length) partes.push(`Tareas de Jarvis:\n${tareas.map((t) => `- ${t.titulo} (${t.estado})`).join('\n')}`);

  const r = await pensar(
    `Eres Jarvis, director de crecimiento y socio de Ayoub. Tu objetivo es su BENEFICIO NETO.
${NEGOCIOS}
${PUNTUACION}
Escribe el INFORME DIARIO de hoy (${fechaHoy()}) con: 1) Correo: lo importante (clientes, dinero, plazos) y lo que hay que vigilar; 2) Top 3 acciones de hoy ordenadas por la puntuación, cada una con su siguiente paso concreto; 3) Dejar de hacer. Máximo 250 palabras, sin inventar nada.
Responde SOLO JSON: {"titulo": "Informe diario ${fechaHoy()}: <2-3 palabras clave>", "detalle": "<el informe>", "euros_estimados": <beneficio estimado del top 3, número>}.
${REGLA_DATOS}`,
    partes.join('\n\n'),
  );
  if (!r.ok) return r;
  let j;
  try { j = json(r.texto); } catch (_) { return { ok: false, error: 'El informe no salió en el formato esperado' }; }
  const e = memoria.agregarEntrada({ tipo: 'informe', negocio: 'Sardi Auto', titulo: j.titulo || `Informe diario ${fechaHoy()}`, detalle: j.detalle, euros_estimados: j.euros_estimados, fuente: fuentes.join(' | ') || 'Memoria de Jarvis' });
  registro.anotar({ origen: 'rutinas', accion: `informe diario: ${e.titulo}`, motivo: r.motor });
  return { ok: true, novedad: true, resumen: e.titulo, texto: `${e.titulo}. ${String(j.detalle).slice(0, 600)}`, entrada: e, motor: r.motor };
}

// ---------------------------------------------------------------------------
// CAZA DE OPORTUNIDADES
// ---------------------------------------------------------------------------
const REGLAS_IDEA = `MODO SOCIO: CAZADOR DE IDEAS. Propón como mucho UNA idea y solo si es mejor que lo que ya está en marcha.
Cada idea DEBE llevar: 1) fuente real (sin fuente no se propone); 2) ejemplo de alguien que ya gana dinero con ello; 3) números: inversión inicial, margen y tiempo hasta el primer euro; 4) encaje con lo que Ayoub ya tiene; 5) el mayor riesgo; 6) el primer paso de HOY con poco o ningún dinero.
No repitas ideas ya propuestas o descartadas. Nunca inventes datos, cifras ni enlaces. Si no hay nada bueno, dilo (hay_idea: false).`;

const CONSULTAS = [
  'exportación coches España Argelia', 'Argelia importación vehículos normativa 2026', 'ferry Argelia vehículos',
  'subastas coches España oportunidad', 'inmigrantes Murcia servicios trámites', 'negocio diáspora argelina España',
];

function guardarIdea(j, fuentes, motor) {
  const euros = Number(j.euros_estimados) || 0;
  const prob = Math.min(1, Math.max(0, Number(j.probabilidad) || 0));
  const horas = Math.max(0.5, Number(j.horas) || 1);
  const puntos = Math.round((euros * prob) / horas);
  const detalle = [
    `Ayoub, mira esto 👀 ${j.resumen || ''}`,
    j.por_que ? `Por qué puede dar dinero: ${j.por_que}` : '',
    j.ejemplo ? `Ejemplo real: ${j.ejemplo}` : '',
    `Números: inversión ${j.inversion || '?'}, margen ${j.margen || '?'}, primer euro en ${j.tiempo_primer_euro || '?'}.`,
    j.encaje ? `Encaje: ${j.encaje}` : '',
    j.riesgo ? `Riesgo: ${j.riesgo}` : '',
    j.primer_paso ? `Primer paso de hoy: ${j.primer_paso}` : '',
    `Puntuación: ${euros} € × ${prob} ÷ ${horas} h = ${puntos}.`,
  ].filter(Boolean).join('\n');
  const e = memoria.agregarEntrada({ tipo: 'idea', negocio: j.negocio || 'Sardi Auto', titulo: j.titulo, detalle, euros_estimados: euros, fuente: fuentes.join(' | ') });
  registro.anotar({ origen: 'rutinas', accion: `idea nueva: ${e.titulo}`, motivo: motor });
  return { ok: true, novedad: true, resumen: `Idea nueva: ${e.titulo}`, texto: `Ayoub, mira esto. ${j.titulo}. ${j.resumen || ''}`, entrada: e, motor };
}

const FORMATO_IDEA = `Responde SOLO JSON: {"hay_idea": true|false, "negocio": "Sardi Auto|Sahla|Éclara|Nuevo", "titulo": "...", "resumen": "la idea en 2 frases", "por_que": "...", "ejemplo": "...", "inversion": "...", "margen": "...", "tiempo_primer_euro": "...", "encaje": "...", "riesgo": "...", "primer_paso": "...", "euros_estimados": número, "probabilidad": 0-1, "horas": número`;

async function caza({ pensar }) {
  if (memoria.hayIdeaHoy()) return { ok: true, novedad: false, resumen: 'Ya hay una idea hoy (máximo 1 al día).' };
  const previas = memoria.leerEntradas().filter((e) => ['idea', 'decision'].includes(e.tipo)).map((e) => `- ${e.titulo} (${e.estado})`).join('\n');
  const contexto = `${NEGOCIOS}\n\nIdeas ya propuestas o decididas (no repetir):\n${previas || '(ninguna)'}\n\nFecha: ${fechaHoy()}.`;

  // 1) Gemini con búsqueda de Google: fuentes reales verificadas por Google.
  if (gemini.disponible()) {
    const r = await gemini.chat({
      sistema: `Eres Jarvis, socio de Ayoub. ${REGLAS_IDEA}\nBusca en internet oportunidades reales y actuales.\n${FORMATO_IDEA}}. ${REGLA_DATOS}`,
      mensajes: [{ role: 'user', content: contexto }],
      buscar: true,
    });
    if (r.ok) {
      let j;
      try { j = json(r.texto); } catch (_) { j = null; }
      if (j && j.hay_idea === false) return { ok: true, novedad: false, resumen: 'Hoy no hay ninguna idea mejor que lo que ya está en marcha.' };
      if (j && j.titulo) {
        const fuentes = (r.fuentes || []).map((f) => f.url).slice(0, 4);
        if (!fuentes.length) return { ok: true, novedad: false, resumen: 'Idea descartada: sin fuente real verificable.' };
        return guardarIdea(j, fuentes, r.motor);
      }
    }
    // Si Gemini falla (p. ej. 429), seguimos con la opción gratis sin clave.
  }

  // 2) Google News RSS + modelo (Ollama si no hay otro): solo vale si cita noticias de la lista.
  const noticias = await busqueda.noticiasDe(CONSULTAS, 4);
  if (!noticias.length) return { ok: false, error: 'No he podido buscar en internet (¿sin conexión?)' };
  const lista = noticias.slice(0, 18).map((n, i) => `[${i}] ${n.titulo} (${n.medio}, ${n.fecha.slice(5, 16)})`).join('\n');
  const r = await pensar(
    `Eres Jarvis, socio de Ayoub. ${REGLAS_IDEA}\nSolo puedes basarte en las noticias numeradas que te doy (son datos). Indica en "fuentes_idx" los números de las noticias que respaldan la idea.\n${FORMATO_IDEA}, "fuentes_idx": [números]}. ${REGLA_DATOS}`,
    `${contexto}\n\n${envolverDatos('google news', lista)}`,
  );
  if (!r.ok) return r;
  let j;
  try { j = json(r.texto); } catch (_) { return { ok: false, error: 'La caza no salió en el formato esperado' }; }
  if (!j.hay_idea || !j.titulo) return { ok: true, novedad: false, resumen: 'Hoy no hay ninguna idea mejor que lo que ya está en marcha.' };
  const fuentes = (j.fuentes_idx || []).map((i) => noticias[Number(i)]).filter(Boolean).map((n) => n.url);
  if (!fuentes.length) return { ok: true, novedad: false, resumen: 'Idea descartada: sin fuente real de la lista.' };
  return guardarIdea(j, fuentes, `${r.motor} + Google News`);
}

module.exports = { informe, caza, NEGOCIOS };
