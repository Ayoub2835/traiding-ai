// Confirmaciones: cuando una acción necesita tu permiso, se crea una petición
// pendiente que la interfaz muestra (y Jarvis te pregunta por voz).
// Si no respondes a tiempo, la respuesta es NO.
'use strict';
const crypto = require('crypto');
const { EventEmitter } = require('events');
const registro = require('./registro');

const eventos = new EventEmitter();
const pendientes = new Map();

/**
 * @param {{origen:string, categoria:string, descripcion:string, tareaId?:string}} p
 * @param {number} segundos tiempo máximo de espera
 * @returns {Promise<boolean>} true si confirmaste
 */
function pedir(p, segundos = 120) {
  const id = crypto.randomBytes(6).toString('hex');
  return new Promise((resolver) => {
    const timer = setTimeout(() => responder(id, false, 'sin respuesta a tiempo'), segundos * 1000);
    pendientes.set(id, { ...p, id, creada: Date.now(), resolver, timer });
    registro.anotar({ origen: p.origen, accion: `pedir confirmación: ${p.descripcion}`, decision: 'pendiente', motivo: p.categoria });
    eventos.emit('nueva', { id, origen: p.origen, categoria: p.categoria, descripcion: p.descripcion, tareaId: p.tareaId, segundos });
  });
}

function responder(id, si, como = 'botón') {
  const p = pendientes.get(id);
  if (!p) return false;
  pendientes.delete(id);
  clearTimeout(p.timer);
  registro.anotar({ origen: p.origen, accion: p.descripcion, decision: si ? 'confirmado' : 'rechazado', motivo: `${p.categoria} (${como})` });
  eventos.emit('resuelta', { id, si });
  p.resolver(Boolean(si));
  return true;
}

function cancelarDeTarea(tareaId) {
  for (const [id, p] of pendientes) if (p.tareaId === tareaId) responder(id, false, 'tarea cancelada');
}

const lista = () => [...pendientes.values()].map(({ resolver, timer, ...r }) => r);

module.exports = { pedir, responder, cancelarDeTarea, lista, eventos };
