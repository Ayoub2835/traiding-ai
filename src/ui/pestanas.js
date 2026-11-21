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
    if (r.id === 'youtube') pintarYoutube(c, r, botones);
    // Las rutinas fijas no se pueden quitar (solo activar/desactivar).
    if (!['resumen', 'informe', 'caza', 'youtube', 'pedidos'].includes(r.id)) botones.append(boton('Quitar', async () => { await api.llamar('rutinas.quitar', r.id); }, 'peligro'));
    c.append(botones);
    return c;
  }));
}

// Tarjeta de YouTube: estado del canal, cola, hora de subida y botones propios.
function pintarYoutube(c, r, botones) {
  const info = el('div', 'meta', 'Comprobando YouTube…');
  const fila = el('div', 'ajuste-botones');
  const horaInp = el('input', '', null, { type: 'time', value: r.horario.tipo === 'diario' ? r.horario.hora : '18:00', title: 'Hora de subida diaria' });
  horaInp.addEventListener('change', async () => {
    if (!horaInp.value) return;
    const res = await api.llamar('rutinas.guardar', { ...r, horario: { tipo: 'diario', hora: horaInp.value } });
    if (res && res.ok === false) ui.mostrarError(res.error);
  });
  fila.append(el('span', 'meta', 'Subir cada día a las'), horaInp);
  c.append(info, fila);
  api.llamar('youtube.estado').then((e) => {
    if (!e || e.ok === false) { info.textContent = (e && e.error) || 'No se pudo leer el estado de YouTube'; return; }
    const canal = e.conectado ? '✔ canal conectado' : (e.configurado ? '✘ falta pulsar «Conectar YouTube»' : '✘ faltan las claves de Google (Ajustes → Claves → YouTube)');
    info.textContent = `${canal} · ${e.pendientes} vídeo${e.pendientes === 1 ? '' : 's'} en la cola`;
    info.title = e.carpeta;
    if (e.ultimos[0]) c.insertBefore(el('div', 'detalle', `Último: «${e.ultimos[0].titulo}» · ${e.ultimos[0].url}`, { dir: 'auto' }), fila.nextSibling);
  });
  c.append(el('div', 'meta', 'Cuentas, vídeos nuevos y «Por revisar»: pestaña REDES.'));
  botones.append(boton('Abrir carpeta de vídeos', async () => {
    const res = await api.llamar('youtube.abrirCarpeta');
    if (!res.ok) ui.mostrarError(res.error);
  }));
}
$('monTipo').addEventListener('change', () => { $('monValor').value = $('monTipo').value === 'diario' ? '09:00' : '240'; });
$('formMonitor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const tipo = $('monTipo').value;
  const horario = tipo === 'diario' ? { tipo, hora: $('monValor').value.trim() } : { tipo, minutos: Number($('monValor').value) };
  const r = await api.llamar('rutinas.guardar', { nombre: $('monNombre').value, instruccion: $('monInstruccion').value, horario, aviso: $('monAviso').value, activo: true, motor: $('monMotor').value === 'manos' ? 'manos' : 'n8n' });
  if (r && r.ok === false) return ui.mostrarError(r.error);
  e.target.reset();
  e.target.closest('details').open = false;
  ui.añadirMensaje('sistema', `Rutina «${r.nombre}» creada.`);
});

// ---------------------------------------------------------------------------
// REDES: cuentas, crear vídeos y «Por revisar»
// ---------------------------------------------------------------------------
const NOMBRE_RED = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };

async function conectar(accion, aviso, exito) {
  if (aviso) ui.añadirMensaje('sistema', aviso);
  const res = await api.llamar(accion);
  if (!res.ok) return ui.mostrarError(res.error);
  ui.añadirMensaje('sistema', exito(res));
  pintarRedes();
}

