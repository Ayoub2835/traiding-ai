// Comprueba desde la terminal que tu n8n responde, sin abrir la app.
//   npm run probar-n8n            -> prueba el panel de memoria
//   npm run probar-n8n -- --chat  -> además envía un mensaje de prueba al chat
// Usa las URLs de config.json.
const fs = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
// Igual que la app: el webhook del panel ignora los "bots", así que nos presentamos como navegador.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

async function probarPanel() {
  const r = await fetch(cfg.n8n.panelUrl, { headers: { 'User-Agent': UA } });
  const datos = await r.json().catch(() => null);
  if (!r.ok || !datos || !Array.isArray(datos.items)) throw new Error(`Panel: HTTP ${r.status}`);
  console.log(`✔ Panel OK: ${datos.items.length} elementos`);
  for (const i of datos.items) console.log(`   - [${i.tipo}] ${i.titulo} (${i.estado})`);
}

async function probarChat() {
  const r = await fetch(cfg.n8n.chatUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
    body: JSON.stringify({ action: 'sendMessage', sessionId: 'prueba-terminal', chatInput: 'Prueba técnica. Responde solo: OK' }),
  });
  const datos = await r.json().catch(() => null);
  if (!r.ok || !datos || !datos.output) throw new Error(`Chat: HTTP ${r.status}`);
  console.log(`✔ Chat OK: "${datos.output}"`);
}

(async () => {
  try {
    await probarPanel();
    if (process.argv.includes('--chat')) await probarChat();
  } catch (e) {
    console.error('✘ ' + e.message);
    process.exit(1);
  }
})();
