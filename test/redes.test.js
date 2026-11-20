// Redes sociales: Meta (Instagram + Facebook) y TikTok contra servidores
// simulados, versión vertical real con ffmpeg y la rutina publicando solo en
// redes (sin YouTube). No se publica nada de verdad.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawnSync } = require('child_process');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-redes-'));
const claves = require('../src/nucleo/claves');
const meta = require('../src/redes/meta');
const tiktok = require('../src/redes/tiktok');
const redes = require('../src/redes');
const youtube = require('../src/youtube');
const creador = require('../src/youtube/creador');

const MB = 1024 * 1024;
const hayFfmpeg = spawnSync(creador.rutaFfmpeg(), ['-version']).status === 0;
const video = path.join(process.env.JARVIS_DATOS, 'v.mp4');
fs.writeFileSync(video, Buffer.alloc(200000, 1));

// Servidor simulado genérico: el manejador recibe { metodo, ruta, q, cab, cuerpo }.
function servidor(manejar) {
  const visto = [];
  const srv = http.createServer((req, res) => {
    const trozos = [];
    req.on('data', (c) => trozos.push(c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const p = { metodo: req.method, ruta: u.pathname, q: Object.fromEntries(u.searchParams), cab: req.headers, cuerpo: Buffer.concat(trozos) };
      visto.push(p);
      const [code, datos] = manejar(p, `http://127.0.0.1:${srv.address().port}`);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(datos));
    });
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r({ srv, visto, base: `http://127.0.0.1:${srv.address().port}` })));
}

test('TikTok: trozos según sus reglas (5-64 MB, el último absorbe el resto)', () => {
  assert.deepStrictEqual(tiktok.trozos(3 * MB), { chunk: 3 * MB, total: 1, rangos: [[0, 3 * MB - 1]] });
  const t = tiktok.trozos(25 * MB + 123);
  assert.strictEqual(t.chunk, 10 * MB);
  assert.strictEqual(t.total, 2);
  assert.deepStrictEqual(t.rangos, [[0, 10 * MB - 1], [10 * MB, 25 * MB + 122]]);
});

