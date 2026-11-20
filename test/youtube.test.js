// YouTube: cola, metadatos y subida completa contra un Google simulado
// (OAuth + subida "resumable"), sin tocar YouTube de verdad.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-youtube-'));
const claves = require('../src/nucleo/claves');
const youtube = require('../src/youtube');
const programador = require('../src/rutinas/programador');

const pendientes = () => youtube.carpeta('pendientes');
const vaciar = () => { for (const d of ['pendientes', 'subidos']) for (const f of fs.readdirSync(youtube.carpeta(d))) fs.unlinkSync(path.join(youtube.carpeta(d), f)); };

// Google simulado: /token, /upload/... (inicio y PUT) y /youtube/v3/channels.
function googleFalso() {
  const visto = { tokens: [], inicio: null, subida: null };
  const srv = http.createServer((req, res) => {
    const trozos = [];
    req.on('data', (c) => trozos.push(c));
    req.on('end', () => {
      const cuerpo = Buffer.concat(trozos);
      const json = (code, d, extra = {}) => { res.writeHead(code, { 'Content-Type': 'application/json', ...extra }); res.end(JSON.stringify(d)); };
      const u = new URL(req.url, 'http://x');
      if (u.pathname === '/token') {
        const p = new URLSearchParams(cuerpo.toString());
        visto.tokens.push(Object.fromEntries(p));
        if (p.get('grant_type') === 'authorization_code') return json(200, { access_token: 'acc-1', refresh_token: 'ref-1' });
        if (p.get('refresh_token') === 'caducado') return json(400, { error: 'invalid_grant' });
        return json(200, { access_token: 'acc-2' });
      }
      if (u.pathname === '/youtube/v3/channels') return json(200, { items: [{ snippet: { title: 'Canal de prueba' } }] });
      if (u.pathname === '/upload/youtube/v3/videos' && req.method === 'POST') {
        visto.inicio = { query: u.search, auth: req.headers.authorization, tamaño: req.headers['x-upload-content-length'], tipo: req.headers['x-upload-content-type'], meta: JSON.parse(cuerpo.toString()) };
        return json(200, {}, { Location: `http://127.0.0.1:${srv.address().port}/subida/abc` });
      }
      if (u.pathname === '/subida/abc' && req.method === 'PUT') {
        visto.subida = { bytes: cuerpo.length, tipo: req.headers['content-type'] };
        return json(200, { id: 'VID123', status: { privacyStatus: visto.inicio.meta.status.privacyStatus } });
      }
      json(404, { error: 'no existe' });
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${srv.address().port}`;
    process.env.JARVIS_GOOGLE_OAUTH_BASE = base;
    process.env.JARVIS_YOUTUBE_BASE = base;
    r({ srv, visto, base });
  }));
}

test('cola: solo vídeos y en orden natural (2 antes que 10)', () => {
  vaciar();
  for (const f of ['10-b.mp4', '2-a.mov', 'notas.txt', 'portada.jpg']) fs.writeFileSync(path.join(pendientes(), f), 'x');
  assert.deepStrictEqual(youtube.cola().map((f) => path.basename(f)), ['2-a.mov', '10-b.mp4']);
});

test('metadatos: .json, .txt, cerebro y nombre del archivo', async () => {
  vaciar();
  const v1 = path.join(pendientes(), '01-uno.mp4');
  fs.writeFileSync(v1, 'x');
  fs.writeFileSync(`${v1.slice(0, -4)}.json`, JSON.stringify({ titulo: 'Título <raro>', descripcion: 'Desc', etiquetas: ['a', 'a', 'b, c'], privacidad: 'unlisted' }));
  const m1 = await youtube.metadatos(v1);
  assert.deepStrictEqual([m1.titulo, m1.etiquetas, m1.privacidad, m1.origen], ['Título raro', ['a', 'b c'], 'unlisted', 'archivo']);

  const v2 = path.join(pendientes(), '02-dos.mp4');
  fs.writeFileSync(v2, 'x');
  fs.writeFileSync(`${v2.slice(0, -4)}.txt`, '﻿Mi título\nLínea 1\nLínea 2\n');
  const m2 = await youtube.metadatos(v2);
  assert.deepStrictEqual([m2.titulo, m2.descripcion, m2.privacidad], ['Mi título', 'Línea 1\nLínea 2', 'public']);

  const v3 = path.join(pendientes(), '03-viaje_a-Marrakech.mp4');
  fs.writeFileSync(v3, 'x');
  const pensar = async () => ({ ok: true, texto: 'Aquí va: {"titulo":"Marrakech en 1 día","descripcion":"Un paseo.","etiquetas":["viaje","Marruecos"]}' });
  const m3 = await youtube.metadatos(v3, pensar);
  assert.deepStrictEqual([m3.titulo, m3.origen, m3.etiquetas], ['Marrakech en 1 día', 'cerebro', ['viaje', 'Marruecos']]);

  const m4 = await youtube.metadatos(v3, async () => ({ ok: false, error: 'sin red' }));
  assert.deepStrictEqual([m4.titulo, m4.origen], ['viaje a Marrakech', 'nombre']);
});

test('etiquetas: no pasan de 500 caracteres', () => {
  const muchas = Array.from({ length: 100 }, (_, i) => `etiqueta${i}`);
  const r = youtube.limpiarEtiquetas(muchas);
  assert.ok(r.join(',').length <= 500 && r.length > 10);
});

test('ejecutar: sin conectar avisa; con cola vacía avisa de que la llenes', async () => {
  vaciar();
  claves.guardar({ YOUTUBE_REFRESH_TOKEN: '' });
  const r1 = await youtube.ejecutar();
  assert.strictEqual(r1.ok, false);
  assert.match(r1.error, /ninguna red conectada/);
  claves.guardar({ YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: 'sec', YOUTUBE_REFRESH_TOKEN: 'ref-1' });
  const r2 = await youtube.ejecutar();
  assert.ok(r2.ok && r2.novedad);
  assert.match(r2.resumen, /No hay vídeos/);
});

test('ejecutar: sube el primero de la cola, lo mueve a subidos y lo anota', async () => {
  const { srv, visto } = await googleFalso();
  try {
    vaciar();
    claves.guardar({ YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: 'sec', YOUTUBE_REFRESH_TOKEN: 'ref-1', YOUTUBE_PRIVACIDAD: 'unlisted' });
    const datos = Buffer.alloc(300000, 7);
    fs.writeFileSync(path.join(pendientes(), '01-hola_mundo.mp4'), datos);
    fs.writeFileSync(path.join(pendientes(), '01-hola_mundo.json'), JSON.stringify({ titulo: 'Hola mundo', descripcion: 'Primer vídeo', etiquetas: ['jarvis'] }));
    fs.writeFileSync(path.join(pendientes(), '02-otro.mp4'), 'y');

    const r = await youtube.ejecutar();
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.url, 'https://youtu.be/VID123');
    assert.match(r.resumen, /Hola mundo.*Quedan 1/);
    assert.strictEqual(visto.tokens[0].grant_type, 'refresh_token');
    assert.strictEqual(visto.inicio.auth, 'Bearer acc-2');
    assert.match(visto.inicio.query, /uploadType=resumable/);
    assert.strictEqual(visto.inicio.tamaño, String(datos.length));
    assert.strictEqual(visto.inicio.tipo, 'video/mp4');
    assert.deepStrictEqual(visto.inicio.meta.snippet.tags, ['jarvis']);
    assert.strictEqual(visto.inicio.meta.status.privacyStatus, 'unlisted');
    assert.strictEqual(visto.subida.bytes, datos.length);
    assert.deepStrictEqual(youtube.cola().map((f) => path.basename(f)), ['02-otro.mp4']);
    assert.strictEqual(fs.readdirSync(youtube.carpeta('subidos')).length, 2);
    assert.strictEqual(youtube.estado().ultimos[0].id, 'VID123');
  } finally {
    srv.close();
  }
});

test('ejecutar: si Google caduca el permiso, el vídeo se queda en la cola', async () => {
  const { srv } = await googleFalso();
  try {
    vaciar();
    claves.guardar({ YOUTUBE_REFRESH_TOKEN: 'caducado' });
    fs.writeFileSync(path.join(pendientes(), 'a.mp4'), 'x');
    const r = await youtube.ejecutar();
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /caducado/);
    assert.strictEqual(youtube.cola().length, 1);
  } finally {
    srv.close();
  }
});

test('conectar: OAuth con PKCE guarda el permiso del canal', async () => {
  const { srv, visto } = await googleFalso();
  try {
    claves.guardar({ YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: 'sec', YOUTUBE_REFRESH_TOKEN: '' });
    visto.tokens = [];
    // "Navegador" simulado: Google redirige a Jarvis con el código.
    const navegador = async (url) => {
      const u = new URL(url);
      assert.strictEqual(u.searchParams.get('code_challenge_method'), 'S256');
      assert.match(u.searchParams.get('scope'), /youtube\.upload/);
      const vuelta = new URL(u.searchParams.get('redirect_uri'));
      vuelta.searchParams.set('code', 'COD');
      vuelta.searchParams.set('state', u.searchParams.get('state'));
      setTimeout(() => fetch(vuelta).catch(() => {}), 50);
    };
    const r = await youtube.conectar(navegador, { segundos: 10 });
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.canal, 'Canal de prueba');
    assert.strictEqual(claves.obtener('YOUTUBE_REFRESH_TOKEN'), 'ref-1');
    assert.strictEqual(visto.tokens[0].code, 'COD');
    assert.ok(visto.tokens[0].code_verifier.length >= 43);
  } finally {
    srv.close();
  }
});

test('conectar: estado distinto (posible ataque) se rechaza', async () => {
  claves.guardar({ YOUTUBE_CLIENT_ID: 'cid', YOUTUBE_CLIENT_SECRET: 'sec' });
  const navegador = async (url) => {
    const vuelta = new URL(new URL(url).searchParams.get('redirect_uri'));
    vuelta.searchParams.set('code', 'COD');
    vuelta.searchParams.set('state', 'otro');
    setTimeout(() => fetch(vuelta).catch(() => {}), 50);
  };
  const r = await youtube.conectar(navegador, { segundos: 10 });
  assert.strictEqual(r.ok, false);
});

test('programador: la rutina de YouTube existe, empieza apagada y no se puede quitar', () => {
  const y = programador.obtener('youtube');
  assert.ok(y);
  assert.strictEqual(y.activo, false);
  const g = programador.guardar({ ...y, activo: true, horario: { tipo: 'diario', hora: '20:15' } });
  assert.deepStrictEqual([g.nombre, g.activo, g.horario.hora], ['Vídeo del día', true, '20:15']);
  assert.strictEqual(programador.quitar('youtube'), false);
  assert.strictEqual(programador.obtener('resumen').nombre, 'Resumen de la mañana');
});
