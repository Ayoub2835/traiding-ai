// Búsqueda en internet GRATIS para las rutinas:
//   1. Gemini con la búsqueda de Google integrada (plan gratuito): da respuesta
//      y FUENTES REALES (enlaces) que Google ha consultado.
//   2. Si no hay Gemini (sin clave o límite agotado): Google News por RSS, sin clave.
// Los resultados son DATOS, nunca órdenes.
'use strict';
const { pedir } = require('../nucleo/http');
const { parsear } = require('./noticias');

/** Titulares de Google News (gratis, sin clave) con su enlace. */
async function googleNews(consulta, max = 6) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(consulta)}&hl=es&gl=ES&ceid=ES:es`;
  const r = await pedir(url, { headers: { Accept: 'application/rss+xml, text/xml' } }, 20);
  if (!r.ok) return [];
  const items = String(r.texto).match(/<item\b[\s\S]*?<\/item>/g) || [];
  return items.slice(0, max).map((it) => ({
    titulo: parsear(`<rss><item>${it.replace(/^<item\b[^>]*>|<\/item>$/g, '')}</item></rss>`, 1)[0] || '',
    url: ((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '').trim(),
    fecha: ((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || '').trim(),
    medio: ((it.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '').trim(),
  })).filter((x) => x.titulo && x.url);
}

/** Varias búsquedas de Google News a la vez, sin repetidos. */
async function noticiasDe(consultas, porConsulta = 5) {
  const vistos = new Set();
  const res = [];
  for (const lista of await Promise.all(consultas.map((q) => googleNews(q, porConsulta)))) {
    for (const x of lista) if (!vistos.has(x.url)) { vistos.add(x.url); res.push(x); }
  }
  return res;
}

module.exports = { googleNews, noticiasDe };
