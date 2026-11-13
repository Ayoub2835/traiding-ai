// Servidores falsos para pruebas: imitan Ollama y la API de Claude (Anthropic).
const http = require('http');

function arrancar(manejador) {
  return new Promise((r) => {
    const s = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (c) => { cuerpo += c; });
      req.on('end', () => {
        const json = (codigo, obj) => { res.writeHead(codigo, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
        manejador(req, cuerpo ? JSON.parse(cuerpo) : null, json);
      });
    });
    s.listen(0, '127.0.0.1', () => r({ servidor: s, url: `http://127.0.0.1:${s.address().port}` }));
  });
}

const peticiones = { ollama: [], claude: [] };

const ollama = () => arrancar((req, body, json) => {
  if (req.url === '/api/tags') return json(200, { models: [{ name: 'qwen2.5:3b' }] });
  if (req.url === '/api/chat') { peticiones.ollama.push(body); return json(200, { message: { role: 'assistant', content: `(local) ${body.messages.at(-1).content.split('Ayoub dice: ').pop()}` } }); }
  json(404, {});
});

const TOML_HAB = `[habilidad]
nombre = "precio-gasoil"
descripcion = "Busca el precio del gasoil y lo resume"
version = "1.0.0"
autor = "aprendida"
disparadores = ["precio del gasoil"]

[[habilidad.pasos]]
herramienta = "n8n"
plantilla = "Busca el precio medio del gasoil hoy en España: {entrada}"
salida = "datos"

[[habilidad.pasos]]
herramienta = "pensar"
plantilla = "Resume en una frase: {datos}"
salida = "resumen"`;

const claude = () => arrancar((req, body, json) => {
  if (!req.url.startsWith('/v1/messages')) return json(404, { type: 'error', error: { type: 'not_found_error', message: 'no' } });
  peticiones.claude.push({ url: req.url, headers: req.headers, body });
  const sistema = (body.system || []).map((b) => b.text).join(' ');
  const usuario = String(body.messages.at(-1).content);
  let texto;
  if (/creador de habilidades/.test(sistema)) texto = TOML_HAB;
  else if (/vigilante de Jarvis/.test(sistema)) texto = /primera vez/.test(usuario) ? '{"novedad":false,"urgente":false,"resumen":"Bitcoin a 60.000 €","notas":"BTC 60000"}' : '{"novedad":true,"urgente":true,"resumen":"Bitcoin ha bajado un 8% (55.000 €)","notas":"BTC 55000"}';
  else if (/Extrae de esta conversación/.test(sistema)) texto = '{"hechos":[{"tipo":"preferencia","texto":"Prefiere respuestas cortas"}]}';
  else if (/resumen hablado de la mañana/.test(sistema)) texto = 'Buenos días, Ayoub. Tienes un correo de Aduanas y la idea de Argelia pendiente.';
  else texto = `(claude) ${usuario.split('Ayoub dice: ').pop()}`;
  json(200, { id: 'msg_1', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: texto }], stop_reason: 'end_turn', stop_details: null, usage: { input_tokens: 10, output_tokens: 10 } });
});

module.exports = { ollama, claude, peticiones, TOML_HAB };
