// Reels de un vídeo propio: elección de momentos por sonoridad y recorte real
// con ffmpeg; los reels quedan en «Por revisar» (no se publican solos).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-reels-'));
const recortes = require('../src/redes/recortes');
const creador = require('../src/youtube/creador');

const hayFfmpeg = spawnSync(creador.rutaFfmpeg(), ['-version']).status === 0;

test('elegirMomentos: los tramos más fuertes, sin solaparse y en orden', () => {
  // 600 s; muy alto en 100-145 y en 400-445; algo alto en 250-295.
  const puntos = [];
  for (let t = 0; t < 600; t += 0.1) {
    const m = (t >= 100 && t < 145) || (t >= 400 && t < 445) ? -10 : (t >= 250 && t < 295 ? -18 : -35);
    puntos.push({ t, m });
  }
  assert.deepStrictEqual(recortes.elegirMomentos(puntos, 600, { n: 2, dur: 45 }), [100, 400]);
  assert.deepStrictEqual(recortes.elegirMomentos(puntos, 600, { n: 3, dur: 45 }), [100, 250, 400]);
  assert.deepStrictEqual(recortes.elegirMomentos(puntos, 30, { n: 3, dur: 45 }), [0], 'vídeo corto: un solo reel entero');
});

test('crear: recorta el momento más fuerte, lo pone en vertical y lo deja en «Por revisar»', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
  const video = path.join(process.env.JARVIS_DATOS, 'mi_video.mp4');
  // 30 s de vídeo; el audio es casi silencio salvo un tramo fuerte entre 15 y 20 s.
  const r0 = spawnSync(creador.rutaFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=30',
    '-f', 'lavfi', '-i', "aevalsrc='0.01*sin(2*PI*440*t)*(1+60*between(t,15,20))':s=44100:d=30", '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video]);
  assert.strictEqual(r0.status, 0);
  const verticales = [];
  const r = await recortes.crear({
    archivo: video, n: 1, dur: 5,
    dep: { hacerVertical: async (corte, titulo, salida) => { verticales.push({ titulo, dur: await creador.duracion(corte) }); fs.copyFileSync(corte, salida); return { archivo: salida }; } },
  });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.reels.length, 1);
  assert.ok(Math.abs(r.reels[0].inicio - 15) <= 1, `debía elegir ~15 s y eligió ${r.reels[0].inicio}`);
  assert.ok(Math.abs(verticales[0].dur - 5) < 0.3);
  assert.strictEqual(verticales[0].titulo, 'mi video');
  assert.strictEqual(r.carpeta, path.join(process.env.JARVIS_DATOS, 'youtube', 'revisar'));
  const archivos = fs.readdirSync(r.carpeta).sort();
  assert.strictEqual(archivos.length, 2);
  assert.match(archivos[0], /-reel-1\.json$/);
  assert.match(archivos[1], /-reel-1\.mp4$/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(r.carpeta, archivos[0]), 'utf8')).titulo, 'mi video #Shorts');
  assert.deepStrictEqual(fs.readdirSync(path.join(process.env.JARVIS_DATOS, 'reels', 'trabajo')), [], 'borra los cortes intermedios');
});

test('crear: rechaza archivos que no son vídeo', async () => {
  const txt = path.join(process.env.JARVIS_DATOS, 'nota.txt');
  fs.writeFileSync(txt, 'hola');
  const r = await recortes.crear({ archivo: txt });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no parece un vídeo/);
});
