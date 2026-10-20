# Ledger — plan: subbar (barra sub-meter para cuota zai)

Spec: chat 2026-10-20, aprobada ("ok"). Fuente de diseño: better-claude plugins/sub-meter/hooks/register.tsx.

## Decisiones (spec)
- Extensión propia `~/dev/pi-subbar`, REEMPLAZA `npm:@bacnh85/pi-sub` (desinstalar).
- Footer status key `subbar`, ambas ventanas fijas: `5h ━━━━━── 85% ↻2h 7d ━─ 12% ↻3d`.
- 8 celdas, filled `━` coloreado, empty `─` dim. Color: ≥90 error, ≥75 warning, resto text.
- Solo barra + reset (sin tok/s, sin coste, sin breakdown v1).
- Fetch: quota/limit (open.bigmodel.cn | api.z.ai), Bearer auth.json (`readStoredCredential`).
- Cadence: session_start + interval 60s; refresh post after_provider_response/message_end (debounce 2s, TTL 30s); re-render countdown 15s cacheado; session_shutdown disarm + guard stale ctx.
- Tests: node --test nativo TS (node v24, sin tsx).

## Tareas
- [ ] Task 1: lib.ts puro (parse, until, bar, color, footerSegments, reset clock) — TDD
- [ ] Task 2: index.ts extensión mínima (session_start, fetch, footer, /sub)
- [ ] Task 3: lifecycle completo + swap pi-sub → pi-subbar en settings
- [ ] Task 4: verificación (suite + smoke gemma + footer real)

## Rulings
- (ninguno aún)

## Pre-flight conflictos
- Ninguno: tareas secuenciales, lib → index consume lib.
