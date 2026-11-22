// Claves y conexiones de servicios externos (.env).
//
// Se leen de (lo último manda):
//   1. .env en la carpeta del proyecto (modo desarrollo)
//   2. %APPDATA%\Jarvis\.env  (donde guarda la pantalla "Claves" de Ajustes)
// Los dos están en .gitignore: el repositorio es PÚBLICO y nunca lleva claves.
const fs = require('fs');
const path = require('path');
const rutas = require('./rutas');
const { pedir } = require('./http');

// Catálogo de claves que entiende Jarvis.
const CATALOGO = [
  { clave: 'GEMINI_API_KEY', grupo: 'Cerebro', etiqueta: 'Clave de Gemini (gratis)', secreta: true, ayuda: 'aistudio.google.com → Get API key (plan gratuito, con límite diario). Para preguntas difíciles, informes y búsqueda de oportunidades.' },
  { clave: 'GEMINI_MODELO', grupo: 'Cerebro', etiqueta: 'Modelo de Gemini', defecto: 'gemini-2.5-flash' },
  { clave: 'GEMINI_LIMITE_DIARIO', grupo: 'Cerebro', etiqueta: 'Máximo de peticiones a Gemini al día', defecto: '200' },
  { clave: 'ANTHROPIC_API_KEY', grupo: 'Cerebro', etiqueta: 'Clave de Claude (opcional, de pago)', secreta: true, ayuda: 'console.anthropic.com → API Keys. Opcional: si no la pones, Jarvis usa Gemini y Ollama.' },
  { clave: 'CLAUDE_MODELO', grupo: 'Cerebro', etiqueta: 'Modelo de Claude', defecto: 'claude-opus-5-5' },
  { clave: 'CLAUDE_ESFUERZO', grupo: 'Cerebro', etiqueta: 'Esfuerzo de Claude (low/medium/high)', defecto: 'medium' },
  { clave: 'OLLAMA_URL', grupo: 'Cerebro', etiqueta: 'Dirección de Ollama', defecto: 'http://127.0.0.1:11434' },
  { clave: 'OLLAMA_MODELO', grupo: 'Cerebro', etiqueta: 'Modelo local de Ollama', defecto: 'qwen2.5:3b' },
  { clave: 'WHISPER_MODELO', grupo: 'Voz', etiqueta: 'Modelo de Whisper local', defecto: 'onnx-community/whisper-small', ayuda: 'Se descarga una vez (~500 MB) y funciona sin internet. Más rápido y menos preciso: onnx-community/whisper-base' },
  { clave: 'EDGE_VOZ_ES', grupo: 'Voz', etiqueta: 'Voz en español (Edge, gratis)', defecto: 'es-ES-AlvaroNeural', ayuda: 'Otras: es-ES-ElviraNeural (mujer), es-ES-XimenaNeural' },
  { clave: 'EDGE_VOZ_AR', grupo: 'Voz', etiqueta: 'Voz en árabe (Edge)', defecto: 'ar-SA-HamedNeural' },
  { clave: 'EDGE_VOZ_DARIJA', grupo: 'Voz', etiqueta: 'Voz para la dárija (Edge, árabe argelino)', defecto: 'ar-DZ-IsmaelNeural' },
  { clave: 'EDGE_VOZ_FR', grupo: 'Voz', etiqueta: 'Voz en francés (Edge)', defecto: 'fr-FR-HenriNeural' },
  { clave: 'OPENAI_API_KEY', grupo: 'Voz', etiqueta: 'Clave de OpenAI (opcional, de pago)', secreta: true, ayuda: 'platform.openai.com → API keys. Voz en tiempo real (Realtime), transcripción y voz de Jarvis.' },
  { clave: 'OPENAI_REALTIME_MODELO', grupo: 'Voz', etiqueta: 'Modelo OpenAI Realtime', defecto: 'gpt-realtime' },
  { clave: 'OPENAI_VOZ', grupo: 'Voz', etiqueta: 'Voz de OpenAI', defecto: 'onyx' },
  { clave: 'GEMINI_LIVE_MODELO', grupo: 'Voz', etiqueta: 'Modelo Gemini Live', defecto: 'gemini-2.5-flash-native-audio-preview-09-2025' },
  { clave: 'GMAIL_USUARIO', grupo: 'Correo', etiqueta: 'Tu Gmail', ayuda: 'Tu dirección completa de Gmail.' },
  { clave: 'GMAIL_CLAVE_APP', grupo: 'Correo', etiqueta: 'Contraseña de aplicación de Gmail', secreta: true, ayuda: 'myaccount.google.com/apppasswords (necesita la verificación en 2 pasos). Jarvis solo LEE y crea BORRADORES con tu permiso; nunca envía.' },
  { clave: 'NTFY_TEMA', grupo: 'Avisos', etiqueta: 'Tema de ntfy (tu canal privado)', secreta: true, ayuda: 'Instala la app ntfy en el móvil y suscríbete a un tema difícil de adivinar, p. ej. jarvis-ayoub-8f3k2.' },
  { clave: 'NTFY_SERVIDOR', grupo: 'Avisos', etiqueta: 'Servidor ntfy', defecto: 'https://ntfy.sh' },
  { clave: 'NTFY_TOKEN', grupo: 'Avisos', etiqueta: 'Token de ntfy (opcional)', secreta: true },
  { clave: 'TWILIO_SID', grupo: 'Avisos', etiqueta: 'Twilio Account SID', secreta: true, ayuda: 'console.twilio.com. Solo para llamadas urgentes (opcional).' },
  { clave: 'TWILIO_TOKEN', grupo: 'Avisos', etiqueta: 'Twilio Auth Token', secreta: true },
  { clave: 'TWILIO_DESDE', grupo: 'Avisos', etiqueta: 'Número Twilio (desde)', ayuda: 'Formato internacional, p. ej. +34600000000' },
  { clave: 'TWILIO_A', grupo: 'Avisos', etiqueta: 'Tu teléfono (a quién llamar)', secreta: true },
  { clave: 'SHOPIFY_TIENDA', grupo: 'Manos', etiqueta: 'Tienda Shopify (xxx.myshopify.com)' },
  { clave: 'SHOPIFY_TOKEN', grupo: 'Manos', etiqueta: 'Token Admin API de Shopify', secreta: true, ayuda: 'Shopify → Configuración → Apps → Desarrollar apps → crear app → permisos de Admin API: write_products, read_products, read_orders, write_merchant_managed_fulfillment_orders, write_content, write_legal_policies → instalar → token de Admin API.' },
  { clave: 'N8N_MCP_URL', grupo: 'Manos', etiqueta: 'URL MCP de n8n (opcional)', ayuda: 'n8n → Settings → MCP access. Deja que las manos lean/editen flujos.' },
  { clave: 'N8N_MCP_TOKEN', grupo: 'Manos', etiqueta: 'Token MCP de n8n', secreta: true },
  { clave: 'CLAUDE_CODE_RUTA', grupo: 'Manos', etiqueta: 'Comando de Claude Code', defecto: 'claude' },
  { clave: 'YOUTUBE_CLIENT_ID', grupo: 'YouTube', etiqueta: 'ID de cliente de Google (OAuth)', ayuda: 'console.cloud.google.com → activa "YouTube Data API v3" → Pantalla de consentimiento (publícala, o el permiso caduca a los 7 días) → Credenciales → ID de cliente OAuth tipo "App de escritorio".' },
  { clave: 'YOUTUBE_CLIENT_SECRET', grupo: 'YouTube', etiqueta: 'Secreto de cliente de Google', secreta: true },
  { clave: 'YOUTUBE_REFRESH_TOKEN', grupo: 'YouTube', etiqueta: 'Permiso del canal (se rellena al pulsar «Conectar YouTube»)', secreta: true, ayuda: 'No lo escribas a mano: pestaña Rutinas → Subir vídeo a YouTube → Conectar YouTube.' },
  { clave: 'TELEGRAM_BOT_TOKEN', grupo: 'Móvil', etiqueta: 'Telegram: token de tu bot', secreta: true, ayuda: 'En Telegram habla con @BotFather → /newbot → elige nombre → copia el token aquí. Luego pulsa Probar: te dirá el código para escribir al bot (/vincular 123456).' },
  { clave: 'TELEGRAM_CHAT_ID', grupo: 'Móvil', etiqueta: 'Telegram: tu chat (se rellena al vincular)', ayuda: 'No lo escribas: escribe a tu bot /vincular <código>. Bórralo para desvincular.' },
  { clave: 'CJ_API_KEY', grupo: 'Tienda', etiqueta: 'CJ Dropshipping: API key', secreta: true, ayuda: 'cjdropshipping.com → inicia sesión → Mi cuenta (My CJ) → Authorization → API → Generate API Key.' },
  { clave: 'META_AD_ACCOUNT_ID', grupo: 'Tienda', etiqueta: 'Meta: ID de tu cuenta publicitaria (solo números)', ayuda: 'business.facebook.com → Configuración del negocio → Cuentas publicitarias (o el número act=… en el Administrador de anuncios). Para anuncios, al generar el token de Meta marca también ads_management y ads_read.' },
  { clave: 'TIENDA_AUTOPAUSA', grupo: 'Tienda', etiqueta: 'Pausar sola la campaña si pierde dinero (si/no)', defecto: 'no', ayuda: 'Con "si", el informe nocturno pausa la campaña de Meta cuando gasta sin vender. Pausar no gasta dinero; activar, Jarvis nunca lo hace solo.' },
  { clave: 'TIENDA_MARCA', grupo: 'Tienda', etiqueta: 'Nombre de tu marca (fabricante en Shopify)' },
  { clave: 'META_PIXEL_ID', grupo: 'Tienda', etiqueta: 'Meta: ID de tu Píxel (para campañas de VENTAS)', ayuda: 'Shopify → Apps → Facebook & Instagram → conecta tu píxel. Luego en business.facebook.com → Administrador de eventos copia el número del píxel (solo números). Con él, las campañas se crean de VENTAS en lugar de tráfico.' },
  { clave: 'META_ADS_TOKEN', grupo: 'Tienda', etiqueta: 'Meta: permiso de anuncios (automático, ~60 días)', secreta: true },
  { clave: 'META_APP_ID', grupo: 'Redes sociales', etiqueta: 'Meta: ID de la app', ayuda: 'developers.facebook.com → Mis apps → Crear app (tipo Empresa) → añade "Inicio de sesión con Facebook para empresas" e "Instagram". Necesitas una Página de Facebook y una cuenta de Instagram profesional vinculada a ella.' },
  { clave: 'META_APP_SECRET', grupo: 'Redes sociales', etiqueta: 'Meta: clave secreta de la app', secreta: true },
  { clave: 'META_USER_TOKEN', grupo: 'Redes sociales', etiqueta: 'Meta: token de usuario (temporal)', secreta: true, ayuda: 'Herramientas → Explorador de la Graph API → elige tu app → permisos pages_show_list, pages_read_engagement, pages_manage_posts, instagram_basic, instagram_content_publish, business_management (y para anuncios: ads_management, ads_read) → Generar token. Pégalo y pulsa «Conectar Facebook e Instagram» (se borra solo).' },
  { clave: 'META_PAGINA', grupo: 'Redes sociales', etiqueta: 'Meta: nombre de tu Página (si tienes varias)' },
  { clave: 'META_PAGE_TOKEN', grupo: 'Redes sociales', etiqueta: 'Meta: permiso de la Página (automático)', secreta: true },
  { clave: 'TIKTOK_CLIENT_KEY', grupo: 'Redes sociales', etiqueta: 'TikTok: Client key', ayuda: 'developers.tiktok.com → Manage apps → crea una app con "Login Kit" (Desktop) y "Content Posting API" (Direct Post). Redirect URI: http://127.0.0.1:*/callback/' },
  { clave: 'TIKTOK_CLIENT_SECRET', grupo: 'Redes sociales', etiqueta: 'TikTok: Client secret', secreta: true },
  { clave: 'TIKTOK_REFRESH_TOKEN', grupo: 'Redes sociales', etiqueta: 'TikTok: permiso de la cuenta (automático)', secreta: true },
  { clave: 'TIKTOK_PRIVACIDAD', grupo: 'Redes sociales', etiqueta: 'TikTok: visibilidad (PUBLIC_TO_EVERYONE / SELF_ONLY)', defecto: 'PUBLIC_TO_EVERYONE', ayuda: 'Hasta que TikTok audite tu app, sus vídeos quedan en privado aunque pongas público.' },
  { clave: 'YOUTUBE_REVISAR', grupo: 'YouTube', etiqueta: 'Revisar los vídeos antes de publicar (si/no)', defecto: 'si', ayuda: 'Con "si", el vídeo del día queda en REDES → Por revisar y solo se publica cuando pulses Publicar.' },
  { clave: 'YOUTUBE_CREAR', grupo: 'YouTube', etiqueta: 'Crear el vídeo solo si la cola está vacía (si/no)', defecto: 'si', ayuda: 'Jarvis crea gratis un resumen cripto narrado (precios reales, noticias y voz) y lo sube.' },
  { clave: 'YOUTUBE_CANAL_NOMBRE', grupo: 'YouTube', etiqueta: 'Nombre del canal (sale en los vídeos)', defecto: 'Cripto al día' },
  { clave: 'FFMPEG_RUTA', grupo: 'Avanzado', etiqueta: 'Ruta de ffmpeg (opcional)', ayuda: 'Normalmente no hace falta: Jarvis trae su propio ffmpeg.' },
  { clave: 'YOUTUBE_PRIVACIDAD', grupo: 'YouTube', etiqueta: 'Visibilidad por defecto (public/unlisted/private)', defecto: 'public', ayuda: 'Hasta que Google audite tu proyecto, YouTube deja PRIVADOS los vídeos subidos por API.' },
  { clave: 'ANTHROPIC_BASE_URL', grupo: 'Avanzado', etiqueta: 'URL base de la API de Anthropic (solo pruebas)' },
  { clave: 'OPENAI_BASE_URL', grupo: 'Avanzado', etiqueta: 'URL base de la API de OpenAI (solo pruebas)' },
];

