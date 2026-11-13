#!/usr/bin/env node
// Servidor MCP mínimo (stdio) que usa Claude Code como "control de permisos":
//   claude -p … --permission-prompt-tool mcp__jarvis__permiso
// Antes de cada acción que no esté ya permitida, Claude Code llama a la
// herramienta "permiso". Este servidor pregunta a Jarvis (por un puerto local
// con token) y devuelve "allow" o "deny". Jarvis aplica su política de
// seguridad y, si hace falta, te pide confirmación por voz.
//
// Se ejecuta como proceso aparte (Electron en modo Node o node), sin dependencias.
'use strict';
const http = require('http');
const readline = require('readline');

const PUERTO = Number(process.env.JARVIS_PUERTO_PERMISOS);
const TOKEN = process.env.JARVIS_TOKEN_PERMISOS || '';
const TAREA = process.env.JARVIS_TAREA || '';

function enviar(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

// Pregunta a Jarvis. Si algo falla, la respuesta es NO (seguro por defecto).
function preguntarAJarvis(herramienta, entrada) {
  return new Promise((resolver) => {
    const cuerpo = JSON.stringify({ tarea: TAREA, herramienta, entrada });
    const req = http.request({
      host: '127.0.0.1', port: PUERTO, path: '/permiso', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(cuerpo), Authorization: `Bearer ${TOKEN}` },
      timeout: 10 * 60 * 1000,
    }, (res) => {
      let datos = '';
      res.on('data', (c) => { datos += c; });
      res.on('end', () => {
        try { resolver(JSON.parse(datos)); } catch (_) { resolver({ permitir: false, motivo: 'Respuesta no válida de Jarvis' }); }
      });
    });
    req.on('error', (e) => resolver({ permitir: false, motivo: `Jarvis no responde: ${e.message}` }));
    req.on('timeout', () => { req.destroy(); resolver({ permitir: false, motivo: 'Sin respuesta a tiempo' }); });
    req.end(cuerpo);
  });
}

const HERRAMIENTA = {
  name: 'permiso',
  description: 'Decide si Claude Code puede usar una herramienta (política de seguridad de Jarvis).',
  inputSchema: {
    type: 'object',
    properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } },
    required: ['tool_name', 'input'],
  },
};

async function manejar(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return enviar({ jsonrpc: '2.0', id, result: {
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'jarvis-permisos', version: '1.0.0' },
    } });
  }
  if (method === 'tools/list') return enviar({ jsonrpc: '2.0', id, result: { tools: [HERRAMIENTA] } });
  if (method === 'tools/call') {
    const args = (params && params.arguments) || {};
    const r = await preguntarAJarvis(args.tool_name, args.input || {});
    const decision = r.permitir
      ? { behavior: 'allow', updatedInput: args.input || {} }
      : { behavior: 'deny', message: r.motivo || 'Denegado por la política de seguridad de Jarvis' };
    return enviar({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
  }
  if (method === 'ping') return enviar({ jsonrpc: '2.0', id, result: {} });
  if (id !== undefined) enviar({ jsonrpc: '2.0', id, error: { code: -32601, message: `Método no soportado: ${method}` } });
  // Las notificaciones (sin id) no llevan respuesta.
}

readline.createInterface({ input: process.stdin }).on('line', (linea) => {
  if (!linea.trim()) return;
  let msg;
  try { msg = JSON.parse(linea); } catch (_) { return; }
  manejar(msg).catch((e) => msg.id !== undefined && enviar({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }));
});
