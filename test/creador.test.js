// Creador de vídeos: guion (con y sin cerebro), aviso legal, escenas, escapado
// del texto en las diapositivas y un montaje real corto con ffmpeg.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-creador-'));
const claves = require('../src/nucleo/claves');
const creador = require('../src/youtube/creador');
const youtube = require('../src/youtube');

const serie = Array.from({ length: 168 }, (_, i) => 60000 + Math.sin(i / 10) * 2000 + i * 10);
const DATOS = {
  monedas: [
    { id: 'bitcoin', nombre: 'Bitcoin', simbolo: 'BTC', precio: 62810, cambio24h: -0.4, cambio7d: 3.2, serie7d: serie },
    { id: 'ethereum', nombre: 'Ethereum', simbolo: 'ETH', precio: 1779.7, cambio24h: 1.1, cambio7d: -2, serie7d: [] },
  ],
  sentimiento: { valor: 10, clase: 'Extreme Fear' },
};
const NOTICIAS = [
  { titulo: 'Bitcoin & Nvidia <se mueven> juntos', url: 'https://ejemplo.com/1', medio: 'Expansión' },
  { titulo: 'Ethereum prepara su actualización', url: 'https://ejemplo.com/2', medio: 'Cointelegraph' },
];
const hayFfmpeg = spawnSync(creador.rutaFfmpeg(), ['-version']).status === 0;

test('guion sin cerebro: plantilla con datos reales y aviso legal', async () => {
  const g = await creador.guion(DATOS, NOTICIAS);
  assert.strictEqual(g.origen, 'plantilla');
  assert.match(g.mercado, /62\.810/);
  assert.match(g.cierre, /no es una recomendación de inversión/);
  assert.strictEqual(g.noticias.length, 2);
});

test('guion con cerebro: usa su JSON y añade el aviso si lo olvida', async () => {
  let recibido = '';
  const pensar = async (sistema, usuario) => {
    recibido = sistema + usuario;
    return { ok: true, texto: '```json\n{"titulo":"Bitcoin se frena","intro":"Hola.","mercado":"Bitcoin baja un poco.","grafico":"Semana al alza.","sentimiento":"Miedo extremo.","noticias":[{"titular":"Nvidia y Bitcoin","puntos":["Se mueven juntos"],"narracion":"Correlación alta."}],"cierre":"Hasta mañana.","etiquetas":["bitcoin"]}\n```' };
  };
  const g = await creador.guion(DATOS, NOTICIAS, pensar);
  assert.strictEqual(g.origen, 'cerebro');
  assert.strictEqual(g.titulo, 'Bitcoin se frena');
  assert.match(g.cierre, /^Hasta mañana\. .*no es una recomendación de inversión/);
  assert.match(recibido, /NO des consejos de inversión/);
  assert.match(recibido, /Extreme Fear|miedo extremo/);
});

test('guion: si el cerebro falla o responde basura, usa la plantilla', async () => {
  assert.strictEqual((await creador.guion(DATOS, NOTICIAS, async () => ({ ok: false }))).origen, 'plantilla');
  assert.strictEqual((await creador.guion(DATOS, NOTICIAS, async () => ({ ok: true, texto: 'no es json' }))).origen, 'plantilla');
});

test('escenas: portada, precios, gráfico, sentimiento, noticias y cierre; texto escapado', async () => {
  const g = await creador.guion(DATOS, NOTICIAS);
  const e = creador.escenas(DATOS, NOTICIAS, g);
  assert.strictEqual(e.length, 4 + NOTICIAS.length + 1);
  const noticia = e[4].svg;
  assert.ok(noticia.includes('Bitcoin &amp; Nvidia &lt;se mueven&gt;'), 'el titular debe ir escapado en el SVG');
  assert.ok(!/<se mueven>/.test(noticia));
  const sharp = require('sharp');
  for (const x of e) {
    const meta = await sharp(Buffer.from(x.svg)).metadata();
    assert.deepStrictEqual([meta.width, meta.height], [1920, 1080]);
  }
});

test('crear: monta el vídeo real con ffmpeg y deja .mp4 + .json en la cola', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
  // Voz simulada: 1 s de tono (sin red).
  const voz = async () => {
    const f = path.join(os.tmpdir(), `voz-${process.pid}.mp3`);
    spawnSync(creador.rutaFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'libmp3lame', f]);
    return fs.readFileSync(f);
  };
  const r = await creador.crear({ dep: { mercado: async () => DATOS, noticias: async () => NOTICIAS, voz } });
  assert.ok(r.ok, r.error);
  assert.ok(fs.statSync(r.video).size > 10000);
  const meta = JSON.parse(fs.readFileSync(r.video.replace(/\.mp4$/, '.json'), 'utf8'));
  assert.ok(meta.titulo);
  assert.match(meta.descripcion, /no es una recomendación de inversión/);
  assert.match(meta.descripcion, /https:\/\/ejemplo\.com\/1/);
  // Duración ≈ escenas × (1 s de voz + 0,6 s de margen): -t corta bien cada escena.
  const info = spawnSync(creador.rutaFfmpeg(), ['-hide_banner', '-i', r.video]).stderr.toString();
  const [, h, m, s] = info.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const dur = Number(h) * 3600 + Number(m) * 60 + Number(s);
  assert.ok(Math.abs(dur - r.escenas * 1.6) < r.escenas * 0.3, `duración ${dur}s para ${r.escenas} escenas`);
  assert.deepStrictEqual(fs.readdirSync(path.join(process.env.JARVIS_DATOS, 'youtube', 'trabajo')), [], 'la carpeta de trabajo se limpia');
});

test('crear: si fallan los precios, devuelve error claro y no deja basura', async () => {
  const r = await creador.crear({ dep: { mercado: async () => { throw new Error('CoinGecko caído'); } } });
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /CoinGecko caído/);
});

test('youtube.ejecutar: con la cola vacía crea el vídeo antes de subir (y respeta YOUTUBE_CREAR=no)', async () => {
  for (const f of fs.readdirSync(youtube.carpeta('pendientes'))) fs.unlinkSync(path.join(youtube.carpeta('pendientes'), f));
  claves.guardar({ YOUTUBE_REFRESH_TOKEN: 'ref', YOUTUBE_CREAR: 'no' });
  let llamadas = 0;
  const crear = async () => { llamadas++; return { ok: false, error: 'creación simulada fallida' }; };
  const r1 = await youtube.ejecutar({ crear });
  assert.strictEqual(llamadas, 0);
  assert.match(r1.resumen, /No hay vídeos/);
  claves.guardar({ YOUTUBE_CREAR: '' });
  const r2 = await youtube.ejecutar({ crear });
  assert.strictEqual(llamadas, 1);
  assert.strictEqual(r2.ok, false);
  assert.match(r2.error, /creación simulada fallida/);
});