async function pintarCuentas() {
  const s = await api.llamar('redes.cuentas');
  const cont = $('redCuentas');
  if (!s || s.ok === false) return vacio(cont, (s && s.error) || 'No se pudo leer el estado de las cuentas');
  const fila = (nombre, ok, detalle, btn) => {
    const c = el('div', 'tarjeta cuenta');
    const izq = el('div');
    izq.append(el('span', ok ? 'ok' : 'no', ok ? '✔ ' : '✘ '), el('strong', '', nombre), el('span', 'meta', detalle ? ` · ${detalle}` : ''));
    c.append(izq);
    if (btn) c.append(btn);
    return c;
  };
  const conMeta = boton(s.facebook ? 'Reconectar' : 'Conectar', () => conectar('redes.conectarMeta', null,
    (r) => `Facebook conectado (Página ${r.pagina})${r.instagram ? ` e Instagram (@${r.instagram})` : '. Ojo: tu Página no tiene una cuenta de Instagram profesional vinculada'}.`), 'mini');
  cont.replaceChildren(
    fila('YouTube', s.youtube, s.youtube ? 'canal conectado' : (s.youtubeConfigurado ? '' : 'faltan las claves de Google (Ajustes → Claves → YouTube)'),
      boton(s.youtube ? 'Reconectar' : 'Conectar', () => conectar('youtube.conectar', 'Abriendo el navegador: elige tu canal y da permiso a Jarvis.', (r) => `YouTube conectado${r.canal ? ` (canal ${r.canal})` : ''}.`), 'mini')),
    fila('TikTok', s.tiktok, s.usuario ? `@${s.usuario}` : 'faltan Client key/secret (Ajustes → Claves → Redes sociales)',
      boton(s.tiktok ? 'Reconectar' : 'Conectar', () => conectar('redes.conectarTikTok', 'Abriendo el navegador: entra en TikTok y da permiso a Jarvis.', (r) => `TikTok conectado${r.usuario ? ` (@${r.usuario})` : ''}.`), 'mini')),
    fila('Facebook', s.facebook, s.pagina || 'faltan los datos de Meta (Ajustes → Claves → Redes sociales)', conMeta),
    fila('Instagram', s.instagram, s.instagram ? 'vinculado a tu Página' : 'necesita una cuenta profesional vinculada a tu Página de Facebook (se conecta junto con Facebook)',
      boton(s.instagram ? 'Reconectar' : 'Conectar', () => conectar('redes.conectarMeta', null,
        (r) => (r.instagram ? `Instagram conectado (@${r.instagram}) junto con Facebook (Página ${r.pagina}).` : `Facebook conectado (Página ${r.pagina}), pero no hay ninguna cuenta de Instagram profesional vinculada a esa Página: vincúlala en la app de Instagram (Configuración → Cuenta → Compartir en otras apps / Centro de cuentas) y vuelve a pulsar Conectar.`)), 'mini')),
    fila('Snapchat', false, 'Snapchat no deja publicar automáticamente a particulares: abre la carpeta y súbelos desde el móvil',
      boton('Abrir carpeta', async () => { const r = await api.llamar('youtube.abrirCarpeta', 'revisar'); if (!r.ok) ui.mostrarError(r.error); }, 'mini')),
  );
}

