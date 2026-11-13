// Política de seguridad de Jarvis: decide qué hace con cada acción.
//
//   permitir  -> se hace sin preguntar (leer, buscar, crear archivos en su carpeta…)
//   confirmar -> pide tu "sí" por voz antes: pagar, comprar, borrar, publicar,
//                enviar mensajes a otros, instalar programas, ajustes de Windows
//   denegar   -> nunca: operar con dinero (finanzas: solo vigilar y avisar) y
//                borrar directamente (se pide mover a _papelera)
//
// Se aplica a cada herramienta que intenta usar Claude Code (manos) y a los
// pasos de las habilidades.
'use strict';
const path = require('path');

const CATEGORIAS = {
  pagar: 'pagar',
  comprar: 'comprar',
  borrar: 'borrar',
  publicar: 'publicar',
  enviar: 'enviar mensajes a otros',
  instalar: 'instalar programas',
  ajustes: 'cambiar ajustes de Windows',
  finanzas: 'operar con dinero',
  fuera: 'modificar archivos fuera de tu carpeta de trabajo',
  desconocida: 'usar una herramienta desconocida',
};

// --- Patrones por categoría (en texto de comandos, URLs o descripciones) -----
const RE = {
  // Operaciones financieras: siempre denegadas.
  finanzas: /\b(transferencia|transfer(?:ir)?|wire\s+transfer|bizum|iban|swift|trading|tradear|broker|binance|coinbase|kraken|metatrader|mt[45]\b|compra(?:r)?\s+(?:acciones|cripto|bitcoin|btc|eth)|vender\s+(?:acciones|cripto)|place[_\s-]?order|market[_\s-]?order|limit[_\s-]?order|withdraw|retirar\s+fondos)\b/i,
  pagar: /\b(pagar|pago|paga|pay(?:ment)?|checkout|stripe|paypal|tarjeta\s+de\s+cr[eé]dito|card[_\s-]?number|cvv|confirmar\s+pedido|place\s+your\s+order|finalizar\s+compra|payer|paiement)\b/i,
  comprar: /\b(comprar|compra|buy(?:\s+now)?|purchase|add\s+to\s+cart|añadir\s+al\s+carrito|acheter|order\s+now)\b/i,
  publicar: /\b(publicar|publica|publish|post\s+(?:to|on)|tweet|git\s+push|gh\s+(?:pr|release)\s+create|npm\s+publish|deploy|desplegar|activate[_\s-]?workflow|publish[_\s-]?workflow|productUpdate.*status.*ACTIVE|publier)\b/i,
  enviar: /\b(send[_\s-]?(?:mail|email|message|sms)|sendmail|Send-MailMessage|smtp|enviar\s+(?:un\s+)?(?:correo|email|mensaje|whatsapp|sms)|reply[_\s-]?(?:email|message)|forward|whatsapp|telegram|twilio|envoyer)\b/i,
  instalar: /\b(npm\s+(?:i|install)\s+(?:-g|--global)|pip\s+install|winget\s+install|choco(?:latey)?\s+install|scoop\s+install|msiexec|Install-(?:Package|Module)|apt(?:-get)?\s+install|brew\s+install|setup\.exe|\.msi\b|instalar\s+(?:el\s+)?programa)\b/i,
  ajustes: /\b(reg(?:\.exe)?\s+(?:add|delete|import)|Set-ItemProperty\s+.*HK(?:LM|CU)|New-ItemProperty|regedit|netsh|bcdedit|sc(?:\.exe)?\s+(?:config|stop|delete)|Set-ExecutionPolicy|powercfg|gpupdate|Disable-|Enable-(?:WindowsOptionalFeature|NetAdapter)|Set-MpPreference|schtasks\s+\/(?:create|delete|change)|Stop-Computer|Restart-Computer|shutdown(?:\.exe)?\s|firewall|defender)\b/i,
  borrarDirecto: /(^|[\s;&|(])(?:rm|rmdir|del|erase|rd|unlink|shred|Remove-Item|ri)\s|git\s+clean\s+-|git\s+reset\s+--hard|format(?:\.com)?\s+[a-z]:|Clear-Content|truncate\s|>\s*\/dev\/null\s*2>&1\s*&&\s*rm/i,
  aPapelera: /_papelera/i,
};

// Herramientas de Claude Code que solo leen o buscan.
const SOLO_LECTURA = new Set(['Read', 'Glob', 'Grep', 'LS', 'WebSearch', 'WebFetch', 'TodoWrite', 'TodoRead', 'Task', 'NotebookRead', 'BashOutput', 'ExitPlanMode', 'KillShell', 'ToolSearch']);
const ESCRITURA = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Herramientas MCP del navegador (Playwright) que solo miran.
const NAVEGADOR_LECTURA = /^mcp__playwright__browser_(navigate|navigate_back|snapshot|take_screenshot|console_messages|network_requests|wait_for|tabs|resize|close|hover|evaluate|press_key)$/;
const NAVEGADOR_ACCION = /^mcp__playwright__browser_(click|type|fill_form|select_option|drag|file_upload|handle_dialog)$/;

const permitir = (motivo) => ({ decision: 'permitir', categoria: null, motivo });
const confirmar = (categoria, descripcion) => ({ decision: 'confirmar', categoria, motivo: `Hace falta tu permiso para ${CATEGORIAS[categoria]}`, descripcion });
const denegar = (categoria, motivo) => ({ decision: 'denegar', categoria, motivo });

const esWin = (r) => /^[a-zA-Z]:[\\/]|^\\\\/.test(String(r || ''));

function dentroDe(base, ruta) {
  if (!base || !ruta) return false;
  // Rutas de Windows (C:\…) se comparan con reglas de Windows, aunque Jarvis
  // se esté probando en otro sistema.
  if (esWin(ruta) !== esWin(base) && (esWin(ruta) || path.isAbsolute(String(ruta)))) return false;
  const p = esWin(base) ? path.win32 : path;
  const rel = p.relative(p.resolve(base), p.resolve(base, String(ruta)));
  return rel === '' || (!rel.startsWith('..') && !p.isAbsolute(rel));
}

// Revisa un texto libre (comando, descripción de clic, URL…) por categorías de riesgo.
function riesgoEnTexto(texto) {
  const t = String(texto || '');
  if (RE.finanzas.test(t)) return 'finanzas';
  if (RE.pagar.test(t)) return 'pagar';
  if (RE.comprar.test(t)) return 'comprar';
  if (RE.ajustes.test(t)) return 'ajustes';
  if (RE.instalar.test(t)) return 'instalar';
  if (RE.enviar.test(t)) return 'enviar';
  if (RE.publicar.test(t)) return 'publicar';
  return null;
}

function decidirCategoria(categoria, descripcion) {
  if (categoria === 'finanzas') {
    return denegar('finanzas', 'Las finanzas son solo para vigilar y avisar: Jarvis nunca mueve dinero, compra ni vende activos.');
  }
  return confirmar(categoria, descripcion);
}

/**
 * Decide sobre una herramienta que quiere usar Claude Code.
 * @param {string} herramienta  p. ej. "Bash", "Write", "mcp__playwright__browser_click"
 * @param {object} entrada      argumentos de la herramienta
 * @param {{espacio?: string}} contexto
 */
function evaluarHerramienta(herramienta, entrada = {}, contexto = {}) {
  const nombre = String(herramienta || '');
  const json = JSON.stringify(entrada || {});

  if (SOLO_LECTURA.has(nombre)) return permitir('Solo lee o busca');

  if (ESCRITURA.has(nombre)) {
    const ruta = entrada.file_path || entrada.path || entrada.notebook_path;
    if (contexto.espacio && !dentroDe(contexto.espacio, ruta)) {
      return confirmar('fuera', `Modificar el archivo ${ruta}`);
    }
    return permitir('Escribe dentro de la carpeta de trabajo');
  }

  if (nombre === 'Bash' || nombre === 'PowerShell') {
    const cmd = String(entrada.command || '');
    if (RE.borrarDirecto.test(cmd)) {
      return denegar('borrar', 'No se borra nada directamente: mueve los archivos a la carpeta _papelera de la carpeta de trabajo (con mv / Move-Item) y Jarvis te pedirá confirmación.');
    }
    const riesgo = riesgoEnTexto(cmd);
    if (riesgo) return decidirCategoria(riesgo, `Ejecutar: ${cmd.slice(0, 300)}`);
    if (/\b(mv|move|Move-Item)\b/i.test(cmd) && RE.aPapelera.test(cmd)) {
      return confirmar('borrar', `Mover a la papelera: ${cmd.slice(0, 300)}`);
    }
    if (/\bcurl\b|\bInvoke-WebRequest\b|\bInvoke-RestMethod\b|\bwget\b/i.test(cmd) && /-X\s*(POST|PUT|DELETE|PATCH)|--data|-d\s|-Method\s+(Post|Put|Delete|Patch)/i.test(cmd)) {
      return confirmar('enviar', `Enviar datos a internet: ${cmd.slice(0, 300)}`);
    }
    return permitir('Comando sin riesgo detectado');
  }

  if (NAVEGADOR_LECTURA.test(nombre)) return permitir('El navegador solo mira');
  if (NAVEGADOR_ACCION.test(nombre)) {
    const riesgo = riesgoEnTexto(json);
    if (riesgo) return decidirCategoria(riesgo, `En el navegador: ${(entrada.element || entrada.ref || json).toString().slice(0, 200)}`);
    return permitir('Acción normal en el navegador');
  }
  if (nombre.startsWith('mcp__playwright__')) return permitir('Navegador');

  if (nombre.startsWith('mcp__')) {
    // Shopify, n8n u otros conectores: leer sí; cambiar según riesgo.
    if (/(get|list|search|read|describe|fetch|query|find|status)/i.test(nombre.split('__').pop())) return permitir('Solo consulta');
    // "send_email" → "send email": el guion bajo impide detectar la palabra.
    const riesgo = riesgoEnTexto(nombre.replace(/_/g, ' ') + ' ' + json);
    if (riesgo) return decidirCategoria(riesgo, `${nombre.replace(/^mcp__/, '').replace(/__/g, ' → ')}`);
    if (/(delete|remove|archive|borrar)/i.test(nombre)) return confirmar('borrar', nombre.replace(/^mcp__/, ''));
    if (/(publish|activate|deploy)/i.test(nombre)) return confirmar('publicar', nombre.replace(/^mcp__/, ''));
    return permitir('Cambio sin riesgo detectado');
  }

  return confirmar('desconocida', `Usar la herramienta ${nombre}`);
}

/** Evalúa una petición en lenguaje natural (antes de mandarla a las manos). */
function evaluarPeticion(texto) {
  const riesgo = riesgoEnTexto(texto);
  if (riesgo === 'finanzas') return decidirCategoria('finanzas');
  if (riesgo) return { decision: 'avisar', categoria: riesgo, motivo: `Puede requerir confirmación (${CATEGORIAS[riesgo]})` };
  return permitir('Sin riesgo detectado');
}

// Respuestas por voz que cuentan como "sí" / "no" (es, fr, ar, dárija).
// (?=…) en vez de \b: \b no funciona con letras acentuadas ni árabes.
const FIN = '(?=$|[\\s,;:])';
const SI = new RegExp(`^(s[ií]|vale|confirmo|confirmado|adelante|hazlo|de acuerdo|ok|oui|d'accord|نعم|اي|إيه|wah|ih|iyeh|eyh|na3am|yes)${FIN}`, 'i');
const NO = new RegExp(`^(no|cancela|cancelar|para|detente|non|annule|لا|la|lla|walou)${FIN}`, 'i');

function interpretarRespuesta(texto) {
  const t = String(texto || '').trim().toLowerCase().replace(/[¡!¿?.,]/g, '');
  if (NO.test(t)) return 'no';
  if (SI.test(t)) return 'si';
  return null;
}

module.exports = { evaluarHerramienta, evaluarPeticion, riesgoEnTexto, interpretarRespuesta, dentroDe, CATEGORIAS };