const rutaUsuario = () => rutas.datos('.env');
const rutaProyecto = () => path.join(rutas.RAIZ, '.env');

// Lector sencillo de archivos .env (CLAVE=valor, comillas opcionales, # comentarios).
function parsear(texto) {
  const r = {};
  for (const linea of String(texto || '').split(/\r?\n/)) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    r[m[1]] = v;
  }
  return r;
}

function leerArchivo(ruta) {
  try { return parsear(fs.readFileSync(ruta, 'utf8')); } catch (_) { return {}; }
}

let cache = null;
function todas() {
  if (!cache) {
    const desarrollo = rutas.enDesarrollo() && !process.env.JARVIS_DATOS ? leerArchivo(rutaProyecto()) : {};
    cache = { ...desarrollo, ...leerArchivo(rutaUsuario()) };
  }
  return cache;
}

function obtener(clave) {
  const v = todas()[clave];
  if (v !== undefined && v !== '') return v;
  const def = CATALOGO.find((c) => c.clave === clave);
  return def && def.defecto ? def.defecto : '';
}

const tiene = (clave) => Boolean(todas()[clave]);

// Guarda cambios en %APPDATA%\Jarvis\.env. Un valor vacío borra la clave.
function guardar(cambios) {
  const actual = leerArchivo(rutaUsuario());
  for (const [k, v] of Object.entries(cambios || {})) {
    if (!/^[A-Z0-9_]+$/.test(k)) continue;
    const limpio = String(v ?? '').replace(/[\r\n]/g, '').trim();
    if (limpio) actual[k] = limpio; else delete actual[k];
  }
  const lineas = ['# Claves de Jarvis (privado: no compartir ni subir a GitHub)'];
  for (const [k, v] of Object.entries(actual)) lineas.push(`${k}=${/[\s#"']/.test(v) ? JSON.stringify(v) : v}`);
  fs.writeFileSync(rutaUsuario(), lineas.join('\n') + '\n', { mode: 0o600 });
  cache = null;
  return paraInterfaz();
}

