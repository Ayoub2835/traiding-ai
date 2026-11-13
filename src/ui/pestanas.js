// Pestañas nuevas de Jarvis v2: Tareas, Habilidades, Rutinas; memoria local;
// pantalla de Claves y servicios; Registro de acciones; y la confirmación de
// seguridad (por voz o con botones).
(() => {
'use strict';
const $ = (id) => document.getElementById(id);
const api = window.jarvis;
let ui = null; // funciones de app.js: añadirMensaje, mostrarError, decir, estado…

const ESTADOS = {
  en_cola: ['En cola', 'gris'], en_curso: ['En curso', 'azul'], esperando_permiso: ['Esperando tu permiso', 'ambar'],
  hecha: ['Hecha', 'verde'], fallida: ['Fallida', 'rojo'], cancelada: ['Cancelada', 'gris'],
};
const hora = (f) => (f ? new Date(f).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

// Crea un elemento con texto (nunca innerHTML con datos: evita inyectar HTML).
function el(tag, clase, texto, attrs = {}) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined && texto !== null) e.textContent = texto;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}
function boton(texto, fn, clase = '') {
  const b = el('button', clase, texto, { type: 'button' });
  b.addEventListener('click', fn);
  return b;
}
const vacio = (cont, texto) => cont.replaceChildren(el('div', 'vacio', texto));

// ---------------------------------------------------------------------------
// Tareas (manos)
// ---------------------------------------------------------------------------
const tareas = new Map();
function pintarTareas() {
  const cont = $('listaTareas');
  const lista = [...tareas.values()].sort((a, b) => b.creada.localeCompare(a.creada));
  const activas = lista.filter((t) => ['en_cola', 'en_curso', 'esperando_permiso'].includes(t.estado)).length;
  $('contTareas').textContent = activas;
  $('contTareas').classList.toggle('oculto', activas === 0);
  if (!lista.length) return vacio(cont, 'Sin tareas. Pide algo como «crea un Excel con…» o «abre Shopify y…».');
  cont.replaceChildren(...lista.slice(0, 30).map((t) => {
    const [txt, color] = ESTADOS[t.estado] || [t.estado, 'gris'];
    const c = el('div', 'tarjeta tarea');
    const cab = el('div', 'tarea-cab');
    cab.append(el('span', `chip ${color}`, txt), el('span', 'meta', `#${t.id} · ${hora(t.creada)}`));
    c.append(cab, el('div', 'titulo', t.titulo, { dir: 'auto' }));
    const prog = (t.progreso || []).slice(-4).map((p) => el('div', 'linea', p.texto, { dir: 'auto' }));
    if (prog.length) { const d = el('div', 'progreso'); d.append(...prog); c.append(d); }
    if (t.resultado) c.append(el('div', 'detalle resultado', t.resultado, { dir: 'auto' }));
    if (t.error) c.append(el('div', 'detalle error', t.error, { dir: 'auto' }));
    if (['en_cola', 'en_curso', 'esperando_permiso'].includes(t.estado)) {
      c.append(boton('■ Cancelar', async () => { await api.llamar('manos.cancelar', t.id); }, 'peligro'));
    }
    if (t.coste) c.append(el('div', 'meta', `Coste: ${t.coste.toFixed(3)} $`));
    return c;
  }));
}
async function cargarTareas() {
  for (const t of await api.llamar('manos.listar')) tareas.set(t.id, t);
  pintarTareas();
}
$('formTarea').addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = $('textoTarea').value.trim();
  if (!texto) return;
  $('textoTarea').value = '';
  const t = await api.llamar('manos.crear', texto);
  if (t && t.id) { tareas.set(t.id, t); pintarTareas(); }
});

// ---------------------------------------------------------------------------
// Habilidades
// ---------------------------------------------------------------------------
async function pintarHabilidades() {
  const lista = await api.llamar('habilidades.listar');
  const cont = $('listaHabilidades');
  if (!lista.length) return vacio(cont, 'Sin habilidades.');
  cont.replaceChildren(...lista.map((h) => {
    const c = el('div', 'tarjeta');
    c.append(
      el('div', 'tipo', `${h.origen === 'aprendida' ? 'APRENDIDA' : 'INCLUIDA'} · ${h.pasos.length} paso${h.pasos.length > 1 ? 's' : ''}`),
      el('div', 'titulo', h.nombre),
      el('div', 'detalle', h.descripcion, { dir: 'auto' }),
      el('div', 'meta', h.disparadores.length ? `Di: «${h.disparadores.slice(0, 3).join('», «')}»` : `Di: «usa la habilidad ${h.nombre}»`, { dir: 'auto' }),
      el('div', 'meta', h.pasos.map((p) => p.herramienta).join(' → ')),
    );
    if (h.autor && /OpenJarvis/.test(h.autor)) c.append(el('div', 'meta', 'Adaptada de OpenJarvis (Apache 2.0)'));
    if (h.origen === 'aprendida') {
      c.append(boton('Quitar (a _papelera)', async () => { await api.llamar('habilidades.borrar', h.nombre); pintarHabilidades(); }, 'peligro'));
    }
    return c;
  }));
}

