import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateDecision, recommendLicenseLevel, type DecisionEvaluation, type LicenseRecommendation } from "./evaluator";
import type { EvaluationInput } from "./payload";
import type { ExecutionMode, LicenseLevel } from "./types";

export interface AgentRecord {
  agentId: string;
  name: string;
  promptHash: string;
  policyHash: string;
  strategyId?: string;
  strategyVersionHash?: string;
  status: "active" | "inactive";
  updatedAt: string;
}

export interface CommitmentStateRecord {
  commitmentId: string;
  agentId: string;
  strategyId?: string;
  strategyVersionHash?: string;
  commitmentHash: string;
  symbol: string;
  side: EvaluationInput["payload"]["decision"]["side"];
  intentType: EvaluationInput["payload"]["decision"]["intent_type"];
  createdAt: string;
  expiresAt: string;
  commitmentVerified: boolean;
  evaluationId: string;
}

export interface AttestationRecord {
  attestationId: string;
  agentId: string;
  strategyId?: string;
  strategyVersionHash?: string;
  windowType: string;
  validShadowTradeCount: number;
  averagePolicyComplianceBps: number;
  rollingMaxDrawdownBps: number;
  averageRiskAdjustedScore: number;
  warningCountLast5: number;
  failCountLast5: number;
  recommendedLevel: LicenseLevel;
  allowedExecutionModes: ExecutionMode[];
  reason: string;
  issuedAt: string;
}

export interface LicenseStateRecord {
  agentId: string;
  strategyId?: string;
  strategyVersionHash?: string;
  currentLevel: LicenseLevel;
  allowedExecutionModes: ExecutionMode[];
  active: boolean;
  revoked: boolean;
  pendingPromotionTo?: LicenseLevel;
  pendingPromotionReason?: string;
  updatedAt: string;
  lastEvaluationId: string;
  lastAttestationId: string;
  reason: string;
}

export interface PersistOptions {
  currentLevel?: LicenseLevel;
  priorEvaluations?: DecisionEvaluation[];
  dataDir?: string;
  agentName?: string;
}

