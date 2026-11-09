// Proceso principal de Jarvis (Electron).
// Se encarga de: ventana, icono en la bandeja, atajo global, arranque con
// Windows, permisos del micrófono, llamadas a n8n y notificaciones.
const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, Notification,
  protocol, session, net, dialog, nativeImage, shell,
} = require('electron');
const { pathToFileURL } = require('url');
const { cargarConfig, hostsPermitidos } = require('./config');
const ajustes = require('./ajustes');
const n8n = require('./n8n');

const APP_ID = 'com.ayoub.jarvis';
const ESQUEMA = 'jarvis';             // la interfaz se sirve como jarvis://app/...
const INICIO_AUTOMATICO = process.argv.includes('--autoarranque');

let cfg = null;
let errorConfig = null;
let ventana = null;
let bandeja = null;
let saliendo = false;
let estadoAtajo = { ok: false, atajo: '', error: '' };
let ultimoPanel = { ok: false, error: 'Aún no se ha consultado el panel', items: [] };
let temporizadorPanel = null;

// ---------------------------------------------------------------------------
// Una sola instancia: si ya está abierta, la segunda solo muestra la ventana.
// ---------------------------------------------------------------------------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => mostrarVentana());
}

// Esquema propio "jarvis://": contexto seguro (necesario para el micrófono)
// y permite que el reconocedor de voz descargue el modelo con fetch.
protocol.registerSchemesAsPrivileged([{
  scheme: ESQUEMA,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true },
}]);

// Rutas de recursos (cambian entre desarrollo y app instalada).
const RAIZ = path.join(__dirname, '..');
const rutaRecurso = (...p) => (app.isPackaged ? path.join(process.resourcesPath, ...p) : path.join(RAIZ, ...p));
const ICONO = path.join(RAIZ, 'assets', 'icon.png');

// Traduce jarvis://app/<ruta> a un archivo local. Nada fuera de estas carpetas.
function archivoParaUrl(urlTexto) {
  const { pathname } = new URL(urlTexto);
  const ruta = decodeURIComponent(pathname);
  if (ruta === '/' || ruta === '') return path.join(RAIZ, 'src', 'renderer', 'Jarvis.html');
  if (ruta === '/vendor/vosk.js') return require.resolve('vosk-browser/dist/vosk.js');
  if (ruta.startsWith('/modelo/')) return dentroDe(rutaRecurso('modelo'), ruta.slice('/modelo/'.length));
  return dentroDe(path.join(RAIZ, 'src', 'renderer'), ruta.slice(1));
}
function dentroDe(base, relativa) {
  const completa = path.normalize(path.join(base, relativa));
  return completa.startsWith(base) ? completa : null; // evita "../"
}

// ---------------------------------------------------------------------------
// Seguridad de red: SOLO se permite hablar con tu n8n.
// ---------------------------------------------------------------------------
function configurarSesion() {
  const permitidos = cfg ? hostsPermitidos(cfg) : new Set();
  const ses = session.defaultSession;

  ses.webRequest.onBeforeRequest((detalles, responder) => {
    const u = new URL(detalles.url);
    const local = [`${ESQUEMA}:`, 'file:', 'data:', 'blob:', 'devtools:', 'chrome-extension:'].includes(u.protocol);
    const n8nOk = u.protocol === 'https:' && permitidos.has(u.host);
    if (!local && !n8nOk) console.warn('[red] Bloqueado:', detalles.url);
    responder({ cancel: !(local || n8nOk) });
  });

  // Permisos: solo micrófono (sin cámara) y notificaciones.
  ses.setPermissionRequestHandler((_wc, permiso, responder, detalles) => {
    if (permiso === 'media') {
      const tipos = detalles.mediaTypes || [];
      return responder(tipos.length > 0 && tipos.every((t) => t === 'audio'));
    }
    responder(permiso === 'notifications');
  });
  ses.setPermissionCheckHandler((_wc, permiso) => ['media', 'notifications'].includes(permiso));

  protocol.handle(ESQUEMA, (peticion) => {
    const archivo = archivoParaUrl(peticion.url);
    if (!archivo || !fs.existsSync(archivo)) return new Response('No encontrado', { status: 404 });
    return net.fetch(pathToFileURL(archivo).toString());
  });
}

// ---------------------------------------------------------------------------
// Ventana principal
// ---------------------------------------------------------------------------
function crearVentana() {
  ventana = new BrowserWindow({
    width: 1280,
    height: 800,
    fullscreen: true,
    backgroundColor: '#000000',
    title: 'Jarvis',
    icon: ICONO,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false, // que siga escuchando aunque esté detrás
      autoplayPolicy: 'no-user-gesture-required', // poder hablar al arrancar sin pulsar nada
    },
  });
  ventana.setMenu(null);
  ventana.loadURL(`${ESQUEMA}://app/`);
  ventana.once('ready-to-show', () => ventana.show());

  // Cerrar la ventana = ocultarla en la bandeja (para salir: menú de la bandeja).
  ventana.on('close', (e) => {
    if (!saliendo) { e.preventDefault(); ventana.hide(); }
  });
  // Los enlaces externos se abren en el navegador, nunca dentro de Jarvis.
  ventana.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  ventana.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ESQUEMA}://`)) e.preventDefault();
  });
}

