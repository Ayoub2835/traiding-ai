// Lógica de la interfaz de Jarvis: saludo, chat, voz, paneles y ajustes.
'use strict';

const $ = (id) => document.getElementById(id);
const api = window.jarvis;

const estado = {
  info: null,
  ajustes: null,
  panel: { items: [] },
  ocupado: false,         // hay una pregunta en curso a n8n
  conversando: false,     // bucle de conversación por voz activo
};

const nucleo = new window.Nucleo($('nucleo'));
const oido = new window.VozJarvis.Oido();
let boca = null;

// Palabras para terminar la conversación por voz.
const FRASES_FIN = /^(gracias( jarvis)?|para|parar|stop|adiós|adios|eso es todo|nada más|nada mas|calla|cállate|callate|silencio)$/i;

// ---------------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------------
function ponerEstadoVoz(texto, estadoNucleo) {
  $('estadoVoz').textContent = texto;
  if (estadoNucleo) nucleo.setEstado(estadoNucleo);
}

let temporizadorAviso = null;
function mostrarError(mensaje) {
  console.error('[Jarvis]', mensaje);
  $('avisoTexto').textContent = mensaje;
  $('aviso').classList.remove('oculto');
  clearTimeout(temporizadorAviso);
  temporizadorAviso = setTimeout(() => $('aviso').classList.add('oculto'), 15000);
  nucleo.setEstado('error');
  setTimeout(() => { if (nucleo.estado === 'error') nucleo.setEstado('reposo'); }, 2500);
}

function añadirMensaje(quien, texto) {
  const div = document.createElement('div');
  div.className = `msg ${quien}`;
  div.textContent = texto;
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
// Hablar (respeta el ajuste "voz sí/no" y el volumen)
// ---------------------------------------------------------------------------
async function decir(texto) {
  if (!estado.ajustes.voz || !texto) return;
  oido.detener(); // nunca escuchar mientras habla (evita que se oiga a sí mismo)
  ponerEstadoVoz('HABLANDO', 'hablando');
  await boca.hablar(texto, {
    volumen: estado.ajustes.volumen,
    nombreVoz: estado.ajustes.nombreVoz,
    alNivel: (n) => nucleo.setNivel(n),
  });
  ponerEstadoVoz('EN ESPERA', 'reposo');
}

// ---------------------------------------------------------------------------
// Chat con n8n
// ---------------------------------------------------------------------------
async function preguntar(texto) {
  if (estado.ocupado) return null;
  estado.ocupado = true;
  añadirMensaje('yo', texto);
  ponerEstadoVoz('PENSANDO…', 'pensando');
  try {
    const r = await api.enviarMensaje(texto);
    if (!r.ok) {
      añadirMensaje('error', '⚠ ' + r.error);
      mostrarError('Chat con n8n: ' + r.error);
      marcarRed(false, r.error);
      ponerEstadoVoz('ERROR', 'error');
      return null;
    }
    marcarRed(true);
    añadirMensaje('jarvis', r.respuesta);
    return r.respuesta;
  } finally {
    estado.ocupado = false;
    if (nucleo.estado === 'pensando') ponerEstadoVoz('EN ESPERA', 'reposo');
  }
}

$('formChat').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('textoChat').value.trim();
  if (!texto) return;
  $('textoChat').value = '';
  boca.callar();
  const respuesta = await preguntar(texto);
  await decir(respuesta);
});

// ---------------------------------------------------------------------------
// Conversación por voz (modo conversación = vuelve a escuchar tras responder)
// ---------------------------------------------------------------------------
async function conversar() {
  if (estado.conversando) {          // segundo toque = parar
    detenerConversacion();
    return;
  }
  boca.callar();
  estado.conversando = true;
  $('btnMicro').classList.add('activo');
  try {
    if (!oido.modelo) ponerEstadoVoz('CARGANDO OÍDO…', 'pensando');
    await oido.cargar();
    while (estado.conversando) {
      ponerEstadoVoz('ESCUCHANDO…', 'escuchando');
      $('transcripcion').textContent = '';
      const texto = await oido.escuchar({
        alParcial: (p) => { $('transcripcion').textContent = p + '…'; },
        alNivel: (n) => nucleo.setNivel(n),
      });
      if (!estado.conversando) break;
      $('transcripcion').textContent = texto;
      if (!texto) break;                       // silencio: se termina
      if (FRASES_FIN.test(texto)) {
        await decir('De acuerdo. Aquí estaré.');
        break;
      }
      const respuesta = await preguntar(texto);
      if (!respuesta) break;                   // error: ya se mostró el motivo
      await decir(respuesta);
      if (!estado.ajustes.conversacion) break;
    }
  } catch (e) {
    mostrarError(e.message || String(e));
  } finally {
    detenerConversacion();
  }
}

function detenerConversacion() {
  estado.conversando = false;
  oido.detener();
  $('btnMicro').classList.remove('activo');
  nucleo.setNivel(0);
  if (!estado.ocupado && !boca.hablando) ponerEstadoVoz('EN ESPERA', 'reposo');
}

$('btnMicro').addEventListener('click', conversar);
$('nucleo').addEventListener('click', conversar);
api.alPedirEscuchar(() => { if (!estado.conversando) conversar(); });

