import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvaluationInput } from "./payload";
import type { ExecutionMode } from "./types";
import type { LicenseStateRecord } from "./state";

export interface ExecutionOptions {
  mode: ExecutionMode;
  dataDir?: string;
}

export interface AlgoProtection {
  stopLoss: EvaluationInput["payload"]["decision"]["stop_loss_rule"];
  takeProfit: EvaluationInput["payload"]["decision"]["take_profit_rule"];
}

export interface BotConfig {
  strategyType: "grid";
  riskTier: "low";
  maxInvestmentPctBalance: number;
  gridCount: number;
}

export interface ProtectedExecutionRecord {
  executionId: string;
  agentId: string;
  decisionId: string;
  symbol: string;
  executionMode: ExecutionMode;
  okxSkill: "algo" | "bot";
  environment: "demo";
  createdAt: string;
  licenseLevel: LicenseStateRecord["currentLevel"];
  remoteRequestId?: string;
  submissionStatus?: "accepted";
  protection?: AlgoProtection;
  botConfig?: BotConfig;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function loadLicense(agentId: string, dataDir: string): Promise<LicenseStateRecord> {
  const licensePath = path.join(dataDir, "licenses", `${agentId}.json`);
  const raw = await readFile(licensePath, "utf8");
  return JSON.parse(raw) as LicenseStateRecord;
}

function buildExecutionRecord(
  input: EvaluationInput,
  license: LicenseStateRecord,
  mode: ExecutionMode,
): ProtectedExecutionRecord {
  const createdAt = new Date().toISOString();
  const baseRecord: ProtectedExecutionRecord = {
    executionId: `exec_${input.payload.decision_id}_${mode}`,
    agentId: input.payload.agent_id,
    decisionId: input.payload.decision_id,
    symbol: input.payload.market_context.symbol,
    executionMode: mode,
    okxSkill: mode,
    environment: "demo",
    createdAt,
    licenseLevel: license.currentLevel,
  };

  if (mode === "algo") {
    return {
      ...baseRecord,
      protection: {
        stopLoss: input.payload.decision.stop_loss_rule,
        takeProfit: input.payload.decision.take_profit_rule,
      },
    };
  }

  return {
    ...baseRecord,
    botConfig: {
      strategyType: "grid",
      riskTier: "low",
      maxInvestmentPctBalance: Math.min(input.payload.decision.size_rule.value, 5),
      gridCount: 6,
    },
  };
}

function assertExecutionAllowed(
  input: EvaluationInput,
  license: LicenseStateRecord,
  mode: ExecutionMode,
): void {
  if (!license.active || license.revoked) {
    throw new Error(`Agent ${license.agentId} is not active for protected execution.`);
  }

  if (!license.allowedExecutionModes.includes(mode)) {
    throw new Error(`License ${license.currentLevel} does not permit ${mode} execution.`);
  }

  if (input.payload.decision.intent_type === "no_trade") {
    throw new Error("No-trade decisions cannot be executed.");
  }

  if (mode === "algo") {
    if (input.payload.decision.stop_loss_rule.mode === "none") {
      throw new Error("Algo execution requires a stop loss rule.");
    }
    if (input.payload.decision.take_profit_rule.mode === "none") {
      throw new Error("Algo execution requires a take profit rule.");
    }
  }
}

export async function executeProtected(
  input: EvaluationInput,
  options: ExecutionOptions,
): Promise<ProtectedExecutionRecord> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const license = await loadLicense(input.payload.agent_id, dataDir);

  assertExecutionAllowed(input, license, options.mode);

  const record = buildExecutionRecord(input, license, options.mode);
  await writeJsonFile(path.join(dataDir, "executions", `${record.executionId}.json`), record);
  return record;
}
