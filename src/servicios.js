// Servicios de Jarvis v2: une cerebro, voz, manos, habilidades, rutinas, memoria,
// avisos y seguridad, y los expone a la interfaz por IPC.
//
// La interfaz llama a window.jarvis.llamar('<accion>', ...args); solo existen las
// acciones de la lista ACCIONES. Los avisos hacia la interfaz van por el canal
// 'jarvis:evento' ({tipo, datos}).
'use strict';
const { ipcMain, Notification, dialog, app } = require('electron');
const claves = require('./nucleo/claves');
const ajustes = require('./nucleo/ajustes');
const rutas = require('./nucleo/rutas');
const n8n = require('./nucleo/n8n');
const { crearCerebro } = require('./cerebro/router');
const ollama = require('./cerebro/ollama');
const claude = require('./cerebro/claude');
const voz = require('./voz');
const manos = require('./manos');
const habilidades = require('./habilidades');
const memoria = require('./memoria');
const avisos = require('./avisos');
const noticias = require('./rutinas/noticias');
const resumen = require('./rutinas/resumen');
const monitores = require('./rutinas/monitores');
const programador = require('./rutinas/programador');
const confirmacion = require('./seguridad/confirmacion');
const registro = require('./seguridad/registro');

let ctx = null;        // { cfg(), ventana(), mostrar(), panel(), icono }
let cerebro = null;
const sesionesGemini = new Map();
let mensajesDesdeExtraccion = 0;

const enviar = (tipo, datos) => {
  const v = ctx && ctx.ventana();
  if (v && !v.isDestroyed()) v.webContents.send('jarvis:evento', { tipo, datos });
};

// n8n como herramienta del cerebro (chat de texto de tu Jarvis de siempre).
async function n8nChat(texto) {
  const cfg = ctx.cfg();
  if (!cfg || !cfg.n8n || !cfg.n8n.chatUrl) return { ok: false, error: 'n8n no está conectado' };
  return n8n.enviarMensaje(cfg, ajustes.leer().sessionId, String(texto).slice(0, 6000));
}

// Ejecuta una tarea de manos y espera el resultado (para habilidades y monitores).
async function manosYEsperar(peticion, origen) {
  const { terminada } = await manos.crear(peticion, { origen });
  const t = await terminada;
  return t.estado === 'hecha' ? { ok: true, texto: t.resultado } : { ok: false, error: t.error || `Tarea ${t.estado}` };
}

function herramientasHabilidad({ pensar }) {
  const texto = async (r) => { const x = await r; if (!x.ok) throw new Error(x.error); return x.texto; };
  return {
    pensar: (t) => texto(pensar('Eres Jarvis, el asistente de Ayoub. Responde en el idioma de la petición, claro y sin markdown.', t)),
    pensar_claude: (t) => texto(pensar('Eres Jarvis, el asistente de Ayoub. Responde en el idioma de la petición.', t, { preferir: 'claude' })),
    n8n: async (t) => { const r = await n8nChat(t); if (!r.ok) throw new Error(r.error); return r.respuesta; },
    manos: async (t) => { const r = await manosYEsperar(t, 'habilidad'); if (!r.ok) throw new Error(r.error); return r.texto; },
    memoria_buscar: async (t) => memoria.buscar(t, 8).map((h) => `- ${h.texto}`).join('\n') || '(nada guardado sobre esto)',
    memoria_guardar: async (t) => { memoria.guardarHecho(t, 'dato', 'habilidad'); return 'Guardado en memoria'; },
    noticias: async () => noticias.comoTexto(await noticias.titulares(ctx.cfg()?.noticias || noticias.POR_DEFECTO, 4)) || '(sin noticias)',
    avisar: async (t) => { const r = await avisos.ntfy({ titulo: 'Jarvis', mensaje: t }); return r.ok ? 'Aviso enviado al móvil' : `No se pudo avisar: ${r.error}`; },
  };
}

