// Oído local: Whisper en el PC entiende español, dárija, árabe y francés.
// (La primera vez descarga el modelo; si no hay internet, la prueba se salta.)
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
// Caché fija: el modelo se descarga una sola vez entre ejecuciones.
process.env.JARVIS_DATOS = process.env.JARVIS_DATOS_WHISPER || path.join(os.homedir(), '.cache', 'jarvis-pruebas');
const whisper = require('../src/voz/whisper');
const idioma = require('../src/cerebro/idioma');

function wav16k(nombre) {
  const b = fs.readFileSync(path.join(__dirname, 'audio', nombre));
  const datos = b.subarray(44);
  const f = new Float32Array(datos.length / 2);
  for (let i = 0; i < f.length; i++) f[i] = datos.readInt16LE(i * 2) / 32768;
  return f;
}

const CASOS = [
  ['n_es.wav', 'es', /tengo pendiente para hoy/i, 'es'],
  ['n_darija.wav', 'ar', /واش/, 'darija'],
  ['n_ar.wav', 'ar', /مرحبا/, 'ar'],
  ['n_fr.wav', 'fr', /aujourd'hui/i, 'fr'],
];

test('Whisper local: 4 idiomas', { timeout: 900000 }, async (t) => {
  try { await whisper.cargar(); } catch (e) { return t.skip(`no se pudo descargar el modelo: ${e.message}`); }
  for (const [archivo, lang, re, router] of CASOS) {
    const r = await whisper.transcribir(wav16k(archivo));
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.idioma, lang, `${archivo}: ${r.texto}`);
    assert.match(r.texto, re, `${archivo}: ${r.texto}`);
    // Y el cerebro reconoce el idioma para contestar igual (dárija incluida).
    assert.strictEqual(idioma.detectar(r.texto), router, `${archivo}: ${r.texto}`);
  }
});
