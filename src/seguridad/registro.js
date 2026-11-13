// Registro de acciones: logs/acciones.log (una línea JSON por acción).
// Sirve para saber siempre qué ha hecho Jarvis, quién lo pidió y qué se decidió.
const fs = require('fs');
const rutas = require('../nucleo/rutas');

const ruta = () => rutas.logs('acciones.log');

// Nunca escribimos claves en el registro.
function sinSecretos(texto) {
  return String(texto ?? '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…')
    .replace(/(token|clave|password|api[_-]?key)(["'\s:=]+)[^\s"',}]+/gi, '$1$2…')
    .slice(0, 2000);
}

/**
 * @param {{origen:string, accion:string, decision?:string, detalle?:any, motivo?:string}} e
 */
function anotar(e) {
  const linea = {
    fecha: new Date().toISOString(),
    origen: e.origen,
    accion: sinSecretos(e.accion),
    decision: e.decision || 'hecho',
    motivo: e.motivo ? sinSecretos(e.motivo) : undefined,
    detalle: e.detalle !== undefined ? sinSecretos(typeof e.detalle === 'string' ? e.detalle : JSON.stringify(e.detalle)) : undefined,
  };
  try {
    fs.appendFileSync(ruta(), JSON.stringify(linea) + '\n');
  } catch (err) {
    console.error('[registro] No se pudo escribir:', err.message);
  }
  return linea;
}

function ultimas(n = 100) {
  try {
    const lineas = fs.readFileSync(ruta(), 'utf8').trim().split('\n');
    return lineas.slice(-n).map((l) => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean).reverse();
  } catch (_) {
    return [];
  }
}

module.exports = { anotar, ultimas, ruta, sinSecretos };
