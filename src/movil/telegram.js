// Controlar Jarvis desde el móvil con un bot de Telegram (gratis).
//  - Crea el bot con @BotFather y pega su token en Ajustes → Claves → Móvil.
//  - Escribe al bot: /vincular <código> (el código sale en Ajustes). Desde ese
//    momento SOLO tu chat puede usarlo; los mensajes de otros se ignoran.
//  - Funciona con "long polling": no hace falta abrir puertos ni servidor.
//  - Lo que escribas va al cerebro de Jarvis. Botones para aprobar pedidos (con
//    doble confirmación porque gastan dinero) y vídeos por revisar.
'use strict';
const crypto = require('crypto');
const claves = require('../nucleo/claves');
const { pedir } = require('../nucleo/http');
const registro = require('../seguridad/registro');

const API = () => `${process.env.JARVIS_TELEGRAM_BASE || 'https://api.telegram.org'}/bot${claves.obtener('TELEGRAM_BOT_TOKEN')}`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let activo = false;
let acciones = null;
// Cada arranque tiene su número: si cambias el token, el bucle viejo se para solo.
let generacion = 0;

const configurado = () => Boolean(claves.obtener('TELEGRAM_BOT_TOKEN'));
const vinculado = () => Boolean(claves.obtener('TELEGRAM_CHAT_ID'));

function codigo() {
  let c = claves.obtener('TELEGRAM_CODIGO');
  if (!c) { c = String(crypto.randomInt(100000, 999999)); claves.guardar({ TELEGRAM_CODIGO: c }); }
  return c;
}

