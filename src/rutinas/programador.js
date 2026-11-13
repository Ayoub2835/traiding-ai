// Programador de rutinas.
//  - Mientras Jarvis está abierto: un temporizador revisa cada minuto qué toca.
//  - Con Jarvis cerrado: una tarea del Programador de tareas de Windows abre
//    Jarvis con "--rutina=<id>" a la hora indicada. Crear esa tarea cambia un
//    ajuste de Windows, así que SIEMPRE se pide confirmación antes.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const rutas = require('../nucleo/rutas');
const registro = require('../seguridad/registro');
const { EJEMPLOS } = require('./monitores');

const archivo = () => rutas.datos('rutinas.json');

function porDefecto() {
  return {
    resumen: { id: 'resumen', nombre: 'Resumen de la mañana', activo: true, horario: { tipo: 'diario', hora: '08:30' }, aviso: 'voz', ultima: null, windows: false },
    monitores: EJEMPLOS.map((e) => ({ ...e, id: crypto.randomBytes(3).toString('hex'), activo: false, notas: '', ultima: null, ultimoResultado: null, windows: false })),
  };
}

function leer() {
  try { return { ...porDefecto(), ...JSON.parse(fs.readFileSync(archivo(), 'utf8')) }; } catch (_) { return porDefecto(); }
}
function escribir(d) { fs.writeFileSync(archivo(), JSON.stringify(d, null, 2)); return d; }

function todas(d = leer()) { return [d.resumen, ...d.monitores]; }
function obtener(id) { return todas().find((r) => r.id === id) || null; }

function validarHorario(h) {
  if (h && h.tipo === 'diario' && /^([01]\d|2[0-3]):[0-5]\d$/.test(h.hora)) return { tipo: 'diario', hora: h.hora };
  if (h && h.tipo === 'cada' && Number(h.minutos) >= 15) return { tipo: 'cada', minutos: Math.round(Number(h.minutos)) };
  throw new Error('Horario no válido: usa "diario" con hora HH:MM o "cada" con 15 minutos o más');
}

/** Crea o actualiza un monitor (o el resumen). */
function guardar(r) {
  const d = leer();
  const limpio = {
    nombre: String(r.nombre || '').slice(0, 80) || 'Monitor',
    activo: Boolean(r.activo),
    horario: validarHorario(r.horario),
    aviso: ['notificacion', 'movil', 'llamada', 'voz'].includes(r.aviso) ? r.aviso : 'notificacion',
  };
  let id = 'resumen';
  if (r.id === 'resumen') {
    d.resumen = { ...d.resumen, ...limpio, nombre: 'Resumen de la mañana' };
  } else {
    if (!String(r.instruccion || '').trim()) throw new Error('Falta qué debe vigilar');
    const base = d.monitores.find((m) => m.id === r.id);
    const nuevo = {
      ...(base || { id: crypto.randomBytes(3).toString('hex'), notas: '', ultima: null, ultimoResultado: null, windows: false }),
      ...limpio,
      instruccion: String(r.instruccion).slice(0, 1000),
      motor: r.motor === 'manos' ? 'manos' : 'n8n',
    };
    if (base) Object.assign(base, nuevo); else d.monitores.push(nuevo);
    id = nuevo.id;
  }
  escribir(d);
  registro.anotar({ origen: 'rutinas', accion: `guardar rutina ${limpio.nombre}`, detalle: limpio });
  return obtener(id);
}

function quitar(id) {
  const d = leer();
  const m = d.monitores.find((x) => x.id === id);
  if (!m) return false;
  // Copia en _papelera por si acaso.
  const papelera = rutas.asegurar(rutas.datos('_papelera'));
  fs.writeFileSync(path.join(papelera, `monitor-${id}-${Date.now()}.json`), JSON.stringify(m, null, 2));
  d.monitores = d.monitores.filter((x) => x.id !== id);
  escribir(d);
  registro.anotar({ origen: 'rutinas', accion: `quitar monitor ${m.nombre} (copia en _papelera)` });
  return true;
}

