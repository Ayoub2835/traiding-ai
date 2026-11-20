// Publicación en TikTok, Instagram y Facebook (además de YouTube).
//  - Hace una versión VERTICAL 1080x1920 del vídeo: el vídeo original centrado
//    sobre un fondo desenfocado, con el título arriba y el canal abajo.
//  - Si dura más de 89 s, se acelera un poco (hasta x1,25) porque los Reels de
//    Facebook no admiten más de 90 s.
//  - Publica en cada red conectada; si una falla, las demás siguen.
'use strict';
const fs = require('fs');
const path = require('path');
const rutas = require('../nucleo/rutas');
const registro = require('../seguridad/registro');
const meta = require('./meta');
const tiktok = require('./tiktok');

const NOMBRES = { tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };
const MAX_REEL = 89;

/** Redes conectadas (en el orden en que se publica). */
function activas() {
  const m = meta.estado();
  return ['tiktok', 'instagram', 'facebook'].filter((r) => (r === 'tiktok' ? tiktok.estado().tiktok : m[r]));
}

function estado() {
  return { ...meta.estado(), ...tiktok.estado(), activas: activas() };
}

/** Texto de la publicación: título, primer párrafo, aviso y hashtags. */
function texto({ titulo, descripcion = '', etiquetas = [] }) {
  const parrafos = String(descripcion).split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const aviso = parrafos.find((p) => /⚠️|recomendación de inversión/.test(p));
  const tags = etiquetas.slice(0, 10).map((e) => `#${String(e).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]/gu, '')}`).filter((t) => t.length > 1);
  return [titulo, parrafos[0] !== aviso ? parrafos[0] : '', aviso || '', tags.join(' ')].filter(Boolean).join('\n\n').slice(0, 2200);
}

const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
function partir(t, max) {
  const out = []; let a = '';
  for (const p of String(t).split(/\s+/).filter(Boolean)) { if ((a + ' ' + p).trim().length > max && a) { out.push(a); a = p; } else a = `${a} ${p}`.trim(); }
  if (a) out.push(a);
  return out;
}

function svgRotulos(titulo, canal) {
  const F = 'Segoe UI, Arial, Helvetica, DejaVu Sans, sans-serif';
  const lineas = partir(titulo, 22).slice(0, 4);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920">
<rect x="60" y="150" width="960" height="${lineas.length * 92 + 70}" rx="28" fill="#000" fill-opacity="0.55"/>
${lineas.map((l, i) => `<text x="540" y="${245 + i * 92}" text-anchor="middle" font-family="${F}" font-size="76" font-weight="800" fill="#ffffff">${esc(l)}</text>`).join('')}
<rect x="290" y="1630" width="500" height="90" rx="45" fill="#f7931a"/>
<text x="540" y="1690" text-anchor="middle" font-family="${F}" font-size="44" font-weight="700" fill="#0b1220">${esc(canal)}</text></svg>`;
}

/** Crea la versión vertical (1080x1920, ≤ 89 s si se puede) de un vídeo horizontal. */
async function hacerVertical(entrada, titulo, salida) {
  const creador = require('../youtube/creador');
  const sharp = require('sharp');
  const rotulos = `${salida}.rotulos.png`;
  await sharp(Buffer.from(svgRotulos(titulo, creador.canal()))).png().toFile(rotulos);
  const dur = await creador.duracion(entrada);
  const f = dur > MAX_REEL ? Math.min(dur / MAX_REEL, 1.25) : 1;
  try {
    await creador.ffmpeg([
      '-i', entrada, '-loop', '1', '-i', rotulos,
      '-filter_complex',
      '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=40,eq=brightness=-0.25[fondo];'
      + '[0:v]scale=1080:-2[centro];[fondo][centro]overlay=0:(H-h)/2[m];'
      + `[m][1:v]overlay=0:0:shortest=1,setpts=PTS/${f.toFixed(4)},fps=30,format=yuv420p[v];`
      + `[0:a]atempo=${f.toFixed(4)},aresample=48000[a]`,
      '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', salida,
    ]);
  } finally {
    fs.rmSync(rotulos, { force: true });
  }
  return { archivo: salida, duracion: dur / f, acelerado: f > 1 };
}

/**
 * Publica el vídeo en todas las redes conectadas.
 * @returns {Promise<Record<string,{ok:boolean,url?:string|null,nota?:string,error?:string}>>}
 */
async function publicar(video, datos, { redes = activas(), dep = {} } = {}) {
  if (!redes.length) return {};
  const trabajo = rutas.asegurar(rutas.datos('redes', 'trabajo', String(Date.now())));
  const resultados = {};
  try {
    const v = await (dep.hacerVertical || hacerVertical)(video, datos.titulo, path.join(trabajo, 'vertical.mp4'));
    const t = texto(datos);
    const pub = {
      tiktok: () => tiktok.publicar(v.archivo, t),
      instagram: () => meta.publicarInstagram(v.archivo, t),
      facebook: () => meta.publicarFacebook(v.archivo, { titulo: datos.titulo, texto: t }),
      ...(dep.publicar || {}),
    };
    for (const red of redes) {
      try {
        const r = await pub[red]();
        let nota = '';
        if (red === 'tiktok' && r.privacidad === 'SELF_ONLY') nota = 'privado: TikTok aún no ha auditado tu app';
        if (r.pendiente) nota = 'en revisión de TikTok';
        resultados[red] = { ok: true, url: r.url || null, nota };
      } catch (e) {
        resultados[red] = { ok: false, error: e.message };
      }
      registro.anotar({ origen: 'redes', accion: `publicar en ${NOMBRES[red]} «${datos.titulo}»`, decision: resultados[red].ok ? 'hecho' : 'fallo', detalle: resultados[red] });
    }
    if (v.acelerado) for (const r of Object.values(resultados)) r.nota = [r.nota, 'acelerado para durar ≤ 90 s'].filter(Boolean).join('; ');
  } catch (e) {
    for (const red of redes) resultados[red] = { ok: false, error: `No se pudo preparar el vídeo vertical: ${e.message}` };
  } finally {
    fs.rmSync(trabajo, { recursive: true, force: true });
  }
  return resultados;
}

/** Una línea por red: "TikTok ✔ (url)" / "Instagram ✘ motivo". */
const resumen = (res) => Object.entries(res).map(([red, r]) => (r.ok
  ? `${NOMBRES[red]} ✔${r.url ? ` ${r.url}` : ''}${r.nota ? ` (${r.nota})` : ''}`
  : `${NOMBRES[red]} ✘ ${r.error}`)).join(' · ');

module.exports = { activas, estado, texto, hacerVertical, publicar, resumen, NOMBRES };
