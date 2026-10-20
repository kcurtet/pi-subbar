# pi-subbar

Sub-meter style progress bar footer for the Z.ai / GLM coding-plan quota in
[pi](https://github.com/badlogic/pi-mono).

```
5h ━━━━━── 85% ↻2h 7d ━─ 12% ↻3d
```

- Both windows side by side (5h rolling + weekly, 8 cells each), reset countdown.
- Color thresholds (sub-meter): ≥75% warning, ≥90% error.
- `/sub` prints the quota table (plan, 5h, 7d, MCP month + reset clock).
  `/sub refresh` forces a fetch.
- Providers: `zai-coding-cn` (open.bigmodel.cn), `zai`, `zai-anthropic` (api.z.ai).
  Key comes from pi's `auth.json` (no config needed).
- Fetch on session start + every 60s, debounced refresh after each turn;
  countdown re-rendered from cache every 15s.

Design copied from better-claude's `sub-meter` plugin (MIT, midudev), adapted
to pi's status-line API. Replaces the pi-sub footer for zai providers.

## Install

```
pi install ../../dev/pi-subbar
```

## Test

```
npm test
```
