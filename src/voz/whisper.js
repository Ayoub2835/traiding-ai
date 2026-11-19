// OÍDO local y gratis: Whisper (modelo abierto de OpenAI) ejecutado EN TU PC con
// transformers.js (ONNX). Entiende español, árabe (y dárija, que escribe en árabe)
// y francés. El modelo se descarga una vez (~500 MB, carpeta %APPDATA%\Jarvis\modelos)
// y después funciona sin internet. El audio nunca sale del PC.
'use strict';
const rutas = require('../nucleo/rutas');
const claves = require('../nucleo/claves');

// Solo los idiomas en que habla Ayoub (evita que confunda la dárija con inglés).
const IDIOMAS = { es: 'spanish', ar: 'arabic', fr: 'french' };

let cargando = null;
let estadoCarga = { listo: false, progreso: 0, error: null };

function cargar(alProgreso = () => {}) {
  if (!cargando) {
    cargando = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      env.cacheDir = rutas.asegurar(rutas.datos('modelos'));
      const vistos = {};
      const asr = await pipeline('automatic-speech-recognition', claves.obtener('WHISPER_MODELO'), {
        dtype: { encoder_model: 'fp32', decoder_model_merged: 'q8' },
        progress_callback: (p) => {
          if (p.status === 'progress' && p.total) {
            vistos[p.file] = [p.loaded, p.total];
            const [a, b] = Object.values(vistos).reduce((x, [l, t]) => [x[0] + l, x[1] + t], [0, 0]);
            estadoCarga.progreso = Math.round((a / b) * 100);
            alProgreso(estadoCarga.progreso);
          }
        },
      });
      const { Tensor } = await import('@huggingface/transformers');
      estadoCarga = { listo: true, progreso: 100, error: null };
      return { asr, Tensor };
    })().catch((e) => {
      cargando = null;
      estadoCarga = { listo: false, progreso: 0, error: e.message };
      throw new Error(`No se pudo cargar Whisper: ${e.message}`);
    });
  }
  return cargando;
}

// Detecta el idioma con un solo paso del decodificador (es / ar / fr).
async function detectarIdioma({ asr, Tensor }, audio) {
  const cfg = asr.model.generation_config;
  const { input_features } = await asr.processor(audio);
  const sot = BigInt(cfg.decoder_start_token_id);
  const salida = await asr.model({ input_features, decoder_input_ids: new Tensor('int64', BigInt64Array.from([sot]), [1, 1]) });
  const v = salida.logits.dims.at(-1);
  const datos = salida.logits.data;
  const base = datos.length - v;
  let mejor = 'es';
  let max = -Infinity;
  for (const c of Object.keys(IDIOMAS)) {
    const x = datos[base + cfg.lang_to_id[`<|${c}|>`]];
    if (x > max) { max = x; mejor = c; }
  }
  return mejor;
}

/**
 * @param {Float32Array} audio mono, 16 kHz
 * @returns {Promise<{ok:boolean, texto?:string, idioma?:string, error?:string}>}
 */
async function transcribir(audio) {
  try {
    const m = await cargar();
    if (!audio || audio.length < 1600) return { ok: true, texto: '', idioma: 'es' };
    const idioma = await detectarIdioma(m, audio);
    const r = await m.asr(audio, { language: IDIOMAS[idioma], task: 'transcribe', chunk_length_s: 30 });
    return { ok: true, texto: String(r.text || '').trim(), idioma };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { cargar, transcribir, estado: () => estadoCarga };
