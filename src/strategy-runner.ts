import type { StrategyContext } from "./strategy-context";
import { z } from "zod";
import { runStructuredLlmTask, type LlmTaskExecutionOptions } from "./llm-command-adapter";
import type { LoadedStrategyDefinition, StrategyDecisionOutput } from "./strategies/types";

function buildNoTradeDecision(strategy: LoadedStrategyDefinition, rationale: string): StrategyDecisionOutput {
  return {
    strategyId: strategy.strategyId,
    strategyVersion: strategy.version,
    strategyVersionHash: strategy.strategyVersionHash,
    requestedExecutionMode: "no_trade",
    strategyRationale: rationale,
    decision: {
      intentType: "no_trade",
      side: "no_trade",
      sizeRule: {
        mode: "percent_balance",
        value: 0.5,
      },
      entryCondition: "skip_trade",
      stopLossRule: {
        mode: "none",
        value: 0,
      },
      takeProfitRule: {
        mode: "none",
        value: 0,
      },
      timeHorizon: "1h",
      confidenceScore: 0.2,
      noTradeAllowed: true,
    },
  };
}

function calculateSpreadBps(context: StrategyContext): number | undefined {
  const bid = context.marketSnapshot.bid_price;
  const ask = context.marketSnapshot.ask_price;
  const last = context.marketSnapshot.last_price;

  if (!bid || !ask || !last || ask <= bid) {
    return undefined;
  }

  return Number((((ask - bid) / last) * 10_000).toFixed(2));
}

function buildContextGatingDecision(
  strategy: LoadedStrategyDefinition,
  context: StrategyContext,
): StrategyDecisionOutput | undefined {
  const spreadBps = calculateSpreadBps(context);
  const change24hPct = context.marketSnapshot.change_24h_pct;
  const totalEquity = context.portfolioSnapshot.total_equity;
  const availableBalance = context.portfolioSnapshot.available_balance;
  const unrealizedPnl = context.portfolioSnapshot.unrealized_pnl;
  const openPositions = context.portfolioSnapshot.current_positions.length;

  if (spreadBps !== undefined && spreadBps > 25) {
    return buildNoTradeDecision(
      strategy,
      `Spread too wide for protected execution (${spreadBps} bps).`,
    );
  }

  if (change24hPct !== undefined && Math.abs(change24hPct) > 8) {
    return buildNoTradeDecision(
      strategy,
      `24h move is too extended for this guarded strategy (${change24hPct}%).`,
    );
  }

  if (
    totalEquity !== undefined &&
    totalEquity > 0 &&
    Number((availableBalance / totalEquity).toFixed(4)) < 0.1
  ) {
    return buildNoTradeDecision(
      strategy,
      "Available balance is too constrained relative to total equity for a fresh protected entry.",
    );
  }

  if (openPositions > 0 && unrealizedPnl !== undefined && unrealizedPnl < -25) {
    return buildNoTradeDecision(
      strategy,
      `Existing open exposure is already under stress (UPL ${unrealizedPnl}).`,
    );
  }

  return undefined;
}

const StrategyDecisionSchema = z.object({
  requestedExecutionMode: z.enum(["algo", "bot", "no_trade"]),
  strategyRationale: z.string().min(1),
  decision: z.object({
    intentType: z.enum(["long", "short", "hedge", "reduce", "no_trade"]),
    side: z.enum(["buy", "sell", "hedge", "reduce", "no_trade"]),
    sizeRule: z.object({
      mode: z.enum(["percent_balance", "fixed_notional"]),
      value: z.number().positive(),
    }),
    entryCondition: z.string().min(1),
    stopLossRule: z.object({
      mode: z.enum(["percent", "rr_multiple", "none"]),
      value: z.number().nonnegative(),
    }),
    takeProfitRule: z.object({
      mode: z.enum(["percent", "rr_multiple", "none"]),
      value: z.number().nonnegative(),
    }),
    timeHorizon: z.string().min(1),
    confidenceScore: z.number().min(0).max(1),
    noTradeAllowed: z.boolean(),
  }),
});

