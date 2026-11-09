# Jarvis — app de escritorio para Windows

Interfaz de escritorio (Electron) para **Jarvis**, el asistente cuyo "cerebro" vive en tu n8n Cloud.
La app no tiene inteligencia propia: escucha, habla, muestra el panel y avisa; las respuestas las da n8n.

## Qué hace

| Función | Cómo |
|---|---|
| Interfaz | Núcleo tipo reactor con anillos de LEDs RGB que reaccionan a tu voz y a la de Jarvis, paneles de conversación, **PENDIENTE**, **MEMORIA** y **AJUSTES**. |
| Voz en español | Oído: reconocimiento **local** con Vosk (el audio no sale del PC). Boca: voces de Windows. |
| Al encender el PC | Se abre sola en pantalla completa, saluda ("Buenos días/tardes/noches, Ayoub") y lee lo pendiente. |
| Bandeja del sistema | Icono junto al reloj: clic = abrir/ocultar; clic derecho = menú (hablar, revisar panel, arrancar con Windows, salir). |
| Atajo global | **Ctrl+Espacio** desde cualquier programa: muestra Jarvis y empieza a escuchar. |
| Notificaciones | Revisa el panel de memoria cada 5 minutos y avisa con una notificación de Windows si hay una **idea** o un **informe** nuevo. |
| Modo conversación | Después de contestar vuelve a escuchar solo. Para terminar: quédate callado, di "gracias", "para" o "eso es todo", o pulsa Esc. |
| Ajustes guardados | Color LED, modo RGB, voz sí/no, volumen, voz de Windows, modo conversación y arranque con Windows. |
| Errores visibles | Si una llamada a n8n falla, aparece el motivo en pantalla (aviso rojo y en el chat). |

## Privacidad

- La app **solo** se conecta a los hosts de las URLs de `config.json` (tu n8n). Cualquier otra conexión se bloquea.
- El reconocimiento de voz es local (modelo Vosk en español incluido en la app). No se usa Google ni ningún otro servicio.
- La voz hablada usa las voces instaladas en Windows.
- Permisos: solo micrófono (sin cámara) y notificaciones.

## Requisitos (en tu PC)

- Windows 10 u 11.
- [Node.js LTS](https://nodejs.org) (solo para arrancar en modo desarrollo o compilar; para usar el instalador no hace falta).
- Una voz en español en Windows: *Configuración → Hora e idioma → Voz → Agregar voces* (por ejemplo "Microsoft Helena" o "Laura").
- Micrófono permitido para apps de escritorio: *Configuración → Privacidad y seguridad → Micrófono → Permitir que las aplicaciones de escritorio accedan al micrófono*.

## Arrancarlo (modo desarrollo)

Abre una terminal (PowerShell) en esta carpeta:

```bash
npm install
```

```bash
npm run modelo
```

```bash
npm start
```

`npm run modelo` descarga una sola vez el modelo de voz en español (~40 MB) a la carpeta `modelo/`.

Para comprobar que n8n responde sin abrir la app:

```bash
npm run probar-n8n
```

## Compilar el instalador `.exe`

```bash
npm run compilar
```

Genera `dist\Jarvis-Setup-1.0.0.exe`. Al instalarlo:

- se instala para tu usuario (sin permisos de administrador) en `%LOCALAPPDATA%\Programs\Jarvis`,
- crea el **acceso directo en el escritorio** y en el menú Inicio,
- abre Jarvis al terminar.

Como el instalador no está firmado digitalmente, Windows SmartScreen puede avisar: pulsa **Más información → Ejecutar de todas formas**.

La primera vez que se abre, Jarvis **pregunta** si quieres que arranque con Windows. Puedes cambiarlo luego en *Ajustes* o en el menú del icono de la bandeja.

## Configuración

`config.json` contiene las URLs de n8n y opciones generales:

```json
{
  "nombreUsuario": "Ayoub",
  "n8n": {
    "chatUrl": "https://…/webhook/…/chat",
    "panelUrl": "https://…/webhook/jarvis-panel-…",
    "timeoutChatSegundos": 90,
    "timeoutPanelSegundos": 30
  },
  "revisarPanelCadaMinutos": 5,
  "atajoGlobal": "CommandOrControl+Space",
  "idiomaVoz": "es-ES"
}
```

Con la app instalada, para cambiarlo sin recompilar copia `config.json` a `%APPDATA%\Jarvis\config.json` y edítalo ahí (tiene prioridad sobre el que viene con la app). Reinicia Jarvis.

- **Atajo**: si Ctrl+Espacio no funciona (algunos teclados de idiomas asiáticos lo usan), Jarvis lo dice en pantalla. Cámbialo, por ejemplo, a `"Alt+J"`.
- **Nota sobre n8n**: el webhook del panel tiene activada la opción *Ignorar bots*; por eso la app se identifica como un navegador normal. Si haces pruebas con `curl` verás un 403 "Authorization data is wrong!".

Los ajustes del usuario se guardan en `%APPDATA%\Jarvis\ajustes.json`.

## Desinstalar

1. *Configuración → Aplicaciones → Aplicaciones instaladas → Jarvis → Desinstalar*.
   Esto borra la app, los accesos directos y la entrada de arranque con Windows.
2. (Opcional) Borra la carpeta `%APPDATA%\Jarvis` para eliminar también ajustes y configuración.

Si solo lo usabas en modo desarrollo, basta con borrar esta carpeta. Si activaste el arranque automático en ese modo, desactívalo antes en *Ajustes*.

## Estructura

```
config.json              URLs de n8n y opciones
src/main.js              Proceso principal: ventana, bandeja, atajo, arranque, notificaciones, seguridad de red
src/n8n.js               Llamadas a n8n (chat y panel) con mensajes de error legibles
src/config.js            Carga y valida config.json
src/ajustes.js           Ajustes del usuario (ajustes.json)
src/preload.js           Puente seguro entre la interfaz y el proceso principal
src/renderer/Jarvis.html Interfaz
src/renderer/estilo.css  Estilo (negro + LED)
src/renderer/nucleo.js   Núcleo reactor animado
src/renderer/voz.js      Oído (Vosk) y boca (voces de Windows)
src/renderer/app.js      Lógica: saludo, chat, conversación, paneles, ajustes
scripts/                 Preparar modelo de voz, probar n8n, generar icono
```

## Limitaciones conocidas

- El modelo de voz local es el "pequeño" de Vosk: entiende bien frases normales, pero puede fallar con nombres propios o palabras poco comunes. Siempre puedes escribir en el chat.
- El reconocimiento empieza tras pulsar el micro, el núcleo o Ctrl+Espacio (no hay palabra de activación "Oye Jarvis").
