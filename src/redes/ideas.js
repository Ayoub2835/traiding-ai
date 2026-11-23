// Ideas de vídeos del día: lee titulares reales de hoy (Google News) sobre tus
// temas y el cerebro propone 5 vídeos cortos (título, gancho y tema). Con un
// botón, Jarvis crea el vídeo y lo deja en «Por revisar».
// Temas: VIDEOS_TEMAS (separados por comas) o trading y criptomonedas.
'use strict';
const fs = require('fs');
const rutas = require('../nucleo/rutas');
const claves = require('../nucleo/claves');
const { envolverDatos, REGLA_DATOS } = require('../seguridad/inyeccion');

const archivo = () => rutas.datos('ideas-videos.json');
function leer() { try { return JSON.parse(fs.readFileSync(archivo(), 'utf8')); } catch (_) { return { ideas: [] }; } }

async function generar({ pensar, dep = {} } = {}) {
  if (!pensar) return { ok: false, error: 'Hace falta el cerebro (Gemini o Claude)' };
  const temas = String(claves.obtener('VIDEOS_TEMAS') || 'bitcoin, criptomonedas, trading').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 4);
  const noticias = dep.noticias || require('../rutinas/busqueda').googleNews;
  const titulares = [];
  for (const t of temas) {
    try { for (const n of (await noticias(t, 6)) || []) titulares.push(`- ${n.titulo || n.title || n}`); } catch (_) { /* sin noticias de ese tema */ }
  }
  const r = await Promise.resolve(pensar(
    `Eres guionista de vídeos cortos (YouTube Shorts, TikTok, Reels) en español de España. Con los titulares de HOY, propón 5 vídeos de 30-60 s que la gente quiera ver. Nada de consejos de inversión, promesas de ganancias ni noticias inventadas: explica y da contexto. ${REGLA_DATOS} `
    + 'Responde SOLO JSON: {"ideas":[{"titulo":"máx. 70","gancho":"primera frase, máx. 12 palabras","tema":"instrucción para crear el vídeo, 1-2 frases"}]}',
    titulares.length ? envolverDatos('titulares de hoy', titulares.slice(0, 30).join('\n')) : `Sin titulares hoy. Temas: ${temas.join(', ')}. Propón ideas atemporales y educativas.`,
    { preferir: 'claude' },
  )).catch(() => null);
  let ideas = [];
  try {
    ideas = JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]).ideas
      .map((x) => ({ titulo: String(x.titulo || '').slice(0, 70), gancho: String(x.gancho || '').slice(0, 100), tema: String(x.tema || x.titulo || '').slice(0, 400) }))
      .filter((x) => x.titulo && x.tema).slice(0, 5);
  } catch (_) { ideas = []; }
  if (!ideas.length) return { ok: false, error: 'El cerebro no ha podido proponer ideas ahora' };
  fs.writeFileSync(archivo(), JSON.stringify({ fecha: new Date().toISOString(), ideas }, null, 2));
  return { ok: true, novedad: true, ideas, resumen: `💡 Ideas de vídeo para hoy:\n${ideas.map((x, i) => `${i + 1}. ${x.titulo}`).join('\n')}\n(REDES → Ideas: un botón y Jarvis lo crea)` };
}

module.exports = { generar, leer };
