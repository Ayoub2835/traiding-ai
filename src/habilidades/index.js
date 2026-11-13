// Habilidades (skills) al estilo OpenJarvis: recetas reutilizables en TOML con
// una lista de pasos. Cada paso usa una herramienta y guarda su resultado con un
// nombre que los pasos siguientes pueden usar entre llaves: {nombre}.
//
//   incluidas/  vienen con la app (adaptadas de OpenJarvis)
//   %APPDATA%\Jarvis\habilidades\  las que aprende cuando dices "aprende a hacer X"
//
// Formato (idea de OpenJarvis skills/data/*.toml, campos en español):
//   [habilidad]  nombre, descripcion, disparadores = ["frases que la activan"]
//   [[habilidad.pasos]]  herramienta, plantilla, salida
'use strict';
const fs = require('fs');
const path = require('path');
const TOML = require('smol-toml');
const rutas = require('../nucleo/rutas');
const registro = require('../seguridad/registro');
const { envolverDatos } = require('../seguridad/inyeccion');
const { normalizar } = require('../memoria');

const HERRAMIENTAS = {
  pensar: 'Razona o redacta con el mejor modelo disponible (texto → texto)',
  pensar_claude: 'Igual que pensar, pero siempre con Claude (tareas difíciles o largas)',
  n8n: 'Pregunta al Jarvis de n8n (tiene Gmail, memoria de ideas/informes y búsqueda web)',
  manos: 'Tarea real en el PC con Claude Code: archivos, navegador, Shopify, n8n',
  memoria_buscar: 'Busca en la memoria local de Jarvis',
  memoria_guardar: 'Guarda un dato en la memoria local',
  noticias: 'Titulares de noticias de hoy (RSS)',
  avisar: 'Envía un aviso al móvil de Ayoub (ntfy)',
};
// Estas traen texto de fuera: su resultado se trata como DATOS, no órdenes.
const EXTERNAS = new Set(['n8n', 'manos', 'noticias']);

const carpetaIncluidas = path.join(__dirname, 'incluidas');
const carpetaAprendidas = () => rutas.asegurar(rutas.datos('habilidades'));

function validar(h) {
  const errores = [];
  if (!h || typeof h !== 'object') return ['No es una habilidad'];
  if (!/^[a-z0-9][a-z0-9-]{1,48}$/.test(h.nombre || '')) errores.push('nombre: solo minúsculas, números y guiones');
  if (!h.descripcion) errores.push('falta descripcion');
  if (!Array.isArray(h.pasos) || h.pasos.length === 0 || h.pasos.length > 10) errores.push('pasos: entre 1 y 10');
  for (const [i, p] of (h.pasos || []).entries()) {
    if (!HERRAMIENTAS[p.herramienta]) errores.push(`paso ${i + 1}: herramienta desconocida "${p.herramienta}"`);
    if (typeof p.plantilla !== 'string' || !p.plantilla.trim() || p.plantilla.length > 4000) errores.push(`paso ${i + 1}: plantilla vacía o demasiado larga`);
    if (!/^[a-z_][a-z0-9_]{0,40}$/.test(p.salida || '')) errores.push(`paso ${i + 1}: salida debe ser un nombre corto (a-z, _)`);
  }
  if (h.disparadores && !Array.isArray(h.disparadores)) errores.push('disparadores debe ser una lista');
  return errores;
}

function leerToml(ruta, origen) {
  const datos = TOML.parse(fs.readFileSync(ruta, 'utf8'));
  const h = datos.habilidad || {};
  return { ...h, disparadores: h.disparadores || [], pasos: h.pasos || [], origen, archivo: ruta };
}

function listar() {
  const todas = [];
  for (const [carpeta, origen] of [[carpetaIncluidas, 'incluida'], [carpetaAprendidas(), 'aprendida']]) {
    let archivos = [];
    try { archivos = fs.readdirSync(carpeta).filter((f) => f.endsWith('.toml')); } catch (_) { /* vacía */ }
    for (const f of archivos) {
      try {
        const h = leerToml(path.join(carpeta, f), origen);
        if (validar(h).length === 0) todas.push(h);
        else console.warn('[habilidades] inválida:', f, validar(h));
      } catch (e) {
        console.warn('[habilidades] no se pudo leer', f, e.message);
      }
    }
  }
  return todas;
}

/** Busca una habilidad cuyo disparador aparezca en el texto, o "usa la habilidad X". */
function buscar(texto) {
  const t = normalizar(texto);
  const todas = listar();
  const explicita = t.match(/(?:usa|ejecuta|lanza|utilise)\s+(?:la\s+)?habilidad\s+([a-z0-9-]+)/);
  if (explicita) {
    const h = todas.find((x) => x.nombre === explicita[1]);
    if (h) return h;
  }
  let mejor = null;
  let largo = 0;
  for (const h of todas) {
    for (const d of h.disparadores) {
      const nd = normalizar(d);
      if (nd && t.includes(nd) && nd.length > largo) { mejor = h; largo = nd.length; }
    }
  }
  return mejor;
}

function rellenar(plantilla, vars, externos) {
  return plantilla.replace(/\{([a-z_][a-z0-9_]*)\}/gi, (todo, k) => {
    if (!(k in vars)) return todo;
    const v = String(vars[k] ?? '');
    return externos.has(k) ? envolverDatos(k, v) : v;
  });
}

/**
 * Ejecuta una habilidad paso a paso.
 * @param {object} h habilidad
 * @param {string} entrada lo que pidió Ayoub
 * @param {Record<string,(texto:string)=>Promise<string>>} herramientas implementaciones
 * @param {(info:{paso:number,total:number,herramienta:string})=>void} alProgreso
 */
