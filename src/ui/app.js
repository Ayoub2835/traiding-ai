// Lógica de la interfaz de Jarvis v2: conexión, saludo, voz, chat, paneles y ajustes.
// Las pestañas nuevas (Tareas, Habilidades, Rutinas), las claves y las
// confirmaciones están en pestanas.js.
'use strict';

const $ = (id) => document.getElementById(id);
const api = window.jarvis;
const { Grabadora, Reproductor, Pitidos, Vosk, Activacion, Vigilante, Boca } = window.VozJarvis;

const estado = {
  info: null,
  ajustes: null,
  panel: { items: [] },
  conectado: false,
  ocupado: false,       // hay una petición en curso a n8n
  conversando: false,   // bucle de conversación por voz activo
  grabando: false,
  atajo: { ultimo: 0, mantenido: false, vigilante: null },
  hablando: false,     // Jarvis está hablando (voz de n8n o de respaldo)
  turno: 0,             // sube al pulsar Parar: se descartan respuestas que lleguen tarde
  modoVoz: 'n8n',       // realtime-openai | realtime-gemini | openai | n8n (lo decide el proceso principal)
};

const nucleo = new window.Nucleo($('nucleo'));
const grabadora = new Grabadora();
const reproductor = new Reproductor();
const activacion = new Activacion(() => alOirActivacion());
const vigilante = new Vigilante(); // para interrumpir a Jarvis hablando
const tiempoReal = new window.TiempoReal({
  alNivel: (n) => nucleo.setNivel(n),
  alTexto: (rol, t) => añadirMensaje(rol === 'error' ? 'error' : rol, t, rol === 'jarvis' ? 'Tiempo real' : null),
  alEstado: (e) => ponerEstadoVoz(e, /HABLANDO/.test(e) ? 'hablando' : /PROCESANDO/.test(e) ? 'pensando' : 'escuchando'),
  alHerramienta: (r) => { if (r.tareaId) window.Pestanas?.avisoTarea(); },
  alFin: (motivo) => {
    estado.conversando = false;
    if (motivo === 'inactividad') añadirMensaje('sistema', 'Tiempo real cerrado por inactividad.');
    reposo();
    reanudarActivacion();
  },
});
let boca = null; // voz de Windows, solo de respaldo

// Frases para terminar la conversación (es / fr / darija).
const FRASES_FIN = /^(gracias( jarvis)?|para|parar|stop|adiós|adios|eso es todo|nada más|nada mas|calla|cállate|callate|silencio|merci|c'est tout|safi|baraka|chokran|شكرا|صافي|بركة)[.!]?$/i;

// ---------------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------------
function ponerEstadoVoz(texto, estadoNucleo) {
  $('estadoVoz').textContent = texto;
  if (estadoNucleo) nucleo.setEstado(estadoNucleo);
}

function reposo() {
  if (!estado.ocupado && !estado.grabando && !estado.hablando && !reproductor.sonando && !(boca && boca.hablando)) {
    ponerEstadoVoz('EN ESPERA', 'reposo');
  }
  actualizarBotones();
}

function actualizarBotones() {
  const hablando = estado.hablando || reproductor.sonando || (boca && boca.hablando);
  $('btnParar').classList.toggle('oculto', !(hablando || estado.ocupado || estado.conversando));
  $('btnMicro').classList.toggle('activo', estado.grabando);
}

let temporizadorAviso = null;
function mostrarError(mensaje) {
  console.error('[Jarvis]', mensaje);
  $('avisoTexto').textContent = mensaje;
  $('aviso').classList.remove('oculto');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => $('aviso').classList.add('oculto'), 15000);
  nucleo.setEstado('error');
  setTimeout(() => { if (nucleo.estado === 'error') reposo(); }, 2500);
}

function añadirMensaje(quien, texto, motor) {
  const div = document.createElement('div');
  div.className = `msg ${quien}`;
  div.dir = 'auto'; // el árabe se muestra de derecha a izquierda automáticamente
  div.textContent = texto;
  // Quién contestó: Ollama, Claude, n8n, manos, habilidad…
  if (motor) {
    const m = document.createElement('span');
    m.className = 'motor';
    m.dir = 'ltr';
    m.textContent = `vía ${motor}`;
    div.appendChild(m);
  }
  $('chat').appendChild(div);
  $('chat').scrollTop = $('chat').scrollHeight;
}

