import { createHash } from "node:crypto";
import { STRATEGY_CATALOG } from "./strategies/catalog";
import type { LoadedStrategyDefinition, StrategyManifest, StrategyType } from "./strategies/types";

function hashStrategy(manifest: StrategyManifest): string {
  const preimage = JSON.stringify({
    strategyId: manifest.strategyId,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    promptTemplate: manifest.promptTemplate,
    supportedSymbols: manifest.supportedSymbols,
    supportedMarketTypes: manifest.supportedMarketTypes,
    requestedExecutionModes: manifest.requestedExecutionModes,
    okxCapabilities: manifest.okxCapabilities,
  });

  return createHash("sha256").update(preimage).digest("hex");
}

export function listAvailableStrategies(): LoadedStrategyDefinition[] {
  return STRATEGY_CATALOG.map((manifest) => ({
    ...manifest,
    strategyVersionHash: hashStrategy(manifest),
  }));
}

export function loadStrategyDefinition(strategyId: StrategyType | string): LoadedStrategyDefinition {
  const strategy = listAvailableStrategies().find((item) => item.strategyId === strategyId);
  if (!strategy) {
    throw new Error(`Unknown strategy: ${strategyId}`);
  }
  return strategy;
}