// ---------------------------------------------------------------------------
// Rutinas (resumen de la mañana y monitores)
// ---------------------------------------------------------------------------
const textoHorario = (h) => (h.tipo === 'diario' ? `cada día a las ${h.hora}` : `cada ${h.minutos} min`);
async function pintarRutinas(lista) {
  lista = lista || await api.llamar('rutinas.listar');
  const cont = $('listaRutinas');
  cont.replaceChildren(...lista.map((r) => {
    const c = el('div', 'tarjeta');
    const cab = el('div', 'tarea-cab');
    const act = el('input', '', null, { type: 'checkbox', title: 'Activa' });
    act.checked = r.activo;
    act.addEventListener('change', async () => { await api.llamar('rutinas.guardar', { ...r, activo: act.checked }); });
    cab.append(el('span', 'titulo', r.nombre, { dir: 'auto' }), act);
    c.append(cab, el('div', 'meta', `${textoHorario(r.horario)} · aviso: ${r.aviso}${r.windows ? ' · en Windows ✔' : ''}`));
    if (r.instruccion) c.append(el('div', 'detalle', r.instruccion, { dir: 'auto' }));
    if (r.ultimoResultado) {
      c.append(el('div', `detalle ${r.ultimoResultado.ok ? '' : 'error'}`, `${hora(r.ultimoResultado.fecha)}: ${r.ultimoResultado.novedad ? '🔔 ' : ''}${r.ultimoResultado.resumen}`, { dir: 'auto' }));
    }
    const botones = el('div', 'ajuste-botones');
    botones.append(boton('▶ Ahora', async (e) => {
      e.target.disabled = true;
      const res = await api.llamar('rutinas.ejecutar', r.id);
      e.target.disabled = false;
      if (!res.ok) ui.mostrarError(`${r.nombre}: ${res.error}`);
    }));
    botones.append(boton(r.windows ? 'Quitar de Windows' : 'Programar en Windows', async () => {
      const res = await api.llamar('rutinas.windows', r.id, !r.windows);
      if (!res.ok && res.error !== 'Cancelado') ui.mostrarError(res.error);
    }));
    if (r.id !== 'resumen') botones.append(boton('Quitar', async () => { await api.llamar('rutinas.quitar', r.id); }, 'peligro'));
    c.append(botones);
    return c;
  }));
}
$('monTipo').addEventListener('change', () => { $('monValor').value = $('monTipo').value === 'diario' ? '09:00' : '240'; });
$('formMonitor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = $('monTipo').value;
  const horario = tipo === 'diario' ? { tipo, hora: $('monValor').value.trim() } : { tipo, minutos: Number($('monValor').value) };
  const r = await api.llamar('rutinas.guardar', { nombre: $('monNombre').value, instruccion: $('monInstruccion').value, horario, aviso: $('monAviso').value, activo: true, motor: 'n8n' });
  if (r && r.ok === false) return ui.mostrarError(r.error);
  e.target.reset();
  e.target.closest('details').open = false;
});

// ---------------------------------------------------------------------------
// Memoria local (en la pestaña Memoria)
// ---------------------------------------------------------------------------
async function pintarHechos() {
  const hechos = await api.llamar('memoria.hechos');
  const cont = $('listaHechos');
  if (!hechos.length) return vacio(cont, 'Aún no recuerdo nada. Di «Jarvis, recuerda que…».');
  cont.replaceChildren(...hechos.slice(0, 40).map((h) => {
    const c = el('div', 'tarjeta hecho');
    c.append(el('div', 'tipo', h.tipo), el('div', 'detalle', h.texto, { dir: 'auto' }), el('div', 'meta', hora(h.fecha)));
    c.append(boton('Olvidar', async () => { await api.llamar('memoria.borrarHecho', h.id); pintarHechos(); }, 'peligro mini'));
    return c;
  }));
}

