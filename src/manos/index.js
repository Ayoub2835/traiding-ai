// Manos de Jarvis: tareas reales en el PC con Claude Code en modo headless.
//
//   claude -p --output-format stream-json --verbose
//          --mcp-config <archivo> --permission-prompt-tool mcp__jarvis__permiso
//
// - Archivos y terminal: herramientas propias de Claude Code.
// - Navegador: servidor MCP de Playwright.
// - n8n: servidor MCP de tu n8n (si pones N8N_MCP_URL y N8N_MCP_TOKEN).
// - Shopify: Admin API con SHOPIFY_TIENDA y SHOPIFY_TOKEN (variables de entorno).
// Cada acción pasa por la política de seguridad (seguridad/politica.js) a través
// del servidor MCP de permisos (permisos-mcp.js) y un puerto local con token.
// Idea de OpenJarvis (agents/claude_code.py: ejecutar Claude como subproceso y
// leer su salida JSON); implementación propia con el CLI de Claude Code.
'use strict';
const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const rutas = require('../nucleo/rutas');
const claves = require('../nucleo/claves');
const politica = require('../seguridad/politica');
const confirmacion = require('../seguridad/confirmacion');
const registro = require('../seguridad/registro');
const { REGLA_DATOS } = require('../seguridad/inyeccion');

const eventos = new EventEmitter();
const tareas = new Map();
const procesos = new Map();
const cola = [];
let puente = null; // { puerto, token }
let opciones = { espacio: null, maxTurnos: 40 };

const archivoTareas = () => rutas.datos('tareas.json');
const ahora = () => new Date().toISOString();

function guardar() {
  const lista = [...tareas.values()].slice(-100);
  try { fs.writeFileSync(archivoTareas(), JSON.stringify(lista, null, 2)); } catch (_) { /* no crítico */ }
}

function cargar() {
  try {
    for (const t of JSON.parse(fs.readFileSync(archivoTareas(), 'utf8'))) {
      // Las que estaban a medias al cerrar la app quedan como interrumpidas.
      if (['en_cola', 'en_curso', 'esperando_permiso'].includes(t.estado)) { t.estado = 'fallida'; t.error = 'Interrumpida al cerrar Jarvis'; }
      tareas.set(t.id, t);
    }
  } catch (_) { /* primera vez */ }
}

function actualizar(t, cambios, progreso) {
  Object.assign(t, cambios, { actualizada: ahora() });
  if (progreso) {
    t.progreso.push({ hora: ahora(), texto: String(progreso).slice(0, 400) });
    if (t.progreso.length > 40) t.progreso.splice(0, t.progreso.length - 40);
  }
  guardar();
  eventos.emit('cambio', publica(t));
}

const publica = (t) => ({ ...t, progreso: t.progreso.slice(-15) });
const listar = () => [...tareas.values()].map(publica).reverse();

