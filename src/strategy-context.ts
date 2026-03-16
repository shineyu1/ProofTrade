import { buildCommitmentHash, EvaluationInputSchema, type EvaluationInput, type TrustPolicy } from "./payload";
import {
  createDefaultCommandRunner,
  defaultOkxCommand,
  ensureOkxProfile,
  parseOkxResponse,
  resolveRunnerInvocation,
  type CommandRunner,
} from "./okx-provider";
import type { LoadedStrategyDefinition } from "./strategies/types";

export interface StrategyContext {
  agentId: string;
  strategyId: string;
  marketSnapshot: EvaluationInput["payload"]["market_context"];
  portfolioSnapshot: EvaluationInput["payload"]["portfolio_context"];
  policyProfile: TrustPolicy;
  timestamp: string;
}

export interface OkxContextSyncOptions {
  profile?: string;
  runner?: CommandRunner;
  okxHomeDir?: string;
}

export interface SyncedOkxContext {
  lastPrice: number;
  bidPrice?: number;
  askPrice?: number;
  high24h?: number;
  low24h?: number;
  vol24h?: number;
  change24hPct?: number;
  availableBalance: number;
  totalEquity?: number;
  unrealizedPnl?: number;
  positions: unknown[];
  syncedAt: string;
}

function buildMarketTickerInvocation(instId: string) {
  return {
    command: defaultOkxCommand(),
    args: ["market", "ticker", instId, "--json"],
  };
}

function buildAccountBalanceInvocation(baseCurrency: string, profile?: string) {
  return {
    command: defaultOkxCommand(),
    args: [
      ...(profile ? ["--profile", profile] : []),
      "--demo",
      "--json",
      "account",
      "balance",
      baseCurrency,
    ],
  };
}

function buildAccountPositionsInvocation(symbol: string, profile?: string) {
  return {
    command: defaultOkxCommand(),
    args: [
      ...(profile ? ["--profile", profile] : []),
      "--demo",
      "--json",
      "account",
      "positions",
      "--instId",
      symbol,
    ],
  };
}

function parseLiveLastPrice(response: unknown, symbol: string): number {
  if (Array.isArray(response) && response.length > 0) {
    const first = response[0] as { last?: unknown };
    const last = Number(first.last);
    if (Number.isFinite(last) && last > 0) {
      return last;
    }
  }

  throw new Error(`Unable to read live OKX market price for ${symbol}.`);
}

function parseNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseMarketSnapshot(response: unknown, symbol: string): Omit<SyncedOkxContext, "availableBalance" | "totalEquity" | "unrealizedPnl" | "positions" | "syncedAt"> {
  if (Array.isArray(response) && response.length > 0) {
    const first = response[0] as Record<string, unknown>;
    const lastPrice = parseNumber(first.last);
    if (!lastPrice || lastPrice <= 0) {
      throw new Error(`Unable to read live OKX market price for ${symbol}.`);
    }

    const bidPrice = parseNumber(first.bidPx);
    const askPrice = parseNumber(first.askPx);
    const high24h = parseNumber(first.high24h);
    const low24h = parseNumber(first.low24h);
    const vol24h = parseNumber(first.vol24h);
    const open24h = parseNumber(first.sodUtc0);
    const change24hPct =
      open24h && open24h > 0
        ? Number((((lastPrice - open24h) / open24h) * 100).toFixed(4))
        : undefined;

    return {
      lastPrice,
      ...(bidPrice !== undefined ? { bidPrice } : {}),
      ...(askPrice !== undefined ? { askPrice } : {}),
      ...(high24h !== undefined ? { high24h } : {}),
      ...(low24h !== undefined ? { low24h } : {}),
      ...(vol24h !== undefined ? { vol24h } : {}),
      ...(change24hPct !== undefined ? { change24hPct } : {}),
    };
  }

  throw new Error(`Unable to read live OKX market price for ${symbol}.`);
}

function parseAvailableBalance(response: unknown, baseCurrency: string): number {
  if (Array.isArray(response) && response.length > 0) {
    const first = response[0] as { details?: Array<{ ccy?: unknown; availBal?: unknown; availEq?: unknown }> };
    const detail = first.details?.find((item) => item && item.ccy === baseCurrency);
    if (detail) {
      const available = Number(detail.availBal ?? detail.availEq);
      if (Number.isFinite(available) && available >= 0) {
        return available;
      }
    }
  }

  throw new Error(`Unable to read live OKX available balance for ${baseCurrency}.`);
}

function parseTotalEquity(response: unknown): number | undefined {
  if (Array.isArray(response) && response.length > 0) {
    const first = response[0] as { totalEq?: unknown };
    return parseNumber(first.totalEq);
  }

  return undefined;
}

function parsePositions(response: unknown): unknown[] {
  if (Array.isArray(response)) {
    return response;
  }

  if (response && typeof response === "object" && "data" in response && Array.isArray((response as { data?: unknown[] }).data)) {
    return (response as { data: unknown[] }).data;
  }

  return [];
}

