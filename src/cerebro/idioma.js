// Detecta el idioma en que te hablan: español, francés, árabe o dárija argelina
// (escrita en letras latinas, "arabizi": wach, kifach, rani, 3, 7…).
'use strict';

const DARIJA = /\b(wach|wech|wesh|kifach|kifah|kifeh|rani|raki|rak|nta|nti|ntouma|bghit|nheb|n7eb|7ab|chhal|ch7al|bezaf|bzaf|sahbi|khoya|khouya|mlih|mli7|walou|wakha|dork|dorka|ghodwa|lyoum|hadi|hada|kayen|makach|ma3lich|labas|saha|yaatik|yatik|3lach|3la|ma3a|m3a|nchallah|inchallah|hamdoulah|brk|khlas|safi|tfadhal|weld|bnat|drahem|sou9|chghol)\b/i;
const FRANCES = /\b(je|tu|vous|nous|est|sont|bonjour|merci|avec|pour|quoi|comment|pourquoi|c'est|j'ai|qu'est|s'il|plaît|aujourd'hui|demain|beaucoup|très|faire|peux|veux)\b/i;
const ESPANOL = /\b(el|la|los|las|qué|que|cómo|como|por|para|hola|gracias|dime|quiero|puedes|hoy|mañana|está|estás|tengo|hazme|busca|necesito)\b|[ñ¿¡]/i;

/** @returns {'ar'|'darija'|'fr'|'es'} */
function detectar(texto) {
  const t = String(texto || '');
  const arabe = (t.match(/[؀-ۿ]/g) || []).length;
  const latinas = (t.match(/[a-zA-Z]/g) || []).length;
  if (arabe > 0 && arabe >= latinas * 0.3) return 'ar';
  // Dárija: palabras típicas o números usados como letras (3=ع, 7=ح, 9=ق) dentro de palabras.
  if (DARIJA.test(t) || /\b[a-z]*[379][a-z]+\b/i.test(t)) return 'darija';
  const fr = (t.match(new RegExp(FRANCES.source, 'gi')) || []).length;
  const es = (t.match(new RegExp(ESPANOL.source, 'gi')) || []).length;
  if (fr > es) return 'fr';
  return 'es';
}

const NOMBRES = { es: 'español', fr: 'francés', ar: 'árabe', darija: 'dárija argelina' };

// Instrucción para los modelos: contestar en el mismo idioma.
function instruccion(idioma) {
  switch (idioma) {
    case 'ar': return 'Ayoub te ha hablado en árabe: responde en árabe estándar claro.';
    case 'darija': return 'Ayoub te ha hablado en dárija argelina: responde en dárija argelina (con letras latinas como él, p. ej. "wah", "rani", "kifach"), sencillo y natural.';
    case 'fr': return 'Ayoub te ha hablado en francés: responde en francés.';
    default: return 'Responde en español de España.';
  }
}

// Código de idioma para voces (TTS, Twilio…).
const LOCALE = { es: 'es-ES', fr: 'fr-FR', ar: 'ar-SA', darija: 'ar-SA' };

module.exports = { detectar, instruccion, NOMBRES, LOCALE };
