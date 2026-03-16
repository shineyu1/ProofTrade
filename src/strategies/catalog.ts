import type { StrategyManifest } from "./types";

export const STRATEGY_CATALOG: StrategyManifest[] = [
  {
    strategyId: "momentum-spot-algo",
    name: "Momentum Spot Algo",
    version: "1.0.0",
    description: "A conservative BTC/ETH momentum strategy that prefers protected spot algo execution.",
    promptTemplate: [
      "You are the Momentum Spot Algo strategy skill.",
      "Read the provided OKX market and portfolio context.",
      "Return one structured shadow decision.",
      "Prefer no_trade when confidence is low or symbol is unsupported.",
      "Never output execution commands; only return a structured shadow decision.",
    ].join("\n"),
    supportedSymbols: ["BTC-USDT", "ETH-USDT"],
    supportedMarketTypes: ["spot"],
    requestedExecutionModes: ["algo", "no_trade"],
    okxCapabilities: ["market", "portfolio", "spot_algo"],
  },
  {
    strategyId: "event-driven-spot-algo",
    name: "Event-Driven Spot Algo",
    version: "1.0.0",
    description: "A guarded event-driven spot strategy intended for protected spot algo execution.",
    promptTemplate: [
      "You are the Event-Driven Spot Algo strategy skill.",
      "Consume the provided OKX context and any event tag or rationale seed.",
      "Prefer protected execution or no_trade; never emit raw market orders.",
      "Return a structured shadow decision only.",
    ].join("\n"),
    supportedSymbols: ["BTC-USDT", "ETH-USDT"],
    supportedMarketTypes: ["spot"],
    requestedExecutionModes: ["algo", "no_trade"],
    okxCapabilities: ["market", "portfolio", "spot_algo"],
  },
];
