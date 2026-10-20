/**
 * pi-subbar — barra de progreso estilo sub-meter (better-claude) para la cuota
 * del coding plan de Z.ai/GLM en el footer de pi.
 *
 * Reemplaza el footer de texto de pi-sub para proveedores zai*:
 *   5h ━━━━━── 85% ↻2h 7d ━─ 12% ↻3d
 */
import { readStoredCredential, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import os from "node:os";
import path from "node:path";
import { footerSegments, parseZaiUsage, providerFor, subLines, type ZaiUsage } from "./lib.ts";

const STATUS_KEY = "subbar";
const MESSAGE_TYPE = "pi-subbar-sub";
const FETCH_INTERVAL_MS = 60_000;
const REFRESH_TTL_MS = 30_000;
const REFRESH_DEBOUNCE_MS = 2_000;
const COUNTDOWN_RENDER_MS = 15_000;
const FETCH_TIMEOUT_MS = 7_000;

interface State {
	ctx: ExtensionContext | undefined;
	providerId: string | undefined;
	usage: ZaiUsage | undefined;
	error: string | undefined;
	lastFetchAt: number;
	inFlight: Promise<ZaiUsage | undefined> | undefined;
	generation: number;
	fetchTimer: ReturnType<typeof setInterval> | undefined;
	renderTimer: ReturnType<typeof setInterval> | undefined;
	debounceTimer: ReturnType<typeof setTimeout> | undefined;
}

function piAuthPath(): string {
	const configDir = process.env.PI_CODING_AGENT_DIR?.trim() || path.join(os.homedir(), ".pi", "agent");
	return path.join(configDir, "auth.json");
}

function isStaleCtxError(error: unknown): boolean {
	// Mismo guard que pi-sub: la sesión puede reemplazarse sin session_shutdown.
	return error instanceof Error && /\bctx is stale\b|invalidated/i.test(error.message);
}

function stopTimers(state: State): void {
	if (state.fetchTimer) clearInterval(state.fetchTimer);
	if (state.renderTimer) clearInterval(state.renderTimer);
	if (state.debounceTimer) clearTimeout(state.debounceTimer);
	state.fetchTimer = undefined;
	state.renderTimer = undefined;
	state.debounceTimer = undefined;
}

function selfDisarm(state: State): void {
	stopTimers(state);
	state.inFlight = undefined;
	state.generation++;
	state.ctx = undefined;
}

/** Footer: una línea ANSI con la barra; loading y error degradan con texto corto. */
function renderFooter(state: State): void {
	const ctx = state.ctx;
	if (!ctx) return;
	const theme = ctx.ui.theme;
	if (!theme?.fg) return;
	let line: string;
	let color: "dim" | "warning" = "dim";
	if (state.error) {
		line = `subbar ${state.error.slice(0, 60)}`;
		color = "warning";
	} else if (!state.usage) {
		line = "GLM quota …";
	} else {
		line = footerSegments(state.usage, Date.now())
			.map((s) => theme.fg(s.color, s.text))
			.join("");
		ctx.ui.setStatus(STATUS_KEY, line);
		return;
	}
	ctx.ui.setStatus(STATUS_KEY, theme.fg(color, line));
}

async function fetchUsage(state: State): Promise<ZaiUsage | undefined> {
	const ctx = state.ctx;
	const providerId = state.providerId;
	if (!ctx || !providerId) return undefined;
	const entry = readStoredCredential(providerId, piAuthPath()) as { key?: string } | undefined;
	if (!entry?.key) throw new Error(`Missing ${providerId} API key in Pi auth`);
	const provider = providerFor(providerId)!;
	const response = await fetch(provider.usageUrl, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${entry.key}`,
			"User-Agent": "pi-subbar/0.1.0",
		},
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	const body = await response.json();
	return parseZaiUsage(body);
}

/** Fetch con dedup (in-flight + TTL) y guard de generación para sesiones reemplazadas. */
async function refreshUsage(state: State, force: boolean): Promise<ZaiUsage | undefined> {
	const ctx = state.ctx;
	if (!ctx || !state.providerId) {
		renderFooter(state);
		return undefined;
	}
	if (!force && state.usage && !state.error && Date.now() - state.lastFetchAt < REFRESH_TTL_MS) return state.usage;
	if (state.inFlight) return state.inFlight;
	const generation = state.generation;
	renderFooter(state);
	state.inFlight = fetchUsage(state)
		.then((usage) => {
			if (state.generation !== generation) return usage;
			state.usage = usage;
			state.error = undefined;
			state.lastFetchAt = Date.now();
			renderFooter(state);
			return usage;
		})
		.catch((error: unknown) => {
			if (isStaleCtxError(error)) {
				selfDisarm(state);
				return undefined;
			}
			if (state.generation !== generation) return undefined;
			state.error = error instanceof Error ? error.message : String(error);
			renderFooter(state);
			return undefined;
		})
		.finally(() => {
			if (state.generation === generation) state.inFlight = undefined;
		});
	return state.inFlight;
}

function deferRefresh(state: State, force: boolean): void {
	refreshUsage(state, force).catch((error: unknown) => {
		if (isStaleCtxError(error)) selfDisarm(state);
	});
}

/** Debounce post-turno: no fetchear en cada mensaje de una ráfaga. */
function scheduleRefresh(state: State): void {
	if (!state.ctx || !state.providerId) return;
	if (state.debounceTimer) return;
	state.debounceTimer = setTimeout(() => {
		state.debounceTimer = undefined;
		deferRefresh(state, false);
	}, REFRESH_DEBOUNCE_MS);
}

function applyModel(state: State, model: { provider?: string } | undefined): void {
	const nextId = model?.provider;
	if (state.providerId !== nextId) {
		state.providerId = nextId;
		state.usage = undefined;
		state.error = undefined;
		state.lastFetchAt = 0;
		state.inFlight = undefined;
		state.generation++;
	}
	if (!nextId || !providerFor(nextId)) {
		// Provider no soportado: ocultar el footer.
		state.ctx?.ui.setStatus(STATUS_KEY, undefined);
	}
	renderFooter(state);
}

function startTimers(state: State): void {
	if (state.fetchTimer || !state.providerId || !providerFor(state.providerId)) return;
	state.fetchTimer = setInterval(() => deferRefresh(state, false), FETCH_INTERVAL_MS);
	// Countdown ↻ refrescado desde los datos cacheados, sin fetch.
	state.renderTimer = setInterval(() => {
		if (state.usage) renderFooter(state);
	}, COUNTDOWN_RENDER_MS);
}

export default function subbar(pi: ExtensionAPI): void {
	const state: State = { lastFetchAt: 0, generation: 0 };

	pi.on("session_start", async (_event, ctx) => {
		// Solo session_start instala state.ctx (startup/new/fork/switch/reload).
		state.ctx = ctx;
		applyModel(state, ctx.model);
		if (providerFor(state.providerId ?? "")) {
			startTimers(state);
			deferRefresh(state, true);
		}
	});

	pi.on("model_select", async (event, _ctx) => {
		applyModel(state, event.model);
		if (providerFor(state.providerId ?? "")) {
			startTimers(state);
			deferRefresh(state, true);
		}
	});

	pi.on("message_end", async (_event, _ctx) => {
		scheduleRefresh(state);
	});

	pi.on("after_provider_response", async (event, _ctx) => {
		if (event.status >= 400) scheduleRefresh(state); // 429/5xx: la cuota pudo cambiar
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		if (state.ctx !== ctx) return; // shutdown tardío de sesión vieja
		stopTimers(state);
		state.inFlight = undefined;
		state.generation++;
		ctx.ui.setStatus(STATUS_KEY, undefined);
		state.ctx = undefined;
	});

	pi.registerCommand("sub", {
		description: "Z.ai/GLM quota: bar footer + table (use /sub refresh to force fetch).",
		getArgumentCompletions: (prefix) => {
			const items = ["refresh"]
				.filter((k) => k.startsWith(String(prefix || "").trim().toLowerCase()))
				.map((k) => ({ value: k, label: k, description: "force refresh" }));
			return items.length > 0 ? items : null;
		},
		handler: async (args, _ctx) => {
			try {
				const force = args.trim().toLowerCase() === "refresh";
				const usage = await refreshUsage(state, force || !state.usage);
				const current = usage ?? state.usage;
				const lines = current
					? subLines(current, Date.now())
					: [`subbar: ${state.error ?? "no data (provider no zai?)"}`];
				pi.sendMessage({ customType: MESSAGE_TYPE, content: lines.join("\n"), display: true });
				if (force && state.ctx?.ui.notify) state.ctx.ui.notify("Z.ai quota refreshed", "info");
			} catch (error) {
				if (!isStaleCtxError(error)) throw error;
				selfDisarm(state);
			}
		},
	});

	pi.registerMessageRenderer?.(MESSAGE_TYPE, (message, _opts, theme) => {
		try {
			const fg = theme?.fg ? (c: never, s: string) => theme.fg(c, s) : (_c: never, s: string) => s;
			const body = (typeof message.content === "string" ? message.content : "").split("\n");
			const clamp = (line: string, width: number) => {
				if (width <= 0 || [...line].length <= width) return line;
				const chars = [...line];
				return chars.slice(0, Math.max(0, width - 1)).join("") + "…";
			};
			return {
				render: (width: number) =>
					body.map((l) => clamp(l, width)).map((line) => fg("customMessageText", line)),
				invalidate: () => {},
			};
		} catch {
			return undefined;
		}
	});
}
