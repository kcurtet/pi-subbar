import assert from "node:assert/strict";
import { test } from "node:test";
import {
	barCells,
	colorFor,
	footerSegments,
	formatResetClock,
	parseZaiUsage,
	until,
	type ZaiUsage,
} from "../lib.ts";

// ---------------------------------------------------------------- until()
test("until: minutos bajo 60", () => {
	assert.equal(until(5 * 60_000), "5m");
	assert.equal(until(42 * 60_000), "42m");
	assert.equal(until(90_000), "2m"); // round(1.5)
	assert.equal(until(30_000), "1m"); // mínimo 1m
	assert.equal(until(10_000), "1m");
});

test("until: horas con minutos zero-padded", () => {
	assert.equal(until((2 * 60 + 5) * 60_000), "2h05m");
	assert.equal(until(125 * 60_000), "2h05m");
	assert.equal(until(3 * 3_600_000), "3h");
	assert.equal(until((23 * 60 + 59) * 60_000), "23h59m");
});

test("until: días", () => {
	assert.equal(until((24 + 2) * 3_600_000), "1d2h");
	assert.equal(until(48 * 3_600_000), "2d");
	assert.equal(until((3 * 24 + 20) * 3_600_000), "3d20h");
});

test("until: cero o negativo → 0m", () => {
	assert.equal(until(0), "0m");
	assert.equal(until(-5000), "0m");
});

// ---------------------------------------------------------------- barCells()
test("barCells: 8 celdas por defecto, redondeo", () => {
	assert.deepEqual(barCells(0), { filled: 0, empty: 8 });
	assert.deepEqual(barCells(100), { filled: 8, empty: 0 });
	assert.deepEqual(barCells(85), { filled: 7, empty: 1 }); // round(6.8)
	assert.deepEqual(barCells(12), { filled: 1, empty: 7 }); // round(0.96)
	assert.deepEqual(barCells(50), { filled: 4, empty: 4 });
});

test("barCells: clamps percent fuera de rango", () => {
	assert.deepEqual(barCells(150), { filled: 8, empty: 0 });
	assert.deepEqual(barCells(-20), { filled: 0, empty: 8 });
});

test("barCells: celdas custom", () => {
	assert.deepEqual(barCells(50, 10), { filled: 5, empty: 5 });
});

// ---------------------------------------------------------------- colorFor()
test("colorFor: umbrales sub-meter", () => {
	assert.equal(colorFor(0), "text");
	assert.equal(colorFor(74), "text");
	assert.equal(colorFor(75), "warning");
	assert.equal(colorFor(89), "warning");
	assert.equal(colorFor(90), "error");
	assert.equal(colorFor(100), "error");
});

// ---------------------------------------------------------------- parseZaiUsage()
const HOUR = 3_600_000;
const NOW = 1_700_000_000_000;

function apiBody(limits: unknown[], planName?: string): unknown {
	return { data: { limits, planName } };
}

function tokenLimit(percentage: number, resetOffsetMs: number): unknown {
	return { type: "TOKENS_LIMIT", percentage, nextResetTime: NOW + resetOffsetMs };
}

test("parseZaiUsage: dos ventanas ordenadas por reset + TIME_LIMIT + plan", () => {
	const body = apiBody(
		[
			tokenLimit(40, 7 * 24 * HOUR), // semana (reset lejano) — viene DESORDENADO
			tokenLimit(85, 2 * HOUR), // 5h
			{ type: "TIME_LIMIT", percentage: 30, nextResetTime: NOW + 20 * 24 * HOUR },
		],
		"GLM Max",
	);
	const u = parseZaiUsage(body);
	assert.equal(u.plan, "GLM Max");
	assert.equal(u.fiveHour.percent, 85);
	assert.equal(u.fiveHour.resetsAtMs, NOW + 2 * HOUR);
	assert.equal(u.weekly?.percent, 40);
	assert.equal(u.weekly?.resetsAtMs, NOW + 7 * 24 * HOUR);
	assert.equal(u.mcpMonthly?.percent, 30);
});

test("parseZaiUsage: solo una ventana TOKENS_LIMIT → weekly undefined", () => {
	const u = parseZaiUsage(apiBody([tokenLimit(10, 3 * HOUR)]));
	assert.equal(u.fiveHour.percent, 10);
	assert.equal(u.weekly, undefined);
});

test("parseZaiUsage: HTTP 200 con code>=400 → error con msg", () => {
	assert.throws(() => parseZaiUsage({ code: 401, msg: "unauthorized" }), /unauthorized/);
});

test("parseZaiUsage: success:false → error", () => {
	assert.throws(() => parseZaiUsage({ code: 0, success: false, msg: "nope" }), /nope/);
});

test("parseZaiUsage: sin TOKENS_LIMIT válidos → error", () => {
	assert.throws(() => parseZaiUsage(apiBody([{ type: "TIME_LIMIT", percentage: 30, nextResetTime: NOW }])), /TOKENS_LIMIT/);
	assert.throws(() => parseZaiUsage(apiBody([{ type: "TOKENS_LIMIT", nextResetTime: NOW }])), /TOKENS_LIMIT/); // sin percentage
});

test("parseZaiUsage: clamps y redondeo de percentage", () => {
	const u = parseZaiUsage(apiBody([tokenLimit(104.4, HOUR)]));
	assert.equal(u.fiveHour.percent, 100);
	const u2 = parseZaiUsage(apiBody([tokenLimit(-3, HOUR)]));
	assert.equal(u2.fiveHour.percent, 0);
	const u3 = parseZaiUsage(apiBody([tokenLimit(12.6, HOUR)]));
	assert.equal(u3.fiveHour.percent, 13);
});