async function pintarRevisar() {
  const [lista, s] = await Promise.all([api.llamar('revision.lista'), api.llamar('redes.cuentas')]);
  const cont = $('listaRevisar');
  $('contRevisar').textContent = lista.length || 0;
  $('contRevisar').classList.toggle('oculto', !lista.length);
  if (!Array.isArray(lista) || !lista.length) return vacio(cont, 'No hay vídeos esperando. Crea uno arriba o espera al vídeo del día.');
  const conectadas = ['youtube', 'tiktok', 'instagram', 'facebook'].filter((x) => s && s[x]);
  cont.replaceChildren(...lista.map((v) => {
    const c = el('div', 'tarjeta revisar');
    const titulo = el('input', '', null, { type: 'text', maxlength: '100', dir: 'auto' });
    titulo.value = v.titulo;
    const desc = el('textarea', '', null, { rows: '3', dir: 'auto' });
    desc.value = v.descripcion;
    const elegir = el('div', 'redes-elegir');
    const marcas = {};
    for (const red of ['youtube', 'tiktok', 'instagram', 'facebook']) {
      const lab = el('label');
      const chk = el('input', '', null, { type: 'checkbox' });
      chk.checked = conectadas.includes(red);
      chk.disabled = !conectadas.includes(red);
      marcas[red] = chk;
      lab.append(chk, document.createTextNode(` ${NOMBRE_RED[red]}${conectadas.includes(red) ? '' : ' (sin conectar)'}`));
      elegir.append(lab);
    }
    const guardar = () => api.llamar('revision.guardar', v.nombre, { titulo: titulo.value, descripcion: desc.value });
    const botones = el('div', 'ajuste-botones');
    botones.append(
      boton('▶ Ver', async () => { const r = await api.llamar('revision.ver', v.nombre); if (!r.ok) ui.mostrarError(r.error); }, 'mini'),
      boton('Guardar texto', async () => { await guardar(); ui.añadirMensaje('sistema', 'Texto guardado.'); }, 'mini'),
      boton('✔ Publicar', async (ev) => {
        const destinos = Object.keys(marcas).filter((k) => marcas[k].checked);
        if (!destinos.length) return ui.mostrarError('Elige al menos una red conectada');
        if (!window.confirm(`¿Publicar «${titulo.value}» en ${destinos.map((d) => NOMBRE_RED[d]).join(', ')}?`)) return;
        ev.target.disabled = true;
        await guardar();
        ui.añadirMensaje('sistema', `Publicando «${titulo.value}»… (puede tardar unos minutos)`);
        const r = await api.llamar('revision.publicar', v.nombre, destinos);
        ev.target.disabled = false;
        if (!r.ok) return ui.mostrarError(r.error);
        ui.añadirMensaje('sistema', r.resumen);
        pintarRevisar();
      }),
      boton('Descartar', async () => {
        if (!window.confirm(`¿Descartar «${titulo.value}»? (va a la papelera de Jarvis)`)) return;
        const r = await api.llamar('revision.descartar', v.nombre);
        if (!r.ok) ui.mostrarError(r.error);
        pintarRevisar();
      }, 'peligro'),
    );
    c.append(el('div', 'meta', `${hora(v.creado)} · ${v.tamañoMB} MB · ${v.nombre}`), titulo, desc, elegir, botones);
    return c;
  }));
}

function pintarRedes() { pintarCuentas(); pintarRevisar(); }

async function crearVideo(accion, args, aviso) {
  const botones = [...document.querySelectorAll('#formVideo button')];
  botones.forEach((b) => { b.disabled = true; });
  if (aviso) ui.añadirMensaje('sistema', aviso);
  const res = await api.llamar(accion, ...args);
  botones.forEach((b) => { b.disabled = false; });
  if (!res.ok) { if (res.error !== 'Cancelado') ui.mostrarError(res.error); return; }
  ui.añadirMensaje('sistema', res.resumen || `Vídeo listo para revisar: «${res.titulo}». Míralo en REDES → Por revisar.`);
  pintarRevisar();
}
$('formVideo').addEventListener('submit', (e) => {
  e.preventDefault();
  const tema = $('temaVideo').value.trim();
  if (!tema) return ui.mostrarError('Escribe de qué quieres el vídeo');
  crearVideo('video.crearTema', [tema], `Creando el vídeo sobre «${tema.slice(0, 80)}» (guion, voz y montaje). Puede tardar unos minutos…`).then(() => { $('temaVideo').value = ''; });
});
$('btnVideoCripto').addEventListener('click', () => crearVideo('video.crearCripto', [], 'Creando el resumen cripto de hoy. Puede tardar unos minutos…'));
$('btnReels').addEventListener('click', () => crearVideo('reels.desdeArchivo', [], ''));

