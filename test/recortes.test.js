// Reels de un vídeo propio: elección de momentos por sonoridad, recorte real
// con ffmpeg y publicación (con redes simuladas).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-reels-'));
const claves = require('../src/nucleo/claves');
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

test('crear: recorta el momento más fuerte de un vídeo real y lo pone en vertical', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
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
  assert.deepStrictEqual(fs.readdirSync(r.carpeta), ['reel-1.mp4'], 'borra los cortes intermedios');
});

test('crear + publicar: sube cada reel a las redes conectadas tal cual (ya es vertical)', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
  claves.guardar({ YOUTUBE_REFRESH_TOKEN: '', META_PAGE_TOKEN: 'P', META_PAGE_ID: 'P1', META_IG_ID: 'IG1' });
  const video = path.join(process.env.JARVIS_DATOS, 'charla.mp4');
  spawnSync(creador.rutaFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30:duration=12', '-f', 'lavfi', '-i', 'sine=duration=12', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', video]);
  const llamadas = [];
  const r = await recortes.crear({
    archivo: video, titulo: 'Mi charla', n: 2, dur: 4, publicar: true,
    dep: {
      hacerVertical: async (corte, _t, salida) => { fs.copyFileSync(corte, salida); return { archivo: salida }; },
      publicar: async (archivo, datos, { redes, dep }) => {
        const v = await dep.hacerVertical(archivo);
        llamadas.push({ archivo, mismo: v.archivo === archivo, redes, titulo: datos.titulo });
        return Object.fromEntries(redes.map((x) => [x, { ok: true, url: `https://${x}/r` }]));
      },
    },
  });
  assert.ok(r.ok, r.error);
  assert.strictEqual(llamadas.length, 2);
  assert.deepStrictEqual(llamadas.map((l) => [l.titulo, l.mismo, l.redes]), [['Mi charla (1/2)', true, ['instagram', 'facebook']], ['Mi charla (2/2)', true, ['instagram', 'facebook']]]);
  assert.match(r.resumen, /«Mi charla \(1\/2\)»: Instagram ✔ https:\/\/instagram\/r · Facebook ✔/);
});

test('crear: rechaza archivos que no son vídeo', async () => {
  const txt = path.join(process.env.JARVIS_DATOS, 'nota.txt');
  fs.writeFileSync(txt, 'hola');
  const r = await recortes.crear({ archivo: txt });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no parece un vídeo/);
});
