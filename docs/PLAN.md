# JARVIS v2 — Plan

Este documento explica cómo se combina la app actual de Jarvis (Electron + n8n) con
ideas y piezas de **OpenJarvis** (<https://github.com/open-jarvis/OpenJarvis>,
Copyright 2025 The OpenJarvis Authors, licencia Apache 2.0).

## 1. Qué es OpenJarvis (resumen del estudio)

OpenJarvis es un framework **en Python** para IA personal "local primero": usa
modelos locales (Ollama) y solo llama a la nube cuando hace falta. Piezas que
revisé:

| Pieza | Dónde | Qué hace |
|---|---|---|
| Router de modelos | `src/openjarvis/learning/routing/` (`complexity.py`, `router.py`) | Puntúa la complejidad de la pregunta (longitud, código, mates, razonamiento, varios pasos) de 0 a 1 y elige modelo pequeño o grande. |
| Skills | `src/openjarvis/skills/` + `skills/data/*.toml` | Habilidades reutilizables en TOML: nombre, descripción y una lista de pasos (`tool_name`, `arguments_template`, `output_key`). |
| Memoria | `src/openjarvis/memory/` (`store.py`, `extractor.py`) | Extrae "hechos" cortos y duraderos de las conversaciones y los guarda (deduplicados, con tope). |
| Morning digest | `agents/morning_digest.py`, `digest_store.py`, preset `morning-digest-*` | Resumen hablado de la mañana a partir de correo, agenda, noticias… con reglas estrictas: solo datos, sin inventar, máx. 200 palabras. |
| Scheduled monitor | preset `scheduled-monitor.toml`, `scheduler/`, `agents/monitor_operative.py` | Agente programado (cron) que guarda estado entre ejecuciones. |
| Code assistant | preset `code-assistant.toml`, `agents/claude_code.py` + `claude_code_runner/index.mjs` | Ejecuta Claude (Agent SDK) como subproceso de Node y lee su salida JSON. |
| Seguridad | `security/injection_scanner.py`, `guardrails.py`, `audit.py`, `capabilities.py` | Detecta inyección de instrucciones en textos externos, registra acciones y limita capacidades. |
| Voz | `speech/` | STT/TTS con varios proveedores (Whisper, OpenAI, ElevenLabs…). |

## 2. Decisión general

Tu app es **JavaScript (Electron)** y debe instalarse con un `.exe` sencillo.
Meter el stack Python de OpenJarvis obligaría a instalar Python, `uv`, un servidor
local y una extensión en Rust: más piezas que fallan en tu portátil.
Por eso **no copio el framework entero**: porto a JavaScript las ideas y los
fragmentos útiles, marcados como "adaptado de OpenJarvis", y mantengo todo dentro
de la app.

## 3. Qué reutilizo, qué adapto y qué no

### Reutilizo (portado a JS, con aviso de origen)

| De OpenJarvis | En Jarvis v2 | Por qué |
|---|---|---|
| Puntuación de complejidad (`complexity.py`) | `src/cerebro/complejidad.js` | Es justo lo que necesita el router "simple → local, difícil → Claude". Añado palabras en español, francés y árabe. |
| Patrones de inyección (`injection_scanner.py`) | `src/seguridad/inyeccion.js` | Para marcar instrucciones escondidas en webs, emails o archivos (son datos, no órdenes). |
| Formato de skills en TOML con pasos | `src/habilidades/` | Formato claro, editable a mano y reutilizable. |
| 6 skills de ejemplo (`daily-digest`, `email-draft`, `web-summarize`, `file-organizer`, `todo-from-notes`, `translate-doc`) | `src/habilidades/incluidas/*.toml` | Traducidas y adaptadas a las herramientas de Jarvis. |
| Reglas del morning digest | `src/rutinas/resumen.js` | "Solo datos, nada inventado, ≤200 palabras, sin markdown": evita que el resumen hablado se invente cosas. |

### Adapto (misma idea, implementación propia)

