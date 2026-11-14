// Si Ollama no está abierto, Jarvis lo abre ("ollama serve") y espera a que responda.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const net = require('net');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-ollama-'));
process.env.PATH = `${path.join(__dirname, 'falsos')}${path.delimiter}${process.env.PATH}`;
const claves = require('../src/nucleo/claves');
const ollama = require('../src/cerebro/ollama');

const puertoLibre = () => new Promise((r) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

test('abre Ollama si está cerrado y luego responde', async () => {
  const puerto = await puertoLibre();
  claves.guardar({ OLLAMA_URL: `http://127.0.0.1:${puerto}` });
  assert.strictEqual(await ollama.abierto(), false);
  const r = await ollama.asegurarAbierto(10);
  assert.deepStrictEqual(r, { ok: true, abiertoPorJarvis: true });
  assert.strictEqual(await ollama.abierto(), true);
  // Si ya está abierto, no lo abre otra vez.
  assert.deepStrictEqual(await ollama.asegurarAbierto(), { ok: true, abiertoPorJarvis: false });
  assert.ok((await ollama.disponible()).ok);
});

test('si Ollama no está instalado, error claro', async () => {
  const puerto = await puertoLibre();
  claves.guardar({ OLLAMA_URL: `http://127.0.0.1:${puerto}` });
  process.env.JARVIS_OLLAMA = 'ollama-que-no-existe-xyz';
  const r = await ollama.asegurarAbierto(2);
  delete process.env.JARVIS_OLLAMA;
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /no se ha podido abrir/i);
});

test('no intenta abrir un Ollama de otro equipo', async () => {
  claves.guardar({ OLLAMA_URL: 'http://192.0.2.10:11434' });
  const r = await ollama.asegurarAbierto(1);
  assert.match(r.error, /otro equipo/);
});
