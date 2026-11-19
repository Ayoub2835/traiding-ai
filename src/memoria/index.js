// Memoria local de Jarvis (en %APPDATA%\Jarvis\memoria):
//   conversacion.jsonl  lo que habláis (una línea por mensaje)
//   hechos.json         hechos duraderos: preferencias, decisiones, datos, tareas
//
// Idea de OpenJarvis (memory/store.py y extractor.py): guardar "hechos" cortos y
// duraderos, deduplicados y con tope, extraídos de la conversación. Implementación
// propia en JavaScript con archivos JSON (sin base de datos que instalar).
// La memoria de n8n (panel) sigue existiendo y se suma como contexto.
'use strict';
const fs = require('fs');
const crypto = require('crypto');
const rutas = require('../nucleo/rutas');

const MAX_HECHOS = 500;
const TIPOS = ['preferencia', 'decision', 'dato', 'tarea', 'persona'];

const archivo = (n) => rutas.datos('memoria', n);
function asegurarCarpeta() { rutas.asegurar(rutas.datos('memoria')); }

// Normaliza para comparar: minúsculas, sin acentos ni signos.
function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
const VACIAS = new Set('el la los las un una unos unas de del al a y o que en con por para es son se mi tu su lo le me te nos qué que como cómo cuando donde le les the and or of to in is it je tu il de la le les et ou un une des est pas'.split(' '));
const palabras = (t) => normalizar(t).split(' ').filter((p) => p.length > 2 && !VACIAS.has(p));

// --- Conversación -----------------------------------------------------------
function guardarMensaje(rol, texto, extra = {}) {
  asegurarCarpeta();
  const linea = { fecha: new Date().toISOString(), rol, texto: String(texto || '').slice(0, 4000), ...extra };
  fs.appendFileSync(archivo('conversacion.jsonl'), JSON.stringify(linea) + '\n');
  return linea;
}

function ultimosMensajes(n = 10) {
  try {
    const lineas = fs.readFileSync(archivo('conversacion.jsonl'), 'utf8').trim().split('\n');
    return lineas.slice(-n).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
  } catch (_) {
    return [];
  }
}

// --- Hechos -----------------------------------------------------------------
function leerHechos() {
  try { return JSON.parse(fs.readFileSync(archivo('hechos.json'), 'utf8')); } catch (_) { return []; }
}
function escribirHechos(h) {
  asegurarCarpeta();
  fs.writeFileSync(archivo('hechos.json'), JSON.stringify(h, null, 2));
}

/** Guarda un hecho (sin duplicados). Devuelve el hecho guardado o el existente. */
function guardarHecho(texto, tipo = 'dato', origen = 'conversacion') {
  const limpio = String(texto || '').trim().slice(0, 500);
  if (!limpio) return null;
  const hechos = leerHechos();
  const n = normalizar(limpio);
  const existente = hechos.find((h) => normalizar(h.texto) === n);
  if (existente) { existente.fecha = new Date().toISOString(); escribirHechos(hechos); return existente; }
  const hecho = { id: crypto.randomBytes(4).toString('hex'), tipo: TIPOS.includes(tipo) ? tipo : 'dato', texto: limpio, origen, fecha: new Date().toISOString() };
  hechos.push(hecho);
  // Tope: se quitan los más antiguos.
  hechos.sort((a, b) => a.fecha.localeCompare(b.fecha));
  escribirHechos(hechos.slice(-MAX_HECHOS));
  return hecho;
}

function borrarHecho(id) {
  const hechos = leerHechos();
  const quedan = hechos.filter((h) => h.id !== id);
  escribirHechos(quedan);
  return hechos.length !== quedan.length;
}