| Idea de OpenJarvis | Cómo queda en v2 | Cambio |
|---|---|---|
| Claude Code runner (Agent SDK por Node) | `src/manos/`: **Claude Code CLI en modo headless** (`claude -p --output-format stream-json`) | El CLI ya trae navegador (Playwright MCP), archivos y terminal, y deja enchufar **mi propio control de permisos** (`--permission-prompt-tool`): cada acción pasa por la política de seguridad y, si hace falta, por tu confirmación por voz. |
| Scheduler propio (daemon) | `src/rutinas/programador.js` | Temporizador interno mientras la app está abierta + **Programador de tareas de Windows** para que arranque aunque esté cerrada. |
| Monitor con estado | `src/rutinas/monitores.js` | Cada monitor guarda sus "notas" de la ejecución anterior y solo avisa si hay novedad. Finanzas: solo vigilar y avisar. |
| Memoria de hechos | `src/memoria/` | Archivos JSON locales (sin base de datos nativa, para que el `.exe` sea simple) + la memoria de n8n que ya existe. |
| Auditoría | `src/seguridad/registro.js` → `logs/acciones.log` | Una línea JSON por acción: qué, quién la pidió, decisión y motivo. |
| Voz multi-proveedor | `src/voz/` | Tiempo real con **OpenAI Realtime** o **Gemini Live** si hay clave; si no, el flujo actual de n8n. Palabra "Jarvis" con Vosk local. |

### No uso (y por qué)

| Pieza | Motivo |
|---|---|
| Servidor/CLI Python, extensión Rust, `uv` | Demasiadas dependencias para un `.exe` de escritorio. |
| Aprendizaje/entrenamiento (`learning/training`, `spec_search`, evals, telemetría de energía) | Investigación; no aporta a un asistente personal en un portátil. |
| Canales (WhatsApp, Slack…) | No pedidos. Los avisos al móvil van por **ntfy** (y llamada **Twilio** opcional). |
| Conectores propios de Gmail/Calendar | Tu n8n ya tiene Gmail y memoria: Jarvis se los pide a n8n en lugar de duplicar credenciales. |
| Router "aprendido" | Necesita datos de uso; empiezo con la heurística, que es transparente. |

## 4. Arquitectura v2

```
src/
  main.js          Orquestador: ventana, bandeja, atajo, IPC
  nucleo/          Configuración, ajustes, claves (.env), n8n, rutas, red permitida
  voz/             TTS, transcripción, tiempo real (OpenAI Realtime / Gemini Live)
    navegador/     Código de voz que corre en la ventana (micro, Vosk, reproductor)
  cerebro/         Router (local / Claude / n8n / manos / habilidad), Ollama, Claude, idioma
  manos/           Tareas reales con Claude Code headless + servidor MCP de permisos
  habilidades/     Skills TOML: incluidas + aprendidas ("aprende a hacer X")
  rutinas/         Resumen de la mañana, monitores, programador, noticias RSS
  memoria/         Conversación, hechos y decisiones en local
  avisos/          ntfy (móvil) y Twilio (llamada)
  seguridad/       Política de acciones, confirmación, inyección, registro
  ui/              Interfaz (núcleo LED, paneles, pestañas Tareas/Habilidades/Rutinas)
```

### Flujo de una petición

1. Llega texto (escrito, o tu voz transcrita).
2. `cerebro/router.js` decide:
   - "aprende a hacer X" → **habilidades** (crea un skill nuevo);
   - coincide con un skill → **habilidades** (lo ejecuta);
   - pide una acción real (crear/abrir/organizar archivos, navegar, Shopify, n8n…) → **manos** (tarea en Claude Code, visible en la pestaña Tareas);
   - correos, informes, ideas u oportunidades → **n8n** (tu Jarvis de siempre);
   - pregunta difícil (puntuación alta, árabe o dárija) → **Claude**;
   - pregunta simple → **Ollama** (`qwen2.5:3b`: rápido en portátil y multilingüe).
3. Si un motor falla, prueba el siguiente (local → Claude → n8n).
4. La respuesta se muestra con el motor que contestó ("vía Ollama · qwen2.5:3b").

### Seguridad

- `seguridad/politica.js` clasifica cada acción: **permitir**, **confirmar** (pagar,
  comprar, borrar, publicar, enviar a otros, instalar, ajustes de Windows) o
  **denegar** (operar con dinero: solo vigilar y avisar; borrar directamente: se
  mueve a `_papelera`).
- Confirmación por voz ("¿Confirmas…? Di sí o no") con botones de respaldo.
- Todo lo leído de webs, emails o archivos va marcado como **datos**, nunca órdenes.
- `logs/acciones.log` registra cada decisión.
- Claves en `.env` y `config.json` (ambos en `.gitignore`); `.env.ejemplo` vacío.

## 5. Límites conocidos

- Las partes que dependen de claves (Claude, OpenAI Realtime, Gemini Live, Twilio)
  se prueban con servidores simulados; con tus claves reales hay que probarlas en tu PC.
- Claude Code y Ollama se ejecutan como programas aparte: el bloqueo de red de la
  ventana de Jarvis no los controla; los controla la política de permisos.