// ---------------------------------------------------------------------------
// Puente local: el servidor MCP de permisos pregunta aquí (127.0.0.1 + token)
// ---------------------------------------------------------------------------
function iniciarPuente() {
  if (puente) return Promise.resolve(puente);
  const token = crypto.randomBytes(24).toString('hex');
  return new Promise((resolver) => {
    const servidor = http.createServer((req, res) => {
      const responder = (codigo, obj) => { res.writeHead(codigo, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method !== 'POST' || req.url !== '/permiso') return responder(404, {});
      if (req.headers.authorization !== `Bearer ${token}`) return responder(401, { permitir: false, motivo: 'token no válido' });
      let cuerpo = '';
      req.on('data', (c) => { cuerpo += c; if (cuerpo.length > 1e6) req.destroy(); });
      req.on('end', async () => {
        try {
          const { tarea, herramienta, entrada } = JSON.parse(cuerpo);
          responder(200, await decidirPermiso(tarea, herramienta, entrada));
        } catch (e) {
          responder(200, { permitir: false, motivo: `Error: ${e.message}` });
        }
      });
    });
    servidor.listen(0, '127.0.0.1', () => {
      puente = { puerto: servidor.address().port, token, servidor };
      resolver(puente);
    });
  });
}

async function decidirPermiso(tareaId, herramienta, entrada) {
  const t = tareas.get(tareaId);
  if (!t || ['cancelada', 'hecha', 'fallida'].includes(t.estado)) return { permitir: false, motivo: 'La tarea ya no está activa' };
  const d = politica.evaluarHerramienta(herramienta, entrada, { espacio: t.espacio });
  const resumen = `${herramienta} ${JSON.stringify(entrada).slice(0, 200)}`;
  if (d.decision === 'permitir') {
    registro.anotar({ origen: `manos:${tareaId}`, accion: resumen, decision: 'permitido', motivo: d.motivo });
    return { permitir: true };
  }
  if (d.decision === 'denegar') {
    registro.anotar({ origen: `manos:${tareaId}`, accion: resumen, decision: 'denegado', motivo: d.motivo });
    actualizar(t, {}, `⛔ Denegado: ${d.motivo}`);
    return { permitir: false, motivo: d.motivo };
  }
  // Confirmar: se pausa la tarea y se te pregunta.
  const estadoAntes = t.estado;
  actualizar(t, { estado: 'esperando_permiso' }, `✋ Pide permiso: ${d.descripcion}`);
  const si = await confirmacion.pedir({ origen: `manos:${tareaId}`, categoria: d.categoria, descripcion: d.descripcion, tareaId });
  if (t.estado === 'esperando_permiso') actualizar(t, { estado: estadoAntes === 'esperando_permiso' ? 'en_curso' : estadoAntes }, si ? '✔ Permiso concedido' : '✘ Permiso denegado');
  return si ? { permitir: true } : { permitir: false, motivo: 'Ayoub no lo ha autorizado. No lo intentes de otra forma; explica qué faltaba.' };
}

// ---------------------------------------------------------------------------
// Lanzar Claude Code
// ---------------------------------------------------------------------------
function scriptPermisos() {
  // En la app instalada el script está fuera del .asar (asarUnpack).
  return path.join(__dirname, 'permisos-mcp.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

function configMcp(tareaId) {
  const win = process.platform === 'win32';
  const servidores = {
    jarvis: {
      command: process.execPath,
      args: [scriptPermisos()],
      env: { ELECTRON_RUN_AS_NODE: '1', JARVIS_PUERTO_PERMISOS: String(puente.puerto), JARVIS_TOKEN_PERMISOS: puente.token, JARVIS_TAREA: tareaId },
    },
    playwright: win
      ? { command: 'cmd', args: ['/c', 'npx', '-y', '@playwright/mcp@0.0.85'] }
      : { command: 'npx', args: ['-y', '@playwright/mcp@0.0.85'] },
  };
  if (claves.tiene('N8N_MCP_URL')) {
    servidores.n8n = { type: 'http', url: claves.obtener('N8N_MCP_URL'), headers: { Authorization: `Bearer ${claves.obtener('N8N_MCP_TOKEN')}` } };
  }
  const ruta = path.join(rutas.asegurar(rutas.datos('manos')), `mcp-${tareaId}.json`);
  fs.writeFileSync(ruta, JSON.stringify({ mcpServers: servidores }, null, 2), { mode: 0o600 });
  return ruta;
}

function reglas(t) {
  return [
    'Eres las "manos" de Jarvis, el asistente de Ayoub. Haz la tarea de forma autónoma y termina con un resumen breve en español de lo hecho.',
    `Trabaja dentro de esta carpeta: ${t.espacio}. No toques archivos fuera de ella salvo que la tarea lo pida expresamente.`,
    'NUNCA borres nada: si algo sobra, muévelo a la carpeta "_papelera" dentro de la carpeta de trabajo.',
    'Pagar, comprar, publicar, enviar mensajes a otras personas, instalar programas o cambiar ajustes de Windows requieren permiso: Jarvis lo pedirá; si te lo deniega, no lo intentes por otro camino.',
    'Finanzas: solo consultar y vigilar. Nunca muevas dinero, ni compres o vendas activos.',
    REGLA_DATOS,
    claves.tiene('SHOPIFY_TOKEN') ? `Shopify: tienda ${claves.obtener('SHOPIFY_TIENDA')}; usa la Admin API (GraphQL) con el token de la variable de entorno SHOPIFY_TOKEN.` : '',
    'Para la web usa las herramientas del navegador (Playwright).',
  ].filter(Boolean).join('\n');
}

// En Windows "claude" suele ser un .cmd: hay que lanzarlo con el intérprete y comillas.
const comillas = (a) => (process.platform === 'win32' && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '""')}"` : a);

function ejecutar(t) {
  const mcp = configMcp(t.id);
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', String(opciones.maxTurnos),
    '--mcp-config', mcp, '--permission-prompt-tool', 'mcp__jarvis__permiso'];
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  if (claves.tiene('ANTHROPIC_API_KEY')) env.ANTHROPIC_API_KEY = claves.obtener('ANTHROPIC_API_KEY');
  if (claves.tiene('SHOPIFY_TOKEN')) { env.SHOPIFY_TOKEN = claves.obtener('SHOPIFY_TOKEN'); env.SHOPIFY_TIENDA = claves.obtener('SHOPIFY_TIENDA'); }
  const comando = claves.obtener('CLAUDE_CODE_RUTA') || 'claude';
  const win = process.platform === 'win32';

  actualizar(t, { estado: 'en_curso', iniciada: ahora() }, 'Arrancando Claude Code…');
  registro.anotar({ origen: `manos:${t.id}`, accion: 'iniciar tarea', detalle: t.peticion });

  let proc;
  try {
    proc = spawn(win ? comillas(comando) : comando, win ? args.map(comillas) : args, {
      cwd: t.espacio, env, shell: win, detached: !win, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    return terminar(t, 'fallida', null, `No se pudo lanzar Claude Code: ${e.message}`);
  }
  procesos.set(t.id, proc);
  proc.stdin.end(`${reglas(t)}\n\nTAREA DE AYOUB:\n${t.peticion}\n`);

  let resto = '';
  let errores = '';
  let resultado = null;
  proc.stdout.on('data', (d) => {
    resto += d.toString('utf8');
    const lineas = resto.split('\n');
    resto = lineas.pop();
    for (const l of lineas) {
      if (!l.trim()) continue;
      let ev;
      try { ev = JSON.parse(l); } catch (_) { continue; }
      if (ev.type === 'system' && ev.subtype === 'init') {
        const jarvis = (ev.mcp_servers || []).find((s) => s.name === 'jarvis');
        actualizar(t, {}, jarvis && jarvis.status !== 'connected' ? `⚠ El control de permisos no conectó (${jarvis.status})` : 'Claude Code listo');
      } else if (ev.type === 'assistant') {
        for (const b of ev.message?.content || []) {
          if (b.type === 'text' && b.text.trim()) actualizar(t, {}, b.text.trim());
          if (b.type === 'tool_use') actualizar(t, {}, `→ ${b.name.replace(/^mcp__/, '').replace(/__/g, ' · ')}`);
        }
      } else if (ev.type === 'result') {
        resultado = ev;
      }
    }
  });
  proc.stderr.on('data', (d) => { errores = (errores + d.toString('utf8')).slice(-3000); });
  proc.on('error', (e) => {
    const msg = e.code === 'ENOENT' ? 'Claude Code no está instalado (npm install -g @anthropic-ai/claude-code)' : e.message;
    terminar(t, 'fallida', null, msg);
  });
  proc.on('close', (codigo) => {
    procesos.delete(t.id);
    fs.rm(mcp, { force: true }, () => {});
    if (t.estado === 'cancelada') return siguiente();
    if (resultado && !resultado.is_error) {
      terminar(t, 'hecha', resultado.result || '(sin resumen)', null, resultado.total_cost_usd);
    } else {
      const motivo = resultado?.result || resultado?.subtype || errores.trim().split('\n').slice(-3).join(' ') || `Claude Code terminó con código ${codigo}`;
      terminar(t, 'fallida', null, motivo);
    }
  });
}

function terminar(t, estado, resultado, error, coste) {
  actualizar(t, { estado, resultado: resultado || null, error: error || null, coste: coste ?? null, terminada: ahora() },
    estado === 'hecha' ? '✔ Terminada' : estado === 'cancelada' ? '■ Cancelada' : `✘ ${error}`);
  registro.anotar({ origen: `manos:${t.id}`, accion: 'fin de tarea', decision: estado, motivo: error || undefined, detalle: resultado || undefined });
  const fin = t._fin;
  delete t._fin;
  if (fin) fin(publica(t));
  siguiente();
}

function siguiente() {
  if ([...tareas.values()].some((t) => t.estado === 'en_curso' || t.estado === 'esperando_permiso')) return;
  const id = cola.shift();
  const t = id && tareas.get(id);
  if (t && t.estado === 'en_cola') ejecutar(t);
}

/**
 * Crea una tarea. Devuelve la tarea y una promesa que se cumple al terminar.
 * @param {string} peticion lo que Ayoub quiere que se haga
 * @param {{origen?:string, titulo?:string}} o
 */
async function crear(peticion, o = {}) {
  await iniciarPuente();
  const id = crypto.randomBytes(3).toString('hex');
  const t = {
    id, titulo: o.titulo || String(peticion).slice(0, 80), peticion: String(peticion), origen: o.origen || 'voz',
    estado: 'en_cola', creada: ahora(), actualizada: ahora(), espacio: rutas.espacioTrabajo(opciones.espacio), progreso: [],
    resultado: null, error: null,
  };
  const terminada = new Promise((r) => { t._fin = r; });
  Object.defineProperty(t, '_fin', { enumerable: false, writable: true, configurable: true, value: t._fin });
  tareas.set(id, t);
  cola.push(id);
  actualizar(t, {}, 'En cola');
  siguiente();
  return { tarea: publica(t), terminada };
}

function matarArbol(proc) {
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { windowsHide: true });
    else process.kill(-proc.pid, 'SIGTERM');
  } catch (_) {
    try { proc.kill('SIGTERM'); } catch (__) { /* ya cerrado */ }
  }
}

function cancelar(id) {
  const t = tareas.get(id);
  if (!t || ['hecha', 'fallida', 'cancelada'].includes(t.estado)) return false;
  const idx = cola.indexOf(id);
  if (idx >= 0) cola.splice(idx, 1);
  confirmacion.cancelarDeTarea(id);
  const proc = procesos.get(id);
  terminar(t, 'cancelada', null, null);
  if (proc) matarArbol(proc);
  registro.anotar({ origen: `manos:${id}`, accion: 'cancelar tarea', decision: 'cancelada' });
  return true;
}

/** ¿Está Claude Code instalado? */
function comprobar() {
  return new Promise((resolver) => {
    const comando = claves.obtener('CLAUDE_CODE_RUTA') || 'claude';
    let salida = '';
    let p;
    try {
      p = spawn(comando, ['--version'], { shell: process.platform === 'win32', windowsHide: true });
    } catch (e) {
      return resolver({ ok: false, error: e.message });
    }
    const t = setTimeout(() => { p.kill(); resolver({ ok: false, error: 'Claude Code no responde' }); }, 15000);
    p.stdout.on('data', (d) => { salida += d; });
    p.on('error', () => { clearTimeout(t); resolver({ ok: false, error: 'Claude Code no está instalado' }); });
    p.on('close', (c) => { clearTimeout(t); resolver(c === 0 ? { ok: true, version: salida.trim() } : { ok: false, error: 'Claude Code no está instalado' }); });
  });
}

function configurar(o) { opciones = { ...opciones, ...o }; }

cargar();

module.exports = { crear, cancelar, listar, comprobar, configurar, eventos, iniciarPuente, decidirPermiso, _tareas: tareas };
