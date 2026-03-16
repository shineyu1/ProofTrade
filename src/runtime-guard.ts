import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvaluationInput } from "./payload";
import { ensureOkxProfile, readOkxLiveLastPrice, type CommandRunner } from "./okx-provider";
import type { LicenseStateRecord } from "./state";
import type { LicenseLevel } from "./types";

export type RuntimeGuardAction = "keep" | "downgrade" | "revoke";

export interface RuntimeGuardThresholds {
  maxDrawdownBps: number;
  hardRevokeDrawdownBps: number;
}

export interface RuntimeGuardReport {
  report_version: string;
  report_id: string;
  agent_id: string;
  decision_id: string;
  previous_level: LicenseLevel;
  final_level: LicenseLevel;
  guard_action: RuntimeGuardAction;
  trigger_code: string;
  symbol: string;
  entry_price: number;
  current_price: number;
  observed_drawdown_bps: number;
  max_drawdown_bps: number;
  hard_revoke_drawdown_bps: number;
  observation_source: string;
  rationale: string;
  issued_at: string;
}

export interface ApplyRuntimeGuardOptions {
  dataDir?: string;
  currentPrice?: number;
  maxDrawdownBps?: number;
  hardRevokeDrawdownBps?: number;
  observationSource?: string;
  profile?: string;
  runner?: CommandRunner;
  okxHomeDir?: string;
}

const DEFAULT_THRESHOLDS: RuntimeGuardThresholds = {
  maxDrawdownBps: 150,
  hardRevokeDrawdownBps: 500,
};

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function adverseMoveBps(input: EvaluationInput, currentPrice: number): number {
  const entryPrice = input.payload.market_context.last_price;
  const intent = input.payload.decision.intent_type;
  const side = input.payload.decision.side;

  if (intent === "no_trade" || side === "no_trade") {
    return 0;
  }

  const directionMultiplier =
    intent === "long" || side === "buy"
      ? 1
      : -1;

  const moveBps = ((currentPrice - entryPrice) / entryPrice) * 10_000 * directionMultiplier;
  return moveBps >= 0 ? 0 : Math.round(Math.abs(moveBps));
}

function outcomeForDrawdown(
  drawdownBps: number,
  thresholds: RuntimeGuardThresholds,
): Pick<RuntimeGuardReport, "final_level" | "guard_action" | "trigger_code" | "rationale"> {
  if (drawdownBps >= thresholds.hardRevokeDrawdownBps) {
    return {
      final_level: "L1",
      guard_action: "revoke",
      trigger_code: "RUNTIME_DRAWDOWN_HARD_STOP",
      rationale: "Runtime guard revoked protected execution after drawdown breached the hard stop threshold.",
    };
  }

  if (drawdownBps >= thresholds.maxDrawdownBps) {
    return {
      final_level: "L2",
      guard_action: "downgrade",
      trigger_code: "RUNTIME_DRAWDOWN_LIMIT",
      rationale: "Runtime guard downgraded the agent to shadow mode after drawdown breached the allowed threshold.",
    };
  }

  return {
    final_level: "L3",
    guard_action: "keep",
    trigger_code: "RUNTIME_GUARD_CLEAR",
    rationale: "Runtime guard observed no drawdown breach. Protected execution remains enabled.",
  };
}

export async function applyRuntimeGuard(
  input: EvaluationInput,
  options: ApplyRuntimeGuardOptions,
): Promise<{ report: RuntimeGuardReport; license: LicenseStateRecord; action: RuntimeGuardAction; finalLevel: LicenseLevel }> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const thresholds: RuntimeGuardThresholds = {
    maxDrawdownBps: options.maxDrawdownBps ?? DEFAULT_THRESHOLDS.maxDrawdownBps,
    hardRevokeDrawdownBps: options.hardRevokeDrawdownBps ?? DEFAULT_THRESHOLDS.hardRevokeDrawdownBps,
  };
  const issuedAt = new Date().toISOString();
  const licensePath = path.join(dataDir, "licenses", `${input.payload.agent_id}.json`);
  const license = await readJson<LicenseStateRecord>(licensePath);
  let currentPrice = options.currentPrice;
  if ((!Number.isFinite(currentPrice) || currentPrice === undefined || currentPrice <= 0) && (options.profile || options.runner)) {
    if (!options.runner) {
      await ensureOkxProfile({
        ...(options.profile ? { profile: options.profile } : {}),
        ...(options.okxHomeDir ? { okxHomeDir: options.okxHomeDir } : {}),
      });
    }
    currentPrice = await readOkxLiveLastPrice(input.payload.market_context.symbol, {
      ...(options.runner ? { runner: options.runner } : {}),
    });
  }

  if (!Number.isFinite(currentPrice) || currentPrice === undefined || currentPrice <= 0) {
    throw new Error("Runtime guard requires a positive currentPrice or a live OKX profile/runner.");
  }

  const drawdownBps = adverseMoveBps(input, currentPrice);
  const outcome = outcomeForDrawdown(drawdownBps, thresholds);

  const report: RuntimeGuardReport = {
    report_version: "1.0.0",
    report_id: `revocation_${input.payload.agent_id}_${Date.parse(issuedAt)}`,
    agent_id: input.payload.agent_id,
    decision_id: input.payload.decision_id,
    previous_level: license.currentLevel,
    final_level: outcome.final_level,
    guard_action: outcome.guard_action,
    trigger_code: outcome.trigger_code,
    symbol: input.payload.market_context.symbol,
    entry_price: input.payload.market_context.last_price,
    current_price: currentPrice,
    observed_drawdown_bps: drawdownBps,
    max_drawdown_bps: thresholds.maxDrawdownBps,
    hard_revoke_drawdown_bps: thresholds.hardRevokeDrawdownBps,
    observation_source: options.observationSource ?? (options.profile || options.runner ? "okx_live_ticker" : "manual_snapshot"),
    rationale: outcome.rationale,
    issued_at: issuedAt,
  };

  const updatedLicense: LicenseStateRecord = {
    ...license,
    currentLevel: outcome.final_level,
    allowedExecutionModes: outcome.final_level === "L3" ? ["algo", "bot"] : [],
    active: outcome.guard_action !== "revoke",
    revoked: outcome.guard_action === "revoke",
    updatedAt: issuedAt,
    reason: outcome.rationale,
  };
  delete updatedLicense.pendingPromotionTo;
  delete updatedLicense.pendingPromotionReason;

  await writeJson(path.join(dataDir, "revocations", `${input.payload.agent_id}.json`), report);
  await writeJson(licensePath, updatedLicense);

  return {
    report,
    license: updatedLicense,
    action: outcome.guard_action,
    finalLevel: outcome.final_level,
  };
}
