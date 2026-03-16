import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadStrategyDefinition } from "./strategy-loader";

export interface StrategyBindingRecord {
  agentId: string;
  strategyId: string;
  strategyVersion: string;
  strategyVersionHash: string;
  active: boolean;
  updatedAt: string;
}

export interface StrategyRegistryOptions {
  dataDir?: string;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function bindingPath(dataDir: string, agentId: string): string {
  return path.join(dataDir, "strategy-bindings", `${agentId}.json`);
}

export async function setActiveStrategyForAgent(
  agentId: string,
  strategyId: string,
  options: StrategyRegistryOptions = {},
): Promise<StrategyBindingRecord> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const strategy = loadStrategyDefinition(strategyId);
  const updatedAt = new Date().toISOString();
  const record: StrategyBindingRecord = {
    agentId,
    strategyId: strategy.strategyId,
    strategyVersion: strategy.version,
    strategyVersionHash: strategy.strategyVersionHash,
    active: true,
    updatedAt,
  };
  await writeJson(bindingPath(dataDir, agentId), record);
  return record;
}

export async function getActiveStrategyForAgent(
  agentId: string,
  options: StrategyRegistryOptions = {},
): Promise<StrategyBindingRecord | undefined> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  try {
    return await readJson<StrategyBindingRecord>(bindingPath(dataDir, agentId));
  } catch {
    return undefined;
  }
}
