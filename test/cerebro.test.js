// Pruebas del cerebro (router), memoria, habilidades y rutinas con servidores falsos.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-cerebro-'));
const falsos = require('./falsos/servidores');
const claves = require('../src/nucleo/claves');
const { decidir, crearCerebro } = require('../src/cerebro/router');
const idioma = require('../src/cerebro/idioma');
const memoria = require('../src/memoria');
const habilidades = require('../src/habilidades');
const monitores = require('../src/rutinas/monitores');
const programador = require('../src/rutinas/programador');

const n8nLlamadas = [];
const deps = {
  nombre: () => 'Ayoub',
  n8nChat: async (t) => { n8nLlamadas.push(t); return { ok: true, respuesta: `(n8n) ${t.slice(0, 60)}` }; },
  panel: () => ({ items: [{ id: 1, tipo: 'idea', titulo: 'Exportar coche a Argelia', estado: 'pendiente_de_ver' }] }),
  crearMonitor: async (t) => ({ ok: true, texto: `Monitor creado: ${t}` }),
  herramientasHabilidad: ({ pensar }) => ({
    pensar: async (t) => (await pensar('Eres Jarvis', t)).texto,
    pensar_claude: async (t) => (await pensar('Eres Jarvis', t)).texto,
    n8n: async (t) => (await deps.n8nChat(t)).respuesta,
    memoria_buscar: async (t) => memoria.buscar(t).map((h) => h.texto).join('\n'),
    memoria_guardar: async (t) => (memoria.guardarHecho(t, 'tarea', 'habilidad'), 'guardado'),
  }),
};
let cerebro;

test.before(async () => {
  const o = await falsos.ollama();
  const c = await falsos.claude();
  claves.guardar({ OLLAMA_URL: o.url, ANTHROPIC_API_KEY: 'sk-ant-prueba', ANTHROPIC_BASE_URL: c.url });
  cerebro = crearCerebro(deps);
});

test('idioma: es / fr / ar / dárija', () => {
  assert.strictEqual(idioma.detectar('¿Qué tiempo hace hoy en Valencia?'), 'es');
  assert.strictEqual(idioma.detectar("Bonjour, qu'est-ce que je dois faire aujourd'hui ?"), 'fr');
  assert.strictEqual(idioma.detectar('مرحبا كيف حالك'), 'ar');
  assert.strictEqual(idioma.detectar('wach rak khoya, kifach ndir lyoum?'), 'darija');
  assert.strictEqual(idioma.detectar('chhal ysswa had tomobil?'), 'darija');
});

test('router: cada petición va a su sitio', () => {
  const casos = [
    ['Hola Jarvis, ¿qué tal?', 'local'],
    ['¿Cuál es la capital de Francia?', 'local'],
    ['Explica paso a paso por qué conviene exportar coches a Argelia y compara los pros y contras con venderlos en España', 'claude'],
    ['wach rak, kifach ndir bach nbi3 tomobil f dzayer?', 'claude'],
    ['¿Tengo correos importantes hoy?', 'n8n'],
    ['¿Qué ideas nuevas hay?', 'n8n'],
    ['Crea un archivo Excel con los precios de los coches', 'manos'],
    ['Abre la web de Shopify y añade un producto nuevo', 'manos'],
    ['tarea: limpia el escritorio', 'manos'],
    ['Recuerda que prefiero el café sin azúcar', 'memoria'],
    ['Aprende a buscar el precio del gasoil cada día', 'aprender'],
    ['Redacta un email al proveedor de Valencia', 'habilidad'],
    ['Vigila el precio del bitcoin y avísame si baja', 'monitor'],
    ['Compra acciones de Tesla por 500 euros', 'denegar'],
    ['Pregunta con modelo local: dime un chiste', 'local'],
  ];
  for (const [t, ruta] of casos) assert.strictEqual(decidir(t).ruta, ruta, `"${t}" → ${decidir(t).ruta} (${decidir(t).motivo})`);
});

test('respuesta simple con Ollama y dice quién contestó', async () => {
  const r = await cerebro.responder('Hola Jarvis, ¿qué tal?');
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.ruta, 'local');
  assert.strictEqual(r.motor, 'Ollama · qwen2.5:3b');
  assert.match(r.texto, /^\(local\)/);
  // El prompt lleva memoria, panel (como datos) e idioma.
  const p = falsos.peticiones.ollama.at(-1).messages.at(-1).content;
  assert.match(p, /datos_externos origen="panel n8n"/);
  assert.match(p, /Responde en español/);
});