// "Vigila X y avísame" → crea un monitor (desactivado de Windows; activo en la app).
async function crearMonitorDesdeTexto(texto) {
  const r = await cerebro.pensar(
    'Convierte la petición en un monitor. Responde SOLO JSON: {"nombre":"corto","instruccion":"qué buscar exactamente","horario":{"tipo":"diario","hora":"HH:MM"} o {"tipo":"cada","minutos":N>=15},"aviso":"movil"|"notificacion"|"llamada"}. '
    + 'Si no dice cada cuánto, usa cada 240 minutos. "llamada" solo si dice que es urgente o que le llames. Finanzas: solo vigilar.',
    texto,
  );
  if (!r.ok) return { ok: false, error: r.error };
  try {
    const d = JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]);
    const m = programador.guardar({ ...d, motor: 'n8n', activo: true });
    enviar('rutinas', programador.todas());
    const cada = m.horario.tipo === 'diario' ? `cada día a las ${m.horario.hora}` : `cada ${m.horario.minutos} minutos`;
    return { ok: true, texto: `Hecho: vigilaré "${m.nombre}" ${cada} y te avisaré ${m.aviso === 'movil' ? 'al móvil' : m.aviso === 'llamada' ? 'con una llamada' : 'con una notificación'} si hay novedades. Lo tienes en la pestaña Rutinas.` };
  } catch (e) {
    return { ok: false, error: 'No he entendido qué vigilar' };
  }
}

// ---------------------------------------------------------------------------
// Rutinas
// ---------------------------------------------------------------------------
async function ejecutarRutina(id, { desdeWindows = false } = {}) {
  const r = programador.obtener(id);
  if (!r) return { ok: false, error: 'Rutina no encontrada' };
  enviar('rutina_inicio', { id, nombre: r.nombre });
  if (id === 'resumen') {
    const res = await resumen.generar({
      nombre: (ctx.cfg() && ctx.cfg().nombreUsuario) || 'Ayoub',
      n8nChat,
      panel: ctx.panel,
      tareasPendientes: () => manos.listar().filter((t) => ['en_cola', 'en_curso', 'esperando_permiso', 'fallida'].includes(t.estado)).slice(0, 5),
      pensar: cerebro.pensar,
      fuentesNoticias: ctx.cfg()?.noticias,
    });
    programador.anotarEjecucion(id, res);
    if (desdeWindows || res.ok) ctx.mostrar();
    enviar('rutina', { id, nombre: r.nombre, ...res, hablar: true });
    return res;
  }
  const res = await monitores.ejecutar(r, { n8nChat, manos: (t) => manosYEsperar(t, `monitor:${r.nombre}`), pensar: cerebro.pensar });
  programador.anotarEjecucion(id, res);
  if (res.ok && res.novedad) {
    if (Notification.isSupported()) new Notification({ title: `👁 ${r.nombre}`, body: res.resumen, icon: ctx.icono }).show();
    if (r.aviso === 'movil' || r.aviso === 'llamada' || res.urgente) {
      await avisos.avisar({ titulo: r.nombre, mensaje: res.resumen, urgencia: res.urgente ? 'urgente' : 'normal', permitirLlamada: r.aviso === 'llamada' });
    }
  }
  enviar('rutina', { id, nombre: r.nombre, ...res, hablar: res.ok && res.novedad });
  enviar('rutinas', programador.todas());
  return res;
}

// Cambiar el Programador de tareas de Windows: SIEMPRE con confirmación.
async function programarWindows(id, activar) {
  const r = programador.obtener(id);
  if (!r) return { ok: false, error: 'Rutina no encontrada' };
  const { response } = await dialog.showMessageBox(ctx.ventana(), {
    type: 'question', buttons: ['Sí, cambiarlo', 'No'], defaultId: 1, cancelId: 1, title: 'Jarvis',
    message: activar ? `¿Crear una tarea en el Programador de tareas de Windows para "${r.nombre}"?` : `¿Quitar "${r.nombre}" del Programador de tareas de Windows?`,
    detail: activar ? 'Así Windows abrirá Jarvis a la hora indicada aunque esté cerrado. Es un ajuste de Windows de tu usuario; puedes quitarlo cuando quieras.' : '',
  });
  if (response !== 0) {
    registro.anotar({ origen: 'rutinas', accion: `tarea de Windows ${r.nombre}`, decision: 'rechazado' });
    return { ok: false, error: 'Cancelado' };
  }
  const extra = app.isPackaged ? [] : [rutas.RAIZ];
  const res = await programador.programarEnWindows(id, activar, process.execPath, extra);
  enviar('rutinas', programador.todas());
  return res;
}

