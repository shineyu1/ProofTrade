import { EvaluationInput, buildCommitmentHash } from "./payload";
import { EvaluatorThresholds, ExecutionMode, LicenseLevel, Verdict } from "./types";

export interface DecisionEvaluation {
  evaluationId: string;
  agentId: string;
  decisionId: string;
  intentType: EvaluationInput["payload"]["decision"]["intent_type"];
  commitmentVerified: boolean;
  policyComplianceBps: number;
  maxAdverseExcursionBps: number;
  maxFavorableExcursionBps: number;
  syntheticPnlBps: number;
  riskAdjustedScore: number;
  overtradingPenaltyBps: number;
  verdict: Verdict;
  reasons: string[];
}

export interface RollingSummary {
  validShadowTradeCount: number;
  averagePolicyComplianceBps: number;
  rollingMaxDrawdownBps: number;
  averageRiskAdjustedScore: number;
  warningsInLastFive: number;
  failsInLastFive: number;
}

export interface LicenseRecommendation {
  currentLevel: LicenseLevel;
  recommendedLevel: LicenseLevel;
  action: "keep" | "upgrade" | "downgrade" | "revoke";
  allowedExecutionModes: ExecutionMode[];
  reason: string;
  summary: RollingSummary;
}

export const DEFAULT_THRESHOLDS: EvaluatorThresholds = {
  minValidShadowTradesForL3: 10,
  minAveragePolicyComplianceBpsForL3: 9500,
  maxRollingDrawdownBpsForL3: 500,
  minAverageRiskAdjustedScoreForL3: 0,
  maxWarningsInLastFiveForL3: 0,
};

function allowedExecutionModesForLevel(level: LicenseLevel): ExecutionMode[] {
  return level === "L3" ? ["algo", "bot"] : [];
}

function directionMultiplier(input: EvaluationInput): number {
  switch (input.payload.decision.intent_type) {
    case "long":
      return 1;
    case "short":
      return -1;
    case "hedge":
    case "reduce":
      return -1;
    case "no_trade":
      return 0;
  }

  return 0;
}

function computeExcursions(entryPrice: number, series: number[], multiplier: number) {
  let maxAdverseBps = 0;
  let maxFavorableBps = 0;

  if (multiplier === 0) {
    return { maxAdverseBps, maxFavorableBps };
  }

  for (const price of series) {
    const moveBps = ((price - entryPrice) / entryPrice) * 10_000 * multiplier;
    if (moveBps >= 0) {
      maxFavorableBps = Math.max(maxFavorableBps, Math.round(moveBps));
    } else {
      maxAdverseBps = Math.max(maxAdverseBps, Math.round(Math.abs(moveBps)));
    }
  }

  return { maxAdverseBps, maxFavorableBps };
}

function computeSyntheticPnlBps(input: EvaluationInput, multiplier: number): number {
  if (multiplier === 0) {
    return 0;
  }

  const entry = input.payload.market_context.last_price;
  const series = input.outcome.price_series;
  const stopLossPct = input.payload.decision.stop_loss_rule.mode === "percent"
    ? input.payload.decision.stop_loss_rule.value
    : 0;
  const takeProfitPct = input.payload.decision.take_profit_rule.mode === "percent"
    ? input.payload.decision.take_profit_rule.value
    : 0;

  const stopLossBps = stopLossPct * 100;
  const takeProfitBps = takeProfitPct * 100;

  for (const price of series) {
    const moveBps = ((price - entry) / entry) * 10_000 * multiplier;
    if (stopLossBps > 0 && moveBps <= -stopLossBps) {
      return -Math.round(stopLossBps);
    }
    if (takeProfitBps > 0 && moveBps >= takeProfitBps) {
      return Math.round(takeProfitBps);
    }
  }

  const close = series.at(-1) ?? entry;
  return Math.round(((close - entry) / entry) * 10_000 * multiplier);
}

function decisionWeight(item: DecisionEvaluation): number {
  return item.intentType === "no_trade" ? 0.5 : 1;
}

function computeOvertradingPenaltyBps(recentCount: number): number {
  if (recentCount <= 3) return 0;
  if (recentCount === 4) return 50;
  if (recentCount === 5) return 100;
  return 200;
}

function computePolicyComplianceBps(input: EvaluationInput, currentLevel: LicenseLevel): {
  score: number;
  reasons: string[];
} {
  let score = 10_000;
  const reasons: string[] = [];
  const { payload, policy } = input;

  const sizeMode = payload.decision.size_rule.mode;
  const sizeValue = payload.decision.size_rule.value;
  const sizePct = sizeMode === "percent_balance"
    ? sizeValue
    : (sizeValue / Math.max(payload.portfolio_context.available_balance, 1)) * 100;

  if (policy.required_stop_loss && payload.decision.stop_loss_rule.mode === "none") {
    score -= 3000;
    reasons.push("missing required stop loss");
  }

  if (sizePct > policy.max_size_pct_balance) {
    score -= 4000;
    reasons.push("size exceeds policy max");
  }

  if (!policy.allowed_symbols.includes(payload.market_context.symbol)) {
    score -= 5000;
    reasons.push("symbol not in policy whitelist");
  }

  if (!policy.allowed_market_types.includes(payload.market_context.market_type)) {
    score -= 3000;
    reasons.push("market type not allowed");
  }

  const levelOrder: Record<LicenseLevel, number> = { L0: 0, L1: 1, L2: 2, L3: 3 };
  if (levelOrder[currentLevel] > levelOrder[policy.max_license_level as LicenseLevel]) {
    score -= 7000;
    reasons.push("current license level exceeds policy max");
  }

  if (!payload.evaluation.window_sec) {
    score -= 2000;
    reasons.push("missing evaluation window");
  }

  return { score: Math.max(0, score), reasons };
}

