// Pruebas de las manos con un Claude Code simulado: permisos, confirmación y cancelación.
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
process.env.JARVIS_DATOS = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-manos-'));
process.env.JARVIS_ESPACIO = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-espacio-'));
process.env.PATH = `${path.join(__dirname, 'falsos')}${path.delimiter}${process.env.PATH}`;
const manos = require('../src/manos');
const confirmacion = require('../src/seguridad/confirmacion');
const registro = require('../src/seguridad/registro');

test('Claude Code se detecta', async () => {
  const r = await manos.comprobar();
  assert.ok(r.ok, r.error);
  assert.match(r.version, /simulado/);
});

test('tarea completa: permite leer, deniega borrar, pide confirmación para instalar (sí) y comprar (no)', async () => {
  process.env.FALSO_PLAN = JSON.stringify([
    { tool: 'Read', input: { file_path: 'a.txt' } },
    { tool: 'Bash', input: { command: 'rm -rf fotos' } },
    { tool: 'Bash', input: { command: 'winget install VLC' } },
    { tool: 'mcp__playwright__browser_click', input: { element: 'Comprar ahora' } },
    { tool: 'Bash', input: { command: 'python transferir.py --iban ES99' } },
  ]);
  const vistas = [];
  const alPedir = (p) => { vistas.push(p.categoria); setTimeout(() => confirmacion.responder(p.id, p.categoria === 'instalar', 'voz'), 50); };
  confirmacion.eventos.on('nueva', alPedir);
  const { tarea, terminada } = await manos.crear('Organiza mis descargas', { origen: 'prueba' });
  assert.ok(['en_cola', 'en_curso'].includes(tarea.estado));
  const fin = await terminada;
  confirmacion.eventos.off('nueva', alPedir);
  assert.strictEqual(fin.estado, 'hecha', fin.error);
  assert.match(fin.resultado, /Read:allow, Bash:deny, Bash:allow, mcp__playwright__browser_click:deny, Bash:deny/);
  assert.deepStrictEqual(vistas, ['instalar', 'comprar']);
  assert.ok(fin.progreso.some((p) => /Prompt con reglas: true/.test(p.texto)));
  const log = registro.ultimas(50).map((l) => `${l.decision}`);
  assert.ok(log.includes('denegado') && log.includes('confirmado') && log.includes('rechazado'));
});

test('cancelar una tarea mientras espera permiso', async () => {
  process.env.FALSO_PLAN = JSON.stringify([{ tool: 'Bash', input: { command: 'git push' } }]);
  const { tarea, terminada } = await manos.crear('Sube los cambios', { origen: 'prueba' });
  await new Promise((r) => confirmacion.eventos.once('nueva', r));
  assert.ok(manos.cancelar(tarea.id));
  const fin = await terminada;
  assert.strictEqual(fin.estado, 'cancelada');
});

test('Claude Code no instalado → error claro', async () => {
  const claves = require('../src/nucleo/claves');
  claves.guardar({ CLAUDE_CODE_RUTA: 'no-existe-claude-xyz' });
  const { terminada } = await manos.crear('algo');
  const fin = await terminada;
  assert.strictEqual(fin.estado, 'fallida');
  assert.match(fin.error, /no está instalado/);
  claves.guardar({ CLAUDE_CODE_RUTA: '' });
});