/** Guarda el resultado de una ejecución (y las notas del monitor). */
function anotarEjecucion(id, resultado) {
  const d = leer();
  const r = todas(d).find((x) => x.id === id);
  if (!r) return;
  r.ultima = new Date().toISOString();
  r.ultimoResultado = { fecha: r.ultima, ok: resultado.ok, resumen: resultado.resumen || resultado.texto || resultado.error || '', novedad: Boolean(resultado.novedad) };
  if (resultado.ok && resultado.notas !== undefined) r.notas = resultado.notas;
  escribir(d);
}

/** ¿Toca ejecutar esta rutina ahora? */
function toca(r, ahora = new Date()) {
  if (!r.activo) return false;
  const ultima = r.ultima ? new Date(r.ultima) : null;
  if (r.horario.tipo === 'cada') return !ultima || ahora - ultima >= r.horario.minutos * 60000;
  const [h, m] = r.horario.hora.split(':').map(Number);
  const objetivo = new Date(ahora); objetivo.setHours(h, m, 0, 0);
  // Margen de 3 h: si encendiste el PC un poco tarde, aún se hace.
  return ahora >= objetivo && ahora - objetivo < 3 * 3600000 && (!ultima || ultima < objetivo);
}

let temporizador = null;
let ocupado = false;
/** Arranca el temporizador interno. ejecutar(id) debe devolver una promesa. */
function iniciar(ejecutar) {
  clearInterval(temporizador);
  const revisar = async () => {
    if (ocupado) return;
    ocupado = true;
    try {
      for (const r of todas()) {
        if (toca(r)) {
          anotarEjecucion(r.id, { ok: true, resumen: 'En curso…' }); // evita repetir si tarda
          try { await ejecutar(r.id); } catch (e) { anotarEjecucion(r.id, { ok: false, error: e.message }); }
        }
      }
    } finally {
      ocupado = false;
    }
  };
  temporizador = setInterval(revisar, 60000);
  setTimeout(revisar, 20000); // primera revisión poco después de arrancar
}

// ---------------------------------------------------------------------------
// Programador de tareas de Windows (schtasks)
// ---------------------------------------------------------------------------
const nombreTarea = (id) => `Jarvis\\Rutina-${id}`;

/** Argumentos de schtasks para crear la tarea (sin ejecutar nada). */
function argsCrearWindows(r, exe, extra = []) {
  const accion = `"${exe}" ${[...extra, `--rutina=${r.id}`].map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`;
  const base = ['/Create', '/F', '/TN', nombreTarea(r.id), '/TR', accion];
  if (r.horario.tipo === 'diario') return [...base, '/SC', 'DAILY', '/ST', r.horario.hora];
  return [...base, '/SC', 'MINUTE', '/MO', String(Math.min(1439, r.horario.minutos))];
}
const argsBorrarWindows = (id) => ['/Delete', '/F', '/TN', nombreTarea(id)];

function schtasks(args) {
  return new Promise((resolver) => {
    if (process.platform !== 'win32') return resolver({ ok: false, error: 'El Programador de tareas solo existe en Windows' });
    const p = spawn('schtasks', args, { windowsHide: true });
    let salida = '';
    p.stdout.on('data', (d) => { salida += d; });
    p.stderr.on('data', (d) => { salida += d; });
    p.on('error', (e) => resolver({ ok: false, error: e.message }));
    p.on('close', (c) => resolver(c === 0 ? { ok: true } : { ok: false, error: salida.trim() || `schtasks terminó con código ${c}` }));
  });
}

/** Crea o quita la tarea de Windows. LLAMAR SOLO TRAS CONFIRMACIÓN. */
async function programarEnWindows(id, activar, exe, extra = []) {
  const r = obtener(id);
  if (!r) return { ok: false, error: 'Rutina no encontrada' };
  const res = await schtasks(activar ? argsCrearWindows(r, exe, extra) : argsBorrarWindows(id));
  registro.anotar({ origen: 'rutinas', accion: `${activar ? 'crear' : 'quitar'} tarea de Windows ${nombreTarea(id)}`, decision: res.ok ? 'hecho' : 'fallo', motivo: res.error });
  if (res.ok) {
    const d = leer();
    const x = todas(d).find((y) => y.id === id);
    x.windows = activar;
    escribir(d);
  }
  return res;
}

module.exports = { leer, todas, obtener, guardar, quitar, anotarEjecucion, toca, iniciar, argsCrearWindows, argsBorrarWindows, programarEnWindows };