// ---------------------------------------------------------------------------
// TIENDA: dropshipping paso a paso (tú apruebas cada paso)
// ---------------------------------------------------------------------------
const eur = (x) => `${Number(x).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const bloquear = async (ev, fn) => { const b = ev && ev.target; if (b) b.disabled = true; try { return await fn(); } finally { if (b) b.disabled = false; } };

function tarjetaProducto(p, { elegido = false } = {}) {
  const c = el('div', `tarjeta td-producto${elegido ? ' td-elegido' : ''}`);
  const img = el('img', '', null, { alt: '' });
  api.llamar('tienda.miniatura', p.pid).then((u) => { if (u) img.src = u; });
  const info = el('div');
  info.append(
    el('div', 'titulo', p.nombre, { dir: 'auto' }),
    el('div', 'cifras', `Coste ${eur(p.costeEUR)} + envío ${eur(p.envioEUR)} (${p.envioDias || '?'} días desde ${p.envioDesde}) · Venta ${eur(p.precioVenta)} · Margen ≈ ${eur(p.margenEUR)} (${p.margenPct} %)`),
    el('div', 'meta', `Puntuación ${p.puntos}/100 · lo venden ${p.listados} tiendas en CJ${p.video ? ' · con vídeo' : ''}`),
  );
  if (p.analisis) info.append(el('div', 'detalle', p.analisis, { dir: 'auto' }));
  c.append(img, info);
  return c;
}

const ESTADO_PEDIDO = {
  por_confirmar: ['Por confirmar', 'ambar'], problema: ['Problema', 'rojo'], creado_en_cj: ['Creado en CJ (sin pagar)', 'rojo'],
  pagado: ['Pagado en CJ · esperando envío', 'azul'], enviado: ['Enviado', 'verde'], manual: ['Hecho a mano', 'gris'],
};
async function pintarPedidos() {
  const lista = await api.llamar('tienda.pedidos');
  const cont = $('tdPedidos');
  if (!Array.isArray(lista) || !lista.length) return vacio(cont, 'Aún no hay pedidos.');
  cont.replaceChildren(...lista.map((p) => {
    const [txt, color] = ESTADO_PEDIDO[p.estado] || [p.estado, 'gris'];
    const c = el('div', 'tarjeta');
    const cab = el('div', 'tarea-cab');
    cab.append(el('span', `chip ${color}`, txt), el('span', 'meta', `${p.nombre} · ${hora(p.fecha)}`));
    c.append(cab,
      el('div', 'detalle', `${p.cliente} · ${p.ciudad} · pagó ${p.total}`, { dir: 'auto' }),
      el('div', 'meta', `${(p.lineas || []).map((l) => `${l.cantidad}× ${l.titulo}`).join(', ')}${p.costeEstimadoEUR ? ` · te cuesta ≈ ${eur(p.costeEstimadoEUR)}` : ''}${p.seguimiento ? ` · seguimiento ${p.seguimiento}` : ''}`, { dir: 'auto' }));
    if (p.problema) c.append(el('div', 'detalle error', p.problema));
    if (p.estado === 'por_confirmar' || p.estado === 'problema') {
      const b = el('div', 'ajuste-botones');
      if (p.estado === 'por_confirmar') {
        b.append(boton('✔ Confirmar y pagar en CJ', (ev) => bloquear(ev, async () => {
          const r = await api.llamar('tienda.confirmarPedido', p.id);
          if (!r.ok) { if (r.error !== 'Cancelado') ui.mostrarError(r.error); } else ui.añadirMensaje('sistema', `Pedido ${p.nombre} comprado en CJ (${r.cjOrderId}). El seguimiento se pondrá solo en Shopify cuando lo envíen.`);
          pintarPedidos();
        })));
      }
      b.append(boton('Ya lo hice a mano', async () => { await api.llamar('tienda.pedidoManual', p.id); pintarPedidos(); }, 'mini'));
      c.append(b);
    }
    return c;
  }));
}
$('btnRevisarPedidos').addEventListener('click', (ev) => bloquear(ev, async () => {
  const r = await api.llamar('tienda.revisarPedidos');
  if (!r.ok) ui.mostrarError(r.error); else ui.añadirMensaje('sistema', r.resumen);
  pintarPedidos();
}));

async function pintarTienda() {
  pintarPedidos();
  const s = await api.llamar('tienda.estado');
  if (!s || s.ok === false) return;
  // Conexiones que faltan.
  const faltan = [];
  if (!s.conexiones.cj) faltan.push('CJ Dropshipping (Ajustes → Claves → Tienda → CJ_API_KEY)');
  if (!s.conexiones.shopify) faltan.push('Shopify (Ajustes → Claves → SHOPIFY_TIENDA y SHOPIFY_TOKEN)');
  if (!s.conexiones.metaAds) faltan.push('Anuncios de Meta (META_AD_ACCOUNT_ID y reconectar Facebook en REDES con ads_management)');
  $('tdConexiones').replaceChildren(...(faltan.length ? [el('div', 'tarjeta', `Falta conectar: ${faltan.join(' · ')}`)] : []));

  // 1 · Propuestas
  const props = s.propuestas || [];
  $('tdPropuestas').replaceChildren(...props.map((p) => {
    const c = tarjetaProducto(p, { elegido: s.elegido?.pid === p.pid });
    c.querySelector('div').append(boton(s.elegido?.pid === p.pid ? '✔ Elegido' : 'Elegir este', async () => {
      const r = await api.llamar('tienda.elegir', p.pid);
      if (!r.ok) return ui.mostrarError(r.error);
      pintarTienda();
    }, 'mini'));
    return c;
  }));

  // 2-4 · Pasos del producto elegido
  const pasos = $('tdPasos');
  pasos.replaceChildren();
  if (!s.elegido) return;
  const paso = (titulo, ...hijos) => { const d = el('div', 'td-paso'); d.append(el('h3', 'titulo-seccion', titulo), ...hijos); pasos.append(d); };

  // 2 · Shopify
  const sh = el('div', 'ajuste-botones');
  if (!s.shopify) {
    sh.append(boton('🛍️ Crear la ficha en Shopify (borrador)', (ev) => bloquear(ev, async () => {
      ui.añadirMensaje('sistema', 'Creando la ficha del producto en Shopify…');
      const r = await api.llamar('tienda.crearEnShopify');
      if (!r.ok) return ui.mostrarError(r.error);
      ui.añadirMensaje('sistema', `Producto creado como BORRADOR: «${r.titulo}». Revísalo en Shopify y publícalo cuando te guste.`);
      pintarTienda();
    })));
  } else {
    const estadoTxt = el('span', 'meta', 'comprobando…');
    api.llamar('tienda.estadoProducto').then((e) => { estadoTxt.textContent = e.ok ? (e.publicado ? `✔ publicado: ${e.url}` : '✘ en borrador: revísalo y publícalo en Shopify') : e.error; });
    sh.append(boton('Abrir en Shopify', () => api.llamar('tienda.abrir', 'shopify'), 'mini'), estadoTxt);
  }
  paso('2 · Página en Shopify', sh);

  // 3 · Anuncio (vídeo + textos)
  const an = el('div', 'ajuste-botones');
  an.append(boton(s.anuncio ? '🎬 Rehacer el anuncio' : '🎬 Crear el anuncio (vídeo vertical)', (ev) => bloquear(ev, async () => {
    ui.añadirMensaje('sistema', 'Creando el vídeo del anuncio (guion, fotos, voz y montaje)…');
    const r = await api.llamar('tienda.crearAnuncio');
    if (!r.ok) return ui.mostrarError(r.error);
    ui.añadirMensaje('sistema', `Anuncio listo: «${r.titular}». Pulsa ▶ Ver para revisarlo.`);
    pintarTienda();
  })));
  if (s.anuncio) {
    an.append(
      boton('▶ Ver', () => api.llamar('tienda.verAnuncio'), 'mini'),
      boton('Carpeta (para TikTok)', () => api.llamar('tienda.abrirCarpetaAnuncio'), 'mini'),
      boton('Abrir TikTok Ads', () => api.llamar('tienda.abrir', 'tiktok'), 'mini'),
    );
  }
  paso('3 · Anuncio', an, ...(s.anuncio ? [el('div', 'detalle', (s.anuncio.textos || []).map((t, i) => `${i + 1}. ${t}`).join('\n'), { dir: 'auto' })] : []));

  // 4 · Campaña de Meta (en pausa) y activación
  const mt = el('div');
  if (s.anuncio && !s.meta) {
    const pres = el('input', '', null, { type: 'number', min: '1', max: '1000', step: '1', value: '10', title: 'Presupuesto diario en euros' });
    const fila = el('div', 'ajuste-botones');
    fila.append(el('span', 'meta', 'Presupuesto diario (€):'), pres, boton('📣 Crear campaña en Meta (EN PAUSA)', (ev) => bloquear(ev, async () => {
      ui.añadirMensaje('sistema', 'Subiendo el vídeo y creando la campaña en Meta (en pausa, no gasta nada)…');
      const r = await api.llamar('tienda.crearCampanaMeta', Number(pres.value));
      if (!r.ok) return ui.mostrarError(r.error);
      ui.añadirMensaje('sistema', `Campaña creada EN PAUSA (${eur(r.presupuesto)}/día). Revísala y pulsa Activar cuando quieras.`);
      pintarTienda();
    })));
    mt.append(fila);
  } else if (s.meta) {
    const fila = el('div', 'ajuste-botones');
    fila.append(
      el('span', 'meta', `${s.meta.estado === 'ACTIVE' ? '🟢 ACTIVA' : '⏸ EN PAUSA'} · ${eur(s.meta.presupuesto)}/día`),
      boton('Abrir en Meta', () => api.llamar('tienda.abrir', 'meta'), 'mini'),
      s.meta.estado === 'ACTIVE'
        ? boton('⏸ Pausar', (ev) => bloquear(ev, async () => { const r = await api.llamar('tienda.pausarMeta'); if (!r.ok) ui.mostrarError(r.error); pintarTienda(); }))
        : boton('▶ Activar (gasta dinero)', (ev) => bloquear(ev, async () => { const r = await api.llamar('tienda.activarMeta'); if (!r.ok && r.error !== 'Cancelado') ui.mostrarError(r.error); pintarTienda(); }), 'peligro'),
    );
    mt.append(fila);
  } else {
    mt.append(el('div', 'meta', 'Primero crea el anuncio (paso 3).'));
  }
  paso('4 · Campaña de Meta (Facebook e Instagram)', mt);
}

$('formTienda').addEventListener('submit', (e) => {
  e.preventDefault();
  const boton1 = e.target.querySelector('button');
  bloquear({ target: boton1 }, async () => {
    ui.añadirMensaje('sistema', 'Buscando productos en CJ y calculando costes, envío a España y margen… (1-3 minutos)');
    const r = await api.llamar('tienda.buscar', $('tdNicho').value.trim());
    if (!r.ok) return ui.mostrarError(r.error);
    ui.añadirMensaje('sistema', `He encontrado ${r.propuestas.length} productos. Elige uno en la pestaña TIENDA.`);
    pintarTienda();
  });
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
  const nombres = { ollama: 'Modelo local', gemini: 'Gemini (gratis)', whisper: 'Oído (Whisper)', correo: 'Correo', n8n: 'n8n', claude: 'Claude', claudeCode: 'Manos (Claude Code)', voz: 'Voz', ntfy: 'Móvil (ntfy)', twilio: 'Llamadas' };
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
const CATEGORIAS = { borrador: 'GUARDAR UN BORRADOR DE CORREO (NO SE ENVÍA)', pagar: 'PAGAR', comprar: 'COMPRAR', borrar: 'BORRAR / MOVER A LA PAPELERA', publicar: 'PUBLICAR', enviar: 'ENVIAR A OTROS', instalar: 'INSTALAR UN PROGRAMA', ajustes: 'CAMBIAR AJUSTES DE WINDOWS', fuera: 'TOCAR ARCHIVOS FUERA DE SU CARPETA', desconocida: 'HERRAMIENTA DESCONOCIDA' };
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
    case 'sistema': ui.añadirMensaje('sistema', datos); break;
    case 'whisper':
      $('transcripcion').textContent = datos >= 100 ? '' : `Preparando el oído local (Whisper): ${datos}%`;
      if (datos >= 100) pintarServicios();
      break;
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
      if (datos.id === 'youtube') pintarRevisar();
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
    document.querySelector('[data-pestana="ajustes"]').addEventListener('click', pintarServicios);
    document.querySelector('[data-pestana="redes"]').addEventListener('click', pintarRedes);
    document.querySelector('[data-pestana="tienda"]').addEventListener('click', pintarTienda);
    pintarRevisar();
  },
  avisoTarea() { pintarTareas(); },
  pintarServicios,
  responderConfirmacion,
};
})();