/** Busca hechos parecidos a la consulta (palabras en común + recientes primero). */
function buscar(consulta, n = 5) {
  const q = new Set(palabras(consulta));
  const ahora = Date.now();
  return leerHechos()
    .map((h) => {
      const comunes = palabras(h.texto).filter((p) => q.has(p)).length;
      const dias = (ahora - new Date(h.fecha).getTime()) / 86400000;
      const extra = h.tipo === 'preferencia' || h.tipo === 'decision' ? 0.3 : 0;
      return { ...h, puntos: comunes + extra + Math.max(0, 0.5 - dias / 60) };
    })
    .filter((h) => h.puntos > 0.6 || (q.size === 0 && h.puntos > 0))
    .sort((a, b) => b.puntos - a.puntos)
    .slice(0, n);
}

/** Texto de contexto para los modelos: hechos relevantes + últimos mensajes. */
function contexto(consulta, { mensajes = 6, hechos = 6 } = {}) {
  const partes = [];
  const relevantes = buscar(consulta, hechos);
  const preferencias = leerHechos().filter((h) => h.tipo === 'preferencia').slice(-3);
  const todos = [...new Map([...preferencias, ...relevantes].map((h) => [h.id, h])).values()];
  if (todos.length) partes.push('Lo que recuerdo de Ayoub:\n' + todos.map((h) => `- (${h.tipo}) ${h.texto}`).join('\n'));
  const ult = ultimosMensajes(mensajes);
  if (ult.length) partes.push('Conversación reciente:\n' + ult.map((m) => `${m.rol === 'yo' ? 'Ayoub' : 'Jarvis'}: ${m.texto.slice(0, 300)}`).join('\n'));
  return partes.join('\n\n');
}

// --- Extracción automática de hechos (estilo OpenJarvis) ----------------------
const PROMPT_EXTRACTOR = `Extrae de esta conversación SOLO hechos duraderos que merezca la pena recordar sobre Ayoub:
preferencias, decisiones tomadas, datos de su negocio o vida, tareas pendientes, personas.
Nada de saludos ni cosas pasajeras. Responde SOLO con JSON: {"hechos":[{"tipo":"preferencia|decision|dato|tarea|persona","texto":"…"}]}.
Si no hay nada, responde {"hechos":[]}. Escribe los hechos en español.`;

/**
 * @param {(sistema:string, usuario:string)=>Promise<string>} llm función que llama a un modelo
 */
async function extraerHechos(llm, n = 8) {
  const ult = ultimosMensajes(n);
  if (ult.length < 2) return [];
  const texto = ult.map((m) => `${m.rol === 'yo' ? 'Ayoub' : 'Jarvis'}: ${m.texto}`).join('\n');
  const salida = await llm(PROMPT_EXTRACTOR, texto);
  const m = String(salida || '').match(/\{[\s\S]*\}/);
  if (!m) return [];
  let datos;
  try { datos = JSON.parse(m[0]); } catch (_) { return []; }
  return (datos.hechos || []).map((h) => guardarHecho(h.texto, h.tipo, 'extraido')).filter(Boolean);
}

// "Recuerda que …" / "Rappelle-toi que …" / "تذكر أن …"
const RE_RECUERDA = /^(?:jarvis[,\s]+)?(?:recuerda|apunta|anota|no olvides)\s+(?:que\s+)?(.+)$|^(?:rappelle-toi|souviens-toi)\s+(?:que\s+)?(.+)$|^(?:تذكر|تذكّر)\s+(?:أن\s+)?(.+)$/i;
function detectarRecuerda(texto) {
  const m = String(texto || '').trim().match(RE_RECUERDA);
  return m ? (m[1] || m[2] || m[3]).trim() : null;
}

// --- Entradas (lo que antes guardaba n8n en la tabla jarvis_memoria) ---------------
// Ideas, informes, decisiones… con estado (pendiente_de_ver, en_curso, visto…).
// Se muestran en el panel PENDIENTE / MEMORIA y las crean las rutinas.
const archivoEntradas = () => archivo('entradas.json');
function leerEntradas() {
  try { return JSON.parse(fs.readFileSync(archivoEntradas(), 'utf8')); } catch (_) { return []; }
}
function escribirEntradas(e) { asegurarCarpeta(); fs.writeFileSync(archivoEntradas(), JSON.stringify(e, null, 2)); }