function aplicarColor(hex) {
  document.documentElement.style.setProperty('--led', hex);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  document.documentElement.style.setProperty('--led-suave', `rgba(${r}, ${g}, ${b}, 0.25)`);
  nucleo.setColor(hex, estado.ajustes ? estado.ajustes.modoRgb : true);
}

function saludoSegunHora(fecha = new Date()) {
  const h = fecha.getHours();
  if (h >= 6 && h < 14) return 'Buenos días';
  if (h >= 14 && h < 21) return 'Buenas tardes';
  return 'Buenas noches';
}

const esPendiente = (i) => /pendiente/i.test(String(i.estado || ''));
const formatoFecha = (f) => {
  const d = new Date(f);
  return isNaN(d) ? String(f || '') : d.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

// ---------------------------------------------------------------------------
// Hablar: voz de Jarvis (mp3 de n8n) o, si no hay, voz de Windows de respaldo
// ---------------------------------------------------------------------------
async function decir({ texto, audioBase64 }) {
  if (!estado.ajustes.voz || (!texto && !audioBase64)) return;
  activacion.pausar(); // que no se "oiga" a sí mismo
  estado.hablando = true;
  ponerEstadoVoz('HABLANDO', 'hablando');
  actualizarBotones();
  const alNivel = (n) => nucleo.setNivel(n);
  // Si puedes interrumpirle, el micro escucha mientras habla.
  if (estado.ajustes.interrumpir && estado.conversando) {
    vigilante.iniciar(() => { estado.interrumpido = true; reproductor.parar(); boca.callar(); }).catch(() => {});
  }
  try {
    // Sin audio de n8n: voz de OpenAI si hay clave; si no, la de Windows.
    if (!audioBase64 && texto) {
      const s = await api.llamar('voz.sintetizar', texto).catch(() => null);
      if (s && s.audioBase64) audioBase64 = s.audioBase64;
      else if (s && s.error) console.warn(s.error);
    }
    if (audioBase64) {
      await reproductor.reproducir(audioBase64, { volumen: estado.ajustes.volumen, alNivel });
    } else {
      await boca.hablar(texto, { volumen: estado.ajustes.volumen, nombreVoz: estado.ajustes.nombreVoz, alNivel });
    }
  } catch (e) {
    mostrarError(e.message);
  } finally {
    vigilante.parar();
    estado.hablando = false;
    reposo();
  }
}

// Para a Jarvis: deja de hablar, de grabar y sale del modo conversación.
function pararTodo() {
  estado.turno++;
  estado.conversando = false;
  reproductor.parar();
  if (boca) boca.callar();
  vigilante.parar();
  if (tiempoReal.activo) tiempoReal.parar('parado');
  if (estado.grabando) grabadora.cancelar();
  nucleo.setNivel(0);
  reposo();
  reanudarActivacion();
}

// ---------------------------------------------------------------------------
// Preguntar a Jarvis
//   texto escrito o voz transcrita → cerebro (router: Ollama / Claude / n8n /
//   manos / habilidades) → respuesta con el motor que contestó → voz.
//   Modo de voz "n8n" (sin claves): tu voz va al endpoint de voz de n8n, como antes.
// ---------------------------------------------------------------------------
async function responderTexto(texto, origen, turno) {
  const r = await api.llamar('cerebro.responder', texto, origen);
  if (turno !== estado.turno) return false; // se pulsó Parar mientras pensaba
  if (!r.ok) {
    añadirMensaje('error', '⚠ ' + r.error);
    mostrarError(r.error);
    return false;
  }
  añadirMensaje('jarvis', r.texto, r.motor);
  if (r.tareaId) window.Pestanas?.avisoTarea();
  estado.ocupado = false;
  await decir({ texto: r.texto });
  return true;
}

/**
 * @param {{texto?: string, blob?: Blob, mime?: string}} entrada
 * @returns {Promise<boolean>} true si Jarvis respondió
 */
async function preguntar(entrada) {
  if (estado.ocupado) return false;
  estado.ocupado = true;
  const turno = estado.turno;
  if (entrada.texto) añadirMensaje('yo', entrada.texto);
  ponerEstadoVoz('PROCESANDO…', 'pensando');
  actualizarBotones();
  try {
    if (entrada.texto) return await responderTexto(entrada.texto, 'texto', turno);

    const audio = await entrada.blob.arrayBuffer();
    if (estado.modoVoz === 'n8n') {
      // Flujo de siempre: n8n entiende, piensa y habla.
      const r = await api.enviarVoz({ audio, mime: entrada.mime });
      if (turno !== estado.turno) return false;
      if (r.ok) {
        marcarRed(true);
        añadirMensaje('yo', r.pregunta || '(audio)');
        $('transcripcion').textContent = r.pregunta;
        añadirMensaje('jarvis', r.respuesta, 'n8n · voz');
        estado.ocupado = false;
        await decir({ texto: r.respuesta, audioBase64: r.audioBase64 });
        return true;
      }
      return await respaldo(entrada, `Voz de n8n: ${r.error}`, turno);
    }
    // Con OpenAI: transcribir (cualquier idioma) y pasar por el router.
    const t = await api.llamar('voz.transcribir', audio, entrada.mime);
    if (turno !== estado.turno) return false;
    if (!t.ok) return await respaldo(entrada, t.error, turno);
    if (!t.texto) { ponerEstadoVoz('NO TE HE ENTENDIDO', 'reposo'); return false; }
    añadirMensaje('yo', t.texto);
    $('transcripcion').textContent = t.texto;
    return await responderTexto(t.texto, 'voz', turno);
  } catch (e) {
    return await respaldo(entrada, e.message || String(e), turno);
  } finally {
    estado.ocupado = false;
    reposo();
  }
}

// Respaldo sin conexión: Vosk transcribe en local (español) y pasa por el router.
async function respaldo(entrada, motivo, turno) {
  mostrarError(motivo);
  añadirMensaje('error', '⚠ ' + motivo + ' — probando el modo de respaldo…');
  if (!entrada.blob) return false;
  ponerEstadoVoz('RESPALDO LOCAL…', 'pensando');
  let texto;
  try {
    texto = await Vosk.transcribir(entrada.blob);
  } catch (e) {
    añadirMensaje('error', '⚠ ' + e.message);
    return false;
  }
  if (!texto) {
    añadirMensaje('error', '⚠ El respaldo local no entendió nada (solo entiende español).');
    return false;
  }
  añadirMensaje('yo', texto);
  $('transcripcion').textContent = texto;
  return responderTexto(texto, 'voz-respaldo', turno);
}

$('formChat').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('textoChat').value.trim();
  if (!texto || estado.ocupado) return;
  $('textoChat').value = '';
  reproductor.parar();
  if (boca) boca.callar();
  await preguntar({ texto });
});