// ---------------------------------------------------------------- footerSegments()
function usage(overrides?: Partial<ZaiUsage>): ZaiUsage {
	return {
		plan: undefined,
		fiveHour: { percent: 85, resetsAtMs: NOW + 125 * 60_000 },
		weekly: { percent: 12, resetsAtMs: NOW + (3 * 24 + 2) * HOUR },
		mcpMonthly: undefined,
		...overrides,
	};
}

test("footerSegments: ambas ventanas con barra, color y reset", () => {
	const segs = footerSegments(usage(), NOW);
	assert.deepEqual(segs, [
		{ text: "5h ", color: "dim" },
		{ text: "━━━━━━━", color: "warning" }, // 85% → 7 filled
		{ text: "─", color: "dim" },
		{ text: " 85%", color: "text" },
		{ text: " ↻2h05m", color: "dim" },
		{ text: " ", color: "dim" },
		{ text: "7d ", color: "dim" },
		{ text: "━", color: "text" }, // 12% → 1 filled, color normal
		{ text: "───────", color: "dim" },
		{ text: " 12%", color: "text" },
		{ text: " ↻3d2h", color: "dim" },
	]);
});

test("footerSegments: error a los 90+", () => {
	const segs = footerSegments(usage({ fiveHour: { percent: 95, resetsAtMs: NOW + 30 * 60_000 } }), NOW);
	assert.equal(segs[1].color, "error");
});

test("footerSegments: ventana sin reset muestra barra sin ↻", () => {
	const segs = footerSegments(usage({ fiveHour: { percent: 20, resetsAtMs: undefined } }), NOW);
	const texts = segs.map((s) => s.text).join("");
	assert.ok(!texts.includes("↻2h"), `no debe tener reset 5h: ${texts}`);
	assert.ok(texts.includes("↻3d2h"), "week mantiene su reset");
});

test("footerSegments: reset ya pasado → 0% y sin ↻", () => {
	const segs = footerSegments(usage({ fiveHour: { percent: 85, resetsAtMs: NOW - 1000 } }), NOW);
	const texts = segs.map((s) => s.text).join("");
	assert.ok(texts.includes(" 0%"), `percent a 0: ${texts}`);
	assert.ok(!texts.includes("↻0m") && !texts.includes("↻-"), `sin countdown negativo: ${texts}`);
	assert.ok(texts.startsWith("5h ────────"), `barra vacía: ${texts}`);
});

test("footerSegments: sin weekly solo dibuja 5h", () => {
	const segs = footerSegments(usage({ weekly: undefined }), NOW);
	assert.ok(!segs.some((s) => s.text.includes("7d")));
});

// ---------------------------------------------------------------- formatResetClock()
test("formatResetClock: hora local HH:MM", () => {
	const ms = NOW + 2 * HOUR;
	const d = new Date(ms);
	const p = (n: number) => String(n).padStart(2, "0");
	assert.equal(formatResetClock(ms), `${p(d.getHours())}:${p(d.getMinutes())}`);
});

// ---------------------------------------------------------------- providerFor()
import { providerFor, subLines } from "../lib.ts";

test("providerFor: mapea proveedores zai a su endpoint", () => {
	assert.equal(providerFor("zai-coding-cn")?.usageUrl, "https://open.bigmodel.cn/api/monitor/usage/quota/limit");
	assert.equal(providerFor("zai")?.usageUrl, "https://api.z.ai/api/monitor/usage/quota/limit");
	assert.equal(providerFor("zai-anthropic")?.usageUrl, "https://api.z.ai/api/monitor/usage/quota/limit");
	assert.equal(providerFor("ZAI"), undefined); // case-sensitive id de pi; sin match suelto
	assert.equal(providerFor("openrouter"), undefined);
	assert.equal(providerFor("ollama"), undefined);
});

// ---------------------------------------------------------------- subLines()
test("subLines: tabla /sub con plan, ventanas y reset completo", () => {
	const lines = subLines(
		{
			plan: "GLM Coding Plan (Max)",
			fiveHour: { percent: 85, resetsAtMs: NOW + 125 * 60_000 },
			weekly: { percent: 12, resetsAtMs: NOW + (3 * 24 + 2) * HOUR },
			mcpMonthly: { percent: 30, resetsAtMs: NOW + 20 * 24 * HOUR },
		},
		NOW,
	);
	assert.ok(lines.some((l) => l.includes("GLM Coding Plan (Max)")), `plan: ${lines.join("|")}`);
	const h5 = lines.find((l) => l.startsWith("5h"))!;
	assert.ok(h5.includes("85%"), h5);
	assert.ok(h5.includes("2h05m"), h5);
	assert.ok(h5.includes(formatResetClock(NOW + 125 * 60_000)), h5);
	const w7 = lines.find((l) => l.startsWith("7d"))!;
	assert.ok(w7.includes("12%") && w7.includes("3d2h"), w7);
	const mcp = lines.find((l) => l.startsWith("mcp"))!;
	assert.ok(mcp.includes("30%"), mcp);
});

test("subLines: sin weekly/mcp los omite", () => {
	const lines = subLines(usage({ weekly: undefined }), NOW);
	assert.ok(!lines.some((l) => l.startsWith("7d")));
	assert.ok(!lines.some((l) => l.startsWith("mcp")));
});