/** Entradas para el panel (más recientes primero), con el formato del panel de n8n. */
function panel(n = 40) {
  return leerEntradas()
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)))
    .slice(0, n)
    .map((e) => ({ id: e.id, tipo: e.tipo, negocio: e.negocio || '', titulo: e.titulo, detalle: String(e.detalle || '').slice(0, 1200), fuente: e.fuente || '', euros: Number(e.euros_estimados) || 0, estado: e.estado || '', fecha: e.fecha }));
}

function agregarEntrada(e) {
  const entradas = leerEntradas();
  const nueva = {
    id: e.id || `j-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`,
    tipo: e.tipo || 'nota', negocio: e.negocio || '', titulo: String(e.titulo || '').slice(0, 200),
    estado: e.estado || 'pendiente_de_ver', euros_estimados: Number(e.euros_estimados) || 0,
    fecha: e.fecha || new Date().toISOString(), fuente: e.fuente || '', detalle: String(e.detalle || '').slice(0, 4000),
    origen: e.origen || 'jarvis',
  };
  entradas.push(nueva);
  escribirEntradas(entradas);
  return nueva;
}

function cambiarEstado(id, estado) {
  const entradas = leerEntradas();
  const e = entradas.find((x) => String(x.id) === String(id));
  if (!e) return false;
  e.estado = estado;
  escribirEntradas(entradas);
  return true;
}

/**
 * Importa la memoria exportada de n8n ({origen, filas:[…]}) sin duplicar:
 * cada fila queda con id "n8n-<id>".
 * @returns {{importadas:number, yaEstaban:number}}
 */
function importarN8n(datos) {
  const filas = Array.isArray(datos) ? datos : datos && datos.filas;
  if (!Array.isArray(filas)) throw new Error('El archivo no tiene una lista "filas"');
  const entradas = leerEntradas();
  const ids = new Set(entradas.map((e) => String(e.id)));
  let importadas = 0;
  let yaEstaban = 0;
  for (const f of filas) {
    const id = `n8n-${f.id}`;
    if (ids.has(id)) { yaEstaban++; continue; }
    entradas.push({ id, tipo: f.tipo || 'nota', negocio: f.negocio || '', titulo: f.titulo || '', estado: f.estado || 'pendiente_de_ver',
      euros_estimados: Number(f.euros_estimados) || 0, fecha: f.fecha || new Date().toISOString(), fuente: f.fuente || '', detalle: f.detalle || '', origen: 'n8n' });
    ids.add(id);
    importadas++;
  }
  escribirEntradas(entradas);
  return { importadas, yaEstaban };
}

/** Busca importado-n8n.json en los sitios habituales y lo importa (sin duplicar). */
function importarAutomatico(rutasPosibles) {
  for (const r of rutasPosibles) {
    try {
      if (!fs.existsSync(r)) continue;
      const res = importarN8n(JSON.parse(fs.readFileSync(r, 'utf8')));
      return { ...res, archivo: r };
    } catch (_) { /* archivo dañado: se ignora */ }
  }
  return null;
}

/** ¿Hay ya una idea de hoy? (máximo 1 idea al día) */
function hayIdeaHoy() {
  const hoy = new Date().toISOString().slice(0, 10);
  return leerEntradas().some((e) => e.tipo === 'idea' && String(e.fecha).slice(0, 10) === hoy && e.origen !== 'n8n-prueba');
}

module.exports = { leerEntradas, panel, agregarEntrada, cambiarEstado, importarN8n, importarAutomatico, hayIdeaHoy,
  guardarMensaje, ultimosMensajes, guardarHecho, borrarHecho, leerHechos, buscar, contexto, extraerHechos, detectarRecuerda, normalizar };