// ---------------------------------------------------------------------------
// Conversación por voz: graba → n8n → responde → (modo conversación) repite
// ---------------------------------------------------------------------------
async function conversar() {
  if (estado.conversando || estado.grabando) { // segundo toque = enviar ya / parar
    if (estado.grabando) grabadora.detener(); else pararTodo();
    return;
  }
  if (tiempoReal.activo) { tiempoReal.parar('parado'); return; }
  if (!estado.conectado) return abrirConexion();
  reproductor.parar();
  if (boca) boca.callar();
  activacion.pausar();
  estado.conversando = true;
  // Tiempo real (OpenAI Realtime / Gemini Live) si hay clave.
  if (estado.modoVoz.startsWith('realtime')) {
    try {
      Pitidos.empezar(estado.ajustes.volumen);
      ponerEstadoVoz('CONECTANDO…', 'pensando');
      await tiempoReal.iniciar(estado.modoVoz);
      actualizarBotones();
      return;
    } catch (e) {
      mostrarError(`Tiempo real no disponible (${e.message}). Sigo en modo normal.`);
      // OpenAI sin tiempo real → grabar y transcribir; Gemini → n8n.
      estado.modoVoz = estado.modoVoz === 'realtime-openai' ? 'openai' : 'n8n';
      estado.conversando = true;
    }
  }
  try {
    while (estado.conversando) {
      const g = await grabarFrase();
      if (!estado.conversando || !g || g.cancelada) break;
      if (!g.hablado) { ponerEstadoVoz('NO TE HE OÍDO', 'reposo'); break; }
      estado.interrumpido = false;
      const ok = await preguntar({ blob: g.blob, mime: g.mime });
      const ultimo = [...document.querySelectorAll('.msg.yo')].pop();
      if (!ok || !estado.ajustes.conversacion) break;
      if (ultimo && FRASES_FIN.test(ultimo.textContent.trim())) break;
    }
  } catch (e) {
    mostrarError(e.message || String(e));
  } finally {
    estado.conversando = false;
    estado.grabando = false;
    reposo();
    reanudarActivacion();
  }
}

