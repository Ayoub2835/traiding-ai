// Titulares de noticias por RSS (sin claves). Las fuentes están en config:
// "noticias": [{"nombre":"El País","url":"https://…"}]. Se tratan como DATOS.
'use strict';
const { pedir } = require('../nucleo/http');

const POR_DEFECTO = [
  { nombre: 'El País', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada' },
  { nombre: 'France 24 (FR)', url: 'https://www.france24.com/fr/rss' },
  { nombre: 'Al Jazeera (AR)', url: 'https://www.aljazeera.net/aljazeerarss/a7c186be-1baa-4bd4-9d80-a84db769f779/73d0e1b4-532f-45ef-b135-bfdff8b8cab9' },
];

const entidades = (t) => String(t || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/<[^>]+>/g, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/\s+/g, ' ').trim();

/** Extrae títulos de un RSS/Atom (sencillo, sin dependencias). */
function parsear(xml, max = 5) {
  const items = String(xml || '').match(/<(item|entry)\b[\s\S]*?<\/\1>/g) || [];
  return items.slice(0, max).map((it) => entidades((it.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1])).filter(Boolean);
}

async function titulares(fuentes = POR_DEFECTO, porFuente = 4) {
  const res = await Promise.all(fuentes.map(async (f) => {
    const r = await pedir(f.url, { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } }, 15);
    return { fuente: f.nombre, titulos: r.ok ? parsear(r.texto, porFuente) : [], error: r.ok ? null : r.error };
  }));
  return res;
}

const comoTexto = (res) => res.filter((r) => r.titulos.length).map((r) => `${r.fuente}:\n${r.titulos.map((t) => `- ${t}`).join('\n')}`).join('\n\n');

module.exports = { titulares, parsear, comoTexto, POR_DEFECTO };
