// Ajustes del usuario guardados en %APPDATA%\Jarvis\ajustes.json
// (color LED, voz sí/no, volumen, modo conversación...).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const POR_DEFECTO = {
  colorLed: '#00e5ff',     // color base de las luces LED
  modoRgb: true,           // arcoíris animado sobre el color base
  voz: true,               // Jarvis habla en voz alta
  volumen: 0.9,            // 0..1
  nombreVoz: '',           // voz de Windows de RESPALDO ('' = la primera en español)
  conversacion: true,      // vuelve a escuchar tras responder
  activacion: true,        // escucha siempre la palabra "Jarvis" (en local, con Vosk)
  modoVoz: 'local',        // local = gratis (Whisper + Edge TTS); auto = tiempo real si hay clave; clasico = OpenAI; n8n
  usarN8n: false,          // n8n es OPCIONAL: apagado por defecto (Ajustes)
  interrumpir: true,       // puedes cortar a Jarvis hablando mientras habla
  avisarMovilNovedades: true, // ideas/informes nuevos de n8n también al móvil (ntfy)
  carpetaTrabajo: '',      // carpeta de las "manos" ('' = Documentos\Jarvis)
  arranqueAutomatico: null,// null = aún no se ha preguntado
  sessionId: '',           // id de sesión para la memoria del chat en n8n
  idsVistos: [],           // elementos del panel ya notificados
};

const RUTA = () => path.join(app.getPath('userData'), 'ajustes.json');
let cache = null;

function leer() {
  if (cache) return cache;
  let guardados = {};
  try {
    guardados = JSON.parse(fs.readFileSync(RUTA(), 'utf8'));
  } catch (_) { /* primera vez o archivo dañado: se usan los valores por defecto */ }
  cache = { ...POR_DEFECTO, ...guardados };
  // Jarvis 100 % local (nov. 2026): voz gratis y n8n apagado por defecto.
  if (!cache.migradoLocal) {
    cache.modoVoz = 'local';
    cache.usarN8n = false;
    cache.migradoLocal = true;
    guardar();
  }
  if (!cache.sessionId) {
    cache.sessionId = 'jarvis-pc-' + crypto.randomBytes(6).toString('hex');
    guardar();
  }
  return cache;
}

function guardar() {
  fs.mkdirSync(path.dirname(RUTA()), { recursive: true });
  fs.writeFileSync(RUTA(), JSON.stringify(cache, null, 2));
}

// Cambia solo las claves indicadas y guarda en disco.
function actualizar(cambios) {
  leer();
  Object.assign(cache, cambios);
  guardar();
  return cache;
}

// Versión "pública" para la interfaz (sin la lista interna de ids).
function paraInterfaz() {
  const { idsVistos, ...resto } = leer();
  return resto;
}

module.exports = { leer, actualizar, paraInterfaz };