async function grabarFrase() {
  estado.grabando = true;
  $('transcripcion').textContent = '';
  ponerEstadoVoz('ESCUCHANDO…', 'escuchando');
  actualizarBotones();
  Pitidos.empezar(estado.ajustes.volumen);
  try {
    return await grabadora.grabar({
      silencio: estado.info.silencioParaCortar || 1.5,
      alNivel: (n) => nucleo.setNivel(n),
    });
  } finally {
    estado.grabando = false;
    Pitidos.terminar(estado.ajustes.volumen);
    actualizarBotones();
  }
}

$('btnMicro').addEventListener('click', conversar);
$('nucleo').addEventListener('click', conversar);
$('btnParar').addEventListener('click', pararTodo);

// Ctrl+Espacio (atajo global). Pulsar = empezar a hablar.
// Mantener pulsado: Windows repite el atajo mientras lo mantienes; cuando
// dejan de llegar repeticiones, sabemos que lo has soltado y se envía.
api.alPedirEscuchar((datos) => {
  const ahora = Date.now();
  const a = estado.atajo;
  const esRepeticion = ahora - a.ultimo < 300;
  a.ultimo = ahora;
  if (!datos || !datos.desdeAtajo) { if (!estado.conversando) conversar(); return; }

  if (estado.grabando) {
    if (esRepeticion) {
      a.mantenido = true;
      clearTimeout(a.vigilante);
      a.vigilante = setTimeout(() => { if (a.mantenido && estado.grabando) grabadora.detener(); a.mantenido = false; }, 400);
    } else {
      grabadora.detener(); // segundo toque = enviar ya
    }
    return;
  }
  if (esRepeticion) return;
  a.mantenido = false;
  if (!estado.conversando) conversar();
});
// Con la ventana activa, soltar Espacio también envía (mantener para hablar).
document.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && estado.atajo.mantenido && estado.grabando) {
    estado.atajo.mantenido = false;
    grabadora.detener();
  }
});

// ---------------------------------------------------------------------------
// Palabra de activación "Jarvis" (Vosk, en local)
// ---------------------------------------------------------------------------
function alOirActivacion() {
  if (estado.ocupado || estado.grabando || estado.conversando || reproductor.sonando) return;
  conversar();
}

async function reanudarActivacion() {
  if (!estado.ajustes || !estado.ajustes.activacion) return;
  if (estado.ocupado || estado.grabando || estado.conversando || reproductor.sonando) return;
  try {
    await activacion.reanudar();
  } catch (e) {
    mostrarError('Palabra de activación: ' + e.message);
  }
}

async function aplicarActivacion() {
  const encendida = !!estado.ajustes.activacion;
  $('estadoActivacion').classList.toggle('oculto', !encendida);
  if (!encendida) return activacion.apagar();
  $('estadoActivacion').textContent = '◌ cargando oído local…';
  try {
    await activacion.encender();
    $('estadoActivacion').textContent = '◉ di «Jarvis»';
    $('estadoActivacion').classList.add('escuchando');
    if (estado.conversando || estado.ocupado || reproductor.sonando) activacion.pausar();
  } catch (e) {
    $('estadoActivacion').textContent = '✕ activación no disponible';
    mostrarError('Palabra de activación: ' + e.message);
  }
}