export interface PersistResult {
  evaluation: DecisionEvaluation;
  recommendation: LicenseRecommendation;
  agent: AgentRecord;
  commitment: CommitmentStateRecord;
  attestation: AttestationRecord;
  license: LicenseStateRecord;
  dataDir: string;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function allowedExecutionModesForLevel(level: LicenseLevel): ExecutionMode[] {
  return level === "L3" ? ["algo", "bot"] : [];
}

function buildAgentRecord(input: EvaluationInput, updatedAt: string, agentName?: string): AgentRecord {
  return {
    agentId: input.payload.agent_id,
    name: agentName ?? input.payload.agent_id,
    promptHash: input.payload.policy_ref.prompt_hash,
    policyHash: input.payload.policy_ref.policy_hash,
    ...(input.payload.strategy_ref
      ? {
          strategyId: input.payload.strategy_ref.strategy_id,
          strategyVersionHash: input.payload.strategy_ref.strategy_version_hash,
        }
      : {}),
    status: "active",
    updatedAt,
  };
}

function buildCommitmentRecord(
  input: EvaluationInput,
  evaluation: DecisionEvaluation,
): CommitmentStateRecord {
  return {
    commitmentId: input.commitment.commitment_id,
    agentId: input.payload.agent_id,
    ...(input.payload.strategy_ref
      ? {
          strategyId: input.payload.strategy_ref.strategy_id,
          strategyVersionHash: input.payload.strategy_ref.strategy_version_hash,
        }
      : {}),
    commitmentHash: input.commitment.commitment_hash,
    symbol: input.payload.market_context.symbol,
    side: input.payload.decision.side,
    intentType: input.payload.decision.intent_type,
    createdAt: input.commitment.created_at,
    expiresAt: input.commitment.expires_at,
    commitmentVerified: evaluation.commitmentVerified,
    evaluationId: evaluation.evaluationId,
  };
}

function buildAttestationRecord(
  input: EvaluationInput,
  recommendation: LicenseRecommendation,
  issuedAt: string,
): AttestationRecord {
  return {
    attestationId: `att_${input.payload.decision_id}`,
    agentId: input.payload.agent_id,
    ...(input.payload.strategy_ref
      ? {
          strategyId: input.payload.strategy_ref.strategy_id,
          strategyVersionHash: input.payload.strategy_ref.strategy_version_hash,
        }
      : {}),
    windowType: "rolling_shadow_decisions",
    validShadowTradeCount: recommendation.summary.validShadowTradeCount,
    averagePolicyComplianceBps: recommendation.summary.averagePolicyComplianceBps,
    rollingMaxDrawdownBps: recommendation.summary.rollingMaxDrawdownBps,
    averageRiskAdjustedScore: recommendation.summary.averageRiskAdjustedScore,
    warningCountLast5: recommendation.summary.warningsInLastFive,
    failCountLast5: recommendation.summary.failsInLastFive,
    recommendedLevel: recommendation.recommendedLevel,
    allowedExecutionModes: recommendation.allowedExecutionModes,
    reason: recommendation.reason,
    issuedAt,
  };
}

function buildLicenseRecord(
  currentLevel: LicenseLevel,
  agentId: string,
  evaluationId: string,
  attestationId: string,
  recommendation: LicenseRecommendation,
  updatedAt: string,
  input: EvaluationInput,
): LicenseStateRecord {
  if (currentLevel === "L2" && recommendation.action === "upgrade" && recommendation.recommendedLevel === "L3") {
    return {
      agentId,
      ...(input.payload.strategy_ref
        ? {
            strategyId: input.payload.strategy_ref.strategy_id,
            strategyVersionHash: input.payload.strategy_ref.strategy_version_hash,
          }
        : {}),
      currentLevel,
      allowedExecutionModes: allowedExecutionModesForLevel(currentLevel),
      active: true,
      revoked: false,
      pendingPromotionTo: recommendation.recommendedLevel,
      pendingPromotionReason: recommendation.reason,
      updatedAt,
      lastEvaluationId: evaluationId,
      lastAttestationId: attestationId,
      reason: "quantitative gate passed; awaiting auditor review and license board decision",
    };
  }

  return {
    agentId,
    ...(input.payload.strategy_ref
      ? {
          strategyId: input.payload.strategy_ref.strategy_id,
          strategyVersionHash: input.payload.strategy_ref.strategy_version_hash,
        }
      : {}),
    currentLevel: recommendation.recommendedLevel,
    allowedExecutionModes: recommendation.allowedExecutionModes,
    active: recommendation.action !== "revoke",
    revoked: recommendation.action === "revoke",
    updatedAt,
    lastEvaluationId: evaluationId,
    lastAttestationId: attestationId,
    reason: recommendation.reason,
  };
}

async function resolveCurrentLevel(
  agentId: string,
  dataDir: string,
  requestedLevel?: LicenseLevel,
): Promise<LicenseLevel> {
  if (requestedLevel) {
    return requestedLevel;
  }

  try {
    const existing = await readJsonFile<LicenseStateRecord>(path.join(dataDir, "licenses", `${agentId}.json`));
    return existing.currentLevel;
  } catch {
    return "L2";
  }
}

export async function evaluateAndPersist(
  input: EvaluationInput,
  options: PersistOptions = {},
): Promise<PersistResult> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const currentLevel = await resolveCurrentLevel(input.payload.agent_id, dataDir, options.currentLevel);
  const priorEvaluations = options.priorEvaluations ?? [];
  const evaluation = evaluateDecision(input, currentLevel);
  const recommendation = recommendLicenseLevel(currentLevel, [...priorEvaluations, evaluation]);
  const updatedAt = new Date().toISOString();

  const agent = buildAgentRecord(input, updatedAt, options.agentName);
  const commitment = buildCommitmentRecord(input, evaluation);
  const attestation = buildAttestationRecord(input, recommendation, updatedAt);
  const license = buildLicenseRecord(
    currentLevel,
    input.payload.agent_id,
    evaluation.evaluationId,
    attestation.attestationId,
    recommendation,
    updatedAt,
    input,
  );

  await Promise.all([
    writeJsonFile(path.join(dataDir, "agents", `${agent.agentId}.json`), agent),
    writeJsonFile(path.join(dataDir, "commitments", `${commitment.commitmentId}.json`), commitment),
    writeJsonFile(path.join(dataDir, "attestations", `${attestation.attestationId}.json`), attestation),
    writeJsonFile(path.join(dataDir, "licenses", `${license.agentId}.json`), license),
  ]);

  return {
    evaluation,
    recommendation,
    agent,
    commitment,
    attestation,
    license,
    dataDir,
  };
}