// ---------------------------------------------------------------------------
// Claves y servicios
// ---------------------------------------------------------------------------
let cambiosClaves = {};
async function abrirClaves() {
  cambiosClaves = {};
  const lista = await api.llamar('claves.listar');
  const grupos = {};
  for (const c of lista) (grupos[c.grupo] = grupos[c.grupo] || []).push(c);
  const cont = $('listaClaves');
  cont.replaceChildren();
  for (const [g, claves] of Object.entries(grupos)) {
    const sec = el('details', 'grupo-claves');
    if (g !== 'Avanzado') sec.open = true;
    sec.append(el('summary', '', g.toUpperCase()));
    for (const c of claves) {
      const fila = el('div', 'fila-clave');
      const inp = el('input', '', null, { type: c.secreta ? 'password' : 'text', placeholder: c.configurada ? c.valor : (c.defecto ? `${c.defecto} (por defecto)` : 'vacío'), autocomplete: 'off', spellcheck: 'false' });
      if (!c.secreta) inp.value = c.valor || '';
      inp.addEventListener('input', () => { cambiosClaves[c.clave] = inp.value; });
      const estado = el('small', c.configurada ? 'ok' : '', c.configurada ? '✔ configurada' : '');
      const probar = boton('Probar', async () => {
        if (Object.keys(cambiosClaves).length) await guardarClaves();
        estado.className = ''; estado.textContent = 'probando…';
        const r = await api.llamar('claves.probar', c.clave);
        estado.className = r.ok ? 'ok' : 'mal';
        estado.textContent = (r.ok ? '✔ ' : '✘ ') + r.mensaje;
      }, 'mini');
      const etiqueta = el('label', '', c.etiqueta);
      if (c.ayuda) etiqueta.title = c.ayuda;
      fila.append(etiqueta, inp, probar, estado);
      if (c.ayuda) fila.append(el('div', 'meta', c.ayuda));
      sec.append(fila);
    }
    cont.append(sec);
  }
  $('clMensaje').textContent = '';
  $('capaClaves').classList.remove('oculto');
}
async function guardarClaves() {
  if (!Object.keys(cambiosClaves).length) return;
  await api.llamar('claves.guardar', cambiosClaves);
  cambiosClaves = {};
  $('clMensaje').textContent = '✔ Guardado.';
  await window.__actualizarModoVoz?.();
  pintarServicios();
}
$('btnClaves').addEventListener('click', abrirClaves);
$('clGuardar').addEventListener('click', async () => { await guardarClaves(); abrirClaves(); });
$('clCerrar').addEventListener('click', () => $('capaClaves').classList.add('oculto'));

async function pintarServicios() {
  const s = await api.llamar('servicios.estado');
  const nombres = { ollama: 'Modelo local', claude: 'Claude', claudeCode: 'Manos (Claude Code)', voz: 'Voz', ntfy: 'Móvil (ntfy)', twilio: 'Llamadas' };
  $('servicios').replaceChildren(...Object.entries(s).map(([k, v]) => {
    const d = el('div', `servicio ${v.ok ? 'ok' : 'mal'}`);
    d.append(el('span', 'punto'), el('strong', '', nombres[k] || k), el('span', 'meta', ` ${v.detalle}`));
    return d;
  }));
}

// ---------------------------------------------------------------------------
// Registro de acciones
// ---------------------------------------------------------------------------
$('btnRegistro').addEventListener('click', async () => {
  const lineas = await api.llamar('registro.ultimas', 150);
  const cont = $('listaRegistro');
  if (!lineas.length) vacio(cont, 'Registro vacío.');
  else {
    cont.replaceChildren(...lineas.map((l) => {
      const d = el('div', `linea-registro ${/denegado|rechazado|fallo/.test(l.decision) ? 'mal' : /confirmado|permitido|hecho/.test(l.decision) ? 'ok' : ''}`);
      d.append(el('span', 'meta', hora(l.fecha)), el('span', 'chip gris', l.decision), el('span', '', ` ${l.origen}: ${l.accion}${l.motivo ? ` — ${l.motivo}` : ''}`, { dir: 'auto' }));
      return d;
    }));
  }
  $('capaRegistro').classList.remove('oculto');
});
$('rgCerrar').addEventListener('click', () => $('capaRegistro').classList.add('oculto'));

// ---------------------------------------------------------------------------
// Confirmación de seguridad (voz + botones)
// ---------------------------------------------------------------------------
const CATEGORIAS = { pagar: 'PAGAR', comprar: 'COMPRAR', borrar: 'BORRAR / MOVER A LA PAPELERA', publicar: 'PUBLICAR', enviar: 'ENVIAR A OTROS', instalar: 'INSTALAR UN PROGRAMA', ajustes: 'CAMBIAR AJUSTES DE WINDOWS', fuera: 'TOCAR ARCHIVOS FUERA DE SU CARPETA', desconocida: 'HERRAMIENTA DESCONOCIDA' };
const colaConfirmar = [];
let confirmando = null;

