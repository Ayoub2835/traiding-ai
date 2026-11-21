# Jarvis — asistente personal de escritorio para Windows (100 % local y gratis)

Jarvis es una app de escritorio (Electron) que **escucha, piensa, actúa y avisa** sin depender de n8n ni de servicios de pago:

| Parte | Cómo funciona (gratis) |
|---|---|
| **Oído** | Whisper ejecutado **en tu PC** (transformers.js/ONNX). Entiende español, dárija, árabe y francés. Se descarga una vez (~500 MB) y luego va sin internet. |
| **Palabra «Jarvis»** | Escucha siempre desde que arranca, sin botones (Vosk, en local). Ctrl+Espacio queda como respaldo. |
| **Cerebro** | Lo sencillo, **Ollama** (`qwen2.5:3b`, en tu PC; si está cerrado, Jarvis lo abre solo). Lo difícil, el árabe y la dárija, **Gemini** con tu clave gratuita. Si Gemini da error 429 (límite gratis) o llegas al límite diario que pongas, pasa a Ollama sin romperse. Siempre muestra quién contestó. |
| **Voz** | **Edge TTS** (gratis): voz de España (`es-ES-AlvaroNeural`), árabe, **árabe argelino para la dárija** (`ar-DZ-IsmaelNeural`) y francés. La voz de Windows solo como respaldo. |
| **Memoria** | Local. La memoria que tenías en n8n se importa y aparece en **PENDIENTE** (botón «✓ Visto» para marcarla). |
| **Rutinas** | **Informe diario a las 12:00** y **caza de oportunidades a las 9, 13, 17 y 21 h**, con el estilo de antes: puntuación (beneficio € × probabilidad) ÷ horas, solo con fuentes reales y como mucho 1 idea al día. Búsqueda gratis: Google dentro de Gemini o, si no, Google News. |
| **Correo** | Gmail por IMAP con una contraseña de aplicación: lee y crea **borradores** solo si dices «sí». **Nunca envía.** |
| **n8n** | Opcional, apagado por defecto (Ajustes → «Usar n8n»). |

