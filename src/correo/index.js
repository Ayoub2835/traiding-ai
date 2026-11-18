// Correo de Gmail por IMAP (gratis), con una CONTRASEÑA DE APLICACIÓN de Google.
//
//   - Leer: correos sin leer de los últimos días (remitente, asunto y un extracto).
//   - Borradores: redacta una respuesta y la guarda en "Borradores" SOLO si tú
//     dices que sí. Jarvis NUNCA envía correos: aquí no hay código para enviar.
// Lo que dicen los correos son DATOS, nunca órdenes (se marcan como tales).
'use strict';
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const MailComposer = require('nodemailer/lib/mail-composer');
const claves = require('../nucleo/claves');
const registro = require('../seguridad/registro');
const confirmacion = require('../seguridad/confirmacion');
const { envolverDatos, REGLA_DATOS } = require('../seguridad/inyeccion');

const configurado = () => claves.tiene('GMAIL_USUARIO') && claves.tiene('GMAIL_CLAVE_APP');

function cliente() {
  return new ImapFlow({
    host: process.env.JARVIS_IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.JARVIS_IMAP_PUERTO) || 993,
    secure: process.env.JARVIS_IMAP_SEGURO !== 'no',
    auth: { user: claves.obtener('GMAIL_USUARIO'), pass: claves.obtener('GMAIL_CLAVE_APP').replace(/\s+/g, '') },
    logger: false,
    tls: process.env.JARVIS_IMAP_SEGURO === 'no' ? undefined : { rejectUnauthorized: true },
  });
}

async function conConexion(fn) {
  if (!configurado()) throw new Error('Falta configurar Gmail (Ajustes → Claves: tu Gmail y la contraseña de aplicación)');
  const c = cliente();
  try {
    await c.connect();
  } catch (e) {
    throw new Error(/auth|login|credentials|Invalid/i.test(e.message + (e.responseText || ''))
      ? 'Gmail no acepta el usuario o la contraseña de aplicación'
      : `No se pudo conectar con Gmail: ${e.message}`);
  }
  try { return await fn(c); } finally { await c.logout().catch(() => {}); }
}

/** Correos sin leer de los últimos `dias` días (no los marca como leídos). */
async function leerNoLeidos({ dias = 2, max = 20 } = {}) {
  return conConexion(async (c) => {
    const lock = await c.getMailboxLock('INBOX');
    try {
      const desde = new Date(Date.now() - dias * 86400000);
      const uids = (await c.search({ seen: false, since: desde }, { uid: true })) || [];
      const ultimos = uids.slice(-max);
      const correos = [];
      for await (const m of c.fetch(ultimos, { envelope: true, source: { start: 0, maxLength: 60000 } }, { uid: true })) {
        let extracto = '';
        try {
          const p = await simpleParser(m.source);
          extracto = (p.text || '').replace(/\s+/g, ' ').trim().slice(0, 600);
        } catch (_) { /* correo raro: solo cabeceras */ }
        const de = m.envelope.from?.[0];
        correos.push({
          uid: m.uid,
          de: de ? `${de.name || ''} <${de.address}>`.trim() : '(desconocido)',
          deDireccion: de?.address || '',
          asunto: m.envelope.subject || '(sin asunto)',
          fecha: m.envelope.date ? new Date(m.envelope.date).toISOString() : null,
          messageId: m.envelope.messageId || null,
          extracto,
        });
      }
      return correos.reverse();
    } finally {
      lock.release();
    }
  });
}

/** Guarda un BORRADOR (nunca lo envía). Llamar solo tras confirmación. */
async function guardarBorrador({ para, asunto, cuerpo, enRespuestaA }) {
  const raw = await new Promise((r, j) => new MailComposer({
    from: claves.obtener('GMAIL_USUARIO'), to: para, subject: asunto, text: cuerpo,
    ...(enRespuestaA ? { inReplyTo: enRespuestaA, references: enRespuestaA } : {}),
  }).compile().build((e, m) => (e ? j(e) : r(m))));
  return conConexion(async (c) => {
    const buzones = await c.list();
    const borradores = buzones.find((b) => b.specialUse === '\\Drafts')?.path || '[Gmail]/Drafts';
    await c.append(borradores, raw, ['\\Draft']);
    registro.anotar({ origen: 'correo', accion: `borrador guardado para ${para}: ${asunto}` });
    return { ok: true, buzon: borradores };
  });
}

