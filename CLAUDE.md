# Instrucciones para Claude

## Delegar en Codex para ahorrar uso

Codex (CLI de OpenAI) está disponible y paga con los créditos de OpenAI del usuario,
no con su plan de Claude. Úsalo para las partes pesadas de una tarea:

- Escribir mucho código nuevo o cambios repetitivos en varios archivos.
- Recorrer muchos archivos para encontrar algo o explicar cómo funciona.
- Primeras pasadas de revisión o búsqueda de errores.

Cómo:

```bash
scripts/codex.sh "tarea concreta, con archivos y criterio de terminado"
scripts/codex.sh --leer "pregunta sobre el código"   # no modifica nada
```

El script devuelve solo la respuesta final de Codex. Después:

1. Revisa siempre lo que haya cambiado (`git diff`) antes de darlo por bueno.
2. Corrige tú lo que esté mal; no le reenvíes a Codex arreglos pequeños.
3. Las tareas cortas (un cambio de pocas líneas, una pregunta simple) hazlas tú
   directamente: delegarlas cuesta más de lo que ahorran.

Si Codex falla por falta de saldo, sigue tú con la tarea y avisa al usuario.
