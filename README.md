# Jarvis — app de escritorio para Windows

Interfaz de escritorio (Electron) para **Jarvis**, el asistente cuyo "cerebro" vive en tu n8n Cloud.
La app no tiene inteligencia propia: escucha, habla, muestra el panel y avisa; las respuestas las da n8n.

## Qué hace

| Función | Cómo |
|---|---|
| Interfaz | Núcleo tipo reactor con anillos de LEDs RGB que reaccionan a tu voz y a la de Jarvis, paneles de conversación, **PENDIENTE**, **MEMORIA** y **AJUSTES**. |
| Voz multilingüe | Graba tu voz y la envía a tu n8n (endpoint de voz), que la entiende y contesta en **español, dárija argelina, árabe o francés**. La respuesta suena con la voz de Jarvis (mp3 que devuelve n8n) y el núcleo late con su volumen real. |
| Pulsa para hablar | Botón del micro, clic en el núcleo o **Ctrl+Espacio**. Corta sola tras **1,5 s de silencio** (o pulsa otra vez / suelta Ctrl+Espacio si lo mantenías). Pitido corto al empezar y al terminar. |
| Palabra de activación | Opcional (Ajustes): di **«Jarvis»** y empieza a grabar. Funciona sin conexión, con Vosk, en tu PC. |
| Parar | Botón rojo ■ o **Esc** mientras Jarvis piensa o habla. |
| Árabe | El texto en árabe se muestra de derecha a izquierda, con la fuente Noto Sans Arabic incluida en la app. |
| Sin conexión | Si la voz de n8n falla, Jarvis transcribe en local con Vosk (solo español), pregunta al chat de texto y responde con la voz de Windows. |
| Al encender el PC | Se abre sola en pantalla completa, saluda ("Buenos días/tardes/noches, Ayoub") con la voz de Jarvis y lee lo pendiente. |
| Bandeja del sistema | Icono junto al reloj: clic = abrir/ocultar; clic derecho = menú (hablar, revisar panel, arrancar con Windows, salir). |
| Atajo global | **Ctrl+Espacio** desde cualquier programa: muestra Jarvis y empieza a escuchar. |
| Notificaciones | Revisa el panel de memoria cada 5 minutos y avisa con una notificación de Windows si hay una **idea** o un **informe** nuevo. |
| Modo conversación | Después de contestar vuelve a escuchar solo. Para terminar: quédate callado, di "gracias", "para", "merci", "safi"… o pulsa Esc. |
| Ajustes guardados | Color LED, modo RGB, voz sí/no, volumen, modo conversación, palabra de activación, voz de respaldo, arranque con Windows y conexión con n8n. |
| Errores visibles | Si una llamada a n8n falla, aparece el motivo en pantalla (aviso rojo y en el chat). |

## Privacidad y seguridad

- La app **solo** se conecta a tu n8n (los hosts de tus 3 URLs). Cualquier otra conexión se bloquea.
- Tu voz grabada se envía a **tu** endpoint de voz de n8n. Lo que haga n8n con ella (por ejemplo, transcribirla y generar la voz con OpenAI) depende de tu flujo de n8n.
- La palabra de activación «Jarvis» y el respaldo sin conexión funcionan en local (Vosk): ese audio no sale del PC.
- Permisos: solo micrófono (sin cámara) y notificaciones.
- **Las URLs de n8n no están en el repositorio** (es público): se escriben en la pantalla «Conectar Jarvis» y se guardan solo en tu PC, en `%APPDATA%\Jarvis\conexion.json`. Quien tenga esas URLs puede hablar con tu Jarvis: no las compartas.

## Requisitos (en tu PC)