function mostrarVentana() {
  if (!ventana) return;
  if (ventana.isMinimized()) ventana.restore();
  ventana.show();
  ventana.focus();
}
function alternarVentana() {
  if (ventana && ventana.isVisible() && ventana.isFocused()) ventana.hide();
  else mostrarVentana();
}
const enviar = (canal, datos) => ventana && !ventana.isDestroyed() && ventana.webContents.send(canal, datos);

// ---------------------------------------------------------------------------
// Bandeja del sistema (junto al reloj)
// ---------------------------------------------------------------------------
function crearBandeja() {
  const img = nativeImage.createFromPath(ICONO).resize({ width: 16, height: 16 });
  bandeja = new Tray(img);
  bandeja.setToolTip('Jarvis');
  bandeja.on('click', alternarVentana);
  actualizarMenuBandeja();
}
function actualizarMenuBandeja() {
  if (!bandeja) return;
  const auto = puedeArrancarSolo() ? app.getLoginItemSettings().openAtLogin : false;
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: 'Abrir / ocultar Jarvis', click: alternarVentana },
    { label: `Hablar con Jarvis (${(cfg && cfg.atajoGlobal) || 'Ctrl+Espacio'})`, click: escucharDesdeAtajo },
    { label: 'Revisar panel ahora', click: () => revisarPanel() },
    { type: 'separator' },
    {
      label: 'Arrancar con Windows', type: 'checkbox', checked: auto, enabled: puedeArrancarSolo(),
      click: (item) => fijarArranque(item.checked),
    },
    { type: 'separator' },
    { label: 'Salir', click: () => { saliendo = true; app.quit(); } },
  ]));
}

// ---------------------------------------------------------------------------
// Arranque con Windows (clave "Ejecutar" del usuario, sin permisos de admin)
// ---------------------------------------------------------------------------
const puedeArrancarSolo = () => process.platform === 'win32' || process.platform === 'darwin';

function fijarArranque(activar) {
  if (!puedeArrancarSolo()) return;
  // En modo desarrollo hay que pasar también la carpeta del proyecto a electron.exe.
  const args = app.isPackaged ? ['--autoarranque'] : [RAIZ, '--autoarranque'];
  app.setLoginItemSettings({ openAtLogin: activar, path: process.execPath, args });
  ajustes.actualizar({ arranqueAutomatico: activar });
  actualizarMenuBandeja();
  enviar('ajustes:cambiados', ajustes.paraInterfaz());
}

// La primera vez se PREGUNTA antes de tocar el arranque de Windows.
async function preguntarArranqueSiHaceFalta() {
  if (!puedeArrancarSolo() || ajustes.leer().arranqueAutomatico !== null) return;
  const { response } = await dialog.showMessageBox(ventana, {
    type: 'question',
    buttons: ['Sí, arrancar con Windows', 'No, gracias'],
    defaultId: 0,
    cancelId: 1,
    title: 'Jarvis',
    message: '¿Quieres que Jarvis se abra solo al encender el PC?',
    detail: 'Se añadirá Jarvis a las aplicaciones de inicio de tu usuario de Windows. '
      + 'Puedes cambiarlo cuando quieras desde el icono de la bandeja o en Ajustes.',
  });
  fijarArranque(response === 0);
}

// ---------------------------------------------------------------------------
// Atajo global Ctrl+Espacio: muestra Jarvis y empieza a escuchar
// ---------------------------------------------------------------------------
function escucharDesdeAtajo() {
  mostrarVentana();
  enviar('voz:escuchar');
}
function registrarAtajo() {
  const atajo = (cfg && cfg.atajoGlobal) || 'CommandOrControl+Space';
  let ok = false;
  try { ok = globalShortcut.register(atajo, escucharDesdeAtajo); } catch (e) { /* atajo con formato no válido */ }
  estadoAtajo = {
    ok,
    atajo,
    error: ok ? '' : `No se pudo registrar el atajo ${atajo} (¿lo usa otra aplicación?). Cámbialo en config.json → "atajoGlobal".`,
  };
}

// ---------------------------------------------------------------------------
// Panel de memoria: se revisa cada X minutos y avisa de ideas/informes nuevos
// ---------------------------------------------------------------------------
async function revisarPanel() {
  if (!cfg) return ultimoPanel;
  const r = await n8n.leerPanel(cfg);
  ultimoPanel = { ...r, items: r.items || ultimoPanel.items || [], revisado: new Date().toISOString() };
  if (r.ok) avisarNovedades(r.items);
  enviar('panel:actualizado', ultimoPanel);
  return ultimoPanel;
}

