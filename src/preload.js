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
  leerPanel: () => ipcRenderer.invoke('panel:leer'),
  revisarPanel: () => ipcRenderer.invoke('panel:revisar'),
  leerAjustes: () => ipcRenderer.invoke('ajustes:leer'),
  guardarAjustes: (cambios) => ipcRenderer.invoke('ajustes:guardar', cambios),
  ocultar: () => ipcRenderer.send('ventana:ocultar'),
  pantallaCompleta: () => ipcRenderer.send('ventana:pantallaCompleta'),
  notificacionPrueba: () => ipcRenderer.send('notificar:prueba'),

  // Eventos que llegan desde el proceso principal
  alPedirEscuchar: escuchar('voz:escuchar'),
  alActualizarPanel: escuchar('panel:actualizado'),
  alCambiarAjustes: escuchar('ajustes:cambiados'),
  alAbrirPestana: escuchar('ui:abrirPestana'),
});