async function metodo(nombre, cuerpo, segundos = 30) {
  const r = await pedir(`${API()}/${nombre}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo || {}) }, segundos);
  if (!r.ok || r.datos?.ok === false) throw new Error(`Telegram (${nombre}): ${r.datos?.description || r.error}`);
  return r.datos?.result;
}

/** Envía un mensaje a tu chat (si está vinculado). Botones: [[{text, callback_data}]]. */
async function enviar(texto, botones) {
  if (!configurado() || !vinculado()) return { ok: false, error: 'Telegram no está vinculado' };
  try {
    await metodo('sendMessage', { chat_id: claves.obtener('TELEGRAM_CHAT_ID'), text: String(texto).slice(0, 4000), ...(botones ? { reply_markup: { inline_keyboard: botones } } : {}) });
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

const AYUDA = [
  'Soy Jarvis 🤖. Escríbeme lo que quieras o usa:',
  '/pedidos – pedidos por confirmar (comprar en CJ)',
  '/revisar – vídeos esperando tu aprobación',
  '/ventas – ventas, anuncios y beneficio',
  '/recordar mañana 10:00 llamar al proveedor – recordatorio (también «en 30 min …», «25/11 18:30 …», «… cada día»)',
  '/agenda – tus próximos recordatorios',
  '/ayuda – esta ayuda',
].join('\n');

async function comando(texto) {
  const a = acciones;
  const [cmd] = texto.trim().split(/\s+/);
  if (cmd === '/start' || cmd === '/ayuda' || cmd === '/help') return enviar(AYUDA);
  if (cmd === '/recordar') {
    if (!a.recordar) return enviar('La agenda no está disponible.');
    const r = await a.recordar(texto.trim().slice(cmd.length).trim());
    return enviar(r.ok ? `⏰ Te lo recordaré el ${new Date(r.recordatorio.cuando).toLocaleString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}: ${r.recordatorio.texto}${r.recordatorio.repetir !== 'no' ? ` (se repite: ${r.recordatorio.repetir})` : ''}` : `✘ ${r.error}`);
  }
  if (cmd === '/agenda') {
    const l = a.agenda ? await a.agenda() : [];
    return enviar(l.length ? `📅 Próximos recordatorios:\n${l.slice(0, 15).map((x) => `• ${new Date(x.cuando).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${x.texto}`).join('\n')}` : 'No tienes recordatorios. Crea uno con /recordar');
  }
  if (cmd === '/ventas') { const r = await a.informe(); return enviar(r.ok ? `📊 ${r.resumen}` : `✘ ${r.error}`); }
  if (cmd === '/pedidos') {
    const lista = (await a.pedidos()).filter((p) => p.estado === 'por_confirmar');
    if (!lista.length) return enviar('No hay pedidos por confirmar. ✅');
    for (const p of lista.slice(0, 10)) {
      await enviar(`🛒 ${p.nombre} · ${p.cliente} (${p.ciudad})\n${(p.lineas || []).map((l) => `${l.cantidad}× ${l.titulo}`).join(', ')}\nPagó ${p.total} · te cuesta ≈ ${p.costeEstimadoEUR} € en CJ`,
        [[{ text: '🛒 Comprar en CJ', callback_data: `ped?:${p.id.split('/').pop()}` }]]);
    }
    return { ok: true };
  }
  if (cmd === '/revisar') {
    const lista = await a.revision();
    if (!lista.length) return enviar('No hay vídeos por revisar. ✅');
    for (const v of lista.slice(0, 10)) {
      await enviar(`🎬 ${v.titulo}\n${v.tamañoMB} MB · ${v.nombre}\n(Míralo en el PC antes de publicar si quieres: REDES → Por revisar)`,
        [[{ text: '✔ Publicar en todas', callback_data: `pub:${v.nombre}`.slice(0, 64) }, { text: '🗑 Descartar', callback_data: `des:${v.nombre}`.slice(0, 64) }]]);
    }
    return { ok: true };
  }
  // Texto libre: al cerebro de Jarvis (como si se lo escribieras en el PC).
  const r = await a.responder(texto);
  return enviar(r.ok ? r.texto : `✘ ${r.error}`);
}

async function boton(datos) {
  const a = acciones;
  const [tipo, ...resto] = String(datos).split(':');
  const valor = resto.join(':');
  if (tipo === 'ped?') {
    const p = (await a.pedidos()).find((x) => x.id.endsWith(`/${valor}`));
    if (!p) return enviar('Ese pedido ya no está.');
    return enviar(`¿Seguro? Se pagará con tu saldo de CJ ≈ ${p.costeEstimadoEUR} € (${p.nombre}).`, [[{ text: '✅ Sí, comprar', callback_data: `ped!:${valor}` }, { text: '❌ No', callback_data: 'nada' }]]);
  }
  if (tipo === 'ped!') {
    const p = (await a.pedidos()).find((x) => x.id.endsWith(`/${valor}`));
    if (!p) return enviar('Ese pedido ya no está.');
    registro.anotar({ origen: 'telegram', accion: `comprar en CJ ${p.nombre}`, decision: 'confirmado desde el móvil' });
    const r = await a.confirmarPedido(p.id);
    return enviar(r.ok ? `✅ ${p.nombre} comprado en CJ (${r.cjOrderId}). El seguimiento irá solo a Shopify.` : `✘ ${r.error}`);
  }
  if (tipo === 'pub') {
    registro.anotar({ origen: 'telegram', accion: `publicar ${valor}`, decision: 'aprobado desde el móvil' });
    const r = await a.publicar(valor);
    return enviar(r.ok ? `✅ ${r.resumen}` : `✘ ${r.error}`);
  }
  if (tipo === 'des') { const r = await a.descartar(valor); return enviar(r.ok ? '🗑 Descartado (está en la papelera de Jarvis).' : `✘ ${r.error}`); }
  return { ok: true };
}

/** Procesa una actualización de Telegram (mensaje o botón). */
async function procesar(u) {
  const msg = u.message;
  const cb = u.callback_query;
  const chat = String(msg?.chat?.id ?? cb?.message?.chat?.id ?? '');
  if (!chat) return;
  const dueño = claves.obtener('TELEGRAM_CHAT_ID');
  if (cb) {
    try { await metodo('answerCallbackQuery', { callback_query_id: cb.id }); } catch (_) { /* da igual */ }
    if (chat !== dueño) return; // solo tu chat
    return boton(cb.data);
  }
  const texto = String(msg?.text || '').trim();
  if (!texto) return;
  if (!dueño) {
    // Aún sin vincular: solo se acepta "/vincular <código>".
    if (/^\/vincular\s+/.test(texto) && texto.split(/\s+/)[1] === codigo()) {
      claves.guardar({ TELEGRAM_CHAT_ID: chat, TELEGRAM_CODIGO: '' });
      registro.anotar({ origen: 'telegram', accion: 'vincular chat de Telegram', detalle: msg.from?.username || '' });
      return enviar(`✅ Vinculado. Hola${msg.from?.first_name ? `, ${msg.from.first_name}` : ''}.\n\n${AYUDA}`);
    }
    return;
  }
  if (chat !== dueño) return; // mensajes de otras personas: se ignoran
  return comando(texto);
}

/** Bucle de "long polling". Se para con parar(). */
async function iniciar(conAcciones) {
  acciones = conAcciones;
  if (activo || !configurado()) return;
  activo = true;
  const mia = ++generacion;
  codigo();
  let offset = Number(claves.obtener('TELEGRAM_OFFSET')) || 0;
  let fallos = 0;
  while (activo && mia === generacion && configurado()) {
    try {
      const ups = await metodo('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }, 70);
      fallos = 0;
      if (mia !== generacion) break;
      for (const u of ups || []) {
        offset = u.update_id + 1;
        try { await procesar(u); } catch (e) { registro.anotar({ origen: 'telegram', accion: 'procesar mensaje', decision: 'fallo', motivo: e.message }); }
      }
      if (ups?.length) claves.guardar({ TELEGRAM_OFFSET: String(offset) });
    } catch (e) {
      fallos += 1;
      if (/401|Unauthorized|Not Found/i.test(e.message)) { activo = false; registro.anotar({ origen: 'telegram', accion: 'conectar bot', decision: 'fallo', motivo: e.message }); break; }
      await esperar(Math.min(60000, 2000 * fallos));
    }
  }
  if (mia === generacion) activo = false;
}

function parar() { activo = false; generacion += 1; }

function estado() {
  return { configurado: configurado(), vinculado: vinculado(), activo, codigo: configurado() && !vinculado() ? codigo() : null };
}

async function probar() {
  const yo = await metodo('getMe', {});
  return `Telegram OK (@${yo.username})${vinculado() ? ' · vinculado' : ` · escribe al bot: /vincular ${codigo()}`}`;
}

// Para los tests: fija las acciones sin arrancar el bucle.
const usarAcciones = (a) => { acciones = a; };

module.exports = { iniciar, parar, enviar, procesar, estado, probar, codigo, usarAcciones };