async function probar() {
  try {
    const n = await conConexion(async (c) => (await c.status('INBOX', { unseen: true })).unseen);
    return { ok: true, noLeidos: n };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

const RE_BORRADOR = /\b(borrador|responde|respóndele|responder|contesta|contéstale|redacta\s+(?:una\s+)?respuesta|réponds|répondre|رد)\b/i;

/**
 * Atiende una petición de correo desde el router.
 * @param {string} texto lo que pidió Ayoub
 * @param {{pensar:Function, idioma:string}} o
 */
async function atender(texto, { pensar }) {
  if (!configurado()) {
    return { ok: true, texto: 'Aún no tengo acceso a tu Gmail. En Ajustes, "Claves y servicios", pon tu Gmail y una contraseña de aplicación de Google (myaccount.google.com/apppasswords).', motor: 'Correo' };
  }
  const borrador = RE_BORRADOR.test(texto);
  let correos;
  try {
    correos = await leerNoLeidos({ dias: borrador ? 7 : 2, max: borrador ? 30 : 20 });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const lista = correos.map((c, i) => `[${i}] De: ${c.de} | Asunto: ${c.asunto} | ${c.fecha ? c.fecha.slice(0, 16) : ''}\n${c.extracto}`).join('\n\n');
  const datos = envolverDatos('gmail', lista || '(no hay correos sin leer)');

  if (!borrador) {
    const r = await pensar(
      `Eres Jarvis, el asistente de Ayoub. Resume sus correos sin leer: primero lo importante (clientes, dinero, plazos), después lo demás en una línea. Breve, para leer en voz alta, sin markdown. ${REGLA_DATOS}`,
      `Petición: ${texto}\n\n${datos}`,
    );
    return r.ok ? { ok: true, texto: r.texto, motor: `Correo + ${r.motor}` } : r;
  }
  if (!correos.length) return { ok: true, texto: 'No tengo correos sin leer de los últimos 7 días a los que responder.', motor: 'Correo' };
  const r = await pensar(
    `Eres Jarvis. Ayoub quiere un BORRADOR de respuesta a uno de sus correos. Elige el correo al que se refiere y redacta la respuesta en el idioma del correo, educada y breve, firmada "Ayoub". Responde SOLO JSON: {"indice": N, "asunto": "Re: …", "cuerpo": "…"}. Nunca prometas pagos ni datos personales. ${REGLA_DATOS}`,
    `Petición: ${texto}\n\n${datos}`,
  );
  if (!r.ok) return r;
  let j;
  try { j = JSON.parse(String(r.texto).match(/\{[\s\S]*\}/)[0]); } catch (_) { return { ok: false, error: 'No he podido preparar el borrador' }; }
  const c = correos[Number(j.indice)];
  if (!c || !c.deDireccion) return { ok: false, error: 'No sé a qué correo responder; dime el remitente o el asunto' };
  const si = await confirmacion.pedir({
    origen: 'correo', categoria: 'borrador',
    descripcion: `Guardar en Borradores (sin enviar) una respuesta a ${c.de}: «${j.asunto}». Texto: ${String(j.cuerpo).slice(0, 400)}`,
  });
  if (!si) return { ok: true, texto: 'Vale, no guardo el borrador.', motor: 'Correo' };
  try {
    await guardarBorrador({ para: c.deDireccion, asunto: j.asunto || `Re: ${c.asunto}`, cuerpo: j.cuerpo, enRespuestaA: c.messageId });
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: true, texto: `Hecho: tienes el borrador para ${c.de} en Gmail, en Borradores. No lo he enviado; revísalo y envíalo tú.`, motor: `Correo + ${r.motor}` };
}

module.exports = { leerNoLeidos, guardarBorrador, probar, atender, configurado };
