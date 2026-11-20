// «Por revisar»: vídeo de un tema (prompt), lista, edición del texto, publicar
// solo en las redes elegidas, descartar, y la rutina en modo revisión.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-revision-'));
const claves = require('../src/nucleo/claves');
const creador = require('../src/youtube/creador');
const youtube = require('../src/youtube');
const revision = require('../src/redes/revision');

const hayFfmpeg = spawnSync(creador.rutaFfmpeg(), ['-version']).status === 0;
const revisar = () => youtube.carpeta('revisar');
const vaciar = () => { for (const d of ['revisar', 'pendientes', 'subidos']) for (const f of fs.readdirSync(youtube.carpeta(d))) fs.unlinkSync(path.join(youtube.carpeta(d), f)); };
const vozFalsa = async () => {
  const f = path.join(os.tmpdir(), `voz-rev-${process.pid}.mp3`);
  spawnSync(creador.rutaFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=0.5', '-c:a', 'libmp3lame', f]);
  return fs.readFileSync(f);
};

test('crearDesdeTema: sin tema o sin cerebro, error claro', async () => {
  assert.match((await creador.crearDesdeTema({ tema: '  ', pensar: async () => ({}) })).error, /Escribe de qué/);
  assert.match((await creador.crearDesdeTema({ tema: 'historia de Bitcoin' })).error, /Claude o Gemini/);
  const r = await creador.crearDesdeTema({ tema: 'x', pensar: async () => ({ ok: true, texto: 'nada' }), dep: { noticias: async () => [] } });
  assert.match(r.error, /guion válido/);
});

test('crearDesdeTema: guion del cerebro con titulares reales, vídeo en «Por revisar»', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
  vaciar();
  let pedido = '';
  const pensar = async (sistema, usuario) => {
    pedido = sistema + usuario;
    return { ok: true, texto: JSON.stringify({ titulo: 'Bitcoin en 1 minuto', intro: 'Hola.', escenas: [{ titular: 'Nace en 2009', puntos: ['Satoshi Nakamoto'], narracion: 'Bitcoin nació en 2009.' }, { titular: 'Halving', puntos: [], narracion: 'Cada cuatro años.' }], cierre: 'Adiós.', descripcion: 'Historia breve.', etiquetas: ['bitcoin', 'historia'] }) };
  };
  const r = await creador.crearDesdeTema({ tema: 'Historia de Bitcoin', pensar, dep: { voz: vozFalsa, noticias: async () => [{ titulo: 'Bitcoin cumple años', url: 'https://ej.com/1', medio: 'El País' }] } });
  assert.ok(r.ok, r.error);
  assert.strictEqual(path.dirname(r.video), revisar());
  assert.strictEqual(r.escenas, 4, 'portada + 2 escenas + cierre');
  assert.match(pedido, /Tema pedido: Historia de Bitcoin/);
  assert.match(pedido, /Bitcoin cumple años · El País/);
  const lista = revision.lista();
  assert.strictEqual(lista.length, 1);
  assert.strictEqual(lista[0].titulo, 'Bitcoin en 1 minuto');
  assert.match(lista[0].descripcion, /Historia breve\.[\s\S]*https:\/\/ej\.com\/1/);
  assert.deepStrictEqual(lista[0].etiquetas, ['bitcoin', 'historia']);
});

test('revisión: editar el texto, publicar solo en las redes elegidas y descartar', async () => {
  vaciar();
  fs.writeFileSync(path.join(revisar(), 'a.mp4'), 'x');
  fs.writeFileSync(path.join(revisar(), 'a.txt'), 'Título viejo\nDesc vieja');
  fs.writeFileSync(path.join(revisar(), 'b.mp4'), 'y');
  revision.guardar('a.mp4', { titulo: 'Título nuevo', descripcion: 'Desc nueva' });
  const a = revision.lista().find((v) => v.nombre === 'a.mp4');
  assert.deepStrictEqual([a.titulo, a.descripcion], ['Título nuevo', 'Desc nueva']);
  assert.ok(!fs.existsSync(path.join(revisar(), 'a.txt')), 'el .json manda: el .txt viejo se quita');

  let recibido = null;
  const r = await revision.publicar('a.mp4', ['youtube', 'tiktok'], { dep: { publicarArchivo: async (p, m, o) => { recibido = { p, titulo: m.titulo, destinos: o.destinos }; return { ok: true, resumen: 'ok' }; } } });
  assert.ok(r.ok);
  assert.deepStrictEqual(recibido, { p: path.join(revisar(), 'a.mp4'), titulo: 'Título nuevo', destinos: ['youtube', 'tiktok'] });
  assert.match((await revision.publicar('a.mp4', [])).error, /al menos una red/);

  assert.ok(revision.descartar('b.mp4').ok);
  assert.ok(!fs.existsSync(path.join(revisar(), 'b.mp4')));
  assert.throws(() => revision.ruta('../../secreto.mp4'), /ya no está/);
  assert.throws(() => revision.ruta('b.mp4'), /ya no está/);
});

test('publicarArchivo: solo en las redes elegidas y conectadas; mueve a subidos', async () => {
  vaciar();
  claves.guardar({ YOUTUBE_REFRESH_TOKEN: '' });
  const p = path.join(revisar(), 'c.mp4');
  fs.writeFileSync(p, 'z');
  const llamadas = [];
  const redes = { activas: () => ['tiktok', 'facebook'], publicar: async (_v, _m, o) => { llamadas.push(o.redes); return Object.fromEntries(o.redes.map((x) => [x, { ok: true }])); }, resumen: () => 'bien' };
  const r = await youtube.publicarArchivo(p, { titulo: 'C' }, { destinos: ['youtube', 'tiktok', 'instagram'], redes });
  assert.ok(r.ok, r.error);
  assert.deepStrictEqual(llamadas, [['tiktok']], 'YouTube e Instagram no están conectados; Facebook no se eligió');
  assert.ok(!fs.existsSync(p));
  assert.strictEqual(fs.readdirSync(youtube.carpeta('subidos')).length, 1);
  const r2 = await youtube.publicarArchivo(p, { titulo: 'C' }, { destinos: ['instagram'], redes });
  assert.match(r2.error, /Ninguna de las redes elegidas/);
});

test('rutina en modo revisión (por defecto): crea el vídeo y NO lo publica', async () => {
  vaciar();
  claves.guardar({ YOUTUBE_REFRESH_TOKEN: 'ref', YOUTUBE_CREAR: '', YOUTUBE_REVISAR: '' });
  let destino = null;
  let publicado = false;
  const redes = { activas: () => ['tiktok'], publicar: async () => { publicado = true; return {}; }, resumen: () => '' };
  const r = await youtube.ejecutar({ redes, crear: async (d) => { destino = d; return { ok: true, titulo: 'Vídeo nuevo' }; } });
  assert.ok(r.ok);
  assert.strictEqual(destino, 'revisar');
  assert.match(r.resumen, /listo para revisar: «Vídeo nuevo»/);
  assert.strictEqual(publicado, false);

  claves.guardar({ YOUTUBE_REVISAR: 'no' });
  await youtube.ejecutar({ redes, crear: async (d) => { destino = d; return { ok: true, titulo: 'X' }; } });
  assert.strictEqual(destino, 'pendientes', 'sin revisión, va directo a la cola');
});
