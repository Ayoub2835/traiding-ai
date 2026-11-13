// Rutas de datos de Jarvis.
// - En la app instalada: %APPDATA%\Jarvis (ajustes, claves, memoria, habilidades…)
// - Registro de acciones: logs\acciones.log (carpeta del proyecto en desarrollo,
//   %APPDATA%\Jarvis\logs en la app instalada).
// - Carpeta de trabajo de las "manos": Documentos\Jarvis (configurable).
// Para pruebas fuera de Electron se puede fijar JARVIS_DATOS.
const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = path.join(__dirname, '..', '..');

// require('electron') fuera de Electron devuelve una ruta (texto), no el módulo.
function electronApp() {
  try {
    const e = require('electron');
    return typeof e === 'object' && e.app ? e.app : null;
  } catch (_) {
    return null;
  }
}

function asegurar(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function datos(...partes) {
  const base = process.env.JARVIS_DATOS
    || (electronApp() ? electronApp().getPath('userData') : path.join(os.homedir(), '.jarvis'));
  return path.join(asegurar(base), ...partes);
}

function enDesarrollo() {
  const a = electronApp();
  return a ? !a.isPackaged : true;
}

function logs(...partes) {
  const base = process.env.JARVIS_LOGS || (enDesarrollo() && !process.env.JARVIS_DATOS ? path.join(RAIZ, 'logs') : datos('logs'));
  return path.join(asegurar(base), ...partes);
}

function espacioTrabajo(personalizada) {
  if (personalizada) return asegurar(personalizada);
  const a = electronApp();
  const docs = a ? a.getPath('documents') : path.join(os.homedir(), 'Documents');
  return asegurar(process.env.JARVIS_ESPACIO || path.join(docs, 'Jarvis'));
}

// Recursos que vienen con la app (modelo de voz, ejemplo de config…).
function recurso(...partes) {
  const a = electronApp();
  return a && a.isPackaged ? path.join(process.resourcesPath, ...partes) : path.join(RAIZ, ...partes);
}

module.exports = { RAIZ, datos, logs, espacioTrabajo, recurso, asegurar, enDesarrollo };
