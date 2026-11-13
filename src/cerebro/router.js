// ROUTER del cerebro: decide quién atiende cada petición y muestra quién contestó.
//
//   "recuerda que …"           → memoria local
//   "aprende a hacer …"        → habilidades (crea una nueva)
//   frase de una habilidad     → habilidades (la ejecuta)
//   "vigila … y avísame"       → rutinas (crea un monitor)
//   acción real en el PC/web   → manos (Claude Code), con permisos
//   correos, ideas, informes   → n8n (tu Jarvis de siempre, con Gmail y memoria)
//   pregunta difícil / árabe   → Claude
//   pregunta simple            → Ollama (modelo local)
// Si el motor elegido falla, se prueba el siguiente.
// La puntuación de complejidad está adaptada de OpenJarvis (ver complejidad.js).
'use strict';
const claude = require('./claude');
const ollama = require('./ollama');
const idioma = require('./idioma');
const { puntuar } = require('./complejidad');
const memoria = require('../memoria');
const habilidades = require('../habilidades');
const manos = require('../manos');
const politica = require('../seguridad/politica');
const registro = require('../seguridad/registro');
const { REGLA_DATOS, envolverDatos } = require('../seguridad/inyeccion');

const UMBRAL_CLAUDE = 0.45;

// --- Detección de intenciones ---------------------------------------------------
const VERBO_ACCION = /\b(crea|crear|créame|creame|haz(?:me)?\s+(?:un|una)|genera(?:me)?\s+(?:un|una)\s+(?:archivo|excel|pdf|documento)|abre|abrir|abreme|ábreme|organiza|ordena|mueve|mover|renombra|descarga|descargar|guarda(?:me)?\s+en|edita|modifica|entra\s+en|navega|rellena|sube\s+(?:el|la|un|una)|instala|publica|cambia\s+el\s+precio|añade\s+(?:un\s+)?producto|crée|ouvre|range|déplace|télécharge|installe|افتح|أنشئ|نظم|حمل)\b/i;
const OBJETO_ACCION = /\b(archivo|archivos|carpeta|carpetas|documento|excel|hoja|pdf|word|escritorio|descargas|documentos|web|página|pagina|navegador|chrome|google|shopify|tienda|producto|productos|pedido|n8n|flujo|workflow|script|código|codigo|programa|app|fichier|dossier|site|navigateur|ملف|مجلد|موقع)\b/i;
const N8N = /\b(correo|correos|email|emails|e-mail|gmail|bandeja|informe|informes|idea|ideas|oportunidad|oportunidades|panel|pendientes?\s+de\s+n8n|mail|mails|courriel|بريد|إيميل)\b/i;
const MONITOR = /^(?:jarvis[,\s]+)?(?:vigila|vigílame|monitoriza|controla\s+cada|avísame\s+(?:si|cuando)|avisame\s+(?:si|cuando)|surveille|préviens-moi|راقب|نبهني)\b/i;
const FORZAR_CLAUDE = /\b(usa claude|con claude|pregúntale a claude|piensa bien|a fondo)\b/i;
const FORZAR_LOCAL = /\b(modelo local|con ollama|sin internet)\b/i;

/**
 * @returns {{ruta:string, motivo:string, puntuacion:number, idioma:string, extra?:any}}
 */
function decidir(texto, { hayClaude = claude.disponible() } = {}) {
  const t = String(texto || '').trim();
  const lang = idioma.detectar(t);
  const { puntuacion, senales } = puntuar(t);
  const base = { puntuacion, idioma: lang };

  const recuerda = memoria.detectarRecuerda(t);
  if (recuerda) return { ...base, ruta: 'memoria', motivo: 'Pides que recuerde algo', extra: recuerda };
  const aprender = habilidades.detectarAprender(t);
  if (aprender) return { ...base, ruta: 'aprender', motivo: 'Pides aprender una habilidad', extra: aprender };
  const hab = habilidades.buscar(t);
  if (hab) return { ...base, ruta: 'habilidad', motivo: `Coincide con la habilidad "${hab.nombre}"`, extra: hab };
  if (MONITOR.test(t)) return { ...base, ruta: 'monitor', motivo: 'Pides vigilar algo y avisar' };
  if (politica.evaluarPeticion(t).decision === 'denegar') return { ...base, ruta: 'denegar', motivo: 'Operación financiera: solo vigilar y avisar' };
  if (/^(?:tarea|hazlo tú|hazlo tu|manos)\s*[:,]/i.test(t) || (VERBO_ACCION.test(t) && OBJETO_ACCION.test(t))) {
    return { ...base, ruta: 'manos', motivo: 'Es una acción real en el PC o en la web' };
  }
  if (N8N.test(t)) return { ...base, ruta: 'n8n', motivo: 'Correos, ideas o informes: lo sabe tu Jarvis de n8n' };
  if (FORZAR_LOCAL.test(t)) return { ...base, ruta: 'local', motivo: 'Pides el modelo local' };
  if (FORZAR_CLAUDE.test(t)) return { ...base, ruta: 'claude', motivo: 'Pides Claude' };
  if (hayClaude && (lang === 'ar' || lang === 'darija')) {
    return { ...base, ruta: 'claude', motivo: `En ${idioma.NOMBRES[lang]} contesta mejor Claude` };
  }
  // Como en el router de OpenJarvis: complejidad alta O varias señales de razonamiento,
  // o código/matemáticas → modelo grande.
  if (puntuacion >= UMBRAL_CLAUDE || senales.razonamiento >= 0.8 || senales.dominio >= 0.7) {
    return { ...base, ruta: 'claude', motivo: `Pregunta compleja (${puntuacion})` };
  }
  return { ...base, ruta: 'local', motivo: `Pregunta sencilla (${puntuacion})` };
}

