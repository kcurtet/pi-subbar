/** pi-subbar — librería pura: parse de la API de cuota zai y render del footer. */

export type FooterColor = "dim" | "text" | "warning" | "error";

export interface UsageWindow {
	/** Porcentaje usado, 0-100 (redondeado). */
	percent: number;
	/** Epoch ms del reset; undefined si la API no lo reporta. */
	resetsAtMs: number | undefined;
}

export interface ZaiUsage {
	plan: string | undefined;
	fiveHour: UsageWindow;
	weekly: UsageWindow | undefined;
	/** TIME_LIMIT — asignación MCP/mensual. */
	mcpMonthly: UsageWindow | undefined;
}

export interface FooterSegment {
	text: string;
	color: FooterColor;
}

// ---------------------------------------------------------------- API parse

interface ZaiLimitEntryLike {
	type?: unknown;
	percentage?: unknown;
	nextResetTime?: unknown;
}

/** Cuerpo de respuesta de la API de cuota zai/BigModel. */
function apiErrorMessage(body: unknown): string | undefined {
	const b = body as { code?: unknown; msg?: unknown; success?: unknown };
	if (typeof b?.code === "number" && b.code >= 400) return String(b.msg ?? `HTTP ${b.code}`);
	if (typeof b?.success === "boolean" && !b.success) return String(b.msg ?? "API error");
	if (typeof b?.msg === "string" && b.msg.length > 0 && b.success === undefined && typeof b?.code === "number") {
		return b.msg;
	}
	return undefined;
}

function windowOf(entry: ZaiLimitEntryLike): UsageWindow | undefined {
	if (typeof entry.percentage !== "number") return undefined;
	const percent = Math.min(100, Math.max(0, Math.round(entry.percentage)));
	const resetsAtMs = typeof entry.nextResetTime === "number" ? entry.nextResetTime : undefined;
	return { percent, resetsAtMs };
}

/**
 * Parse de `GET /api/monitor/usage/quota/limit`.
 * TOKENS_LIMIT ordenados por nextResetTime: [0] = ventana 5h, [1] = semanal.
 * TIME_LIMIT = mensual MCP. Lanza Error si la API reporta error o no hay ventanas válidas.
 */
export function parseZaiUsage(body: unknown): ZaiUsage {
	const err = apiErrorMessage(body);
	if (err) throw new Error(`Z.ai API error: ${err}`);

	const data = (body as { data?: { limits?: unknown; planName?: unknown } }).data;
	const limits = Array.isArray(data?.limits) ? (data!.limits as ZaiLimitEntryLike[]) : [];

	const tokenLimits = limits
		.filter((l) => l?.type === "TOKENS_LIMIT")
		.sort((a, b) => (typeof a.nextResetTime === "number" ? a.nextResetTime : 0) - (typeof b.nextResetTime === "number" ? b.nextResetTime : 0));
	const windows = tokenLimits.map(windowOf).filter((w): w is UsageWindow => w !== undefined);
	if (windows.length === 0) throw new Error("No TOKENS_LIMIT entries in Z.ai usage response");

	const timeEntry = limits.find((l) => l?.type === "TIME_LIMIT");
	const plan = typeof data?.planName === "string" && data.planName ? data.planName : undefined;

	return {
		plan,
		fiveHour: windows[0],
		weekly: windows[1],
		mcpMonthly: timeEntry ? windowOf(timeEntry) : undefined,
	};
}

// ---------------------------------------------------------------- formato

/** "42m", "2h05m", "3h", "3d2h", "2d" — hasta el reset. */
export function until(ms: number): string {
	const minutes = ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60_000));
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) {
		const rem = minutes % 60;
		return `${hours}h${rem ? String(rem).padStart(2, "0") + "m" : ""}`;
	}
	const days = Math.floor(hours / 24);
	const remH = hours % 24;
	return `${days}d${remH ? `${remH}h` : ""}`;
}