test('pregunta difícil con Claude: modelo, esfuerzo, caché y respaldo de servidor', async () => {
  const r = await cerebro.responder('Explica paso a paso por qué conviene exportar coches a Argelia y compara los pros y contras');
  assert.ok(r.ok, r.error);
  assert.strictEqual(r.motor, 'Claude · claude-opus-5-5');
  const pet = falsos.peticiones.claude.at(-1);
  assert.strictEqual(pet.body.model, 'claude-opus-5-5');
  assert.deepStrictEqual(pet.body.output_config, { effort: 'medium' });
  assert.strictEqual(pet.body.fallbacks, 'default');
  assert.match(pet.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.deepStrictEqual(pet.body.system[0].cache_control, { type: 'ephemeral' });
});

test('si Ollama falla, contesta Claude (respaldo)', async () => {
  claves.guardar({ OLLAMA_URL: 'http://127.0.0.1:9' });
  const r = await cerebro.responder('¿Cuál es la capital de Francia?');
  assert.ok(r.ok);
  assert.match(r.motor, /^Claude/);
  assert.ok(r.respaldo && /local/.test(r.respaldo[0]));
});

test('sin Ollama ni Claude, contesta n8n', async () => {
  claves.guardar({ ANTHROPIC_API_KEY: '' });
  const r = await cerebro.responder('¿Cuál es la capital de Italia?');
  assert.ok(r.ok);
  assert.strictEqual(r.motor, 'n8n · Jarvis');
  claves.guardar({ ANTHROPIC_API_KEY: 'sk-ant-prueba' });
});

test('memoria: "recuerda que" guarda y luego aparece en el contexto', async () => {
  const r = await cerebro.responder('Recuerda que el proveedor de Valencia se llama Ruiz Motor');
  assert.match(r.texto, /Apuntado: el proveedor de Valencia se llama Ruiz Motor/);
  assert.match(memoria.contexto('¿cómo se llama el proveedor de Valencia?'), /Ruiz Motor/);
  const extra = await memoria.extraerHechos(cerebro.llm);
  assert.strictEqual(extra[0].texto, 'Prefiere respuestas cortas');
});

test('habilidades: aprender una nueva y usarla', async () => {
  const r = await cerebro.responder('Aprende a buscar el precio del gasoil cada día');
  assert.ok(r.ok, r.error);
  assert.match(r.texto, /precio-gasoil/);
  assert.ok(habilidades.listar().some((h) => h.nombre === 'precio-gasoil' && h.origen === 'aprendida'));
  const u = await cerebro.responder('Dime el precio del gasoil de hoy');
  assert.strictEqual(u.ruta, 'habilidad');
  assert.ok(u.ok, u.error);
  // El resultado de n8n entra en el paso "pensar" como DATOS.
  const ult = String(falsos.peticiones.claude.at(-1).body.messages[0].content);
  assert.match(ult, /<datos_externos origen="datos">/);
  assert.ok(habilidades.borrar('precio-gasoil'));
});

test('habilidad incluida (borrador de email) con 3 pasos', async () => {
  const r = await cerebro.responder('Redacta un email al proveedor pidiendo el precio de 3 coches');
  assert.strictEqual(r.motor, 'Habilidad · borrador-email');
  assert.ok(r.ok);
});

test('monitor con memoria: primera vez toma nota, la segunda avisa de la novedad', async () => {
  const m = { id: 'x', nombre: 'Bitcoin', instruccion: 'precio del bitcoin', motor: 'n8n', notas: '' };
  const ctx = { n8nChat: deps.n8nChat, pensar: cerebro.pensar };
  const r1 = await monitores.ejecutar(m, ctx);
  assert.deepStrictEqual([r1.novedad, r1.notas], [false, 'BTC 60000']);
  const r2 = await monitores.ejecutar({ ...m, notas: r1.notas }, ctx);
  assert.deepStrictEqual([r2.novedad, r2.urgente], [true, true]);
});

test('programador: cuándo toca y orden de Windows', () => {
  const r = { id: 'resumen', activo: true, horario: { tipo: 'diario', hora: '08:30' }, ultima: null };
  assert.strictEqual(programador.toca(r, new Date('2026-11-14T08:40:00')), true);
  assert.strictEqual(programador.toca(r, new Date('2026-11-14T08:20:00')), false);
  assert.strictEqual(programador.toca({ ...r, ultima: '2026-11-14T08:31:00' }, new Date('2026-11-14T09:00:00')), false);
  assert.strictEqual(programador.toca({ ...r, horario: { tipo: 'cada', minutos: 60 }, ultima: new Date(Date.now() - 61 * 60000).toISOString() }), true);
  const args = programador.argsCrearWindows(r, 'C:\\Users\\Ayoub\\AppData\\Local\\Programs\\Jarvis\\Jarvis.exe');
  assert.deepStrictEqual(args, ['/Create', '/F', '/TN', 'Jarvis\\Rutina-resumen', '/TR', '"C:\\Users\\Ayoub\\AppData\\Local\\Programs\\Jarvis\\Jarvis.exe" --rutina=resumen', '/SC', 'DAILY', '/ST', '08:30']);
  const g = programador.guardar({ nombre: 'Precio gasoil', instruccion: 'Precio del gasoil', horario: { tipo: 'cada', minutos: 120 }, activo: true });
  assert.ok(g.id && g.horario.minutos === 120);
  assert.ok(programador.quitar(g.id));
  assert.throws(() => programador.guardar({ nombre: 'x', instruccion: 'y', horario: { tipo: 'cada', minutos: 1 } }));
});
