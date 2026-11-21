#!/usr/bin/env bash
# Delega una tarea a Codex (OpenAI) y muestra solo su respuesta final.
#
# Uso:
#   scripts/codex.sh "descripción de la tarea"
#   scripts/codex.sh --leer "pregunta"     # solo lectura, no cambia archivos
#
# La API key la inyecta el proxy del entorno; la variable solo tiene que existir.
set -euo pipefail

if ! command -v codex >/dev/null 2>&1; then
  echo "Codex no está instalado: npm install -g @openai/codex" >&2
  exit 1
fi

export OPENAI_API_KEY="${OPENAI_API_KEY:-proxy-injected}"

sandbox="workspace-write"
if [ "${1:-}" = "--leer" ]; then
  sandbox="read-only"
  shift
fi

if [ $# -eq 0 ]; then
  echo "Uso: scripts/codex.sh [--leer] \"tarea\"" >&2
  exit 1
fi

raiz="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
salida="$(mktemp)"
trap 'rm -f "$salida"' EXIT

codex exec --skip-git-repo-check --ephemeral --sandbox "$sandbox" -C "$raiz" \
  -o "$salida" "$*" >/dev/null 2>&1 || {
  echo "Codex falló (¿sin saldo en OpenAI o sin red?)." >&2
  exit 1
}

cat "$salida"