// --- Prompts -------------------------------------------------------------------
function sistema(nombre) {
  return [
    `Eres Jarvis, el asistente personal de ${nombre} (empresario en España con negocios entre España y Argelia).`,
    'Respondes como en una conversación hablada: claro, directo, cálido y breve (2-5 frases salvo que pida detalle). Sin markdown.',
    'Contesta siempre en el idioma en que te hablan: español, dárija argelina, árabe o francés.',
    'No inventes datos. Si no lo sabes, dilo.',
    'Nunca pagas, compras ni mueves dinero: en finanzas solo vigilas e informas.',
    REGLA_DATOS,
  ].join('\n');
}

function mensajeUsuario(texto, lang, deps) {
  const ahora = new Date();
  const panel = (deps.panel?.().items || []).filter((i) => /pendiente/i.test(String(i.estado || ''))).slice(0, 5);
  const contexto = [
    `Fecha y hora: ${ahora.toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}.`,
    memoria.contexto(texto),
    panel.length ? envolverDatos('panel n8n', panel.map((i) => `- [${i.tipo}] ${i.titulo}`).join('\n')) : '',
    idioma.instruccion(lang),
  ].filter(Boolean).join('\n\n');
  return `${contexto}\n\nAyoub dice: ${texto}`;
}

// --- Motores con respaldo ------------------------------------------------------------
const ORDEN = { local: ['local', 'claude', 'n8n'], claude: ['claude', 'n8n', 'local'], n8n: ['n8n', 'claude', 'local'] };

async function usarMotor(motor, texto, lang, deps) {
  if (motor === 'local') {
    return ollama.chat({ sistema: sistema(deps.nombre()), mensajes: [{ role: 'user', content: mensajeUsuario(texto, lang, deps) }] });
  }
  if (motor === 'claude') {
    if (!claude.disponible()) return { ok: false, error: 'Sin clave de Claude' };
    return claude.chat({ sistema: sistema(deps.nombre()), mensajes: [{ role: 'user', content: mensajeUsuario(texto, lang, deps) }] });
  }
  const r = await deps.n8nChat(texto);
  return r.ok ? { ok: true, texto: r.respuesta, motor: 'n8n · Jarvis' } : { ok: false, error: r.error };
}

async function conRespaldo(ruta, texto, lang, deps) {
  const fallos = [];
  for (const motor of ORDEN[ruta]) {
    const r = await usarMotor(motor, texto, lang, deps);
    if (r.ok) return { ...r, respaldo: fallos.length ? fallos : undefined };
    fallos.push(`${motor}: ${r.error}`);
  }
  return { ok: false, error: `Ningún motor pudo responder (${fallos.join(' · ')})` };
}

/** Pensar sin conversación (habilidades, resúmenes, extractor). */
function crearPensar(deps) {
  return async (sistemaTxt, usuario, { preferir = 'claude' } = {}) => {
    const orden = preferir === 'local' ? ['local', 'claude'] : ['claude', 'local'];
    const fallos = [];
    for (const m of orden) {
      const r = m === 'claude'
        ? (claude.disponible() ? await claude.chat({ sistema: sistemaTxt, mensajes: [{ role: 'user', content: usuario }] }) : { ok: false, error: 'sin clave' })
        : await ollama.chat({ sistema: sistemaTxt, mensajes: [{ role: 'user', content: usuario }], temperatura: 0.2, segundos: 180 });
      if (r.ok) return r;
      fallos.push(`${m}: ${r.error}`);
    }
    // Último recurso: el Jarvis de n8n.
    const n = await deps.n8nChat(`${sistemaTxt}\n\n${usuario}`);
    return n.ok ? { ok: true, texto: n.respuesta, motor: 'n8n · Jarvis' } : { ok: false, error: fallos.join(' · ') };
  };
}