// ---------------------------------------------------------------------------
// Panel de memoria y pestaña PENDIENTE
// ---------------------------------------------------------------------------
function tarjeta(item) {
  const div = document.createElement('div');
  div.className = 'tarjeta';
  div.dir = 'auto';
  const partes = [
    ['tipo', [item.tipo, item.negocio].filter(Boolean).join(' · ')],
    ['titulo', item.titulo || '(sin título)'],
    ['detalle', item.detalle || ''],
  ];
  for (const [clase, texto] of partes) {
    const el = document.createElement('div');
    el.className = clase;
    el.dir = 'auto';
    el.textContent = texto;
    div.appendChild(el);
  }
  const meta = document.createElement('div');
  meta.className = 'meta';
  for (const t of [formatoFecha(item.fecha), item.euros ? `~${item.euros} €` : '', item.estado ? item.estado.replace(/_/g, ' ') : '']) {
    if (!t) continue;
    const s = document.createElement('span');
    s.textContent = t;
    meta.appendChild(s);
  }
  div.appendChild(meta);
  return div;
}

function pintarLista(contenedor, items, textoVacio) {
  contenedor.replaceChildren();
  if (!items.length) {
    const v = document.createElement('div');
    v.className = 'vacio';
    v.textContent = textoVacio;
    contenedor.appendChild(v);
    return;
  }
  items.forEach((i) => contenedor.appendChild(tarjeta(i)));
}

function pintarPanel(panel) {
  estado.panel = panel;
  const items = panel.items || [];
  const pendientes = items.filter(esPendiente);
  $('contPendiente').textContent = pendientes.length;
  pintarLista($('listaPendiente'), pendientes, panel.ok === false && !items.length ? 'No se pudo leer el panel.' : 'Nada pendiente. 👌');
  pintarLista($('listaMemoria'), items, 'La memoria está vacía.');
  $('panelRevisado').textContent = panel.revisado ? 'Revisado ' + formatoFecha(panel.revisado) : '—';
  if (panel.sinConectar) {
    marcarRed(false, 'Sin conectar');
  } else if (panel.ok === false) {
    marcarRed(false, panel.error);
    mostrarError('Panel de memoria: ' + panel.error);
  } else {
    marcarRed(true);
  }
}

function marcarRed(ok, motivo) {
  $('estadoRed').classList.toggle('ok', ok);
  $('estadoRed').classList.toggle('mal', !ok);
  $('estadoRedTexto').textContent = ok ? 'n8n conectado' : (estado.conectado ? 'n8n sin conexión' : 'sin conectar');
  $('estadoRed').title = ok ? 'Conexión con n8n correcta' : motivo || '';
}

api.alActualizarPanel(pintarPanel);
$('btnRevisar').addEventListener('click', async () => {
  $('btnRevisar').disabled = true;
  await api.revisarPanel();
  $('btnRevisar').disabled = false;
});

// Pestañas
function abrirPestana(nombre) {
  document.querySelectorAll('.pestanas button').forEach((b) => b.classList.toggle('activa', b.dataset.pestana === nombre));
  document.querySelectorAll('.contenido-pestana').forEach((c) => c.classList.toggle('oculto', c.id !== 'pestana-' + nombre));
}
document.querySelectorAll('.pestanas button').forEach((b) => b.addEventListener('click', () => abrirPestana(b.dataset.pestana)));
api.alAbrirPestana(abrirPestana);

// ---------------------------------------------------------------------------
// Pantalla "Conectar Jarvis"
// ---------------------------------------------------------------------------
const CAMPOS_CONEXION = { chatUrl: 'cxChat', panelUrl: 'cxPanel', vozUrl: 'cxVoz' };
let alConectar = null;

