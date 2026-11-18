// Jarvis 100 % local y gratis: Gemini (límite y 429 → Ollama), informe diario,
// caza de oportunidades, memoria importada de n8n y Edge TTS.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-gratis-'));
const falsos = require('./falsos/servidores');
const claves = require('../src/nucleo/claves');
const gemini = require('../src/cerebro/gemini');
const memoria = require('../src/memoria');
const negocio = require('../src/rutinas/negocio');
const { crearCerebro } = require('../src/cerebro/router');

// Gemini falso: responde según el sistema; con modo429 devuelve el límite diario.
const g = { peticiones: [], modo429: false };
function geminiFalso() {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; });
      req.on('end', () => {
        const body = b ? JSON.parse(b) : {};
        g.peticiones.push({ url: req.url, body });
        const json = (c, o) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
        if (g.modo429) return json(429, { error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
        const sistema = body.systemInstruction?.parts?.[0]?.text || '';
        let texto = `(gemini) ${body.contents?.[0]?.parts?.[0]?.text?.split('Ayoub dice: ').pop()}`;
        let grounding;
        if (/INFORME DIARIO/.test(sistema)) texto = '{"titulo":"Informe diario 18 nov. 2026: Arkana y Baleària","detalle":"Correo: cliente pregunta por el Arkana. Top 3: responder al cliente; llamar a Baleària; post Sahla.","euros_estimados":900}';
        if (/CAZADOR DE IDEAS/.test(sistema)) {
          texto = '{"hay_idea":true,"negocio":"Sardi Auto","titulo":"Broker de furgonetas eléctricas a Argelia","resumen":"Argelia abre cupo a furgonetas eléctricas.","inversion":"0 €","margen":"400 €","tiempo_primer_euro":"2 semanas","riesgo":"normativa","primer_paso":"llamar a 3 clientes","euros_estimados":800,"probabilidad":0.3,"horas":4}';
          grounding = { groundingChunks: [{ web: { uri: 'https://vertexaisearch.cloud.google.com/grounding/abc', title: 'aps.dz' } }] };
        }
        json(200, { candidates: [{ content: { parts: [{ text: texto }] }, finishReason: 'STOP', groundingMetadata: grounding }] });
      });
    });
    s.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${s.address().port}`));
  });
}

let cerebro;
test.before(async () => {
  const o = await falsos.ollama();
  process.env.JARVIS_GEMINI_BASE = await geminiFalso();
  claves.guardar({ OLLAMA_URL: o.url, GEMINI_API_KEY: 'clave-falsa', GEMINI_LIMITE_DIARIO: '5' });
  cerebro = crearCerebro({ nombre: () => 'Ayoub', n8nChat: async () => ({ ok: false, error: 'n8n desactivado' }), usarN8n: () => false, panel: () => ({ items: memoria.panel() }), crearMonitor: async () => ({ ok: true }), herramientasHabilidad: () => ({}), correo: async () => ({ ok: true, texto: 'correo' }) });
});

test('pregunta difícil → Gemini; sencilla → Ollama', async () => {
  const d = await cerebro.responder('Explica paso a paso y compara los pros y contras de exportar a Argelia');
  assert.match(d.motor, /^Gemini · gemini-2.5-flash/);
  assert.strictEqual(g.peticiones.at(-1).url.split('?')[0], '/models/gemini-2.5-flash:generateContent');
  const s = await cerebro.responder('Hola, ¿qué tal?');
  assert.strictEqual(s.motor, 'Ollama · qwen2.5:3b');
});

test('árabe y dárija → Gemini', async () => {
  assert.match((await cerebro.responder('واش راك خويا؟')).motor, /^Gemini/);
});

test('error 429 de Gemini → contesta Ollama sin romperse, y Gemini queda en pausa', async () => {
  g.modo429 = true;
  const r = await cerebro.responder('Explica paso a paso y compara los pros y contras de abrir Sahla en Valencia');
  g.modo429 = false;
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.motor, 'Ollama · qwen2.5:3b');
  assert.match(r.respaldo[0], /límite gratuito/);
  assert.strictEqual(gemini.disponible(), false);
  assert.match(gemini.estado(), /En pausa por límite/);
  // Mientras está en pausa, lo difícil va directo a Ollama (sin llamar a Google).
  const n = g.peticiones.length;
  assert.strictEqual((await cerebro.responder('Analiza y compara dos estrategias de precio para Sahla')).motor, 'Ollama · qwen2.5:3b');
  assert.strictEqual(g.peticiones.length, n);
  fs.rmSync(path.join(process.env.JARVIS_DATOS, 'gemini-uso.json'));
});

test('límite diario propio: al llegar a GEMINI_LIMITE_DIARIO deja de usar Gemini', async () => {
  fs.writeFileSync(path.join(process.env.JARVIS_DATOS, 'gemini-uso.json'), JSON.stringify({ fecha: new Date().toISOString().slice(0, 10), usadas: 5 }));
  assert.strictEqual(gemini.disponible(), false);
  assert.match(gemini.estado(), /5\/5/);
  fs.rmSync(path.join(process.env.JARVIS_DATOS, 'gemini-uso.json'));
  assert.strictEqual(gemini.disponible(), true);
});

test('memoria de n8n importada y en el panel PENDIENTE', () => {
  const r = memoria.importarN8n(JSON.parse(fs.readFileSync(path.join(__dirname, 'datos', 'memoria-ejemplo.json'), 'utf8')));
  assert.deepStrictEqual(r, { importadas: 11, yaEstaban: 0 });
  assert.deepStrictEqual(memoria.importarN8n(JSON.parse(fs.readFileSync(path.join(__dirname, 'datos', 'memoria-ejemplo.json'), 'utf8'))), { importadas: 0, yaEstaban: 11 });
  const p = memoria.panel();
  assert.strictEqual(p[0].titulo, 'Informe de ejemplo más reciente');
  assert.strictEqual(p.filter((x) => /pendiente/.test(x.estado)).length, 10);
  assert.ok(memoria.cambiarEstado('n8n-11', 'visto'));
  assert.strictEqual(memoria.panel().filter((x) => /pendiente/.test(x.estado)).length, 9);
});

test('informe diario: estilo n8n, se guarda en la memoria como pendiente', async () => {
  const r = await negocio.informe({ pensar: cerebro.pensar, tareas: [] });
  assert.ok(r.ok, r.error);
  assert.match(r.resumen, /Informe diario 18 nov\. 2026/);
  const sis = g.peticiones.at(-1).body.systemInstruction.parts[0].text;
  assert.match(sis, /beneficio esperado en € × probabilidad de éxito\) ÷ horas/);
  assert.match(g.peticiones.at(-1).body.contents[0].parts[0].text, /Entrada de ejemplo 9/); // usa la memoria importada
  assert.strictEqual(memoria.panel()[0].tipo, 'informe');
});

test('caza: con Gemini busca en Google (fuentes reales) y como mucho 1 idea al día', async () => {
  const r = await negocio.caza({ pensar: cerebro.pensar });
  assert.ok(r.ok && r.novedad, r.error || r.resumen);
  const pet = g.peticiones.at(-1).body;
  assert.deepStrictEqual(pet.tools, [{ google_search: {} }]);
  assert.match(pet.contents[0].parts[0].text, /Idea de ejemplo: maquinaria/); // no repetir ideas
  const idea = memoria.panel().find((e) => e.titulo === 'Broker de furgonetas eléctricas a Argelia');
  assert.match(idea.fuente, /^https:\/\//);
  assert.match(idea.detalle, /800 € × 0\.3 ÷ 4 h = 60/);
  const otra = await negocio.caza({ pensar: cerebro.pensar });
  assert.strictEqual(otra.novedad, false);
  assert.match(otra.resumen, /máximo 1 al día/);
});

test('caza sin Gemini: Google News (gratis) + modelo local, solo con fuentes de la lista', async (t) => {
  // Borramos la idea de hoy para poder probar otra vez.
  const archivo = path.join(process.env.JARVIS_DATOS, 'memoria', 'entradas.json');
  fs.writeFileSync(archivo, JSON.stringify(JSON.parse(fs.readFileSync(archivo, 'utf8')).filter((e) => e.tipo !== 'idea' || e.origen === 'n8n')));
  claves.guardar({ GEMINI_API_KEY: '' });
  const pensar = async () => ({ ok: true, motor: 'Ollama · qwen2.5:3b', texto: '{"hay_idea":true,"negocio":"Sardi Auto","titulo":"Idea basada en noticias","resumen":"x","euros_estimados":300,"probabilidad":0.5,"horas":2,"fuentes_idx":[0,99]}' });
  const r = await negocio.caza({ pensar });
  if (!r.ok && /internet/.test(r.error)) return t.skip('sin acceso a Google News');
  assert.ok(r.novedad, r.resumen || r.error);
  const idea = memoria.panel().find((e) => e.titulo === 'Idea basada en noticias');
  assert.match(idea.fuente, /^https:\/\/news\.google\.com\//);
  assert.doesNotMatch(idea.fuente, /\|/); // el índice 99 (inventado) se descarta
  claves.guardar({ GEMINI_API_KEY: 'clave-falsa' });
});

test('Edge TTS: voz de España y voz argelina para la dárija (servicio real)', async (t) => {
  const edge = require('../src/voz/edge');
  const es = await edge.sintetizar('Hola Ayoub, soy Jarvis.', 'es');
  if (es.error && /conect|timeout|tiempo|ENOTFOUND|403/i.test(es.error)) return t.skip(es.error);
  assert.ok(es.audioBase64 && es.audioBase64.length > 5000, es.error);
  assert.strictEqual(es.voz, 'es-ES-AlvaroNeural');
  const dz = await edge.sintetizar('واش راك خويا', 'darija');
  assert.strictEqual(dz.voz, 'ar-DZ-IsmaelNeural');
  assert.ok(dz.audioBase64.length > 3000);
});
