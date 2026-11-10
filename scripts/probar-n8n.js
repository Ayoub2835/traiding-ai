// Comprueba desde la terminal que tu n8n responde, sin abrir la app.
//   npm run probar-n8n            -> prueba el panel de memoria
//   npm run probar-n8n -- --chat  -> además prueba el chat y la voz (envía un mensaje de prueba)
// Lee las URLs de config.json (copia config.ejemplo.json y pon tus URLs; no se sube al repositorio)
// o de la conexión guardada por la app en %APPDATA%\Jarvis\conexion.json.
const fs = require('fs');
const os = require('os');
const path = require('path');

function leer(ruta) { try { return JSON.parse(fs.readFileSync(ruta, 'utf8')); } catch (_) { return null; } }
const appData = process.env.APPDATA || path.join(os.homedir(), '.config');
const cfgLocal = leer(path.join(__dirname, '..', 'config.json')) || {};
const conexion = leer(path.join(appData, 'Jarvis', 'conexion.json')) || {};
const n8n = { ...(cfgLocal.n8n || {}), ...conexion };
if (!n8n.panelUrl) {
  console.error('✘ No hay URLs: abre la app y usa "Conectar Jarvis", o crea config.json a partir de config.ejemplo.json');
  process.exit(1);
}
// Igual que la app: el webhook del panel ignora los "bots", así que nos presentamos como navegador.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function probarPanel() {
  const r = await fetch(n8n.panelUrl, { headers: { 'User-Agent': UA } });
  const datos = await r.json().catch(() => null);
  if (!r.ok || !datos || !Array.isArray(datos.items)) throw new Error(`Panel: HTTP ${r.status}`);
  console.log(`✔ Panel OK: ${datos.items.length} elementos`);
  for (const i of datos.items) console.log(`   - [${i.tipo}] ${i.titulo} (${i.estado})`);
}

async function probarChat() {
  const r = await fetch(n8n.chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ action: 'sendMessage', sessionId: 'prueba-terminal', chatInput: 'Prueba técnica. Responde solo: OK' }),
  });
  const datos = await r.json().catch(() => null);
  if (!r.ok || !datos || !datos.output) throw new Error(`Chat: HTTP ${r.status}`);
  console.log(`✔ Chat OK: "${datos.output}"`);
}

async function probarVoz() {
  if (!n8n.vozUrl) return console.log('· Voz: sin URL configurada');
  const form = new FormData();
  form.append('texto', 'Prueba técnica. Responde solo: OK');
  form.append('sessionId', 'prueba-terminal');
  const r = await fetch(n8n.vozUrl, { method: 'POST', body: form, headers: { 'User-Agent': UA } });
  const datos = await r.json().catch(() => null);
  if (!r.ok || !datos || !datos.respuesta) throw new Error(`Voz: HTTP ${r.status}`);
  console.log(`✔ Voz OK: "${datos.respuesta}" + audio de ${Math.round((datos.audio_base64 || '').length * 0.75 / 1024)} KB`);
}

(async () => {
  try {
    await probarPanel();
    if (process.argv.includes('--chat')) { await probarChat(); await probarVoz(); }
  } catch (e) {
    console.error('✘ ' + e.message);
    process.exit(1);
  }
})();