- Windows 10 u 11.
- [Node.js LTS](https://nodejs.org) (solo para arrancar en modo desarrollo o compilar; para usar el instalador no hace falta).
- Una voz en español en Windows: *Configuración → Hora e idioma → Voz → Agregar voces* (por ejemplo "Microsoft Helena" o "Laura").
- Micrófono permitido para apps de escritorio: *Configuración → Privacidad y seguridad → Micrófono → Permitir que las aplicaciones de escritorio accedan al micrófono*.

## Instalación fácil

1. Instala [Node.js LTS](https://nodejs.org).
2. Descarga este repositorio y haz doble clic en **`INSTALAR-JARVIS.bat`**.
   Instala las dependencias, descarga el modelo de voz, crea el instalador y lo abre.
3. Sigue el instalador. Al abrir Jarvis por primera vez aparece **«Conectar Jarvis»**: pega las URLs del chat, del panel y de voz, y pulsa **Probar y guardar**.

Si algo falla, la ventana lo dice ("Algo ha fallado, haz una foto…") y se queda abierta.

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

`npm run modelo` descarga una sola vez el modelo de voz en español (~40 MB) a la carpeta `modelo/` (para la palabra de activación y el modo sin conexión).

Para comprobar que n8n responde sin abrir la app (añade `-- --chat` para probar también el chat y la voz):

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

**Conexión con n8n** — la primera vez que se abre la app aparece la pantalla **«Conectar Jarvis»** con 3 campos:

| Campo | Qué es |
|---|---|
| URL del chat | Webhook del chat (POST `{action:"sendMessage", sessionId, chatInput}` → `{output}`) |
| URL del panel | Webhook del panel de memoria (GET → `{items:[...]}`) |
| URL de voz | Webhook de voz (POST multipart con `audio` o `texto` + `sessionId` → `{ok, pregunta, respuesta, audio_base64, audio_mime}`) |

**Probar y guardar** prueba las 3 y solo guarda si responden. Para cambiarlas: *Ajustes → Cambiar conexión con n8n*.

**Otras opciones** — `config.ejemplo.json` (sin URLs reales) trae los valores por defecto. Para cambiarlos, cópialo como `%APPDATA%\Jarvis\config.json` y edítalo:

- `nombreUsuario`: cómo te saluda.
- `revisarPanelCadaMinutos`: cada cuánto mira si hay ideas o informes nuevos.
- `atajoGlobal`: si Ctrl+Espacio no funciona (algunos teclados lo usan para cambiar de idioma), Jarvis lo dice en pantalla. Prueba, por ejemplo, `"Alt+J"`.
- `silencioParaCortarSegundos`: silencio que hace falta para dar la frase por terminada (1,5 s).
- `n8n.timeout…Segundos`: tiempo máximo de espera de cada llamada.

**Nota sobre n8n**: el webhook del panel tiene activada la opción *Ignorar bots*; por eso la app se identifica como un navegador normal. Si haces pruebas con `curl` verás un 403 "Authorization data is wrong!".

Los ajustes del usuario se guardan en `%APPDATA%\Jarvis\ajustes.json`.

## Desinstalar

1. *Configuración → Aplicaciones → Aplicaciones instaladas → Jarvis → Desinstalar*.
   Esto borra la app, los accesos directos y la entrada de arranque con Windows.
2. (Opcional) Borra la carpeta `%APPDATA%\Jarvis` para eliminar también ajustes, configuración y las URLs de conexión.

Si solo lo usabas en modo desarrollo, basta con borrar esta carpeta. Si activaste el arranque automático en ese modo, desactívalo antes en *Ajustes*.

## Estructura

```
INSTALAR-JARVIS.bat      Instalación en un clic (Node → npm install → compilar → abre el instalador)
config.ejemplo.json      Opciones por defecto (sin URLs reales)
src/main.js              Proceso principal: ventana, bandeja, atajo, arranque, notificaciones, seguridad de red
src/n8n.js               Llamadas a n8n (chat, panel y voz) con mensajes de error legibles
src/config.js            Configuración y URLs guardadas (conexion.json)
src/ajustes.js           Ajustes del usuario (ajustes.json)
src/preload.js           Puente seguro entre la interfaz y el proceso principal
src/renderer/Jarvis.html Interfaz
src/renderer/estilo.css  Estilo (negro + LED)
src/renderer/nucleo.js   Núcleo reactor animado
src/renderer/voz.js      Grabadora, reproductor de la voz de Jarvis, pitidos, Vosk (activación y respaldo)
src/renderer/app.js      Lógica: conexión, saludo, chat, conversación, paneles, ajustes
scripts/                 Preparar modelo de voz, probar n8n, generar icono
```

## Limitaciones conocidas

- La palabra de activación usa el modelo pequeño de Vosk en español: en las pruebas reconoce «Jarvis» dicho en español, inglés y francés, pero puede tener alguna falsa alarma con palabras parecidas (por ejemplo «gris»). Mientras está activa, el micrófono queda abierto (en local).
- El respaldo sin conexión solo entiende español; la dárija, el árabe y el francés necesitan el endpoint de voz de n8n.
- Mantener Ctrl+Espacio para hablar depende de que Windows repita el atajo mientras lo mantienes; si no, funciona como "pulsar para empezar" y corta sola con el silencio.
