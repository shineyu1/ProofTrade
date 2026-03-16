export type StrategyType = "momentum-spot-algo" | "event-driven-spot-algo";

export interface StrategyManifest {
  strategyId: StrategyType;
  name: string;
  version: string;
  description: string;
  promptTemplate: string;
  supportedSymbols: string[];
  supportedMarketTypes: Array<"spot" | "perpetual">;
  requestedExecutionModes: Array<"algo" | "bot" | "no_trade">;
  okxCapabilities: string[];
}

export interface LoadedStrategyDefinition extends StrategyManifest {
  strategyVersionHash: string;
}

export interface StrategyDecisionOutput {
  strategyId: string;
  strategyVersion: string;
  strategyVersionHash: string;
  requestedExecutionMode: "algo" | "bot" | "no_trade";
  strategyRationale: string;
  decision: {
    intentType: "long" | "short" | "hedge" | "reduce" | "no_trade";
    side: "buy" | "sell" | "hedge" | "reduce" | "no_trade";
    sizeRule: {
      mode: "percent_balance" | "fixed_notional";
      value: number;
    };
    entryCondition: string;
    stopLossRule: {
      mode: "percent" | "rr_multiple" | "none";
      value: number;
    };
    takeProfitRule: {
      mode: "percent" | "rr_multiple" | "none";
      value: number;
    };
    timeHorizon: string;
    confidenceScore: number;
    noTradeAllowed: boolean;
  };
}
