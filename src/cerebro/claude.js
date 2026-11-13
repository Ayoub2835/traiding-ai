// Claude (API de Anthropic) para preguntas difíciles, árabe/dárija, habilidades
// y resúmenes. Usa el SDK oficial @anthropic-ai/sdk.
'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const claves = require('../nucleo/claves');

// Modelos que admiten el respaldo automático del servidor si Claude rechaza
// una petición (fallbacks: "default").
const CON_RESPALDO = /^claude-(opus-5(-5)?|fable-5-[12]|sonnet-5-5)$/;

let cliente = null;
let claveUsada = null;
function obtenerCliente() {
  const clave = claves.obtener('ANTHROPIC_API_KEY');
  if (!clave) return null;
  if (!cliente || claveUsada !== clave) {
    const base = claves.obtener('ANTHROPIC_BASE_URL');
    cliente = new Anthropic({ apiKey: clave, ...(base ? { baseURL: base } : {}), maxRetries: 2, timeout: 120000 });
    claveUsada = clave;
  }
  return cliente;
}

const disponible = () => Boolean(claves.obtener('ANTHROPIC_API_KEY'));
const modelo = () => claves.obtener('CLAUDE_MODELO');

/**
 * @param {{sistema:string, mensajes:Anthropic.MessageParam[], esfuerzo?:string, maxTokens?:number}} p
 */
async function chat({ sistema, mensajes, esfuerzo, maxTokens = 16000 }) {
  const c = obtenerCliente();
  if (!c) return { ok: false, error: 'Falta la clave de Claude (Ajustes → Claves)' };
  const m = modelo();
  const peticion = {
    model: m,
    max_tokens: maxTokens,
    // El sistema es estable: se cachea. Lo que cambia (memoria, hora) va en los mensajes.
    system: [{ type: 'text', text: sistema, cache_control: { type: 'ephemeral' } }],
    messages: mensajes,
    output_config: { effort: esfuerzo || claves.obtener('CLAUDE_ESFUERZO') || 'medium' },
  };
  try {
    let resp;
    if (CON_RESPALDO.test(m)) {
      resp = await c.beta.messages.create({ ...peticion, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } else {
      resp = await c.messages.create(peticion);
    }
    if (resp.stop_reason === 'refusal') {
      return { ok: false, error: 'Claude no ha querido responder a esto' + (resp.stop_details?.explanation ? `: ${resp.stop_details.explanation}` : '') };
    }
    const texto = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!texto) return { ok: false, error: 'Claude respondió vacío' };
    return { ok: true, texto, motor: `Claude · ${resp.model || m}` };
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return { ok: false, error: 'La clave de Claude no es válida' };
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: 'Claude: demasiadas peticiones, prueba en un momento' };
    if (e instanceof Anthropic.APIConnectionError) return { ok: false, error: 'No se pudo conectar con Claude', sinConexion: true };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `Claude: error ${e.status}: ${e.message}` };
    return { ok: false, error: `Claude: ${e.message}` };
  }
}

module.exports = { chat, disponible, modelo };