async function runPromptStrategyDecision(
  strategy: LoadedStrategyDefinition,
  context: StrategyContext,
  llm?: LlmTaskExecutionOptions,
): Promise<StrategyDecisionOutput | undefined> {
  const result = await runStructuredLlmTask(
    {
      task: "strategy",
      systemPrompt: [
        strategy.promptTemplate,
        `Supported symbols: ${strategy.supportedSymbols.join(", ")}`,
        `Supported market types: ${strategy.supportedMarketTypes.join(", ")}`,
        `Allowed requested execution modes: ${strategy.requestedExecutionModes.join(", ")}`,
        "Return only one structured shadow decision.",
        "Do not emit raw execution commands.",
        "Prefer no_trade if confidence is low or the symbol is unsupported.",
      ].join("\n"),
      input: context,
    },
    StrategyDecisionSchema,
    llm,
  );

  if (!result) {
    return undefined;
  }

  return {
    strategyId: strategy.strategyId,
    strategyVersion: strategy.version,
    strategyVersionHash: strategy.strategyVersionHash,
    requestedExecutionMode: strategy.requestedExecutionModes.includes(result.output.requestedExecutionMode)
      ? result.output.requestedExecutionMode
      : "no_trade",
    strategyRationale: result.output.strategyRationale,
    decision: result.output.decision,
  };
}

function runDeterministicStrategyDecision(
  strategy: LoadedStrategyDefinition,
  context: StrategyContext,
): StrategyDecisionOutput {
  if (
    !strategy.supportedSymbols.includes(context.marketSnapshot.symbol) ||
    !strategy.supportedMarketTypes.includes(context.marketSnapshot.market_type)
  ) {
    return buildNoTradeDecision(strategy, "Unsupported symbol or market type for the selected strategy.");
  }

  if (context.portfolioSnapshot.available_balance <= 0) {
    return buildNoTradeDecision(strategy, "No available balance for protected execution.");
  }

  const gatedDecision = buildContextGatingDecision(strategy, context);
  if (gatedDecision) {
    return gatedDecision;
  }

  const spreadBps = calculateSpreadBps(context);
  const change24hPct = context.marketSnapshot.change_24h_pct;
  const totalEquity = context.portfolioSnapshot.total_equity;
  const unrealizedPnl = context.portfolioSnapshot.unrealized_pnl;
  const openPositions = context.portfolioSnapshot.current_positions.length;
  const baseSizePct = strategy.strategyId === "event-driven-spot-algo" ? 3 : 5;
  const adjustedSizePct =
    spreadBps !== undefined && spreadBps > 10
      ? Number((baseSizePct * 0.75).toFixed(2))
      : baseSizePct;
  const confidence =
    change24hPct !== undefined && Math.abs(change24hPct) > 4
      ? 0.63
      : strategy.strategyId === "event-driven-spot-algo"
        ? 0.66
        : 0.71;
  const contextSignals = [
    spreadBps !== undefined ? `spread=${spreadBps}bps` : undefined,
    change24hPct !== undefined ? `change24h=${change24hPct}%` : undefined,
    totalEquity !== undefined ? `totalEq=${totalEquity}` : undefined,
    unrealizedPnl !== undefined ? `upl=${unrealizedPnl}` : undefined,
    `positions=${openPositions}`,
  ]
    .filter((item): item is string => Boolean(item))
    .join(", ");

  if (strategy.strategyId === "event-driven-spot-algo") {
    return {
      strategyId: strategy.strategyId,
      strategyVersion: strategy.version,
      strategyVersionHash: strategy.strategyVersionHash,
      requestedExecutionMode: "algo",
      strategyRationale: `Event-driven strategy prefers guarded spot algo execution under the current OKX context (${contextSignals}).`,
      decision: {
        intentType: "long",
        side: "buy",
        sizeRule: {
          mode: "percent_balance",
          value: adjustedSizePct,
        },
        entryCondition: "event_confirmed_market_now",
        stopLossRule: {
          mode: "percent",
          value: 1.2,
        },
        takeProfitRule: {
          mode: "percent",
          value: 1.8,
        },
        timeHorizon: "2h",
        confidenceScore: confidence,
        noTradeAllowed: true,
      },
    };
  }

  return {
    strategyId: strategy.strategyId,
    strategyVersion: strategy.version,
    strategyVersionHash: strategy.strategyVersionHash,
    requestedExecutionMode: "algo",
    strategyRationale: `Momentum strategy identified a protected long setup under the current OKX spot context (${contextSignals}).`,
    decision: {
      intentType: "long",
      side: "buy",
      sizeRule: {
        mode: "percent_balance",
        value: adjustedSizePct,
      },
      entryCondition: "market_now",
      stopLossRule: {
        mode: "percent",
        value: 1.5,
      },
      takeProfitRule: {
        mode: "percent",
        value: 2,
      },
      timeHorizon: "4h",
      confidenceScore: confidence,
      noTradeAllowed: true,
    },
  };
}

export async function runStrategyDecision(
  strategy: LoadedStrategyDefinition,
  context: StrategyContext,
  options: { llm?: LlmTaskExecutionOptions } = {},
): Promise<StrategyDecisionOutput> {
  const llmOutput = await runPromptStrategyDecision(strategy, context, options.llm);
  return llmOutput ?? runDeterministicStrategyDecision(strategy, context);
}