function avisarNovedades(items) {
  const a = ajustes.leer();
  const vistos = new Set(a.idsVistos.map(String));
  const primeraVez = a.idsVistos.length === 0;
  const nuevos = items.filter((i) => !vistos.has(String(i.id)));
  if (nuevos.length === 0) return;

  // La primera vez solo se memorizan (lo pendiente ya lo lee el saludo).
  if (!primeraVez) {
    for (const item of nuevos) {
      const tipo = String(item.tipo || '').toLowerCase();
      if (!['idea', 'informe'].includes(tipo)) continue;
      mostrarNotificacion(
        tipo === 'idea' ? '💡 Nueva idea de Jarvis' : '📋 Nuevo informe de Jarvis',
        item.titulo || '(sin título)',
        item.euros ? `${item.titulo} · ~${item.euros} €` : undefined
      );
    }
  }
  // Se guardan como mucho los últimos 200 ids.
  const todos = [...vistos, ...nuevos.map((i) => String(i.id))].slice(-200);
  ajustes.actualizar({ idsVistos: todos });
}

function mostrarNotificacion(titulo, cuerpo, alternativo) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: titulo, body: alternativo || cuerpo, icon: ICONO, silent: false });
  n.on('click', () => { mostrarVentana(); enviar('ui:abrirPestana', 'pendiente'); });
  n.show();
}

function iniciarRevisionPeriodica() {
  const minutos = Math.max(1, Number(cfg && cfg.revisarPanelCadaMinutos) || 5);
  clearInterval(temporizadorPanel);
  temporizadorPanel = setInterval(revisarPanel, minutos * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Comunicación con la interfaz (IPC)
// ---------------------------------------------------------------------------
function registrarIpc() {
  ipcMain.handle('app:info', () => ({
    nombreUsuario: (cfg && cfg.nombreUsuario) || 'Ayoub',
    idiomaVoz: (cfg && cfg.idiomaVoz) || 'es-ES',
    errorConfig,
    atajo: estadoAtajo,
    inicioAutomatico: INICIO_AUTOMATICO,
    puedeArrancarSolo: puedeArrancarSolo(),
    arrancaConWindows: puedeArrancarSolo() ? app.getLoginItemSettings().openAtLogin : false,
    version: app.getVersion(),
  }));

  ipcMain.handle('chat:enviar', async (_e, texto) => {
    if (!cfg) return { ok: false, error: errorConfig || 'Sin configuración' };
    if (typeof texto !== 'string' || !texto.trim()) return { ok: false, error: 'Mensaje vacío' };
    return n8n.enviarMensaje(cfg, ajustes.leer().sessionId, texto.trim().slice(0, 4000));
  });

  ipcMain.handle('panel:leer', () => ultimoPanel);
  ipcMain.handle('panel:revisar', () => revisarPanel());

  ipcMain.handle('ajustes:leer', () => ajustes.paraInterfaz());
  ipcMain.handle('ajustes:guardar', (_e, cambios) => {
    // Solo se aceptan claves conocidas y con el tipo correcto.
    const limpio = {};
    if (typeof cambios.colorLed === 'string' && /^#[0-9a-f]{6}$/i.test(cambios.colorLed)) limpio.colorLed = cambios.colorLed;
    for (const k of ['voz', 'conversacion', 'modoRgb']) if (typeof cambios[k] === 'boolean') limpio[k] = cambios[k];
    if (typeof cambios.volumen === 'number') limpio.volumen = Math.min(1, Math.max(0, cambios.volumen));
    if (typeof cambios.nombreVoz === 'string') limpio.nombreVoz = cambios.nombreVoz.slice(0, 200);
    if (typeof cambios.arranqueAutomatico === 'boolean') fijarArranque(cambios.arranqueAutomatico);
    return ajustes.actualizar(limpio) && ajustes.paraInterfaz();
  });

  ipcMain.on('ventana:ocultar', () => ventana && ventana.hide());
  ipcMain.on('ventana:pantallaCompleta', () => ventana && ventana.setFullScreen(!ventana.isFullScreen()));
  ipcMain.on('notificar:prueba', () => mostrarNotificacion('Jarvis', 'Las notificaciones funcionan correctamente.'));
}

// ---------------------------------------------------------------------------
// Arranque de la app
// ---------------------------------------------------------------------------
app.setAppUserModelId(APP_ID); // necesario para las notificaciones de Windows

app.whenReady().then(async () => {
  try {
    cfg = cargarConfig();
  } catch (e) {
    errorConfig = e.message;
    console.error(e.message);
  }
  configurarSesion();
  registrarIpc();
  crearVentana();
  crearBandeja();
  registrarAtajo();

  // Primera revisión del panel en cuanto carga la interfaz y luego cada X minutos.
  ventana.webContents.once('did-finish-load', async () => {
    await revisarPanel();
    iniciarRevisionPeriodica();
    preguntarArranqueSiHaceFalta();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
// No se cierra al cerrar la ventana: sigue en la bandeja.
app.on('window-all-closed', () => {});