async function mostrarConfirmacion() {
  if (confirmando || !colaConfirmar.length) return;
  confirmando = colaConfirmar.shift();
  const p = confirmando;
  $('cfCategoria').textContent = CATEGORIAS[p.categoria] || p.categoria;
  $('cfDescripcion').textContent = p.descripcion;
  $('cfVoz').textContent = 'Di «sí» o «no» (o pulsa un botón).';
  $('capaConfirmar').classList.remove('oculto');
  ui.activacion.pausar();
  // Jarvis pregunta en voz alta y escucha la respuesta en local.
  try {
    await ui.decir({ texto: `Necesito tu permiso para ${(CATEGORIAS[p.categoria] || p.categoria).toLowerCase()}. ${p.descripcion.slice(0, 160)}. ¿Confirmas? Di sí o no.` });
    if (confirmando !== p) return;
    $('cfVoz').textContent = '🎙 Escuchando… di «sí» o «no».';
    const r = await window.VozJarvis.escucharSiNo(10);
    if (confirmando !== p) return;
    if (r) responderConfirmacion(r === 'si', 'voz');
    else $('cfVoz').textContent = 'No te he oído: pulsa un botón.';
  } catch (e) {
    $('cfVoz').textContent = `Sin micrófono (${e.message}): pulsa un botón.`;
  }
}
async function responderConfirmacion(si, como = 'botón') {
  if (!confirmando) return;
  const p = confirmando;
  confirmando = null;
  $('capaConfirmar').classList.add('oculto');
  await api.llamar('confirmacion.responder', p.id, si, como);
  ui.añadirMensaje('sistema', `${si ? '✔ Permitido' : '✘ No permitido'}: ${p.descripcion.slice(0, 120)}`);
  ui.reanudarActivacion();
  mostrarConfirmacion();
}
$('cfSi').addEventListener('click', () => responderConfirmacion(true));
$('cfNo').addEventListener('click', () => responderConfirmacion(false));

// ---------------------------------------------------------------------------
// Eventos del proceso principal
// ---------------------------------------------------------------------------
function alEvento({ tipo, datos }) {
  switch (tipo) {
    case 'tarea': {
      const antes = tareas.get(datos.id);
      tareas.set(datos.id, datos);
      pintarTareas();
      if (antes && antes.estado !== datos.estado && ['hecha', 'fallida'].includes(datos.estado)) {
        const msg = datos.estado === 'hecha' ? `Tarea terminada: ${datos.resultado || datos.titulo}` : `La tarea "${datos.titulo}" ha fallado: ${datos.error}`;
        ui.añadirMensaje(datos.estado === 'hecha' ? 'jarvis' : 'error', msg, datos.estado === 'hecha' ? 'Manos · Claude Code' : null);
        if (!ui.estado.hablando && !ui.estado.conversando) ui.decir({ texto: msg.slice(0, 400) });
      }
      break;
    }
    case 'confirmacion': colaConfirmar.push(datos); mostrarConfirmacion(); break;
    case 'confirmacion_resuelta':
      if (confirmando && confirmando.id === datos.id) { confirmando = null; $('capaConfirmar').classList.add('oculto'); mostrarConfirmacion(); }
      break;
    case 'rutinas': pintarRutinas(datos); break;
    case 'habilidades': pintarHabilidades(); break;
    case 'progreso': $('transcripcion').textContent = datos; break;
    case 'rutina_inicio': ui.añadirMensaje('sistema', `▶ ${datos.nombre}…`); break;
    case 'rutina':
      if (datos.ok) {
        const texto = datos.texto || datos.resumen;
        if (datos.hablar && texto) { ui.añadirMensaje('jarvis', texto, datos.motor || 'Rutinas'); ui.decir({ texto }); }
        else ui.añadirMensaje('sistema', `${datos.nombre}: ${datos.resumen || 'sin novedad'}`);
      } else {
        ui.añadirMensaje('error', `⚠ ${datos.nombre}: ${datos.error}`);
      }
      pintarRutinas();
      break;
    default: break;
  }
}

window.Pestanas = {
  async iniciar(funciones) {
    ui = funciones;
    api.alEvento(alEvento);
    for (const p of await api.llamar('confirmacion.lista')) colaConfirmar.push(p);
    mostrarConfirmacion();
    cargarTareas();
    pintarHabilidades();
    pintarRutinas();
    pintarHechos();
    pintarServicios();
    // La memoria local se refresca al abrir su pestaña.
    document.querySelector('[data-pestana="memoria"]').addEventListener('click', pintarHechos);
    document.querySelector('[data-pestana="habilidades"]').addEventListener('click', pintarHabilidades);
  },
  avisoTarea() { pintarTareas(); },
  pintarServicios,
  responderConfirmacion,
};
})();