// ---------------------------------------------------------------------------
// Panel de memoria y pestaña PENDIENTE
// ---------------------------------------------------------------------------
function tarjeta(item) {
  const div = document.createElement('div');
  div.className = 'tarjeta';
  const partes = [
    ['tipo', [item.tipo, item.negocio].filter(Boolean).join(' · ')],
    ['titulo', item.titulo || '(sin título)'],
    ['detalle', item.detalle || ''],
  ];
  for (const [clase, texto] of partes) {
    const el = document.createElement('div');
    el.className = clase;
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
  if (panel.ok === false) {
    marcarRed(false, panel.error);
    mostrarError('Panel de memoria: ' + panel.error);
  } else {
    marcarRed(true);
  }
}

function marcarRed(ok, motivo) {
  $('estadoRed').classList.toggle('ok', ok);
  $('estadoRed').classList.toggle('mal', !ok);
  $('estadoRedTexto').textContent = ok ? 'n8n conectado' : 'n8n sin conexión';
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
}

$('ajColor').addEventListener('input', (e) => aplicarColor(e.target.value));
$('ajColor').addEventListener('change', (e) => guardar({ colorLed: e.target.value }));
$('ajRgb').addEventListener('change', (e) => guardar({ modoRgb: e.target.checked }));
$('ajVoz').addEventListener('change', (e) => { if (!e.target.checked) boca.callar(); guardar({ voz: e.target.checked }); });
$('ajVolumen').addEventListener('input', (e) => { $('ajVolumenValor').textContent = Math.round(e.target.value * 100) + '%'; });
$('ajVolumen').addEventListener('change', (e) => guardar({ volumen: Number(e.target.value) }));
$('ajNombreVoz').addEventListener('change', (e) => guardar({ nombreVoz: e.target.value }));
$('ajConversacion').addEventListener('change', (e) => guardar({ conversacion: e.target.checked }));
$('ajArranque').addEventListener('change', (e) => guardar({ arranqueAutomatico: e.target.checked }));
$('btnProbarVoz').addEventListener('click', () => {
  if (!estado.ajustes.voz) return mostrarError('La voz está desactivada en Ajustes.');
  if (!boca.vocesEspanol().length) mostrarError('Windows no tiene voces en español instaladas (Configuración → Hora e idioma → Voz).');
  decir(`Hola ${estado.info.nombreUsuario}, así suena mi voz.`);
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
    if (estado.conversando || boca.hablando) { boca.callar(); detenerConversacion(); } else api.ocultar();
  }
  if (e.key === 'F11') api.pantallaCompleta();
});
setInterval(() => {
  $('reloj').textContent = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}, 1000);

// ---------------------------------------------------------------------------
// Saludo inicial: "Buenos días, Ayoub" + lo pendiente
// ---------------------------------------------------------------------------
// "un informe", "una idea", "una decisión"...
function articulo(palabra) {
  const p = String(palabra).toLowerCase().trim();
  const femeninas = ['idea', 'decision', 'decisión', 'oportunidad', 'tarea', 'nota', 'alerta'];
  return femeninas.includes(p) || /(a|ión|ion|dad)$/.test(p) ? 'una' : 'un';
}

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
  const texto = textoSaludo();
  añadirMensaje('jarvis', texto);
  await decir(texto);
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------
async function iniciar() {
  iniciarFondo($('fondo'), () => getComputedStyle(document.documentElement).getPropertyValue('--led').trim() || '#00e5ff');
  estado.info = await api.info();
  estado.ajustes = await api.leerAjustes();
  boca = new window.VozJarvis.Boca(estado.info.idiomaVoz);
  pintarAjustes();
  pintarVoces();
  speechSynthesis.addEventListener('voiceschanged', pintarVoces);

  if (estado.info.errorConfig) mostrarError('Configuración: ' + estado.info.errorConfig);
  $('notaAtajo').textContent = estado.info.atajo.ok
    ? `Atajo global: ${estado.info.atajo.atajo.replace('CommandOrControl', 'Ctrl').replace('Space', 'Espacio')} para hablar desde cualquier sitio.`
    : estado.info.atajo.error;
  if (!estado.info.atajo.ok && estado.info.atajo.error) añadirMensaje('error', '⚠ ' + estado.info.atajo.error);

  // Cargamos el modelo de voz en segundo plano para que el micro responda rápido.
  ponerEstadoVoz('CARGANDO OÍDO…', 'pensando');
  oido.cargar()
    .then(() => { if (!estado.conversando && !boca.hablando && !estado.ocupado) ponerEstadoVoz('EN ESPERA', 'reposo'); })
    .catch((e) => mostrarError(e.message));

  // Esperamos al primer resultado del panel (máx. 20 s) para el saludo.
  let panel = await api.leerPanel();
  const limite = Date.now() + 20000;
  while (!panel.revisado && Date.now() < limite) {
    await new Promise((r) => setTimeout(r, 500));
    panel = await api.leerPanel();
  }
  pintarPanel(panel);
  // Las voces de Windows pueden tardar un instante en estar disponibles.
  if (!boca.voces.length) await new Promise((r) => setTimeout(r, 800));
  await saludar();
}

iniciar().catch((e) => mostrarError('Error al iniciar: ' + e.message));

// Para pruebas automáticas (no se usa en el uso normal).
window.__jarvis = { estado, nucleo, oido, get boca() { return boca; }, textoSaludo, saludoSegunHora, preguntar, conversar };
