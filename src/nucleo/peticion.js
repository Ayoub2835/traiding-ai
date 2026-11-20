// Peticiones HTTP con los módulos http/https de Node para SUBIR ARCHIVOS grandes
// sin cargarlos en memoria (enteros o por trozos). Las usan YouTube, TikTok,
// Instagram y Facebook. Siempre devuelven { ok, estado, datos, cabeceras, error }.
'use strict';
const fs = require('fs');
const http = require('http');
const https = require('https');

/**
 * @param {string} url
 * @param {{metodo?:string, cabeceras?:object, cuerpo?:string|Buffer, archivo?:string,
 *          inicio?:number, fin?:number, segundos?:number}} o  inicio/fin: bytes (incluidos) del archivo
 */
function peticion(url, { metodo = 'GET', cabeceras = {}, cuerpo = null, archivo = null, inicio, fin, segundos = 60 } = {}) {
  return new Promise((resolver) => {
    let u;
    try { u = new URL(url); } catch (_) { return resolver({ ok: false, error: `Dirección no válida: ${url}` }); }
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method: metodo, headers: cabeceras }, (res) => {
      let texto = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { texto += d; });
      res.on('end', () => {
        let datos = null;
        try { datos = texto ? JSON.parse(texto) : null; } catch (_) { /* no es JSON */ }
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        const e = datos && datos.error;
        const motivo = datos && (datos.error_description || (e && typeof e === 'object' ? (e.message || (e.code && e.code !== 'ok' ? e.code : null)) : e));
        resolver({ ok, estado: res.statusCode, datos, cabeceras: res.headers, error: ok ? null : `HTTP ${res.statusCode}: ${motivo || texto.slice(0, 200)}` });
      });
    });
    req.setTimeout(segundos * 1000, () => req.destroy(new Error(`sin respuesta en ${segundos} s`)));
    req.on('error', (e) => resolver({ ok: false, sinConexion: true, error: `No se pudo conectar con ${u.host}: ${e.message}` }));
    if (archivo) {
      const s = fs.createReadStream(archivo, inicio !== undefined ? { start: inicio, end: fin } : {});
      s.on('error', (e) => req.destroy(e));
      s.pipe(req);
    } else {
      req.end(cuerpo);
    }
  });
}

const formulario = (o) => new URLSearchParams(o).toString();

module.exports = { peticion, formulario };
