import type { ProtectedExecutionRecord } from "./execution";
import type { EvaluationInput } from "./payload";

export interface OkxAlgoDemoRequest {
  skill: "algo";
  environment: "demo";
  payload: {
    instId: string;
    tdMode: "cash";
    side: "buy" | "sell";
    ordType: "oco";
    tpTriggerPxType: "last";
    slTriggerPxType: "last";
    tpOrdPx: string;
    slOrdPx: string;
    sz: string;
  };
}

export interface OkxBotDemoRequest {
  skill: "bot";
  environment: "demo";
  payload: {
    instId: string;
    strategyType: "grid";
    mode: "neutral";
    gridCount: number;
    investmentAmount: string;
    riskTier: "low";
  };
}

export type OkxDemoRequest = OkxAlgoDemoRequest | OkxBotDemoRequest;

function formatSize(input: EvaluationInput): string {
  const { mode, value } = input.payload.decision.size_rule;
  if (mode === "fixed_notional") {
    return value.toFixed(2);
  }

  const notional = (input.payload.portfolio_context.available_balance * value) / 100;
  return notional.toFixed(2);
}

function computeTakeProfitPrice(entryPrice: number, value: number, side: "buy" | "sell"): string {
  const delta = entryPrice * (value / 100);
  return (side === "buy" ? entryPrice - delta : entryPrice + delta).toFixed(2);
}

function computeStopLossPrice(entryPrice: number, value: number, side: "buy" | "sell"): string {
  const delta = entryPrice * (value / 100);
  return (side === "buy" ? entryPrice + delta : entryPrice - delta).toFixed(2);
}

function buildAlgoRequest(
  input: EvaluationInput,
  execution: ProtectedExecutionRecord,
  marketPriceOverride?: number,
): OkxAlgoDemoRequest {
  if (!execution.protection) {
    throw new Error("Algo execution record is missing protection rules.");
  }

  const side = input.payload.decision.side === "sell" ? "sell" : "buy";
  const entryPrice = marketPriceOverride ?? input.payload.market_context.last_price;
  const tpValue = execution.protection.takeProfit.value;
  const slValue = execution.protection.stopLoss.value;

  return {
    skill: "algo",
    environment: "demo",
    payload: {
      instId: execution.symbol,
      tdMode: "cash",
      side,
      ordType: "oco",
      tpTriggerPxType: "last",
      slTriggerPxType: "last",
      tpOrdPx: computeTakeProfitPrice(entryPrice, tpValue, side),
      slOrdPx: computeStopLossPrice(entryPrice, slValue, side),
      sz: formatSize(input),
    },
  };
}

function buildBotRequest(
  input: EvaluationInput,
  execution: ProtectedExecutionRecord,
): OkxBotDemoRequest {
  if (!execution.botConfig) {
    throw new Error("Bot execution record is missing bot configuration.");
  }

  const investmentAmount = input.payload.decision.size_rule.mode === "fixed_notional"
    ? input.payload.decision.size_rule.value
    : (input.payload.portfolio_context.available_balance * execution.botConfig.maxInvestmentPctBalance) / 100;

  return {
    skill: "bot",
    environment: "demo",
    payload: {
      instId: execution.symbol,
      strategyType: execution.botConfig.strategyType,
      mode: "neutral",
      gridCount: execution.botConfig.gridCount,
      investmentAmount: investmentAmount.toFixed(2),
      riskTier: execution.botConfig.riskTier,
    },
  };
}

export function buildOkxDemoRequest(
  input: EvaluationInput,
  execution: ProtectedExecutionRecord,
  options: { marketPriceOverride?: number } = {},
): OkxDemoRequest {
  if (execution.executionMode === "algo") {
    return buildAlgoRequest(input, execution, options.marketPriceOverride);
  }

  return buildBotRequest(input, execution);
}