// Para la pantalla de Ajustes: las secretas solo se muestran enmascaradas.
function paraInterfaz() {
  const t = todas();
  return CATALOGO.map((c) => {
    const valor = t[c.clave] || '';
    return {
      ...c,
      configurada: Boolean(valor),
      valor: c.secreta ? (valor ? `••••${valor.slice(-4)}` : '') : valor,
    };
  });
}

// ---------------------------------------------------------------------------
// Pruebas de cada servicio (botón "Probar" en Ajustes → Claves)
// ---------------------------------------------------------------------------
const PRUEBAS = {
  async ANTHROPIC_API_KEY() {
    const base = obtener('ANTHROPIC_BASE_URL') || 'https://api.anthropic.com';
    const r = await pedir(`${base}/v1/models?limit=1`, { headers: { 'x-api-key': obtener('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' } }, 20);
    return r.ok ? 'Claude responde' : r.error;
  },
  async OPENAI_API_KEY() {
    const base = obtener('OPENAI_BASE_URL') || 'https://api.openai.com';
    const r = await pedir(`${base}/v1/models`, { headers: { Authorization: `Bearer ${obtener('OPENAI_API_KEY')}` } }, 20);
    return r.ok ? 'OpenAI responde' : r.error;
  },
  async GEMINI_API_KEY() {
    const gemini = require('../cerebro/gemini');
    const r = await gemini.chat({ sistema: 'Responde solo: OK', mensajes: [{ role: 'user', content: 'Prueba' }], contar: false });
    return r.ok ? `Gemini responde (${r.motor})` : r.error;
  },
  async GMAIL_CLAVE_APP() {
    const correo = require('../correo');
    const r = await correo.probar();
    return r.ok ? `Gmail OK: ${r.noLeidos} sin leer` : r.error;
  },
  async OLLAMA_URL() {
    const r = await pedir(`${obtener('OLLAMA_URL')}/api/tags`, {}, 10);
    if (!r.ok) return `Ollama no responde (${r.error}). ¿Está abierto?`;
    const modelos = (r.datos?.models || []).map((m) => m.name);
    const buscado = obtener('OLLAMA_MODELO');
    return modelos.some((m) => m === buscado || m.startsWith(buscado + ':'))
      ? `Ollama OK con ${buscado}`
      : `Ollama responde, pero falta el modelo ${buscado}. Ejecuta: ollama pull ${buscado}`;
  },
  async NTFY_TEMA() {
    const avisos = require('../avisos');
    const r = await avisos.ntfy({ titulo: 'Jarvis', mensaje: 'Prueba de aviso: si lees esto, funciona.', prioridad: 'default' });
    return r.ok ? 'Aviso enviado: mira el móvil' : r.error;
  },
  async TWILIO_SID() {
    const sid = obtener('TWILIO_SID');
    const r = await pedir(`https://api.twilio.com/2010-04-01/Accounts/${sid}.json`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${sid}:${obtener('TWILIO_TOKEN')}`).toString('base64') },
    }, 20);
    return r.ok ? `Twilio OK (${r.datos?.friendly_name || 'cuenta'})` : r.error;
  },
  async SHOPIFY_TOKEN() {
    const r = await pedir(`https://${obtener('SHOPIFY_TIENDA')}/admin/api/2025-07/shop.json`, { headers: { 'X-Shopify-Access-Token': obtener('SHOPIFY_TOKEN') } }, 20);
    return r.ok ? `Shopify OK (${r.datos?.shop?.name || 'tienda'})` : r.error;
  },
};
PRUEBAS.YOUTUBE_REFRESH_TOKEN = async () => {
  try { return await require('../youtube').probarConexion(); } catch (e) { return e.message; }
};
PRUEBAS.TELEGRAM_BOT_TOKEN = async () => {
  try { return await require('../movil/telegram').probar(); } catch (e) { return e.message; }
};
PRUEBAS.CJ_API_KEY = async () => {
  try { return await require('../tienda/cj').probar(); } catch (e) { return e.message; }
};
PRUEBAS.META_PAGE_TOKEN = async () => {
  try { return await require('../redes/meta').probar(); } catch (e) { return e.message; }
};
PRUEBAS.TIKTOK_REFRESH_TOKEN = async () => {
  try { return await require('../redes/tiktok').probar(); } catch (e) { return e.message; }
};
PRUEBAS.OLLAMA_MODELO = PRUEBAS.OLLAMA_URL;
PRUEBAS.GEMINI_MODELO = PRUEBAS.GEMINI_API_KEY;
PRUEBAS.GMAIL_USUARIO = PRUEBAS.GMAIL_CLAVE_APP;
PRUEBAS.TWILIO_TOKEN = PRUEBAS.TWILIO_SID;
PRUEBAS.SHOPIFY_TIENDA = PRUEBAS.SHOPIFY_TOKEN;

async function probar(clave) {
  const prueba = PRUEBAS[clave];
  if (!prueba) return { ok: true, mensaje: 'Sin prueba automática para esta clave' };
  if (!obtener(clave)) return { ok: false, mensaje: 'Está vacía' };
  try {
    const mensaje = await prueba();
    const ok = /OK|responde|enviado/i.test(mensaje) && !/no responde|falta|HTTP|No se pudo/i.test(mensaje);
    return { ok, mensaje };
  } catch (e) {
    return { ok: false, mensaje: e.message };
  }
}

const recargar = () => { cache = null; };

module.exports = { CATALOGO, obtener, tiene, guardar, paraInterfaz, probar, parsear, recargar };