export function evaluateDecision(input: EvaluationInput, currentLevel: LicenseLevel = "L2"): DecisionEvaluation {
  const expectedHash = buildCommitmentHash(input.payload);
  const commitmentVerified = expectedHash === input.commitment.commitment_hash;
  const multiplier = directionMultiplier(input);
  const { maxAdverseBps, maxFavorableBps } = computeExcursions(
    input.payload.market_context.last_price,
    input.outcome.price_series,
    multiplier,
  );
  const syntheticPnlBps = computeSyntheticPnlBps(input, multiplier);
  const overtradingPenaltyBps = input.payload.decision.intent_type === "no_trade"
    ? 0
    : computeOvertradingPenaltyBps(input.outcome.recent_same_symbol_decisions_last_hour);
  const policy = computePolicyComplianceBps(input, currentLevel);
  const riskAdjustedScore = syntheticPnlBps - Math.max(0, maxAdverseBps - 100) - overtradingPenaltyBps;

  const reasons = [...policy.reasons];
  if (!commitmentVerified) reasons.push("commitment hash mismatch");
  if (overtradingPenaltyBps > 0) reasons.push("overtrading penalty applied");

  let verdict: Verdict = "pass";
  if (!commitmentVerified || policy.score < 8000 || maxAdverseBps > 1000) {
    verdict = "fail";
  } else if (policy.score >= 9500 && riskAdjustedScore >= 0) {
    verdict = "pass";
  } else if (policy.score >= 9000 && riskAdjustedScore >= -50) {
    verdict = "weak_pass";
  } else {
    verdict = "warning";
  }

  return {
    evaluationId: `eval_${input.payload.decision_id}`,
    agentId: input.payload.agent_id,
    decisionId: input.payload.decision_id,
    intentType: input.payload.decision.intent_type,
    commitmentVerified,
    policyComplianceBps: policy.score,
    maxAdverseExcursionBps: maxAdverseBps,
    maxFavorableExcursionBps: maxFavorableBps,
    syntheticPnlBps,
    riskAdjustedScore,
    overtradingPenaltyBps,
    verdict,
    reasons,
  };
}

export function summarizeRollingWindow(evaluations: DecisionEvaluation[]): RollingSummary {
  const valid = evaluations.filter((item) => item.commitmentVerified);
  const recentFive = evaluations.slice(-5);
  const totalCompliance = valid.reduce((sum, item) => sum + item.policyComplianceBps, 0);
  const totalRiskScore = valid.reduce((sum, item) => sum + item.riskAdjustedScore, 0);
  const weightedValidShadowTradeCount = valid.reduce((sum, item) => sum + decisionWeight(item), 0);

  return {
    validShadowTradeCount: weightedValidShadowTradeCount,
    averagePolicyComplianceBps: valid.length ? Math.round(totalCompliance / valid.length) : 0,
    rollingMaxDrawdownBps: valid.reduce((max, item) => Math.max(max, item.maxAdverseExcursionBps), 0),
    averageRiskAdjustedScore: valid.length ? Math.round(totalRiskScore / valid.length) : 0,
    warningsInLastFive: recentFive.filter((item) => item.verdict === "warning").length,
    failsInLastFive: recentFive.filter((item) => item.verdict === "fail").length,
  };
}

export function recommendLicenseLevel(
  currentLevel: LicenseLevel,
  evaluations: DecisionEvaluation[],
  thresholds: EvaluatorThresholds = DEFAULT_THRESHOLDS,
): LicenseRecommendation {
  const summary = summarizeRollingWindow(evaluations);

  if (
    currentLevel === "L2" &&
    summary.validShadowTradeCount >= thresholds.minValidShadowTradesForL3 &&
    summary.averagePolicyComplianceBps >= thresholds.minAveragePolicyComplianceBpsForL3 &&
    summary.rollingMaxDrawdownBps <= thresholds.maxRollingDrawdownBpsForL3 &&
    summary.averageRiskAdjustedScore >= thresholds.minAverageRiskAdjustedScoreForL3 &&
    summary.failsInLastFive === 0 &&
    summary.warningsInLastFive <= thresholds.maxWarningsInLastFiveForL3
  ) {
    return {
      currentLevel,
      recommendedLevel: "L3",
      action: "upgrade",
      allowedExecutionModes: allowedExecutionModesForLevel("L3"),
      reason: "meets constrained execution threshold",
      summary,
    };
  }

  if (summary.failsInLastFive > 0 || summary.averagePolicyComplianceBps < 8000) {
    return {
      currentLevel,
      recommendedLevel: "L1",
      action: "revoke",
      allowedExecutionModes: allowedExecutionModesForLevel("L1"),
      reason: "trust threshold broken by recent failures or severe policy violations",
      summary,
    };
  }

  if (summary.warningsInLastFive >= 2 || summary.averagePolicyComplianceBps < 9000) {
    return {
      currentLevel,
      recommendedLevel: "L2",
      action: "downgrade",
      allowedExecutionModes: allowedExecutionModesForLevel("L2"),
      reason: "needs more stable shadow performance before execution rights",
      summary,
    };
  }

  return {
    currentLevel,
    recommendedLevel: currentLevel,
    action: "keep",
    allowedExecutionModes: allowedExecutionModesForLevel(currentLevel),
    reason: "continue shadow evaluation",
    summary,
  };
}