test('texto de la publicación: título, resumen, aviso y hashtags limpios', () => {
  const t = redes.texto({ titulo: 'Bitcoin hoy', descripcion: 'Resumen del día.\n\n⚠️ No es una recomendación de inversión.\n\nDatos: CoinGecko', etiquetas: ['bitcoin', 'noticias cripto', 'Análisis técnico'] });
  assert.match(t, /^Bitcoin hoy\n\nResumen del día\.\n\n⚠️ No es una recomendación/);
  assert.match(t, /#bitcoin #noticiascripto #Analisistecnico$/);
});

test('Meta: conectar cambia el token por el de la Página y borra el temporal', async () => {
  const { srv, base } = await servidor((p) => {
    if (p.ruta === '/v27.0/oauth/access_token') return [200, { access_token: 'LARGO' }];
    if (p.ruta === '/v27.0/me/accounts') return [200, { data: [{ id: 'P1', name: 'Mi Página', access_token: 'PAGETOK', instagram_business_account: { id: 'IG1', username: 'micuenta' } }] }];
    return [404, {}];
  });
  process.env.JARVIS_GRAPH_BASE = base;
  try {
    claves.guardar({ META_APP_ID: 'app', META_APP_SECRET: 'sec', META_USER_TOKEN: 'CORTO' });
    const r = await meta.conectar();
    assert.ok(r.ok, r.error);
    assert.deepStrictEqual([r.pagina, r.instagram], ['Mi Página', 'micuenta']);
    assert.deepStrictEqual(['META_PAGE_TOKEN', 'META_PAGE_ID', 'META_IG_ID', 'META_USER_TOKEN'].map((k) => claves.obtener(k)), ['PAGETOK', 'P1', 'IG1', '']);
    assert.deepStrictEqual(meta.estado(), { facebook: true, instagram: true, pagina: 'Mi Página' });
  } finally { srv.close(); }
});

test('Instagram y Facebook: reel completo (contenedor/inicio, subida rupload, publicación)', async () => {
  let consultas = 0;
  const { srv, visto, base } = await servidor((p, b) => {
    if (p.ruta === '/v27.0/IG1/media') return [200, { id: 'C1', uri: `${b}/ig-api-upload/v27.0/C1` }];
    if (p.ruta === '/ig-api-upload/v27.0/C1' || p.ruta === '/video-upload/V1') return [200, { success: true }];
    if (p.ruta === '/v27.0/C1') return [200, { status_code: ++consultas < 2 ? 'IN_PROGRESS' : 'FINISHED' }];
    if (p.ruta === '/v27.0/IG1/media_publish') return [200, { id: 'M1' }];
    if (p.ruta === '/v27.0/M1') return [200, { permalink: 'https://www.instagram.com/reel/abc/' }];
    if (p.ruta === '/v27.0/P1/video_reels' && p.q.upload_phase === 'finish') return [200, { success: true }];
    if (p.ruta === '/v27.0/P1/video_reels') return [200, { video_id: 'V1', upload_url: `${b}/video-upload/V1` }];
    return [404, {}];
  });
  process.env.JARVIS_GRAPH_BASE = base;
  try {
    const ig = await meta.publicarInstagram(video, 'Texto #bitcoin', { esperaMs: 10 });
    assert.deepStrictEqual(ig, { id: 'M1', url: 'https://www.instagram.com/reel/abc/' });
    const crear = visto.find((x) => x.ruta === '/v27.0/IG1/media');
    assert.deepStrictEqual([crear.q.media_type, crear.q.upload_type, crear.q.caption], ['REELS', 'resumable', 'Texto #bitcoin']);
    const subidaIg = visto.find((x) => x.ruta === '/ig-api-upload/v27.0/C1');
    assert.deepStrictEqual([subidaIg.cab.authorization, subidaIg.cab.offset, subidaIg.cab.file_size, subidaIg.cuerpo.length], ['OAuth PAGETOK', '0', '200000', 200000]);

    const fb = await meta.publicarFacebook(video, { titulo: 'Bitcoin hoy', texto: 'Texto' });
    assert.deepStrictEqual(fb, { id: 'V1', url: 'https://www.facebook.com/reel/V1' });
    const inicio = visto.find((x) => x.ruta === '/v27.0/P1/video_reels' && x.metodo === 'POST' && !x.q.upload_phase);
    assert.deepStrictEqual(JSON.parse(inicio.cuerpo), { upload_phase: 'start', access_token: 'PAGETOK' });
    const fin = visto.find((x) => x.q.upload_phase === 'finish');
    assert.deepStrictEqual([fin.q.video_id, fin.q.video_state, fin.q.title], ['V1', 'PUBLISHED', 'Bitcoin hoy']);
  } finally { srv.close(); }
});

test('TikTok: renueva (y guarda) el token, reintenta en privado si la app no está auditada y sube por trozos', async () => {
  const { srv, visto, base } = await servidor((p, b) => {
    const cuerpo = p.cuerpo.toString();
    if (p.ruta === '/v2/oauth/token/') return [200, { access_token: 'TT', refresh_token: 'REFRESCO-NUEVO', expires_in: 7200 }];
    if (p.ruta === '/v2/post/publish/creator_info/query/') return [200, { data: { creator_username: 'yo', privacy_level_options: ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'SELF_ONLY'] }, error: { code: 'ok' } }];
    if (p.ruta === '/v2/post/publish/video/init/') {
      const j = JSON.parse(cuerpo);
      if (j.post_info.privacy_level !== 'SELF_ONLY') return [403, { error: { code: 'unaudited_client_can_only_post_to_private_accounts', message: 'unaudited' } }];
      return [200, { data: { publish_id: 'pub1', upload_url: `${b}/subir/abc` }, error: { code: 'ok' } }];
    }
    if (p.ruta === '/subir/abc') return [201, {}];
    if (p.ruta === '/v2/post/publish/status/fetch/') return [200, { data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [777] }, error: { code: 'ok' } }];
    return [404, {}];
  });
  process.env.JARVIS_TIKTOK_BASE = base;
  try {
    claves.guardar({ TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'cs', TIKTOK_REFRESH_TOKEN: 'REFRESCO-VIEJO', TIKTOK_USUARIO: 'yo' });
    const r = await tiktok.publicar(video, 'Bitcoin hoy #bitcoin', { esperaMs: 10 });
    assert.deepStrictEqual(r, { id: 'pub1', privacidad: 'SELF_ONLY', url: 'https://www.tiktok.com/@yo/video/777' });
    assert.strictEqual(claves.obtener('TIKTOK_REFRESH_TOKEN'), 'REFRESCO-NUEVO');
    const inits = visto.filter((x) => x.ruta === '/v2/post/publish/video/init/').map((x) => JSON.parse(x.cuerpo));
    assert.deepStrictEqual(inits.map((i) => i.post_info.privacy_level), ['PUBLIC_TO_EVERYONE', 'SELF_ONLY']);
    assert.deepStrictEqual(inits[1].source_info, { source: 'FILE_UPLOAD', video_size: 200000, chunk_size: 200000, total_chunk_count: 1 });
    assert.strictEqual(inits[1].post_info.is_aigc, true);
    const put = visto.find((x) => x.ruta === '/subir/abc');
    assert.deepStrictEqual([put.metodo, put.cab['content-range'], put.cuerpo.length], ['PUT', 'bytes 0-199999/200000', 200000]);
  } finally { srv.close(); }
});

