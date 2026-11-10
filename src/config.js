// Configuración de Jarvis.
//
// Se forma combinando, por orden (lo último manda):
//   1. config.ejemplo.json  -> opciones por defecto (SIN URLs reales; va en el repositorio)
//   2. config.json          -> opcional, tus opciones (no se sube al repositorio)
//                              Se busca en %APPDATA%\Jarvis\ y en la carpeta del proyecto.
//   3. conexion.json        -> las 3 URLs de n8n que guardas en la pantalla
//                              "Conectar Jarvis" (%APPDATA%\Jarvis\conexion.json).
//
// Las URLs de n8n son "secretas" (quien las tenga puede hablar con tu Jarvis),
// por eso nunca se guardan en el código ni en el repositorio público.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const CAMPOS_URL = ['chatUrl', 'panelUrl', 'vozUrl'];
const RAIZ = path.join(__dirname, '..');

const rutaConexion = () => path.join(app.getPath('userData'), 'conexion.json');

function leerJson(ruta) {
  if (!ruta || !fs.existsSync(ruta)) return null;
  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (e) {
    throw new Error(`${path.basename(ruta)} no es un JSON válido (${ruta}): ${e.message}`);
  }
}

// Une dos objetos de configuración (solo un nivel de profundidad en "n8n").
function combinar(base, extra) {
  if (!extra) return base;
  return { ...base, ...extra, n8n: { ...(base.n8n || {}), ...(extra.n8n || {}) } };
}

// Una URL es válida si es https y no es la de ejemplo.
function urlValida(u) {
  try {
    const url = new URL(String(u || ''));
    return url.protocol === 'https:' && !/TU-INSTANCIA|ID-DE/i.test(url.href);
  } catch (_) {
    return false;
  }
}

function cargarConfig() {
  const ejemplo = leerJson(path.join(process.resourcesPath || '', 'config.ejemplo.json'))
    || leerJson(path.join(RAIZ, 'config.ejemplo.json'))
    || {};
  let cfg = { ...ejemplo, n8n: { ...(ejemplo.n8n || {}) } };
  // Las URLs del ejemplo no valen: se quitan.
  for (const k of CAMPOS_URL) if (!urlValida(cfg.n8n[k])) delete cfg.n8n[k];

  const propia = leerJson(path.join(app.getPath('userData'), 'config.json'))
    || leerJson(path.join(RAIZ, 'config.json'));
  cfg = combinar(cfg, propia);

  const conexion = leerJson(rutaConexion());
  if (conexion) cfg = combinar(cfg, { n8n: conexion });

  for (const k of CAMPOS_URL) if (!urlValida(cfg.n8n[k])) delete cfg.n8n[k];
  return cfg;
}

// ¿Faltan URLs? Entonces hay que mostrar la pantalla "Conectar Jarvis".
function faltanUrls(cfg) {
  return CAMPOS_URL.filter((k) => !cfg || !cfg.n8n || !urlValida(cfg.n8n[k]));
}

function guardarConexion(urls) {
  const limpio = {};
  for (const k of CAMPOS_URL) {
    if (!urlValida(urls[k])) throw new Error(`La URL "${k}" no es válida (debe empezar por https://)`);
    limpio[k] = String(urls[k]).trim();
  }
  fs.mkdirSync(path.dirname(rutaConexion()), { recursive: true });
  fs.writeFileSync(rutaConexion(), JSON.stringify(limpio, null, 2));
}

// Hosts a los que la app tiene permiso de conectarse (solo tu n8n).
function hostsPermitidos(cfg) {
  const hosts = new Set();
  for (const k of CAMPOS_URL) if (cfg && cfg.n8n && urlValida(cfg.n8n[k])) hosts.add(new URL(cfg.n8n[k]).host);
  return hosts;
}

module.exports = { cargarConfig, faltanUrls, guardarConexion, hostsPermitidos, urlValida, CAMPOS_URL };
