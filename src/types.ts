export type LicenseLevel = "L0" | "L1" | "L2" | "L3";
export type ExecutionMode = "algo" | "bot";

export type IntentType = "long" | "short" | "hedge" | "reduce" | "no_trade";

export type Side = "buy" | "sell" | "hedge" | "reduce" | "no_trade";

export type Verdict = "pass" | "weak_pass" | "warning" | "fail";

export interface EvaluatorThresholds {
  minValidShadowTradesForL3: number;
  minAveragePolicyComplianceBpsForL3: number;
  maxRollingDrawdownBpsForL3: number;
  minAverageRiskAdjustedScoreForL3: number;
  maxWarningsInLastFiveForL3: number;
}
