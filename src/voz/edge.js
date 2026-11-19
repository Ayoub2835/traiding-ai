// VOZ gratis con Edge TTS (las voces neuronales del navegador Edge de Microsoft).
// Voces por idioma (cambiables en Ajustes → Claves): España, árabe, árabe
// argelino para la dárija y francés. Necesita internet; sin él, Jarvis usa la
// voz de Windows como respaldo.
'use strict';
const { MsEdgeTTS, OUTPUT_FORMAT } = require('msedge-tts');
const claves = require('../nucleo/claves');
const idioma = require('../cerebro/idioma');

function vozPara(lang) {
  return {
    es: claves.obtener('EDGE_VOZ_ES'),
    ar: claves.obtener('EDGE_VOZ_AR'),
    darija: claves.obtener('EDGE_VOZ_DARIJA'),
    fr: claves.obtener('EDGE_VOZ_FR'),
  }[lang] || claves.obtener('EDGE_VOZ_ES');
}

// Edge lee SSML: hay que escapar < > & para que no falle con textos raros.
const escapar = (t) => String(t).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/** @returns {Promise<{audioBase64:string, mime:string, voz:string}|{error:string}>} */
async function sintetizar(texto, lang) {
  const t = String(texto || '').trim().slice(0, 3000);
  if (!t) return { error: 'Texto vacío' };
  const voz = vozPara(lang || idioma.detectar(t));
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voz, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(escapar(t));
    const partes = [];
    await new Promise((resolver, rechazar) => {
      const limite = setTimeout(() => rechazar(new Error('Edge TTS no respondió a tiempo')), 30000);
      audioStream.on('data', (d) => partes.push(d));
      audioStream.on('end', () => { clearTimeout(limite); resolver(); });
      audioStream.on('error', (e) => { clearTimeout(limite); rechazar(e); });
    });
    const buf = Buffer.concat(partes);
    if (!buf.length) return { error: 'Edge TTS devolvió audio vacío' };
    return { audioBase64: buf.toString('base64'), mime: 'audio/mpeg', voz };
  } catch (e) {
    return { error: `Edge TTS: ${e.message}` };
  } finally {
    try { tts.close(); } catch (_) { /* ya cerrado */ }
  }
}

module.exports = { sintetizar, vozPara };
