// Bot de Telegram con la API simulada: vincular con código, ignorar a extraños,
// hablar con el cerebro, y comprar un pedido solo tras DOS confirmaciones.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const http = require('http');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-telegram-'));
const claves = require('../src/nucleo/claves');
const telegram = require('../src/movil/telegram');

let enviados = [];
let srv;
test.before(async () => {
  srv = http.createServer((req, res) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      const metodo = req.url.split('/').pop();
      if (metodo === 'sendMessage') enviados.push(JSON.parse(b));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, result: metodo === 'getMe' ? { username: 'mi_jarvis_bot' } : true }));
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  process.env.JARVIS_TELEGRAM_BASE = `http://127.0.0.1:${srv.address().port}`;
  claves.guardar({ TELEGRAM_BOT_TOKEN: '123:ABC' });
});
test.after(() => srv.close());

const msg = (chat, text) => ({ update_id: 1, message: { chat: { id: chat }, from: { first_name: 'Ayoub' }, text } });
const cb = (chat, data) => ({ update_id: 2, callback_query: { id: 'q', data, message: { chat: { id: chat } } } });

let compras = 0;
const PEDIDO = { id: 'gid://shopify/Order/555', nombre: '#1005', cliente: 'Ana', ciudad: 'Madrid', total: '19.95 EUR', costeEstimadoEUR: 8.4, estado: 'por_confirmar', lineas: [{ cantidad: 1, titulo: 'Cepillo' }] };
telegram.usarAcciones({
  responder: async (t) => ({ ok: true, texto: `Eco: ${t}` }),
  informe: async () => ({ ok: true, resumen: 'Hoy: 2 pedidos' }),
  pedidos: async () => [PEDIDO],
  confirmarPedido: async () => { compras += 1; return { ok: true, cjOrderId: 'CJ-1' }; },
  revision: async () => [],
  publicar: async () => ({ ok: true, resumen: 'publicado' }),
  descartar: async () => ({ ok: true }),
});

test('vincular: solo con el código correcto; luego ignora a otros chats', async () => {
  const codigo = telegram.codigo();
  assert.match(codigo, /^\d{6}$/);
  assert.match(await telegram.probar(), /@mi_jarvis_bot.*\/vincular \d{6}/);
  await telegram.procesar(msg(999, '/vincular 000000'));
  await telegram.procesar(msg(999, 'hola'));
  assert.strictEqual(claves.obtener('TELEGRAM_CHAT_ID'), '', 'código malo: no se vincula');
  assert.strictEqual(enviados.length, 0);
  await telegram.procesar(msg(42, `/vincular ${codigo}`));
  assert.strictEqual(claves.obtener('TELEGRAM_CHAT_ID'), '42');
  assert.match(enviados.pop().text, /Vinculado\. Hola, Ayoub/);
  await telegram.procesar(msg(999, '/pedidos'));
  await telegram.procesar(cb(999, 'ped!:555'));
  assert.strictEqual(enviados.length, 0, 'un extraño no puede usar el bot');
  assert.strictEqual(compras, 0);
});

test('texto libre va al cerebro; /ventas da el informe', async () => {
  enviados = [];
  await telegram.procesar(msg(42, '¿qué tal mis ventas?'));
  await telegram.procesar(msg(42, '/ventas'));
  assert.deepStrictEqual(enviados.map((e) => e.text), ['Eco: ¿qué tal mis ventas?', '📊 Hoy: 2 pedidos']);
  assert.ok(enviados.every((e) => e.chat_id === '42'));
});

test('pedido: primer botón pide confirmación con el coste; solo el segundo compra', async () => {
  enviados = [];
  await telegram.procesar(msg(42, '/pedidos'));
  assert.match(enviados[0].text, /#1005 · Ana \(Madrid\)[\s\S]*te cuesta ≈ 8.4 €/);
  assert.strictEqual(enviados[0].reply_markup.inline_keyboard[0][0].callback_data, 'ped?:555');
  await telegram.procesar(cb(42, 'ped?:555'));
  assert.strictEqual(compras, 0, 'el primer botón no compra');
  assert.match(enviados[1].text, /¿Seguro\? Se pagará con tu saldo de CJ ≈ 8.4 €/);
  assert.strictEqual(enviados[1].reply_markup.inline_keyboard[0][0].callback_data, 'ped!:555');
  await telegram.procesar(cb(42, 'ped!:555'));
  assert.strictEqual(compras, 1);
  assert.match(enviados[2].text, /#1005 comprado en CJ \(CJ-1\)/);
});

test('aviso de las rutinas llega también a Telegram', async () => {
  enviados = [];
  const avisos = require('../src/avisos');
  const r = await avisos.avisar({ titulo: 'Pedidos de la tienda', mensaje: '1 pedido nuevo' });
  assert.ok(r.telegram.ok);
  assert.strictEqual(enviados[0].text, '🔔 Pedidos de la tienda\n1 pedido nuevo');
});