test('TikTok: conectar con PKCE en hexadecimal y redirect /callback/', async () => {
  let codigoReto = null;
  const { srv, visto, base } = await servidor((p) => {
    if (p.ruta === '/v2/oauth/token/') return [200, { access_token: 'TT', refresh_token: 'R1' }];
    if (p.ruta === '/v2/post/publish/creator_info/query/') return [200, { data: { creator_username: 'yo' } }];
    return [404, {}];
  });
  process.env.JARVIS_TIKTOK_BASE = base;
  try {
    claves.guardar({ TIKTOK_CLIENT_KEY: 'ck', TIKTOK_CLIENT_SECRET: 'cs', TIKTOK_REFRESH_TOKEN: '' });
    const navegador = async (url) => {
      const u = new URL(url);
      codigoReto = u.searchParams.get('code_challenge');
      const vuelta = new URL(u.searchParams.get('redirect_uri'));
      assert.match(vuelta.pathname, /^\/callback\/$/);
      vuelta.searchParams.set('code', 'COD');
      vuelta.searchParams.set('state', u.searchParams.get('state'));
      setTimeout(() => fetch(vuelta).catch(() => {}), 30);
    };
    const r = await tiktok.conectar(navegador, { segundos: 10 });
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.usuario, 'yo');
    assert.match(codigoReto, /^[0-9a-f]{64}$/, 'TikTok escritorio usa SHA-256 en hexadecimal');
    const tok = new URLSearchParams(visto.find((x) => x.ruta === '/v2/oauth/token/').cuerpo.toString());
    const verificador = tok.get('code_verifier');
    assert.strictEqual(require('crypto').createHash('sha256').update(verificador).digest('hex'), codigoReto);
    assert.strictEqual(claves.obtener('TIKTOK_REFRESH_TOKEN'), 'R1');
  } finally { srv.close(); }
});

test('vertical: 1080x1920 con audio a 48 kHz (ffmpeg real)', { skip: !hayFfmpeg && 'sin ffmpeg' }, async () => {
  const entrada = path.join(process.env.JARVIS_DATOS, 'horizontal.mp4');
  spawnSync(creador.rutaFfmpeg(), ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=640x360:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', entrada]);
  const salida = path.join(process.env.JARVIS_DATOS, 'vertical.mp4');
  const r = await redes.hacerVertical(entrada, 'Bitcoin & Ethereum <hoy>: título largo de prueba para partir', salida);
  assert.strictEqual(r.acelerado, false);
  const info = spawnSync(creador.rutaFfmpeg(), ['-hide_banner', '-i', salida]).stderr.toString();
  assert.match(info, /1080x1920/);
  assert.match(info, /48000 Hz/);
  assert.ok(!fs.existsSync(`${salida}.rotulos.png`), 'borra los rótulos temporales');
});

test('publicar: si una red falla, las demás siguen', async () => {
  const res = await redes.publicar(video, { titulo: 'T', descripcion: 'D', etiquetas: [] }, {
    redes: ['tiktok', 'instagram', 'facebook'],
    dep: {
      hacerVertical: async (_e, _t, s) => { fs.writeFileSync(s, 'v'); return { archivo: s, duracion: 80, acelerado: false }; },
      publicar: {
        tiktok: async () => ({ id: 'p', privacidad: 'SELF_ONLY', url: null }),
        instagram: async () => { throw new Error('token caducado'); },
        facebook: async () => ({ id: 'V', url: 'https://www.facebook.com/reel/V' }),
      },
    },
  });
  assert.deepStrictEqual(Object.keys(res), ['tiktok', 'instagram', 'facebook']);
  assert.strictEqual(res.instagram.ok, false);
  assert.ok(res.tiktok.ok && res.facebook.ok);
  assert.match(redes.resumen(res), /TikTok ✔ \(privado: TikTok aún no ha auditado tu app\) · Instagram ✘ token caducado · Facebook ✔ https:\/\/www\.facebook\.com\/reel\/V/);
});

test('rutina sin YouTube: publica solo en redes, mueve el vídeo y lo anota en el historial', async () => {
  claves.guardar({ YOUTUBE_REFRESH_TOKEN: '' });
  for (const f of fs.readdirSync(youtube.carpeta('pendientes'))) fs.unlinkSync(path.join(youtube.carpeta('pendientes'), f));
  fs.writeFileSync(path.join(youtube.carpeta('pendientes'), '01-video.mp4'), 'x');
  fs.writeFileSync(path.join(youtube.carpeta('pendientes'), '01-video.txt'), 'Mi título\nMi descripción');
  const falsas = { activas: () => ['tiktok', 'facebook'], publicar: async (_v, m, { redes: r }) => Object.fromEntries(r.map((x) => [x, { ok: true, url: `https://${x}/${m.titulo}` }])), resumen: redes.resumen };
  const r = await youtube.ejecutar({ redes: falsas });
  assert.ok(r.ok, r.error);
  assert.match(r.resumen, /Publicado «Mi título»: TikTok ✔ .* · Facebook ✔/);
  assert.doesNotMatch(r.resumen, /YouTube/);
  assert.strictEqual(youtube.cola().length, 0);
  assert.deepStrictEqual(Object.keys(youtube.estado().ultimos[0].redes), ['tiktok', 'facebook']);

  // Si todas fallan, el vídeo se queda en la cola.
  fs.writeFileSync(path.join(youtube.carpeta('pendientes'), '02-video.mp4'), 'x');
  const r2 = await youtube.ejecutar({ redes: { ...falsas, publicar: async () => ({ tiktok: { ok: false, error: 'caído' } }) } });
  assert.strictEqual(r2.ok, false);
  assert.match(r2.error, /sigue en la cola/);
  assert.strictEqual(youtube.cola().length, 1);
});
