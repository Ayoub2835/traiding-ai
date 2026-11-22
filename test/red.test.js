// Filtro de red de la ventana (src/nucleo/red.js): las funciones nuevas
// (vídeos, tienda, Telegram, Meta) deben poder conectarse a sus servicios, y
// todo lo demás sigue bloqueado. Este filtro solo actúa dentro de Electron,
// por eso los demás tests (fuera de Electron) no lo detectaban.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-red-'));
const claves = require('../src/nucleo/claves');
const red = require('../src/nucleo/red');

test('datos públicos de los vídeos y la tienda, siempre permitidos', () => {
  for (const u of ['https://api.coingecko.com/api/v3/coins/markets', 'https://api.alternative.me/fng/', 'https://api.frankfurter.dev/v1/latest', 'https://news.google.com/rss']) {
    assert.ok(red.permitida(u, {}), u);
  }
});

test('CJ, Telegram y Meta solo cuando tienes su clave; el resto, bloqueado', () => {
  const urls = ['https://developers.cjdropshipping.com/api2.0/v1/product/listV2', 'https://cf.cjdropshipping.com/foto.jpg', 'https://ae01.alicdn.com/kf/foto.jpg', 'https://api.telegram.org/bot1/getMe', 'https://graph.facebook.com/v27.0/me'];
  for (const u of urls) assert.strictEqual(red.permitida(u, {}), false, `sin clave: ${u}`);
  claves.guardar({ CJ_API_KEY: 'x', TELEGRAM_BOT_TOKEN: '1:a', META_PAGE_TOKEN: 'p' });
  for (const u of urls) assert.ok(red.permitida(u, {}), `con clave: ${u}`);
  assert.strictEqual(red.permitida('https://cjdropshipping.com.malo.net/x', {}), false, 'un dominio que solo lo imita no pasa');
  assert.strictEqual(red.permitida('http://cf.cjdropshipping.com/x', {}), false, 'solo https');
  assert.strictEqual(red.permitida('https://ejemplo-cualquiera.com/', {}), false);
});