async function abrirConexion() {
  const c = await api.estadoConexion();
  for (const [k, id] of Object.entries(CAMPOS_CONEXION)) {
    $(id).value = c.urls[k] || '';
    $(id + 'Estado').textContent = '';
    $(id + 'Estado').className = '';
  }
  $('cxMensaje').textContent = '';
  $('cxCancelar').classList.toggle('oculto', !estado.conectado);
  $('capaConexion').classList.remove('oculto');
  $(Object.values(CAMPOS_CONEXION).find((id) => !$(id).value) || 'cxChat').focus();
  return new Promise((r) => { alConectar = r; });
}

function cerrarConexion(conectado) {
  $('capaConexion').classList.add('oculto');
  if (alConectar) { alConectar(conectado); alConectar = null; }
}

$('formConexion').addEventListener('submit', async (e) => {
  e.preventDefault();
  const urls = Object.fromEntries(Object.entries(CAMPOS_CONEXION).map(([k, id]) => [k, $(id).value.trim()]));
  $('cxGuardar').disabled = true;
  $('cxMensaje').textContent = 'Probando las 3 conexiones… (puede tardar unos segundos)';
  for (const id of Object.values(CAMPOS_CONEXION)) { $(id + 'Estado').textContent = '…'; $(id + 'Estado').className = ''; }
  try {
    const r = await api.probarYGuardarConexion(urls);
    for (const [k, id] of Object.entries(CAMPOS_CONEXION)) {
      const campo = r.campos[k] || { ok: false, error: 'sin probar' };
      $(id + 'Estado').textContent = campo.ok ? '✔ ' + (campo.detalle || 'correcto') : '✘ ' + campo.error;
      $(id + 'Estado').className = campo.ok ? 'ok' : 'mal';
    }
    if (r.ok) {
      $('cxMensaje').textContent = '✔ Guardado. ¡Jarvis está conectado!';
      estado.conectado = true;
      setTimeout(() => cerrarConexion(true), 900);
    } else {
      $('cxMensaje').textContent = 'No se ha guardado: corrige las direcciones marcadas con ✘.';
    }
  } finally {
    $('cxGuardar').disabled = false;
  }
});
$('cxCancelar').addEventListener('click', () => cerrarConexion(false));
$('btnConexion').addEventListener('click', () => abrirConexion());

// ---------------------------------------------------------------------------
// Ajustes (se guardan solos en %APPDATA%\Jarvis\ajustes.json)
// ---------------------------------------------------------------------------
function pintarAjustes() {
  const a = estado.ajustes;
  $('ajColor').value = a.colorLed;
  $('ajRgb').checked = a.modoRgb;
  $('ajVoz').checked = a.voz;
  $('ajVolumen').value = a.volumen;
  $('ajVolumenValor').textContent = Math.round(a.volumen * 100) + '%';
  $('ajConversacion').checked = a.conversacion;
  $('ajActivacion').checked = !!a.activacion;
  $('ajInterrumpir').checked = !!a.interrumpir;
  $('ajModoVoz').value = a.modoVoz || 'auto';
  $('ajMovil').checked = !!a.avisarMovilNovedades;
  $('ajArranque').checked = !!estado.info.arrancaConWindows;
  $('filaArranque').classList.toggle('oculto', !estado.info.puedeArrancarSolo);
  aplicarColor(a.colorLed);
}

function pintarVoces() {
  const sel = $('ajNombreVoz');
  const voces = boca.vocesEspanol();
  sel.replaceChildren();
  if (!voces.length) {
    sel.appendChild(new Option('(no hay voces en español instaladas)', ''));
    return;
  }
  sel.appendChild(new Option('Automática', ''));
  voces.forEach((v) => sel.appendChild(new Option(`${v.name} (${v.lang})`, v.name)));
  sel.value = estado.ajustes.nombreVoz || '';
}

async function guardar(cambios) {
  estado.ajustes = await api.guardarAjustes(cambios);
  if ('arranqueAutomatico' in cambios) estado.info = await api.info();
  pintarAjustes();
  if ('activacion' in cambios) aplicarActivacion();
}