// ---------------------------------------------------------------------------
// Estado de los servicios (para la pantalla de Ajustes y el arranque)
// ---------------------------------------------------------------------------
async function estadoServicios() {
  const [o, cc] = await Promise.all([ollama.disponible(), manos.comprobar()]);
  return {
    ollama: { ok: o.ok, detalle: o.ok ? `Ollama · ${ollama.modelo()}` : o.error },
    claude: { ok: claude.disponible(), detalle: claude.disponible() ? `Claude · ${claude.modelo()}` : 'Falta ANTHROPIC_API_KEY' },
    claudeCode: { ok: cc.ok, detalle: cc.ok ? `Claude Code ${cc.version}` : cc.error },
    voz: { ok: true, detalle: { 'realtime-openai': 'Tiempo real · OpenAI', 'realtime-gemini': 'Tiempo real · Gemini Live', openai: 'OpenAI (grabar y transcribir)', n8n: 'Voz por n8n' }[voz.modo(ajustes.leer().modoVoz)], modo: voz.modo(ajustes.leer().modoVoz) },
    ntfy: { ok: claves.tiene('NTFY_TEMA'), detalle: claves.tiene('NTFY_TEMA') ? 'Avisos al móvil activos' : 'Sin avisos al móvil' },
    twilio: { ok: claves.tiene('TWILIO_SID'), detalle: claves.tiene('TWILIO_SID') ? 'Llamadas urgentes activas' : 'Sin llamadas' },
  };
}

