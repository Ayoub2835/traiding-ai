// Puente seguro entre la interfaz (Jarvis.html) y el proceso principal.
// La interfaz NO tiene acceso a Node ni a la red: solo a estas funciones.
const { contextBridge, ipcRenderer } = require('electron');

const escuchar = (canal) => (fn) => {
  const manejador = (_e, datos) => fn(datos);
  ipcRenderer.on(canal, manejador);
  return () => ipcRenderer.removeListener(canal, manejador);
};

contextBridge.exposeInMainWorld('jarvis', {
  info: () => ipcRenderer.invoke('app:info'),
  enviarMensaje: (texto) => ipcRenderer.invoke('chat:enviar', texto),
  // Voz por n8n: { audio: ArrayBuffer, mime } o { texto }
  enviarVoz: (datos) => ipcRenderer.invoke('voz:enviar', datos),
  estadoConexion: () => ipcRenderer.invoke('conexion:estado'),
  probarYGuardarConexion: (urls) => ipcRenderer.invoke('conexion:probarYGuardar', urls),
  leerPanel: () => ipcRenderer.invoke('panel:leer'),
  revisarPanel: () => ipcRenderer.invoke('panel:revisar'),
  leerAjustes: () => ipcRenderer.invoke('ajustes:leer'),
  guardarAjustes: (cambios) => ipcRenderer.invoke('ajustes:guardar', cambios),
  ocultar: () => ipcRenderer.send('ventana:ocultar'),
  pantallaCompleta: () => ipcRenderer.send('ventana:pantallaCompleta'),
  notificacionPrueba: () => ipcRenderer.send('notificar:prueba'),

  // Jarvis v2: acciones de cerebro, voz, manos, habilidades, rutinas, claves…
  llamar: (accion, ...args) => ipcRenderer.invoke('jarvis:accion', accion, ...args),
  alEvento: escuchar('jarvis:evento'),

  // Eventos que llegan desde el proceso principal
  alPedirEscuchar: escuchar('voz:escuchar'),
  alActualizarPanel: escuchar('panel:actualizado'),
  alCambiarAjustes: escuchar('ajustes:cambiados'),
  alAbrirPestana: escuchar('ui:abrirPestana'),
});
