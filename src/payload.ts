import { createHash } from "node:crypto";
import { z } from "zod";

export const SizeRuleSchema = z.object({
  mode: z.enum(["percent_balance", "fixed_notional"]),
  value: z.number().positive(),
});

export const ExitRuleSchema = z.object({
  mode: z.enum(["percent", "rr_multiple", "none"]),
  value: z.number().nonnegative(),
});

export const ShadowTradePayloadSchema = z.object({
  schema_version: z.string(),
  agent_id: z.string().min(1),
  decision_id: z.string().min(1),
  timestamp: z.string().datetime(),
  strategy_ref: z.object({
    strategy_id: z.string().min(1),
    strategy_version: z.string().min(1),
    strategy_version_hash: z.string().min(1),
  }).optional(),
  market_context: z.object({
    venue: z.literal("okx-cex"),
    market_type: z.enum(["spot", "perpetual"]),
    symbol: z.string().min(1),
    last_price: z.number().positive(),
    bid_price: z.number().positive().optional(),
    ask_price: z.number().positive().optional(),
    high_24h: z.number().positive().optional(),
    low_24h: z.number().positive().optional(),
    vol_24h: z.number().nonnegative().optional(),
    change_24h_pct: z.number().optional(),
    timeframe: z.string().min(1),
  }),
  portfolio_context: z.object({
    account_mode: z.enum(["demo", "subaccount"]),
    base_currency: z.string().min(1),
    available_balance: z.number().nonnegative(),
    total_equity: z.number().nonnegative().optional(),
    unrealized_pnl: z.number().optional(),
    current_positions: z.array(z.unknown()),
  }),
  decision: z.object({
    intent_type: z.enum(["long", "short", "hedge", "reduce", "no_trade"]),
    side: z.enum(["buy", "sell", "hedge", "reduce", "no_trade"]),
    size_rule: SizeRuleSchema,
    entry_condition: z.string().min(1),
    stop_loss_rule: ExitRuleSchema,
    take_profit_rule: ExitRuleSchema,
    time_horizon: z.string().min(1),
    confidence_score: z.number().min(0).max(1),
    no_trade_allowed: z.boolean(),
  }),
  policy_ref: z.object({
    policy_version: z.string().min(1),
    policy_hash: z.string().min(1),
    prompt_hash: z.string().min(1),
  }),
  rationale: z.object({
    summary: z.string().min(1),
    rationale_hash: z.string().min(1),
  }),
  evaluation: z.object({
    window_sec: z.number().int().positive(),
    success_metric: z.string().min(1),
  }),
});

export type ShadowTradePayload = z.infer<typeof ShadowTradePayloadSchema>;

export const TrustPolicySchema = z.object({
  required_stop_loss: z.boolean().default(true),
  max_size_pct_balance: z.number().positive(),
  allowed_symbols: z.array(z.string().min(1)).min(1),
  allowed_market_types: z.array(z.enum(["spot", "perpetual"])).min(1),
  max_license_level: z.enum(["L0", "L1", "L2", "L3"]),
});

export type TrustPolicy = z.infer<typeof TrustPolicySchema>;

export const CommitmentRecordSchema = z.object({
  commitment_id: z.string().min(1),
  commitment_hash: z.string().min(1),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime(),
});

export type CommitmentRecord = z.infer<typeof CommitmentRecordSchema>;

export const EvaluationInputSchema = z.object({
  payload: ShadowTradePayloadSchema,
  policy: TrustPolicySchema,
  commitment: CommitmentRecordSchema,
  outcome: z.object({
    price_series: z.array(z.number().positive()).min(1),
    recent_same_symbol_decisions_last_hour: z.number().int().nonnegative(),
  }),
});

export type EvaluationInput = z.infer<typeof EvaluationInputSchema>;

export function buildCommitmentHash(payload: ShadowTradePayload): string {
  const preimage = JSON.stringify({
    agent_id: payload.agent_id,
    decision_id: payload.decision_id,
    ...(payload.strategy_ref
      ? {
          strategy_id: payload.strategy_ref.strategy_id,
          strategy_version_hash: payload.strategy_ref.strategy_version_hash,
        }
      : {}),
    symbol: payload.market_context.symbol,
    market_type: payload.market_context.market_type,
    side: payload.decision.side,
    intent_type: payload.decision.intent_type,
    size_rule: payload.decision.size_rule,
    entry_condition: payload.decision.entry_condition,
    stop_loss_rule: payload.decision.stop_loss_rule,
    take_profit_rule: payload.decision.take_profit_rule,
    evaluation_window_sec: payload.evaluation.window_sec,
    policy_hash: payload.policy_ref.policy_hash,
    prompt_hash: payload.policy_ref.prompt_hash,
    rationale_hash: payload.rationale.rationale_hash,
  });

  return createHash("sha256").update(preimage).digest("hex");
}