Además: manos con Claude Code (opcional, de pago), habilidades, monitores, avisos al móvil (ntfy) y seguridad con confirmación por voz.
Basado en parte en ideas y código adaptado de [OpenJarvis](https://github.com/open-jarvis/OpenJarvis) (Apache 2.0). Ver [`NOTICE`](NOTICE) y [`docs/PLAN.md`](docs/PLAN.md).

## Actualizar la app en tu PC

**Con un solo comando** (recomendado): pulsa `Windows + R`, escribe `powershell`, pulsa Intro y pega:

```powershell
irm https://raw.githubusercontent.com/ayoub2835/traiding-ai/claude/lucid-hawking-kithaj/ACTUALIZAR-JARVIS.ps1 | iex
```

Descarga la última versión en `Documentos\Jarvis-app`, copia tu `importado-n8n.json` si está en Descargas, ejecuta el instalador y abre las páginas para crear tus claves gratis. Al abrir Jarvis te pregunta si programa el informe y la caza en Windows.

**A mano:**

1. Descarga la última versión de la rama `claude/lucid-hawking-kithaj` (botón *Code → Download ZIP* en GitHub, o `git pull` si usas Git) y descomprímela encima de la carpeta anterior.
2. Copia tu `importado-n8n.json` en la carpeta `memoria` del proyecto, en `Documentos\Jarvis` o en `Descargas` (Jarvis lo importa solo, sin duplicar). También puedes usar *Ajustes → Importar memoria*.
3. Haz doble clic en **`INSTALAR-JARVIS.bat`** e instala encima de la versión anterior (tus ajustes, claves y memoria se conservan).
4. En Jarvis: *Ajustes → Claves y servicios* → pega tu clave de **Gemini** (gratis) y, si quieres, tu **Gmail** + contraseña de aplicación → *Probar*.
5. *Rutinas* → en «Informe diario» y «Caza de oportunidades» pulsa **Programar en Windows** (pregunta antes de crear las tareas).

## Instalación fácil (Windows)

1. Instala [Node.js LTS](https://nodejs.org).
2. (Recomendado) Instala [Ollama](https://ollama.com/download) para el modelo local gratuito.
3. Descarga este repositorio y haz doble clic en **`INSTALAR-JARVIS.bat`**. Hace esto:
   1. comprueba Node.js;
   2. comprueba Ollama y, si falta el modelo `qwen2.5:3b` (≈2 GB), pregunta si lo descarga;
   3. si no tienes Claude Code, pregunta si lo instala (`npm install -g @anthropic-ai/claude-code`);
   4. `npm install`;
   5. `npm run compilar` (descarga el modelo de voz y crea el instalador);
   6. abre `dist\Jarvis-Setup-*.exe` para instalar (acceso directo en el escritorio).
4. Abre Jarvis y en **Ajustes → Claves y servicios** pega tu clave de Gemini (gratis) y, si quieres correo, tu Gmail y la contraseña de aplicación; pulsa *Probar*.
   La primera vez descarga el oído local (Whisper, ~500 MB): el estado aparece bajo el núcleo.
   n8n ya no hace falta; si algún día lo quieres, actívalo en *Ajustes → Usar n8n*.

Si algo falla, la ventana dice «Algo ha fallado, haz una foto» y no se cierra.

## Claves (todas opcionales)

Se pegan en **Ajustes → Claves y servicios** y se guardan solo en tu PC (`%APPDATA%\Jarvis\.env`).
Nunca van al repositorio (es público): `.env` y `config.json` están en `.gitignore`; `.env.ejemplo` es una plantilla vacía.

| Clave | Para qué | Dónde se consigue |
|---|---|---|
| `GEMINI_API_KEY` | **Gratis.** Lo difícil, árabe/dárija, informe diario y caza de oportunidades (con búsqueda de Google). `GEMINI_LIMITE_DIARIO` (200 por defecto) pone tu propio tope diario. | aistudio.google.com → Get API key |
| `GMAIL_USUARIO`, `GMAIL_CLAVE_APP` | **Gratis.** Leer tu correo y crear borradores (nunca envía) | myaccount.google.com/apppasswords (necesita la verificación en 2 pasos) |
| `ANTHROPIC_API_KEY` | Opcional, de pago: Claude como alternativa a Gemini; Claude Code puede usarla. | console.anthropic.com → API Keys |
| `OPENAI_API_KEY` | Opcional, de pago: voz en tiempo real (modo «Tiempo real») | platform.openai.com → API keys |
| `NTFY_TEMA` | Avisos al móvil (gratis): instala la app **ntfy** y suscríbete a un tema difícil de adivinar | ntfy.sh |
| `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_DESDE`, `TWILIO_A` | Llamada de voz para avisos urgentes | console.twilio.com |
| `SHOPIFY_TIENDA`, `SHOPIFY_TOKEN` | Que las manos trabajen con tu tienda | Shopify → Apps → Desarrollar apps → Admin API |
| `N8N_MCP_URL`, `N8N_MCP_TOKEN` | Que las manos lean/editen tus flujos de n8n | n8n → Settings → MCP access |

Sin ninguna clave Jarvis funciona igual en local: Ollama, Whisper, Edge TTS y búsqueda por Google News.

## Cómo decide quién contesta (cerebro)

| Si dices… | Lo atiende |
|---|---|
| «Recuerda que…» | Memoria local |
| «Aprende a…» | Habilidades (crea una nueva) |
| La frase de una habilidad («redacta un email…») | Esa habilidad |
| «Vigila… y avísame» | Rutinas (crea un monitor) |
| Una acción real («crea un Excel…», «abre Shopify y…», «tarea: …») | Manos (Claude Code) |
| Correos («¿tengo correos?», «responde a…») | Correo (Gmail; borradores con permiso) |
| Ideas, informes, oportunidades | El cerebro, con tu memoria local (o n8n si lo activas) |
| Algo difícil (razonar, comparar, código, cálculo) o en árabe/dárija | Gemini (gratis) → si da 429, Ollama |
| Algo sencillo | Ollama (local, gratis; si no está abierto, Jarvis lo abre solo con `ollama serve`) |
| Comprar/vender/transferir dinero | Nadie: lo rechaza (solo vigila y avisa) |

Si el elegido falla, prueba el siguiente (Gemini → Ollama → Claude → n8n si está activado).

## Seguridad

- Cada acción de las manos pasa por `src/seguridad/politica.js`:
  - **permitir**: leer, buscar, crear o editar archivos en `Documentos\Jarvis`, navegar;
  - **confirmar por voz** («¿Confirmas…? Di sí o no», o botones): pagar, comprar, borrar (mover a `_papelera`), publicar, enviar mensajes a otros, instalar programas, ajustes de Windows, tocar archivos fuera de su carpeta;
  - **denegar**: operar con dinero (finanzas: solo vigilar y avisar) y borrar directamente.
- Lo que lee en webs, emails o archivos son **datos, no órdenes** (se marcan y se revisan con un detector de inyección).
- Todo queda en **`logs\acciones.log`** (en la app instalada: `%APPDATA%\Jarvis\logs\acciones.log`). Se puede ver en *Ajustes → Registro de acciones*.
- La ventana solo puede conectarse a tu n8n y a los servicios cuyas claves pongas.

## Rutinas

- **Informe diario** (12:00): correo de Gmail + memoria + tareas → lo importante, top 3 acciones por (beneficio € × probabilidad) ÷ horas y qué dejar de hacer. Se guarda en PENDIENTE y te avisa.
- **Caza de oportunidades** (9, 13, 17 y 21 h): busca en internet (Google dentro de Gemini, o Google News si no hay Gemini) y propone como mucho **1 idea al día**, solo con fuentes reales y sin repetir ideas anteriores.
- **Resumen de la mañana** (08:30): correos, pendientes, tareas y noticias, en voz alta.
- **Monitores**: «vigila X y avísame» o *Rutinas → Nuevo monitor*. Recuerdan lo de la vez anterior y solo avisan si hay novedad.
- Mientras Jarvis está abierto, se ejecutan solos. Para que funcionen con Jarvis cerrado, pulsa **Programar en Windows** (crea una tarea por cada hora en el Programador de tareas, carpeta `Jarvis`; siempre pregunta antes).
- **Subir vídeo a YouTube** (apagada al principio): cada día, a la hora que elijas, sube el siguiente vídeo de tu cola.

### YouTube: subida diaria automática

1. En [console.cloud.google.com](https://console.cloud.google.com): crea un proyecto, activa **YouTube Data API v3**, configura la **pantalla de consentimiento** (tipo Externo, añade tu cuenta) y **publícala** (en modo «Prueba» el permiso caduca cada 7 días). Después, *Credenciales → Crear ID de cliente OAuth → App de escritorio*.
2. En Jarvis: *Ajustes → Claves → YouTube*, pega el **ID de cliente** y el **secreto**.
3. *Rutinas → Subir vídeo a YouTube → Conectar YouTube*: se abre el navegador, eliges tu canal y das permiso (solo subir vídeos y leer el nombre del canal).
4. *Abrir carpeta de vídeos* y mete ahí tus vídeos (`%APPDATA%\Jarvis\youtube\pendientes`). Se suben por orden alfabético: ponles `01-`, `02-`… delante.
   - Título y descripción: un `.json` con el mismo nombre (`{"titulo":"…","descripcion":"…","etiquetas":["…"],"privacidad":"public"}`) o un `.txt` (1.ª línea = título, resto = descripción). Si no pones nada, Claude los escribe a partir del nombre del archivo.
5. Elige la hora, activa la rutina y, si quieres que funcione con Jarvis cerrado, pulsa **Programar en Windows**.

**Jarvis crea los vídeos solo (gratis).** Si la cola está vacía cuando toca subir, Jarvis crea el resumen cripto del día (1-2 minutos, 1920x1080) y lo sube:
- **Datos reales** sin claves: precios y gráfico de 7 días de Bitcoin, Ethereum, Solana, BNB y XRP (CoinGecko), índice de miedo y codicia (alternative.me) y 3 noticias de Google News.
- **Guion** de Claude o Gemini usando *solo* esos datos (sin cerebro disponible, una plantilla). Nunca da consejos de inversión y cada vídeo lleva el aviso legal y las fuentes en la descripción.
- **Voz** gratis de Edge TTS y **montaje** con ffmpeg (incluido en Jarvis): diapositivas con zoom suave.
- Botón **🎬 Crear vídeo ahora** para generarlo y verlo antes de que se publique. Para subir solo tus propios vídeos, pon `YOUTUBE_CREAR=no` en *Ajustes → Claves*. El nombre del canal que sale en los vídeos se cambia en `YOUTUBE_CANAL_NOMBRE`.

### Pestaña REDES (cuentas, crear vídeos y revisar antes de publicar)

- **Cuentas**: estado de YouTube, TikTok, Facebook, Instagram y Snapchat, con su botón *Conectar*. (Snapchat no permite a particulares publicar automáticamente: sube esos vídeos desde el móvil.)
- **Crear vídeo**: escribe de qué lo quieres (tu *prompt*, p. ej. «5 errores de los novatos en trading») y pulsa *🎬 Generar vídeo*; o *📈 Resumen cripto de hoy*; o *✂️ Reels de un vídeo mío*.
- **Por revisar**: **nada se publica sin tu permiso**. Cada vídeo nuevo (también el de la rutina diaria, salvo que pongas `YOUTUBE_REVISAR=no`) espera aquí: lo ves (*▶ Ver*), cambias título y descripción, marcas en qué redes sale y pulsas *✔ Publicar* (o *Descartar*, que lo manda a la papelera de Jarvis).

### TikTok, Instagram y Facebook

La misma rutina (*Vídeo del día*) publica también en cada red que conectes; basta con conectar una. Para estas redes Jarvis hace una **versión vertical 1080x1920** (vídeo centrado, fondo desenfocado, título arriba) de 90 s como máximo (si dura más, la acelera un poco). Si una red falla, las demás siguen; el vídeo solo sale de la cola cuando se ha publicado en alguna.

**Facebook e Instagram** (necesitas una **Página de Facebook** y una cuenta de **Instagram profesional** vinculada a ella):
1. En [developers.facebook.com](https://developers.facebook.com) → *Mis apps → Crear app* (tipo Empresa) y añade *Inicio de sesión con Facebook para empresas* e *Instagram*. Copia el **ID de la app** y la **clave secreta** (*Configuración → Básica*).
2. *Herramientas → Explorador de la Graph API*: elige tu app, marca `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`, `instagram_content_publish` y `business_management`, y pulsa *Generate Access Token*.
3. En Jarvis, *Ajustes → Claves → Redes sociales*: pega el ID, la clave secreta y ese token. Luego *Rutinas → Conectar Facebook e Instagram*: Jarvis guarda el permiso de tu Página, que **no caduca**, y borra el token temporal.

**TikTok**:
1. En [developers.tiktok.com](https://developers.tiktok.com) → *Manage apps*: crea una app con **Login Kit** (plataforma *Desktop*) y **Content Posting API** (activa *Direct Post*). En Login Kit añade la redirect URI `http://127.0.0.1:*/callback/`.
2. Pega el **Client key** y el **Client secret** en *Ajustes → Claves → Redes sociales* y pulsa *Rutinas → Conectar TikTok*.
3. **Importante:** hasta que TikTok **audite tu app** (se pide desde su web de desarrolladores), todo lo que publique queda en **privado** («solo yo»). Es una norma de TikTok; Jarvis te lo indica en el resultado.

Los vídeos de TikTok se marcan como contenido generado con IA (voz sintética), como piden sus normas.

### Pestaña TIENDA (dropshipping con Shopify y CJ)

1. **Buscar productos** en CJ Dropshipping con coste, envío a España, precio y margen reales (tras IVA y comisiones), puntuación y una opinión honesta. Tú eliges.
2. **Ficha en Shopify** en borrador (la publicas tú).
3. **Anuncio**: vídeo vertical con las fotos y textos (también para subirlo a TikTok Ads).
4. **Campaña de Meta** en pausa; solo gasta si pulsas Activar y lo confirmas.

Y además, en automático:
- **Pedidos** (cada 30 min): avisa de cada pedido pagado. *Confirmar y pagar en CJ* lo compra con tu saldo de CJ (siempre pregunta con el coste). Cuando CJ lo envía, el seguimiento se pone solo en Shopify y el cliente recibe el aviso.
- **Ventas y anuncios** (21:30): ventas, gasto en anuncios y beneficio real de hoy y 7 días. Si la campaña gasta sin vender, propone pausarla (con `TIENDA_AUTOPAUSA=si` la pausa sola; activar, nunca).
- **Correos de clientes** (cada hora): detecta los correos de clientes, busca su pedido y seguimiento y prepara la respuesta. Al aprobarla va a tus **Borradores de Gmail**: Jarvis nunca envía correos.

Permisos de la app de Shopify: `write_products`, `read_products`, `read_orders`, `write_merchant_managed_fulfillment_orders`.

### Jarvis en el móvil (Telegram)

1. En Telegram, habla con **@BotFather** → `/newbot` y copia el token.
2. Pégalo en *Ajustes → Claves → Móvil* y pulsa *Probar*: te dará un código.
3. Escribe a tu bot `/vincular <código>`. Desde entonces **solo tu chat** puede usarlo.

Puedes hablarle como a Jarvis y usar `/ventas`, `/pedidos` (comprar en CJ con doble confirmación), `/revisar` (publicar o descartar vídeos) y `/ayuda`. Los avisos de las rutinas también te llegan por Telegram.

### Reels de un vídeo tuyo

*Rutinas → ✂️ Reels de un vídeo mío*: eliges un vídeo de tu PC, confirmas que **tienes sus derechos** y Jarvis busca los 3 momentos con más energía (por el audio), hace 3 reels verticales de 45 s y, si eliges *Crear y publicar*, los sube a YouTube (como Shorts), TikTok, Instagram y Facebook. Con *Solo crear* te los deja en una carpeta para revisarlos. Jarvis **no descarga** vídeos de YouTube ni de otras webs: subir películas o vídeos de otros infringe los derechos de autor y las redes borran esos vídeos y pueden cerrar la cuenta.

Los vídeos subidos pasan a `youtube\subidos` y quedan en `youtube\historial.json`; si una subida falla, el vídeo se queda en la cola y se reintenta al día siguiente. **Importante:** hasta que Google apruebe la auditoría de tu proyecto (formulario «YouTube API Services – Audit and Quota Extension»), YouTube deja **privados** los vídeos subidos por API; Jarvis te avisa si pasa. Y YouTube penaliza el contenido repetitivo o generado en masa: sube vídeos con valor propio.

## Desarrollo

```bash
npm install
```

```bash
npm run modelo
```

```bash
npm start
```

Pruebas automáticas (seguridad, cerebro, manos con un Claude Code simulado, avisos):

```bash
npm test
```

Compilar el instalador:

```bash
npm run compilar
```

## Estructura

```
src/
  main.js          Ventana, bandeja, atajo Ctrl+Espacio, arranque con Windows, conexión n8n
  servicios.js     Une todos los módulos y los expone a la interfaz
  nucleo/          Configuración, ajustes, claves (.env), HTTP, red permitida, n8n
  voz/             Whisper local, Edge TTS, tiempo real opcional (OpenAI Realtime / Gemini Live)
    navegador/     Micro, Vosk (palabra «Jarvis», respaldo), reproductor, tiempo real en la ventana
  cerebro/         Router, complejidad (de OpenJarvis), idioma, Ollama, Gemini, Claude
  manos/           Tareas con Claude Code + servidor MCP de permisos
  habilidades/     Skills TOML (incluidas/ adaptadas de OpenJarvis) y "aprende a…"
  rutinas/         Informe diario, caza de oportunidades, resumen, monitores, programador, búsqueda gratis
  memoria/         Conversación y hechos en local
  avisos/          ntfy y Twilio
  correo/          Gmail por IMAP: leer y borradores (nunca envía)
  seguridad/       Política, confirmaciones, detector de inyección, registro
  ui/              Interfaz (núcleo LED, chat, pestañas)
test/              Pruebas automáticas y simuladores
docs/PLAN.md       Qué se tomó de OpenJarvis y por qué
```

## Desinstalar

1. *Configuración → Aplicaciones → Jarvis → Desinstalar*.
2. Si programaste rutinas en Windows, quítalas antes desde *Rutinas → Quitar de Windows* (o en el Programador de tareas, carpeta `Jarvis`).
3. (Opcional) Borra `%APPDATA%\Jarvis` (ajustes, claves, memoria, habilidades aprendidas, registro).
4. (Opcional) `npm uninstall -g @anthropic-ai/claude-code` y desinstalar Ollama.

## Limitaciones conocidas

- La palabra «Jarvis» se detecta con el modelo pequeño de Vosk en español: puede tener alguna falsa alarma con palabras parecidas.
- El respaldo sin Whisper (Vosk) solo entiende español.
- Edge TTS es un servicio gratuito de Microsoft sin garantías: si deja de funcionar, Jarvis habla con la voz de Windows.
- La memoria importada de n8n no se sube a GitHub (el repositorio es público): `memoria/` está en `.gitignore`.
- Claude Code y Ollama son programas aparte: el filtro de red de la ventana no los controla; los controla la política de permisos.
- Gemini, Gmail, OpenAI Realtime y Twilio se han probado con servidores simulados (Gmail con un servidor IMAP de prueba): pruébalos con tus claves.
