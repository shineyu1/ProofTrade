import type { EvaluationInput, ShadowTradePayload } from "./payload";
import type { LoadedStrategyDefinition, StrategyDecisionOutput } from "./strategies/types";

export interface NormalizeStrategyDecisionOptions {
  baseInput: EvaluationInput;
  strategy: LoadedStrategyDefinition;
  output: StrategyDecisionOutput;
  decisionId: string;
  timestamp: string;
}

export function normalizeStrategyDecision(
  options: NormalizeStrategyDecisionOptions,
): ShadowTradePayload {
  const { baseInput, strategy, output, decisionId, timestamp } = options;
  return {
    ...baseInput.payload,
    decision_id: decisionId,
    timestamp,
    strategy_ref: {
      strategy_id: strategy.strategyId,
      strategy_version: strategy.version,
      strategy_version_hash: strategy.strategyVersionHash,
    },
    decision: {
      intent_type: output.decision.intentType,
      side: output.decision.side,
      size_rule: output.decision.sizeRule,
      entry_condition: output.decision.entryCondition,
      stop_loss_rule: output.decision.stopLossRule,
      take_profit_rule: output.decision.takeProfitRule,
      time_horizon: output.decision.timeHorizon,
      confidence_score: output.decision.confidenceScore,
      no_trade_allowed: output.decision.noTradeAllowed,
    },
    rationale: {
      summary: output.strategyRationale,
      rationale_hash: `${strategy.strategyVersionHash.slice(0, 16)}_${decisionId}`,
    },
  };
}
