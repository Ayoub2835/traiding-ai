# Jarvis v2 — asistente personal de escritorio para Windows

Jarvis es una app de escritorio (Electron) que **escucha, piensa, actúa y avisa**:

- **Voz**: escucha siempre la palabra «Jarvis», conversación seguida sin botón, puedes interrumpirle hablando. En tiempo real con OpenAI Realtime o Gemini Live si tienes clave; si no, con tu flujo de voz de n8n.
- **Cerebro**: un router elige quién contesta y te lo muestra en pantalla («vía Ollama · qwen2.5:3b», «vía Claude», «vía n8n»…).
- **Manos**: hace tareas reales en tu PC con Claude Code (archivos, navegador, Shopify, n8n), con un panel de **Tareas** con estado y botón de cancelar.
- **Habilidades**: «Jarvis, aprende a…» crea una habilidad reutilizable.
- **Rutinas**: resumen de la mañana hablado y monitores programados con memoria.
- **Memoria** local + la memoria de tu n8n.
- **Avisos** al móvil (ntfy) y llamada para lo urgente (Twilio).
- **Seguridad**: pide tu «sí» por voz antes de pagar, comprar, borrar, publicar, enviar a otros, instalar o tocar ajustes de Windows. Con el dinero solo vigila y avisa.
- Idiomas: **español, dárija argelina, árabe y francés** (el árabe se muestra de derecha a izquierda).

Basado en parte en ideas y código adaptado de [OpenJarvis](https://github.com/open-jarvis/OpenJarvis) (Apache 2.0). Ver [`NOTICE`](NOTICE) y [`docs/PLAN.md`](docs/PLAN.md).

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
4. Abre Jarvis:
   - **Conectar Jarvis**: pega las 3 URLs de tu n8n (chat, panel y voz) → *Probar y guardar*.
   - **Ajustes → Claves y servicios**: pega tus claves y pulsa *Probar* en cada una.

Si algo falla, la ventana dice «Algo ha fallado, haz una foto» y no se cierra.

## Claves (todas opcionales)

Se pegan en **Ajustes → Claves y servicios** y se guardan solo en tu PC (`%APPDATA%\Jarvis\.env`).
Nunca van al repositorio (es público): `.env` y `config.json` están en `.gitignore`; `.env.ejemplo` es una plantilla vacía.

| Clave | Para qué | Dónde se consigue |
|---|---|---|
| `ANTHROPIC_API_KEY` | Claude: preguntas difíciles, árabe/dárija, habilidades, resúmenes. Claude Code puede usarla también. | console.anthropic.com → API Keys |
| `OPENAI_API_KEY` | Voz en tiempo real (Realtime), transcripción multilingüe y voz de Jarvis | platform.openai.com → API keys |
| `GEMINI_API_KEY` | Alternativa a OpenAI para la voz en tiempo real (Gemini Live) | aistudio.google.com → Get API key |
| `NTFY_TEMA` | Avisos al móvil (gratis): instala la app **ntfy** y suscríbete a un tema difícil de adivinar | ntfy.sh |
| `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_DESDE`, `TWILIO_A` | Llamada de voz para avisos urgentes | console.twilio.com |
| `SHOPIFY_TIENDA`, `SHOPIFY_TOKEN` | Que las manos trabajen con tu tienda | Shopify → Apps → Desarrollar apps → Admin API |
| `N8N_MCP_URL`, `N8N_MCP_TOKEN` | Que las manos lean/editen tus flujos de n8n | n8n → Settings → MCP access |

Sin ninguna clave Jarvis funciona como antes (n8n) más el modelo local de Ollama.

## Cómo decide quién contesta (cerebro)

| Si dices… | Lo atiende |
|---|---|
| «Recuerda que…» | Memoria local |
| «Aprende a…» | Habilidades (crea una nueva) |
| La frase de una habilidad («redacta un email…») | Esa habilidad |
| «Vigila… y avísame» | Rutinas (crea un monitor) |
| Una acción real («crea un Excel…», «abre Shopify y…», «tarea: …») | Manos (Claude Code) |
| Correos, ideas, informes, oportunidades | Tu Jarvis de n8n |
| Algo difícil (razonar, comparar, código, cálculo) o en árabe/dárija | Claude |
| Algo sencillo | Ollama (local, gratis) |
| Comprar/vender/transferir dinero | Nadie: lo rechaza (solo vigila y avisa) |

Si el elegido falla, prueba el siguiente (local → Claude → n8n).

## Seguridad

- Cada acción de las manos pasa por `src/seguridad/politica.js`:
  - **permitir**: leer, buscar, crear o editar archivos en `Documentos\Jarvis`, navegar;
  - **confirmar por voz** («¿Confirmas…? Di sí o no», o botones): pagar, comprar, borrar (mover a `_papelera`), publicar, enviar mensajes a otros, instalar programas, ajustes de Windows, tocar archivos fuera de su carpeta;
  - **denegar**: operar con dinero (finanzas: solo vigilar y avisar) y borrar directamente.
- Lo que lee en webs, emails o archivos son **datos, no órdenes** (se marcan y se revisan con un detector de inyección).
- Todo queda en **`logs\acciones.log`** (en la app instalada: `%APPDATA%\Jarvis\logs\acciones.log`). Se puede ver en *Ajustes → Registro de acciones*.
- La ventana solo puede conectarse a tu n8n y a los servicios cuyas claves pongas.

## Rutinas

- **Resumen de la mañana** (08:30 por defecto): correos y agenda (vía n8n), ideas e informes pendientes, tareas sin terminar y noticias; te lo dice en voz alta.
- **Monitores**: «vigila X y avísame» o *Rutinas → Nuevo monitor*. Recuerdan lo de la vez anterior y solo avisan si hay novedad.
- Mientras Jarvis está abierto, se ejecutan solos. Para que funcionen con Jarvis cerrado, pulsa **Programar en Windows** (crea una tarea en el Programador de tareas; siempre pregunta antes).

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
  voz/             Voz de OpenAI, transcripción, tiempo real (OpenAI Realtime / Gemini Live)
    navegador/     Micro, Vosk (palabra «Jarvis», respaldo), reproductor, tiempo real en la ventana
  cerebro/         Router, complejidad (de OpenJarvis), idioma, Ollama, Claude
  manos/           Tareas con Claude Code + servidor MCP de permisos
  habilidades/     Skills TOML (incluidas/ adaptadas de OpenJarvis) y "aprende a…"
  rutinas/         Resumen de la mañana, monitores, programador, noticias RSS
  memoria/         Conversación y hechos en local
  avisos/          ntfy y Twilio
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
- El respaldo sin conexión solo entiende español.
- Claude Code y Ollama son programas aparte: el filtro de red de la ventana no los controla; los controla la política de permisos.
- OpenAI Realtime, Gemini Live y Twilio están programados según su documentación, pero solo se han probado con servidores simulados: pruébalos con tus claves.
