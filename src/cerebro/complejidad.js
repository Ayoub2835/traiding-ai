// Puntuación de complejidad de una pregunta (0 = trivial, 1 = muy compleja).
//
// Adaptado de OpenJarvis — src/openjarvis/learning/routing/complexity.py
// Copyright 2025 The OpenJarvis Authors. Licencia Apache 2.0 (ver NOTICE y
// LICENSES/OpenJarvis-Apache-2.0.txt). Cambios: portado a JavaScript, mismas
// señales y pesos (longitud 0.20, dominio 0.25, razonamiento 0.25, varias
// preguntas 0.15, creatividad 0.15) con palabras añadidas en español, francés y árabe.
'use strict';

const CODIGO = /```|`[^`]+`|\bdef\s|\bclass\s|\bimport\s|\bfunction\s|\bconst\s|\bvar\s|\blet\s|\bif\s*\(|->|=>|\{\s*\}|\bfor\s+\w+\s+in\s|#include|System\.out|\b(código|codigo|script|programa|función|funcion|bug|error de|compila|javascript|python|sql|regex)\b/i;
const MATES = /\b(solve|integral|equation|proof|derivative|matrix|theorem|calculate|compute|sigma|probability|resuelve|ecuación|ecuacion|demuestra|derivada|matriz|teorema|calcula|probabilidad|porcentaje|rentabilidad|interés compuesto|calcule|équation|حساب|معادلة)\b/i;
const RAZONAR = /\b(explain|analyze|compare|why|step[- ]by[- ]step|reason|think|pros\s+and\s+cons|trade-?\s*offs?|evaluate|explica|analiza|compara|por\s*qué|porque|paso a paso|razona|ventajas y desventajas|pros y contras|evalúa|evalua|estrategia|plan de negocio|recomiéndame|qué harías|expliquer|analyse|pourquoi|اشرح|حلل|قارن|لماذا)\b/i;
const VARIOS_PASOS = /\bstep\s*\d|\b(?:and\s+also|additionally|furthermore|además|también|luego|después|primero|en segundo lugar|ensuite|puis)\b|\b\d+\.\s/i;
const CREATIVO = /\b(create|design|draft|compose|crea|diseña|redacta|escribe|compón|inventa|genera|rédige|écris|اكتب)\b/i;

/** @returns {{puntuacion:number, senales:object}} */
function puntuar(texto) {
  const q = String(texto || '');
  const s = {};
  let p = 0;

  const n = q.length;
  s.longitud = n < 50 ? 0 : n < 150 ? 0.3 : n < 400 ? 0.6 : n < 1000 ? 0.8 : 1;
  p += 0.20 * s.longitud;

  s.dominio = 0;
  if (CODIGO.test(q)) s.dominio = Math.max(s.dominio, 0.8);
  if (MATES.test(q)) s.dominio = Math.max(s.dominio, 0.7);
  if (CODIGO.test(q) && MATES.test(q)) s.dominio = 1;
  p += 0.25 * s.dominio;

  const razonamientos = (q.match(new RegExp(RAZONAR.source, 'gi')) || []).length;
  s.razonamiento = razonamientos === 0 ? 0 : razonamientos === 1 ? 0.6 : razonamientos === 2 ? 0.8 : 1;
  p += 0.25 * s.razonamiento;

  const preguntas = (q.match(/[?؟]/g) || []).length;
  s.varias = preguntas >= 3 || VARIOS_PASOS.test(q) ? 1 : preguntas === 2 ? 0.5 : 0;
  p += 0.15 * s.varias;

  s.creativo = CREATIVO.test(q) ? (n > 80 ? 1 : 0.5) : 0;
  p += 0.15 * s.creativo;

  return { puntuacion: Math.round(Math.min(1, p) * 100) / 100, senales: s };
}

module.exports = { puntuar };