// Respuestas cortas en el idioma de Ayoub.
const FRASES = {
  apuntado: { es: 'Apuntado: ', fr: 'C\'est noté : ', ar: 'تم الحفظ: ', darija: 'Sajjeltha: ' },
  tarea: { es: 'Me pongo con ello. Lo verás en la pestaña Tareas y te aviso al terminar.', fr: 'Je m\'en occupe. Tu le verras dans l\'onglet Tâches.', ar: 'سأبدأ الآن. ستجدها في تبويب المهام وسأخبرك عند الانتهاء.', darija: 'Rani nkhdem 3liha. Tchoufha f Tareas w nkhabrek ki nkemmel.' },
};
const frase = (k, lang) => FRASES[k][lang] || FRASES[k].es;

/**
 * Crea el cerebro con sus dependencias.
 * @param {{nombre:()=>string, n8nChat:(t:string)=>Promise<{ok,respuesta?,error?}>, panel:()=>{items:any[]}, crearMonitor:(desc:string)=>Promise<{ok,texto?,error?}>, herramientasHabilidad:(deps)=>object}} deps
 */
function crearCerebro(deps) {
  const pensar = crearPensar(deps);
  const llm = async (s, u) => { const r = await pensar(s, u); if (!r.ok) throw new Error(r.error); return r.texto; };

  /**
   * @param {string} texto petición de Ayoub
   * @param {{origen?:string, alProgreso?:(t:string)=>void}} o
   */
  async function responder(texto, o = {}) {
    const d = decidir(texto);
    memoria.guardarMensaje('yo', texto, { origen: o.origen || 'texto' });
    registro.anotar({ origen: `cerebro:${o.origen || 'texto'}`, accion: `ruta ${d.ruta}`, motivo: d.motivo, detalle: texto.slice(0, 200) });
    let r;
    try {
      switch (d.ruta) {
        case 'memoria': {
          const h = memoria.guardarHecho(d.extra, /decid/i.test(d.extra) ? 'decision' : 'dato', 'pedido');
          r = { ok: true, texto: frase('apuntado', d.idioma) + h.texto, motor: 'Memoria local' };
          break;
        }
        case 'aprender': {
          o.alProgreso?.('Aprendiendo la habilidad…');
          const a = await habilidades.aprender(d.extra, llm);
          r = a.ok
            ? { ok: true, texto: `Aprendido. Nueva habilidad "${a.habilidad.nombre}": ${a.habilidad.descripcion}. Actívala diciendo: "${a.habilidad.disparadores[0] || a.habilidad.nombre}".`, motor: 'Habilidades', habilidad: a.habilidad.nombre }
            : { ok: false, error: a.error };
          break;
        }
        case 'habilidad': {
          const salida = await habilidades.ejecutar(d.extra, texto, deps.herramientasHabilidad({ pensar, llm }), (p) => o.alProgreso?.(`Habilidad ${d.extra.nombre}: paso ${p.paso}/${p.total} (${p.herramienta})`));
          r = { ok: true, texto: salida, motor: `Habilidad · ${d.extra.nombre}` };
          break;
        }
        case 'monitor': {
          r = await deps.crearMonitor(texto);
          if (r.ok) r.motor = 'Rutinas';
          break;
        }
        case 'denegar':
          r = { ok: true, texto: 'Eso no lo hago: con el dinero solo vigilo y aviso, nunca compro, vendo ni hago transferencias. Si quieres, te creo una vigilancia y te aviso de los cambios.', motor: 'Seguridad' };
          break;
        case 'manos': {
          const { tarea } = await manos.crear(texto.replace(/^(?:tarea|hazlo tú|hazlo tu|manos)\s*[:,]\s*/i, ''), { origen: o.origen || 'texto' });
          r = { ok: true, texto: frase('tarea', d.idioma), motor: 'Manos · Claude Code', tareaId: tarea.id };
          break;
        }
        default:
          r = await conRespaldo(d.ruta, texto, d.idioma, deps);
      }
    } catch (e) {
      r = { ok: false, error: e.message };
    }
    if (r.ok) memoria.guardarMensaje('jarvis', r.texto, { motor: r.motor });
    return { ...r, ruta: d.ruta, motivo: d.motivo, idioma: d.idioma };
  }

  return { responder, pensar, llm, decidir };
}

module.exports = { crearCerebro, decidir, sistema };
