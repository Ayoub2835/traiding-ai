// Carga config.json (URLs de n8n y opciones generales).
// Orden de búsqueda:
//   1. Carpeta de datos del usuario (%APPDATA%\Jarvis\config.json) -> permite
//      cambiar URLs sin reinstalar.
//   2. Carpeta "resources" de la app instalada (copiada por el instalador).
//   3. Raíz del proyecto (modo desarrollo: npm start).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

function rutasCandidatas() {
  return [
    path.join(app.getPath('userData'), 'config.json'),
    path.join(process.resourcesPath || '', 'config.json'),
    path.join(__dirname, '..', 'config.json'),
  ];
}

function cargarConfig() {
  for (const ruta of rutasCandidatas()) {
    if (ruta && fs.existsSync(ruta)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(ruta, 'utf8'));
        cfg._ruta = ruta;
        validar(cfg);
        return cfg;
      } catch (e) {
        throw new Error(`config.json no válido (${ruta}): ${e.message}`);
      }
    }
  }
  throw new Error('No se encuentra config.json');
}

function validar(cfg) {
  if (!cfg.n8n || !cfg.n8n.chatUrl || !cfg.n8n.panelUrl) {
    throw new Error('faltan n8n.chatUrl o n8n.panelUrl');
  }
  // Solo se aceptan URLs https: nada de enviar datos en claro.
  for (const u of [cfg.n8n.chatUrl, cfg.n8n.panelUrl]) {
    if (new URL(u).protocol !== 'https:') throw new Error(`la URL debe ser https: ${u}`);
  }
}

// Hosts a los que la app tiene permiso de conectarse (solo tu n8n).
function hostsPermitidos(cfg) {
  return new Set([new URL(cfg.n8n.chatUrl).host, new URL(cfg.n8n.panelUrl).host]);
}

module.exports = { cargarConfig, hostsPermitidos };
