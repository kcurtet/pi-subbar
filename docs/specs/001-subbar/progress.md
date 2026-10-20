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
- [x] Task 1: lib.ts puro — TDD 20/20 (commit a1c) + providerFor/subLines 23/23
- [x] Task 2: index.ts completo (session_start, fetch, footer, /sub, renderer)
- [x] Task 3: lifecycle (timers, debounce, model_select, shutdown, stale guards) + swap settings
- [x] Task 4: verificación — suite 23/23; live API parse OK (`5h ━━────── 22% ↻2h41m`); smoke gemma+zai EXIT=0; carga desde settings OK. Footer visual interactivo: pendiente usuario (/reload).

## Rulings
- Ruling: tests `until(90s)→"1m"` y "reset pasado sin ↻" estaban mal (round(1.5)=2; ↻ de semana contamina) — corregidos los TESTS, no el código — coste si me equivoco: ninguno (comportamiento sub-meter preservado).
- Ruling: pi -p invalida ctx sin session_shutdown; timer de countdown (15s) lanzaba "ctx is stale" no capturado — fix: try/catch stale-ctx en renderFooter con selfDisarm (patrón pi-sub) — coste: un render perdido al desarmar, recuperado por session_start siguiente.
- Ruling: API viva hoy solo reporta 1 TOKENS_LIMIT (5h) + TIME_LIMIT — weekly ausente → footer muestra solo 5h; código lo maneja (undefined weekly).

## Rulings
- (ninguno aún)

## Pre-flight conflictos
- Ninguno: tareas secuenciales, lib → index consume lib.
