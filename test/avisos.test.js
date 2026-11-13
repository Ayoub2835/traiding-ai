// Avisos: ntfy (servicio real si hay red; tema aleatorio) y Twilio (servidor simulado).
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-avisos-'));
const claves = require('../src/nucleo/claves');
const avisos = require('../src/avisos');

test('ntfy: el aviso llega al tema (con acentos en el título)', async (t) => {
  const tema = `jarvis-prueba-${Math.random().toString(36).slice(2, 10)}`;
  claves.guardar({ NTFY_TEMA: tema });
  const r = await avisos.ntfy({ titulo: 'Prueba de Jarvis — señal', mensaje: 'Aviso de prueba automática', prioridad: 'alta' });
  if (!r.ok && /conectar|egress|403/.test(r.error)) return t.skip(`sin acceso a ntfy.sh: ${r.error}`);
  assert.ok(r.ok, r.error);
  await new Promise((r) => setTimeout(r, 1500));
  const resp = await fetch(`https://ntfy.sh/${tema}/json?poll=1`);
  const msgs = (await resp.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === 'message');
  assert.strictEqual(msgs.length, 1);
  assert.strictEqual(msgs[0].title, 'Prueba de Jarvis — señal');
  assert.strictEqual(msgs[0].message, 'Aviso de prueba automática');
  assert.strictEqual(msgs[0].priority, 4);
});

test('Twilio: llamada con TwiML y autenticación correctas', async () => {
  let recibido = null;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => { recibido = { url: req.url, auth: req.headers.authorization, cuerpo: new URLSearchParams(b) }; res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"sid":"CA123"}'); });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.JARVIS_TWILIO_BASE = `http://127.0.0.1:${srv.address().port}`;
  claves.guardar({ TWILIO_SID: 'AC1', TWILIO_TOKEN: 'tok', TWILIO_DESDE: '+34900000000', TWILIO_A: '+34600000000' });
  const r = await avisos.llamar('Bitcoin ha bajado un 8% <urgente>');
  srv.close();
  assert.ok(r.ok, r.error);
  assert.strictEqual(recibido.url, '/2010-04-01/Accounts/AC1/Calls.json');
  assert.strictEqual(recibido.auth, 'Basic ' + Buffer.from('AC1:tok').toString('base64'));
  assert.strictEqual(recibido.cuerpo.get('To'), '+34600000000');
  assert.match(recibido.cuerpo.get('Twiml'), /<Say language="es-ES">Bitcoin ha bajado un 8% &lt;urgente&gt;<\/Say>/);
});

test('sin claves: error claro, sin romper', async () => {
  claves.guardar({ NTFY_TEMA: '', TWILIO_SID: '' });
  assert.match((await avisos.ntfy({ mensaje: 'x' })).error, /NTFY_TEMA/);
  assert.match((await avisos.llamar('x')).error, /Twilio/);
});