/** Celdas llenas/vacías de la barra para un porcentaje (default 8 celdas). */
export function barCells(percent: number, cells = 8): { filled: number; empty: number } {
	const pct = Math.min(100, Math.max(0, percent));
	const filled = Math.min(cells, Math.max(0, Math.round((pct / 100) * cells)));
	return { filled, empty: cells - filled };
}

/** Umbral sub-meter: ≥90 error, ≥75 warning, resto text. */
export function colorFor(percent: number): "error" | "warning" | "text" {
	if (percent >= 90) return "error";
	if (percent >= 75) return "warning";
	return "text";
}

/** Reloj local HH:MM del reset (para /sub). */
export function formatResetClock(resetsAtMs: number): string {
	const d = new Date(resetsAtMs);
	const p = (n: number) => String(n).padStart(2, "0");
	return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function windowSegments(label: string, w: UsageWindow, now: number): FooterSegment[] {
	const expired = w.resetsAtMs !== undefined && w.resetsAtMs <= now;
	const percent = expired ? 0 : w.percent;
	const { filled, empty } = barCells(percent);
	const segs: FooterSegment[] = [{ text: `${label} `, color: "dim" }];
	if (filled > 0) segs.push({ text: "━".repeat(filled), color: colorFor(percent) });
	if (empty > 0) segs.push({ text: "─".repeat(empty), color: "dim" });
	segs.push({ text: ` ${percent}%`, color: "text" });
	if (!expired && w.resetsAtMs !== undefined) {
		segs.push({ text: ` ↻${until(w.resetsAtMs - now)}`, color: "dim" });
	}
	return segs;
}

/** Segmentos del footer: `5h ━━━━━── 85% ↻2h 7d ━─ 12% ↻3d` (ambas ventanas). */
export function footerSegments(u: ZaiUsage, now: number): FooterSegment[] {
	const segs = windowSegments("5h", u.fiveHour, now);
	if (u.weekly) segs.push({ text: " ", color: "dim" }, ...windowSegments("7d", u.weekly, now));
	return segs;
}

// ---------------------------------------------------------------- proveedores

export interface ZaiProvider {
	id: string;
	usageUrl: string;
	label: string;
}

const PROVIDERS: Record<string, ZaiProvider> = {
	"zai-coding-cn": {
		id: "zai-coding-cn",
		usageUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
		label: "GLM",
	},
	zai: { id: "zai", usageUrl: "https://api.z.ai/api/monitor/usage/quota/limit", label: "GLM" },
	"zai-anthropic": { id: "zai-anthropic", usageUrl: "https://api.z.ai/api/monitor/usage/quota/limit", label: "GLM" },
};

/** Proveedor soportado para el id de provider del modelo activo (exacto). */
export function providerFor(providerId: string): ZaiProvider | undefined {
	return PROVIDERS[providerId] ?? undefined;
}

// ---------------------------------------------------------------- /sub

function subLine(label: string, w: UsageWindow, now: number): string {
	const expired = w.resetsAtMs !== undefined && w.resetsAtMs <= now;
	const percent = expired ? 0 : w.percent;
	const { filled, empty } = barCells(percent);
	const bar = "━".repeat(filled) + "─".repeat(empty);
	const reset =
		w.resetsAtMs === undefined
			? ""
			: expired
				? " · reset pendiente"
				: ` · reset ${formatResetClock(w.resetsAtMs)} (${until(w.resetsAtMs - now)})`;
	return `${label} ${bar} ${percent}%${reset}`;
}

/** Líneas de la tabla /sub. */
export function subLines(u: ZaiUsage, now: number): string[] {
	const lines: string[] = [];
	if (u.plan) lines.push(u.plan);
	lines.push(subLine("5h", u.fiveHour, now));
	if (u.weekly) lines.push(subLine("7d", u.weekly, now));
	if (u.mcpMonthly) lines.push(subLine("mcp", u.mcpMonthly, now));
	return lines;
}
