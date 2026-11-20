// "Por revisar": los vídeos que crea Jarvis (y los reels de tus vídeos) esperan
// aquí a que los veas. Puedes cambiar el título y la descripción, elegir en qué
// redes salen y pulsar Publicar; o Descartar (va a _papelera, no se borra).
'use strict';
const fs = require('fs');
const path = require('path');
const rutas = require('../nucleo/rutas');
const registro = require('../seguridad/registro');
const youtube = require('../youtube');

const carpeta = () => youtube.carpeta('revisar');

/** Ruta del vídeo, solo si es un nombre de archivo de la carpeta (nada de rutas). */
function ruta(nombre) {
  const n = path.basename(String(nombre || ''));
  const p = path.join(carpeta(), n);
  if (!n || n !== String(nombre) || !youtube.VIDEOS.test(n) || !fs.existsSync(p)) throw new Error('Ese vídeo ya no está en «Por revisar»');
  return p;
}

function lista() {
  const dir = carpeta();
  return fs.readdirSync(dir).filter((f) => youtube.VIDEOS.test(f)).map((f) => {
    const p = path.join(dir, f);
    let m = {};
    try { m = youtube.leerMetadatos(p) || {}; } catch (_) { m = {}; }
    return {
      nombre: f, archivo: p, creado: fs.statSync(p).mtime.toISOString(), tamañoMB: +(fs.statSync(p).size / 1048576).toFixed(1),
      titulo: m.titulo || youtube.tituloDeNombre(p), descripcion: m.descripcion || '', etiquetas: Array.isArray(m.etiquetas) ? m.etiquetas : [],
    };
  }).sort((a, b) => b.creado.localeCompare(a.creado));
}

/** Guarda tus cambios de título/descripción/etiquetas en el .json del vídeo. */
function guardar(nombre, { titulo, descripcion, etiquetas } = {}) {
  const p = ruta(nombre);
  const json = p.replace(/\.[^.]+$/, '.json');
  let actual = {};
  try { actual = JSON.parse(fs.readFileSync(json, 'utf8')); } catch (_) { actual = youtube.leerMetadatos(p) || {}; }
  const nuevo = {
    ...actual,
    ...(titulo !== undefined ? { titulo: String(titulo).slice(0, 100) } : {}),
    ...(descripcion !== undefined ? { descripcion: String(descripcion).slice(0, 4900) } : {}),
    ...(etiquetas !== undefined ? { etiquetas: Array.isArray(etiquetas) ? etiquetas : String(etiquetas).split(',').map((e) => e.trim()).filter(Boolean) } : {}),
  };
  fs.writeFileSync(json, JSON.stringify(nuevo, null, 2));
  const txt = p.replace(/\.[^.]+$/, '.txt');
  if (fs.existsSync(txt)) fs.rmSync(txt); // el .json manda
  return { ok: true };
}

/** Publica el vídeo revisado en las redes elegidas (p. ej. ['youtube','tiktok']). */
async function publicar(nombre, destinos, { dep = {} } = {}) {
  const p = ruta(nombre);
  const lista = Array.isArray(destinos) && destinos.length ? destinos : null;
  if (!lista) return { ok: false, error: 'Elige al menos una red' };
  const m = await youtube.metadatos(p);
  registro.anotar({ origen: 'revision', accion: `publicar «${m.titulo}»`, decision: 'aprobado por el usuario', detalle: lista });
  return (dep.publicarArchivo || youtube.publicarArchivo)(p, m, { destinos: lista });
}

/** Descarta el vídeo: lo mueve (con su .json/.txt) a _papelera. */
function descartar(nombre) {
  const p = ruta(nombre);
  const papelera = rutas.asegurar(rutas.datos('_papelera'));
  for (const f of [p, ...youtube.compañeros(p)]) fs.renameSync(f, path.join(papelera, `${Date.now()}-${path.basename(f)}`));
  registro.anotar({ origen: 'revision', accion: `descartar ${path.basename(p)} (a _papelera)` });
  return { ok: true };
}

module.exports = { lista, guardar, publicar, descartar, ruta, carpeta };
