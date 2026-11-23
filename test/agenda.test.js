// Agenda (recordatorios con frases en español), ideas de vídeo del día y el
// panel «Configurar Jarvis».
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-agenda-'));
const claves = require('../src/nucleo/claves');
const agenda = require('../src/agenda');
const ideas = require('../src/redes/ideas');
const configuracion = require('../src/nucleo/configuracion');

const BASE = new Date(2026, 10, 23, 9, 0, 0); // 23/11/2026 09:00 hora local

test('entiende frases: en X min/horas, hoy/mañana, día/mes y «cada día»', () => {
  const a = agenda.interpretar('en 30 min sacar la ropa', BASE);
  assert.strictEqual(a.cuando.getTime() - BASE.getTime(), 30 * 60000);
  assert.strictEqual(a.texto, 'sacar la ropa');
  const b = agenda.interpretar('mañana 10:30 llamar al proveedor', BASE);
  assert.deepStrictEqual([b.cuando.getDate(), b.cuando.getHours(), b.cuando.getMinutes(), b.texto], [24, 10, 30, 'llamar al proveedor']);
  const c = agenda.interpretar('25/11 a las 18:30 dentista', BASE);
  assert.deepStrictEqual([c.cuando.getDate(), c.cuando.getMonth(), c.cuando.getHours(), c.texto], [25, 10, 18, 'dentista']);
  const d = agenda.interpretar('hoy 21:00 revisar ventas cada día', BASE);
  assert.deepStrictEqual([d.cuando.getHours(), d.texto, d.repetir], [21, 'revisar ventas', 'diario']);
  assert.strictEqual(agenda.interpretar('algún día de estos', BASE), null);
  assert.strictEqual(agenda.interpretar('1/1 10:00 año nuevo', BASE).cuando.getFullYear(), 2027, 'una fecha ya pasada es del año que viene');
});

test('avisa una vez; los que se repiten pasan a la siguiente vez', () => {
  const ahora = Date.now();
  assert.strictEqual(agenda.agregar({ texto: 'x', cuando: new Date(ahora - 3600000) }, ahora).ok, false, 'no acepta horas pasadas');
  assert.strictEqual(agenda.agregar({ texto: '', cuando: new Date(ahora + 1000) }).ok, false);
  agenda.agregar({ texto: 'una vez', cuando: new Date(ahora + 60000) }, ahora);
  agenda.agregar({ texto: 'cada día', cuando: new Date(ahora + 60000), repetir: 'diario' }, ahora);
  agenda.agregar({ texto: 'luego', cuando: new Date(ahora + 3 * 3600000) }, ahora);
  assert.deepStrictEqual(agenda.vencidos(ahora).map((r) => r.texto), []);
  const toca = agenda.vencidos(ahora + 2 * 60000);
  assert.deepStrictEqual(toca.map((r) => r.texto).sort(), ['cada día', 'una vez']);
  assert.deepStrictEqual(agenda.vencidos(ahora + 3 * 60000), [], 'no avisa dos veces');
  const quedan = agenda.lista();
  assert.deepStrictEqual(quedan.map((r) => r.texto), ['luego', 'cada día']);
  assert.ok(new Date(quedan[1].cuando).getTime() > ahora + 86000000, 'el diario pasa a mañana');
  assert.ok(agenda.quitar(quedan[0].id).ok);
  assert.strictEqual(agenda.lista().length, 1);
});

test('ideas de vídeo: con las noticias de hoy (como datos), 5 como mucho, guardadas', async () => {
  assert.strictEqual((await ideas.generar({})).ok, false);
  let usuario = '';
  const pensar = async (_s, u) => {
    usuario = u;
    return { texto: JSON.stringify({ ideas: Array.from({ length: 7 }, (_, i) => ({ titulo: `Idea ${i}`, gancho: 'Mira esto', tema: `Tema ${i}` })) }) };
  };
  const r = await ideas.generar({ pensar, dep: { noticias: async (t) => [{ titulo: `Bitcoin sube hoy (${t})` }] } });
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.ideas.length, 5);
  assert.match(usuario, /Bitcoin sube hoy/);
  assert.match(usuario, /titulares de hoy/, 'los titulares van marcados como datos');
  assert.match(r.resumen, /Idea 0/);
  assert.strictEqual(ideas.leer().ideas.length, 5);
});

test('configurar Jarvis: dice qué falta sin mostrar ninguna clave', () => {
  claves.guardar({ GEMINI_API_KEY: 'clave-secreta-123', CJ_API_KEY: 'otra-secreta' });
  const c = configuracion.pasos();
  assert.ok(c.total >= 10);
  const por = (id) => c.pasos.find((x) => x.id === id);
  assert.strictEqual(por('cerebro').ok, true);
  assert.strictEqual(por('cj').ok, true);
  assert.strictEqual(por('shopify').ok, false);
  assert.ok(c.pasos.every((x) => x.como.length >= 2));
  assert.ok(!JSON.stringify(c).includes('clave-secreta-123') && !JSON.stringify(c).includes('otra-secreta'), 'nunca muestra valores');
});