function parseUnrealizedPnl(positions: unknown[]): number | undefined {
  const values = positions
    .map((item) => {
      if (item && typeof item === "object" && "upl" in item) {
        return parseNumber((item as { upl?: unknown }).upl);
      }
      return undefined;
    })
    .filter((value): value is number => value !== undefined);

  if (values.length === 0) {
    return undefined;
  }

  return Number(values.reduce((sum, value) => sum + value, 0).toFixed(8));
}

function buildShiftedExpiry(createdAt: string, windowSec: number): string {
  const created = new Date(createdAt);
  return new Date(created.getTime() + windowSec * 1000).toISOString();
}

async function runInvocation(
  runner: CommandRunner,
  command: string,
  args: string[],
): Promise<unknown> {
  const invocation = resolveRunnerInvocation(command, args);
  const result = await runner(invocation.command, invocation.args);
  return parseOkxResponse(result.stdout);
}

export async function syncInputWithOkxContext(
  input: EvaluationInput,
  options: OkxContextSyncOptions = {},
): Promise<{ input: EvaluationInput; context?: SyncedOkxContext }> {
  if (!options.profile && !options.runner) {
    return { input };
  }

  if (!options.runner) {
    await ensureOkxProfile({
      ...(options.profile ? { profile: options.profile } : {}),
      ...(options.okxHomeDir ? { okxHomeDir: options.okxHomeDir } : {}),
    });
  }

  const runner = options.runner ?? createDefaultCommandRunner();
  const symbol = input.payload.market_context.symbol;
  const baseCurrency = input.payload.portfolio_context.base_currency;

  const [marketResponse, balanceResponse, positionsResponse] = await Promise.all([
    runInvocation(runner, buildMarketTickerInvocation(symbol).command, buildMarketTickerInvocation(symbol).args),
    runInvocation(
      runner,
      buildAccountBalanceInvocation(baseCurrency, options.profile).command,
      buildAccountBalanceInvocation(baseCurrency, options.profile).args,
    ),
    runInvocation(
      runner,
      buildAccountPositionsInvocation(symbol, options.profile).command,
      buildAccountPositionsInvocation(symbol, options.profile).args,
    ),
  ]);

  const positions = parsePositions(positionsResponse);
  const marketSnapshot = parseMarketSnapshot(marketResponse, symbol);
  const totalEquity = parseTotalEquity(balanceResponse);
  const unrealizedPnl = parseUnrealizedPnl(positions);
  const syncedContext: SyncedOkxContext = {
    ...marketSnapshot,
    availableBalance: parseAvailableBalance(balanceResponse, baseCurrency),
    ...(totalEquity !== undefined ? { totalEquity } : {}),
    ...(unrealizedPnl !== undefined ? { unrealizedPnl } : {}),
    positions,
    syncedAt: new Date().toISOString(),
  };

  const updatedPayload = {
    ...input.payload,
    timestamp: syncedContext.syncedAt,
    market_context: {
      ...input.payload.market_context,
      last_price: syncedContext.lastPrice,
      ...(syncedContext.bidPrice ? { bid_price: syncedContext.bidPrice } : {}),
      ...(syncedContext.askPrice ? { ask_price: syncedContext.askPrice } : {}),
      ...(syncedContext.high24h ? { high_24h: syncedContext.high24h } : {}),
      ...(syncedContext.low24h ? { low_24h: syncedContext.low24h } : {}),
      ...(syncedContext.vol24h !== undefined ? { vol_24h: syncedContext.vol24h } : {}),
      ...(syncedContext.change24hPct !== undefined ? { change_24h_pct: syncedContext.change24hPct } : {}),
    },
    portfolio_context: {
      ...input.payload.portfolio_context,
      available_balance: syncedContext.availableBalance,
      ...(syncedContext.totalEquity !== undefined ? { total_equity: syncedContext.totalEquity } : {}),
      ...(syncedContext.unrealizedPnl !== undefined ? { unrealized_pnl: syncedContext.unrealizedPnl } : {}),
      current_positions: syncedContext.positions,
    },
  };

  return {
    context: syncedContext,
    input: EvaluationInputSchema.parse({
      ...input,
      payload: updatedPayload,
      commitment: {
        ...input.commitment,
        created_at: syncedContext.syncedAt,
        expires_at: buildShiftedExpiry(syncedContext.syncedAt, updatedPayload.evaluation.window_sec),
        commitment_hash: buildCommitmentHash(updatedPayload),
      },
    }),
  };
}

export function buildStrategyContextFromInput(
  input: EvaluationInput,
  strategy: LoadedStrategyDefinition,
): StrategyContext {
  return {
    agentId: input.payload.agent_id,
    strategyId: strategy.strategyId,
    marketSnapshot: input.payload.market_context,
    portfolioSnapshot: input.payload.portfolio_context,
    policyProfile: input.policy,
    timestamp: input.payload.timestamp,
  };
}