async function ejecutar(h, entrada, herramientas, alProgreso = () => {}) {
  const ahora = new Date();
  const vars = { entrada, fecha: ahora.toLocaleDateString('es-ES'), hora: ahora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) };
  const externos = new Set(); // salidas que vienen de fuera (se pasan como datos)
  registro.anotar({ origen: 'habilidades', accion: `ejecutar habilidad ${h.nombre}`, detalle: entrada });
  let ultimo = '';
  for (const [i, paso] of h.pasos.entries()) {
    alProgreso({ paso: i + 1, total: h.pasos.length, herramienta: paso.herramienta });
    const fn = herramientas[paso.herramienta];
    if (!fn) throw new Error(`La herramienta ${paso.herramienta} no está disponible`);
    const texto = rellenar(paso.plantilla, vars, externos);
    const resultado = await fn(texto);
    vars[paso.salida] = resultado;
    if (EXTERNAS.has(paso.herramienta)) externos.add(paso.salida);
    ultimo = resultado;
  }
  return ultimo;
}

// --- "Aprende a hacer X" --------------------------------------------------------
const PROMPT_APRENDER = `Eres el creador de habilidades de Jarvis. Convierte la petición de Ayoub en una habilidad reutilizable en TOML con EXACTAMENTE este formato:

[habilidad]
nombre = "nombre-con-guiones"
descripcion = "qué hace, en una frase"
version = "1.0.0"
autor = "aprendida"
disparadores = ["frase corta que la activa", "otra forma de pedirlo"]

[[habilidad.pasos]]
herramienta = "una de las herramientas"
plantilla = "instrucción del paso; usa {entrada} para lo que pida Ayoub y {salida_de_un_paso_anterior}"
salida = "nombre_corto"

Herramientas disponibles:
${Object.entries(HERRAMIENTAS).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
Variables siempre disponibles: {entrada}, {fecha}, {hora}.

Reglas: entre 1 y 6 pasos; el último paso produce la respuesta para Ayoub; disparadores en el idioma de Ayoub;
nunca pagar, comprar, borrar ni operar con dinero (para eso Jarvis pedirá confirmación aparte);
responde SOLO con el TOML, sin explicaciones ni bloques de código.`;

/**
 * @param {string} descripcion lo que Ayoub quiere que aprenda
 * @param {(sistema:string, usuario:string)=>Promise<string>} llm
 */
async function aprender(descripcion, llm) {
  let ultimoError = '';
  for (let intento = 0; intento < 2; intento++) {
    const pista = ultimoError ? `\n\nEl intento anterior falló: ${ultimoError}. Corrígelo.` : '';
    const salida = await llm(PROMPT_APRENDER, `Aprende a hacer esto: ${descripcion}${pista}`);
    const toml = String(salida || '').replace(/^```(?:toml)?\s*|```\s*$/g, '').trim();
    try {
      const datos = TOML.parse(toml);
      const h = { ...(datos.habilidad || {}), disparadores: datos.habilidad?.disparadores || [], pasos: datos.habilidad?.pasos || [] };
      const errores = validar(h);
      if (errores.length) { ultimoError = errores.join('; '); continue; }
      // No pisar una incluida ni otra aprendida con el mismo nombre.
      let nombre = h.nombre;
      const existentes = new Set(listar().map((x) => x.nombre));
      for (let n = 2; existentes.has(nombre); n++) nombre = `${h.nombre}-${n}`;
      h.nombre = nombre;
      const texto = TOML.stringify({ habilidad: { ...h, version: h.version || '1.0.0', autor: 'aprendida', aprendida_el: new Date().toISOString(), peticion: descripcion } });
      const ruta = path.join(carpetaAprendidas(), `${nombre}.toml`);
      fs.writeFileSync(ruta, `# Habilidad aprendida por Jarvis\n${texto}`);
      registro.anotar({ origen: 'habilidades', accion: `aprender habilidad ${nombre}`, detalle: descripcion });
      return { ok: true, habilidad: { ...h, origen: 'aprendida', archivo: ruta } };
    } catch (e) {
      ultimoError = `TOML no válido (${e.message.split('\n')[0]})`;
    }
  }
  return { ok: false, error: `No he podido crear la habilidad: ${ultimoError}` };
}

function borrar(nombre) {
  const ruta = path.join(carpetaAprendidas(), `${nombre}.toml`);
  if (!/^[a-z0-9-]+$/.test(nombre) || !fs.existsSync(ruta)) return false;
  // Nada se borra del todo: va a _papelera.
  const papelera = rutas.asegurar(rutas.datos('_papelera'));
  fs.renameSync(ruta, path.join(papelera, `${nombre}-${Date.now()}.toml`));
  registro.anotar({ origen: 'habilidades', accion: `mover habilidad ${nombre} a _papelera` });
  return true;
}

// "Aprende a …" / "Apprends à …" / "تعلم …"
const RE_APRENDER = /^(?:jarvis[,\s]+)?(?:aprende\s+(?:a|cómo|como)|apprends(?:\s+à|\s+a)?|تعلم|t3allem|ta3allem)\s+(.+)$/i;
const detectarAprender = (texto) => { const m = String(texto || '').trim().match(RE_APRENDER); return m ? m[1].trim() : null; };

module.exports = { listar, buscar, ejecutar, aprender, borrar, validar, detectarAprender, HERRAMIENTAS };