// ---------------------------------------------------------------------------
// Acciones disponibles para la interfaz
// ---------------------------------------------------------------------------
const ACCIONES = {
  // Cerebro
  'cerebro.responder': async (texto, origen = 'texto') => {
    const r = await cerebro.responder(String(texto || '').slice(0, 6000), { origen, alProgreso: (p) => enviar('progreso', p) });
    // Cada 6 mensajes, extrae hechos duraderos en segundo plano (modelo local si hay).
    if (++mensajesDesdeExtraccion >= 6) {
      mensajesDesdeExtraccion = 0;
      memoria.extraerHechos(async (s, u) => { const x = await cerebro.pensar(s, u, { preferir: 'local' }); if (!x.ok) throw new Error(x.error); return x.texto; })
        .catch(() => {});
    }
    return r;
  },
  'cerebro.decidir': (texto) => cerebro.decidir(String(texto || '')),
  // Voz
  'voz.modo': () => voz.modo(ajustes.leer().modoVoz),
  'voz.transcribir': (audio, mime) => voz.transcribir(Buffer.from(audio), mime),
  'voz.sintetizar': (texto) => voz.sintetizar(texto),
  'voz.sesionOpenAI': () => voz.sesionOpenAI((ctx.cfg() && ctx.cfg().nombreUsuario) || 'Ayoub'),
  'voz.geminiAbrir': async () => {
    const s = new voz.SesionGemini((ctx.cfg() && ctx.cfg().nombreUsuario) || 'Ayoub');
    const id = Math.random().toString(36).slice(2, 10);
    for (const ev of ['audio', 'texto', 'interrumpido', 'fin_turno', 'cerrada', 'error']) s.on(ev, (d) => enviar('gemini', { id, ev, d }));
    s.on('herramienta', async (h) => {
      const r = await ACCIONES['cerebro.responder'](h.args.peticion || '', 'voz-tiempo-real');
      s.responderHerramienta(h.id, h.nombre, r.ok ? `${r.texto} (contestó: ${r.motor})` : `Error: ${r.error}`);
      enviar('respuesta_herramienta', r);
    });
    try { await s.abrir(); } catch (e) { return { ok: false, error: e.message }; }
    sesionesGemini.set(id, s);
    return { ok: true, id };
  },
  'voz.geminiAudio': (id, b64) => { sesionesGemini.get(id)?.enviarAudio(b64); },
  'voz.geminiCerrar': (id) => { sesionesGemini.get(id)?.cerrar(); sesionesGemini.delete(id); },
  // Manos
  'manos.listar': () => manos.listar(),
  'manos.cancelar': (id) => manos.cancelar(id),
  'manos.crear': async (peticion) => (await manos.crear(String(peticion || ''), { origen: 'boton' })).tarea,
  // Confirmaciones
  'confirmacion.lista': () => confirmacion.lista(),
  'confirmacion.responder': (id, si, como) => confirmacion.responder(id, Boolean(si), como === 'voz' ? 'voz' : 'botón'),
  // Habilidades
  'habilidades.listar': () => habilidades.listar().map(({ archivo, ...h }) => h),
  'habilidades.borrar': (nombre) => { const ok = habilidades.borrar(nombre); enviar('habilidades', null); return ok; },
  // Rutinas
  'rutinas.listar': () => programador.todas(),
  'rutinas.guardar': (r) => { const g = programador.guardar(r); enviar('rutinas', programador.todas()); return g; },
  'rutinas.quitar': (id) => { const ok = programador.quitar(id); enviar('rutinas', programador.todas()); return ok; },
  'rutinas.ejecutar': (id) => ejecutarRutina(id),
  'rutinas.windows': (id, activar) => programarWindows(id, Boolean(activar)),
  // Memoria
  'memoria.hechos': () => memoria.leerHechos().slice().reverse(),
  'memoria.borrarHecho': (id) => memoria.borrarHecho(id),
  // Claves y servicios
  'claves.listar': () => claves.paraInterfaz(),
  'claves.guardar': (cambios) => { const r = claves.guardar(cambios); registro.anotar({ origen: 'ajustes', accion: `guardar claves: ${Object.keys(cambios || {}).join(', ')}` }); return r; },
  'claves.probar': (clave) => claves.probar(clave),
  'servicios.estado': () => estadoServicios(),
  // Registro
  'registro.ultimas': (n) => registro.ultimas(Math.min(500, Number(n) || 100)),
};

function iniciar(contexto) {
  ctx = contexto;
  cerebro = crearCerebro({
    nombre: () => (ctx.cfg() && ctx.cfg().nombreUsuario) || 'Ayoub',
    n8nChat,
    panel: ctx.panel,
    crearMonitor: crearMonitorDesdeTexto,
    herramientasHabilidad,
  });

  ipcMain.handle('jarvis:accion', async (_e, accion, ...args) => {
    const fn = ACCIONES[accion];
    if (!fn) return { ok: false, error: `Acción desconocida: ${accion}` };
    try {
      return await fn(...args);
    } catch (e) {
      console.error('[servicios]', accion, e);
      return { ok: false, error: e.message };
    }
  });

  manos.configurar({ espacio: ajustes.leer().carpetaTrabajo || null });
  manos.eventos.on('cambio', (t) => {
    enviar('tarea', t);
    if (['hecha', 'fallida'].includes(t.estado) && Notification.isSupported()) {
      new Notification({ title: t.estado === 'hecha' ? '✔ Tarea terminada' : '✘ Tarea fallida', body: `${t.titulo}\n${(t.resultado || t.error || '').slice(0, 180)}`, icon: ctx.icono }).show();
    }
  });
  confirmacion.eventos.on('nueva', (p) => { ctx.mostrar(); enviar('confirmacion', p); });
  confirmacion.eventos.on('resuelta', (p) => enviar('confirmacion_resuelta', p));
  programador.iniciar((id) => ejecutarRutina(id));
}

module.exports = { iniciar, ejecutarRutina, ACCIONES };
