// Reels a partir de un vídeo TUYO (un archivo de tu PC, del que tengas los
// derechos): Jarvis busca los momentos con más "energía" (el audio más alto,
// medido con el filtro ebur128 de ffmpeg), los recorta, los pone en vertical
// y los deja en «Por revisar» para que tú los publiques en YouTube (Shorts),
// TikTok, Instagram y Facebook.
//
// No descarga vídeos de YouTube ni de otras webs: subir películas o vídeos de
// otros infringe los derechos de autor y las redes bloquean esas cuentas.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const rutas = require('../nucleo/rutas');
const registro = require('../seguridad/registro');

const VIDEOS = /\.(mp4|mov|m4v|mkv|webm|avi)$/i;

/** Sonoridad momentánea por décima de segundo: [{t, m}] (m en LUFS). */
function sonoridad(archivo) {
  const { rutaFfmpeg } = require('../youtube/creador');
  return new Promise((resolver, rechazar) => {
    const p = spawn(rutaFfmpeg(), ['-hide_banner', '-nostats', '-i', archivo, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { windowsHide: true });
    const puntos = [];
    let resto = '';
    p.stderr.on('data', (d) => {
      const lineas = (resto + d).split('\n');
      resto = lineas.pop();
      for (const l of lineas) {
        const m = l.match(/\bt:\s*([\d.]+).*?\bM:\s*(-?[\d.]+|-inf)/);
        if (m) puntos.push({ t: Number(m[1]), m: m[2] === '-inf' ? -120 : Number(m[2]) });
      }
    });
    p.on('error', rechazar);
    p.on('close', (c) => (c === 0 ? resolver(puntos) : rechazar(new Error(`ffmpeg no pudo analizar el audio (código ${c})`))));
  });
}

/**
 * Elige n tramos de `dur` segundos sin solaparse, con el audio medio más alto.
 * Evita el 3 % inicial y final (cabeceras y créditos). Devuelve inicios ordenados.
 */
function elegirMomentos(puntos, total, { n = 3, dur = 45 } = {}) {
  if (total <= dur + 1) return [0];
  const margen = total * 0.03;
  const porSegundo = new Map();
  for (const p of puntos) {
    const s = Math.floor(p.t);
    const x = porSegundo.get(s) || { suma: 0, n: 0 };
    x.suma += p.m; x.n += 1;
    porSegundo.set(s, x);
  }
  const media = (s) => { const x = porSegundo.get(s); return x ? x.suma / x.n : -120; };
  const candidatos = [];
  for (let ini = Math.ceil(margen); ini + dur <= total - margen; ini += 1) {
    let suma = 0;
    for (let s = ini; s < ini + dur; s++) suma += media(s);
    candidatos.push({ ini, valor: suma / dur });
  }
  candidatos.sort((a, b) => b.valor - a.valor);
  const elegidos = [];
  for (const c of candidatos) {
    if (elegidos.every((e) => Math.abs(e - c.ini) >= dur)) elegidos.push(c.ini);
    if (elegidos.length === n) break;
  }
  return elegidos.sort((a, b) => a - b);
}

/**
 * Crea los reels y los deja en «Por revisar».
 * @param {{archivo:string, titulo?:string, n?:number, dur?:number, dep?:object}} o
 */
async function crear({ archivo, titulo, n = 3, dur = 45, dep = {} }) {
  const creador = require('../youtube/creador');
  const redes = require('./index');
  if (!archivo || !fs.existsSync(archivo)) return { ok: false, error: 'No encuentro el vídeo' };
  if (!VIDEOS.test(archivo)) return { ok: false, error: 'Ese archivo no parece un vídeo (mp4, mov, mkv, webm, avi)' };
  const nombre = titulo || path.basename(archivo, path.extname(archivo)).replace(/[_-]+/g, ' ').trim();
  const marca = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '');
  const trabajo = rutas.asegurar(rutas.datos('reels', 'trabajo', marca));
  // Los reels van a «Por revisar»: tú decides si se publican y dónde.
  const revisar = rutas.asegurar(rutas.datos('youtube', 'revisar'));
  try {
    const total = await creador.duracion(archivo);
    const inicios = elegirMomentos(await (dep.sonoridad || sonoridad)(archivo), total, { n, dur });
    const reels = [];
    for (const [i, ini] of inicios.entries()) {
      const largo = Math.min(dur, total - ini);
      const corte = path.join(trabajo, `corte-${i + 1}.mp4`);
      await creador.ffmpeg(['-ss', ini.toFixed(2), '-i', archivo, '-t', largo.toFixed(2), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', corte]);
      const tituloReel = inicios.length > 1 ? `${nombre} (${i + 1}/${inicios.length})` : nombre;
      const vertical = path.join(revisar, `${marca}-reel-${i + 1}.mp4`);
      await (dep.hacerVertical || redes.hacerVertical)(corte, tituloReel, vertical);
      fs.writeFileSync(vertical.replace(/\.mp4$/, '.json'), JSON.stringify({ titulo: `${tituloReel} #Shorts`.slice(0, 100), descripcion: tituloReel, etiquetas: ['shorts', 'reels'] }, null, 2));
      reels.push({ archivo: vertical, titulo: tituloReel, inicio: ini, duracion: largo });
    }
    registro.anotar({ origen: 'reels', accion: `crear ${reels.length} reels de ${path.basename(archivo)}`, decision: 'hecho' });
    return { ok: true, carpeta: revisar, reels, resumen: `${reels.length} reels listos en «Por revisar» (pestaña REDES)` };
  } catch (e) {
    registro.anotar({ origen: 'reels', accion: `crear reels de ${path.basename(archivo)}`, decision: 'fallo', motivo: e.message });
    return { ok: false, error: `No se pudieron crear los reels: ${e.message}` };
  } finally {
    fs.rmSync(trabajo, { recursive: true, force: true });
  }
}

module.exports = { crear, elegirMomentos, sonoridad };