$('ajColor').addEventListener('input', (e) => aplicarColor(e.target.value));
$('ajColor').addEventListener('change', (e) => guardar({ colorLed: e.target.value }));
$('ajRgb').addEventListener('change', (e) => guardar({ modoRgb: e.target.checked }));
$('ajVoz').addEventListener('change', (e) => { if (!e.target.checked) { reproductor.parar(); boca.callar(); } guardar({ voz: e.target.checked }); });
$('ajVolumen').addEventListener('input', (e) => { $('ajVolumenValor').textContent = Math.round(e.target.value * 100) + '%'; });
$('ajVolumen').addEventListener('change', (e) => guardar({ volumen: Number(e.target.value) }));
$('ajNombreVoz').addEventListener('change', (e) => guardar({ nombreVoz: e.target.value }));
$('ajConversacion').addEventListener('change', (e) => guardar({ conversacion: e.target.checked }));
$('ajActivacion').addEventListener('change', (e) => guardar({ activacion: e.target.checked }));
$('ajInterrumpir').addEventListener('change', (e) => guardar({ interrumpir: e.target.checked }));
$('ajMovil').addEventListener('change', (e) => guardar({ avisarMovilNovedades: e.target.checked }));
$('ajModoVoz').addEventListener('change', async (e) => { await guardar({ modoVoz: e.target.value }); await window.__actualizarModoVoz(); window.Pestanas?.pintarServicios(); });
$('ajArranque').addEventListener('change', (e) => guardar({ arranqueAutomatico: e.target.checked }));
$('btnProbarVoz').addEventListener('click', () => {
  if (!estado.ajustes.voz) return mostrarError('La voz está desactivada en Ajustes.');
  // Prueba completa: texto → n8n → voz de Jarvis.
  preguntar({ texto: `Di solo esta frase: "Hola ${estado.info.nombreUsuario}, así suena mi voz."` });
});
$('btnProbarNotif').addEventListener('click', () => api.notificacionPrueba());
api.alCambiarAjustes(async (a) => { estado.ajustes = a; estado.info = await api.info(); pintarAjustes(); });

// ---------------------------------------------------------------------------
// Ventana, teclado y reloj
// ---------------------------------------------------------------------------
$('btnOcultar').addEventListener('click', () => api.ocultar());
$('btnPantalla').addEventListener('click', () => api.pantallaCompleta());
$('avisoCerrar').addEventListener('click', () => $('aviso').classList.add('oculto'));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!$('capaConexion').classList.contains('oculto')) {
      if (estado.conectado) cerrarConexion(false);
      return;
    }
    const activo = estado.conversando || estado.grabando || estado.ocupado || reproductor.sonando || (boca && boca.hablando);
    if (activo) pararTodo(); else api.ocultar();
  }
  if (e.key === 'F11') api.pantallaCompleta();
});
setInterval(() => {
  $('reloj').textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}, 1000);

// ---------------------------------------------------------------------------
// Saludo inicial: "Buenos días, Ayoub" + lo pendiente (con la voz de Jarvis)
// ---------------------------------------------------------------------------
// "un informe", "una idea", "una decisión"...
function articulo(palabra) {
  const p = String(palabra).toLowerCase().trim();
  const femeninas = ['idea', 'decision', 'decisión', 'oportunidad', 'tarea', 'nota', 'alerta'];
  return femeninas.includes(p) || /(a|ión|ion|dad)$/.test(p) ? 'una' : 'un';
}

// Texto del saludo hecho en la app (se usa si n8n no responde).
function textoSaludo() {
  const nombre = estado.info.nombreUsuario;
  let texto = `${saludoSegunHora()}, ${nombre}.`;
  const panel = estado.panel;
  if (panel.ok === false && !(panel.items || []).length) {
    return texto + ' No he podido consultar tu panel de memoria. El motivo aparece en pantalla.';
  }
  const pendientes = (panel.items || []).filter(esPendiente);
  if (!pendientes.length) return texto + ' No tienes nada pendiente. ¿En qué te ayudo?';
  texto += pendientes.length === 1 ? ' Tienes una cosa pendiente.' : ` Tienes ${pendientes.length} cosas pendientes.`;
  pendientes.slice(0, 6).forEach((p, i) => {
    const tipo = p.tipo ? `${articulo(p.tipo)} ${p.tipo}` : 'un elemento';
    texto += ` ${i === 0 ? 'Primero' : i === pendientes.length - 1 ? 'Y por último' : 'Después'}, ${tipo}: ${p.titulo}.`;
  });
  if (pendientes.length > 6) texto += ` Y ${pendientes.length - 6} más en la pestaña Pendiente.`;
  return texto;
}

