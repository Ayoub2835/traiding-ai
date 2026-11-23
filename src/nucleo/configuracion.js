// «Configurar Jarvis»: lista de todo lo que se puede conectar, si ya está y cómo
// hacerlo paso a paso. Solo mira SI existe cada clave (nunca su valor).
'use strict';
const claves = require('./claves');

const t = (k) => claves.tiene(k);

function pasos() {
  let tienda = false;
  try { const ts = require('../tienda/tiendas'); tienda = ts.lista().some((x) => ts.conectada(x.id)); } catch (_) { tienda = false; }
  const lista = [
    { id: 'cerebro', nombre: 'Cerebro (Gemini gratis o Claude)', ok: t('GEMINI_API_KEY') || t('ANTHROPIC_API_KEY'), para: 'Pensar, escribir fichas, guiones y respuestas',
      como: ['Entra en aistudio.google.com con tu cuenta de Google', 'Pulsa «Get API key» → «Create API key» y cópiala', 'Jarvis → AJUSTES → Claves → GEMINI_API_KEY → pégala → Guardar → Probar'] },
    { id: 'ntfy', nombre: 'Avisos al móvil (ntfy)', ok: t('NTFY_TEMA'), para: 'Que Jarvis te avise de pedidos, ventas y recordatorios',
      como: ['Instala la app ntfy en el móvil', 'En la app, pulsa ＋ y suscríbete a un tema difícil de adivinar (p. ej. jarvis-tunombre-7k2p9x)', 'AJUSTES → Claves → NTFY_TEMA → el mismo tema → Guardar → Probar'] },
    { id: 'cj', nombre: 'CJ Dropshipping', ok: t('CJ_API_KEY'), para: 'Buscar productos y comprar los pedidos (tiendas con dropshipping)',
      como: ['cjdropshipping.com → tu perfil → Authorization / API', 'Genera la API Key y cópiala', 'AJUSTES → Claves → CJ_API_KEY → Guardar → Probar'] },
    { id: 'shopify', nombre: 'Tienda de Shopify', ok: tienda, para: 'Crear productos, ver pedidos, poner seguimientos y páginas',
      como: ['admin.shopify.com → Configuración → Apps y canales de ventas → Desarrollar apps → Crear una app', 'Configurar permisos de Admin API: write_products, read_products, read_orders, write_merchant_managed_fulfillment_orders, write_content, write_legal_policies', 'Instalar la app → Revelar el token de Admin API (empieza por shpat_)', 'Jarvis → TIENDA → ＋ Añadir tienda → dirección, token y tipo → Guardar'] },
    { id: 'gmail', nombre: 'Gmail', ok: t('GMAIL_USUARIO') && t('GMAIL_CLAVE_APP'), para: 'Leer correos de clientes y dejar respuestas en Borradores',
      como: ['myaccount.google.com → Seguridad → activa la verificación en 2 pasos', 'Busca «Contraseñas de aplicaciones» → crea una llamada Jarvis → copia las 16 letras', 'AJUSTES → Claves → GMAIL_USUARIO (tu email) y GMAIL_CLAVE_APP → Guardar → Probar'] },
    { id: 'meta', nombre: 'Facebook e Instagram', ok: t('META_PAGE_TOKEN'), para: 'Publicar vídeos y reels, y la Biblioteca de anuncios',
      como: ['developers.facebook.com → Crear app (tipo Empresa) → copia el ID y la clave secreta', 'AJUSTES → Claves → META_APP_ID y META_APP_SECRET → Guardar', 'Tu Instagram debe ser profesional y estar unido a tu Página de Facebook', 'REDES → Conectar Facebook/Instagram → acepta los permisos'] },
    { id: 'anuncios', nombre: 'Anuncios de Meta', ok: t('META_ADS_TOKEN') && t('META_AD_ACCOUNT_ID'), para: 'Crear campañas (siempre en pausa) y leer el gasto',
      como: ['business.facebook.com → Configuración → Cuentas publicitarias → copia el número', 'AJUSTES → Claves → META_AD_ACCOUNT_ID → Guardar', 'REDES → vuelve a conectar Facebook aceptando ads_management y ads_read'] },
    { id: 'pixel', nombre: 'Píxel de Meta', ok: t('META_PIXEL_ID'), para: 'Campañas de VENTAS que buscan compras',
      como: ['Shopify → Apps → instala «Facebook & Instagram» y conecta tu píxel', 'business.facebook.com → Administrador de eventos → copia el número del píxel', 'AJUSTES → Claves → META_PIXEL_ID → Guardar'] },
    { id: 'youtube', nombre: 'YouTube', ok: t('YOUTUBE_REFRESH_TOKEN'), para: 'Subir los vídeos que crea Jarvis',
      como: ['console.cloud.google.com → crea un proyecto → activa «YouTube Data API v3»', 'Credenciales → ID de cliente OAuth → tipo «App de escritorio» → copia ID y secreto', 'AJUSTES → Claves → YOUTUBE_CLIENT_ID y YOUTUBE_CLIENT_SECRET → Guardar', 'REDES → Conectar YouTube → elige tu canal'] },
    { id: 'tiktok', nombre: 'TikTok', ok: t('TIKTOK_REFRESH_TOKEN'), para: 'Subir los vídeos a TikTok',
      como: ['developers.tiktok.com → crea una app con «Login Kit» y «Content Posting API»', 'Copia el Client Key y el Client Secret', 'AJUSTES → Claves → TIKTOK_CLIENT_KEY y TIKTOK_CLIENT_SECRET → Guardar', 'REDES → Conectar TikTok (hasta que TikTok revise tu app, los vídeos salen solo para ti)'] },
    { id: 'telegram', nombre: 'Telegram (controlar Jarvis desde el móvil)', ok: t('TELEGRAM_BOT_TOKEN') && t('TELEGRAM_CHAT_ID'), para: 'Hablar con Jarvis, aprobar pedidos y vídeos, recordatorios',
      como: ['En Telegram, habla con @BotFather → /newbot → nombre → copia el token', 'AJUSTES → Claves → TELEGRAM_BOT_TOKEN → Guardar', 'Escribe a tu bot /vincular y el código que te muestra Jarvis'] },
  ];
  return { listos: lista.filter((x) => x.ok).length, total: lista.length, pasos: lista };
}

module.exports = { pasos };