async function saludar() {
  // Solo una vez por arranque de la app (no al mostrar/ocultar la ventana).
  if (sessionStorage.getItem('saludado')) return;
  sessionStorage.setItem('saludado', '1');
  const textoLocal = textoSaludo();
  if (!estado.ajustes.voz || estado.panel.ok === false) {
    añadirMensaje('jarvis', textoLocal);
    return decir({ texto: textoLocal });
  }
  // Pedimos a Jarvis que salude con SU voz, leyendo el mismo resumen.
  estado.ocupado = true;
  ponerEstadoVoz('PROCESANDO…', 'pensando');
  try {
    const r = await api.enviarVoz({
      texto: `[Saludo automático de la app al encender el PC] Saluda en español en 2 o 3 frases, empezando exactamente por "${saludoSegunHora()}, ${estado.info.nombreUsuario}." y resume esto: ${textoLocal.split('.').slice(1).join('.').trim()}`,
    });
    estado.ocupado = false;
    if (r.ok) {
      añadirMensaje('jarvis', r.respuesta);
      return await decir({ texto: r.respuesta, audioBase64: r.audioBase64 });
    }
    mostrarError('Voz de n8n: ' + r.error);
  } finally {
    estado.ocupado = false;
  }
  añadirMensaje('jarvis', textoLocal);
  await decir({ texto: textoLocal });
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
async function iniciar() {
  iniciarFondo($('fondo'), () => getComputedStyle(document.documentElement).getPropertyValue('--led').trim() || '#00e5ff');
  estado.info = await api.info();
  estado.ajustes = await api.leerAjustes();
  boca = new Boca(estado.info.idiomaVoz);
  pintarAjustes();
  pintarVoces();
  speechSynthesis.addEventListener('voiceschanged', pintarVoces);
  ponerEstadoVoz('EN ESPERA', 'reposo');
  estado.modoVoz = await api.llamar('voz.modo');
  window.Pestanas?.iniciar({ añadirMensaje, mostrarError, decir, pararTodo, estado, activacion, reanudarActivacion, abrirConexion });

  if (estado.info.errorConfig) mostrarError('Configuración: ' + estado.info.errorConfig);
  $('notaAtajo').textContent = estado.info.atajo.ok
    ? `Atajo global: ${estado.info.atajo.atajo.replace('CommandOrControl', 'Ctrl').replace('Space', 'Espacio')} (pulsa, o mantén pulsado mientras hablas).`
    : estado.info.atajo.error;
  if (!estado.info.atajo.ok && estado.info.atajo.error) añadirMensaje('error', '⚠ ' + estado.info.atajo.error);

  // Primera vez: pantalla "Conectar Jarvis".
  const conexion = await api.estadoConexion();
  estado.conectado = conexion.faltan.length === 0;
  if (!estado.conectado) {
    marcarRed(false, 'Sin conectar');
    await abrirConexion();
  }

  // Esperamos al primer resultado del panel (máx. 20 s) para el saludo.
  let panel = await api.leerPanel();
  const limite = Date.now() + 20000;
  while ((!panel.revisado || panel.sinConectar) && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 500));
    panel = await api.leerPanel();
  }
  pintarPanel(panel);
  aplicarActivacion();
  await saludar();
  reanudarActivacion();
}

iniciar().catch((e) => mostrarError('Error al iniciar: ' + e.message));

// Para pruebas automáticas (no se usa en el uso normal).
window.__jarvis = { estado, nucleo, grabadora, reproductor, activacion, vigilante, tiempoReal, Vosk, get boca() { return boca; }, textoSaludo, preguntar, conversar, pararTodo, decir, añadirMensaje };
// Cuando cambian claves o el modo de voz, se recalcula el modo.
window.__actualizarModoVoz = async () => { estado.modoVoz = await api.llamar('voz.modo'); };
