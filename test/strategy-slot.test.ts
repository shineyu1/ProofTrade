import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { EvaluationInput } from "../src/payload";

const payloadModule = require("../src/payload.ts");
const stateModule = require("../src/state.ts");
const certificateModule = require("../src/certificate.ts");
const strategyLoaderModule = require("../src/strategy-loader.ts");
const strategyRegistryModule = require("../src/strategy-registry.ts");
const strategyContextModule = require("../src/strategy-context.ts");
const strategyRunnerModule = require("../src/strategy-runner.ts");
const strategyNormalizerModule = require("../src/strategy-normalizer.ts");

const { EvaluationInputSchema, ShadowTradePayloadSchema, buildCommitmentHash } = payloadModule;
const { evaluateAndPersist } = stateModule;
const { generateLicenseCertificate } = certificateModule;
const { listAvailableStrategies, loadStrategyDefinition } = strategyLoaderModule;
const { setActiveStrategyForAgent, getActiveStrategyForAgent } = strategyRegistryModule;
const { buildStrategyContextFromInput } = strategyContextModule;
const { runStrategyDecision } = strategyRunnerModule;
const { normalizeStrategyDecision } = strategyNormalizerModule;

function loadSampleInput(overrides?: Partial<EvaluationInput>): EvaluationInput {
  const fullPath = path.join(process.cwd(), "examples", "sample-evaluation-input.json");
  const raw = JSON.parse(readFileSync(fullPath, "utf8")) as EvaluationInput;
  const mergedWithoutHash: EvaluationInput = {
    ...raw,
    ...overrides,
    payload: {
      ...raw.payload,
      ...overrides?.payload,
    },
    policy: {
      ...raw.policy,
      ...overrides?.policy,
    },
    commitment: {
      ...raw.commitment,
      ...overrides?.commitment,
    },
    outcome: {
      ...raw.outcome,
      ...overrides?.outcome,
    },
  };
  const mergedPayload = ShadowTradePayloadSchema.parse(mergedWithoutHash.payload);
  const commitmentHash = buildCommitmentHash(mergedPayload);

  return EvaluationInputSchema.parse({
    ...mergedWithoutHash,
    commitment: {
      ...mergedWithoutHash.commitment,
      commitment_hash: overrides?.commitment?.commitment_hash ?? commitmentHash,
    },
  });
}

test("listAvailableStrategies returns the white-listed strategy skills with stable hashes", () => {
  const strategies = listAvailableStrategies();
  const momentum = loadStrategyDefinition("momentum-spot-algo");
  const eventDriven = loadStrategyDefinition("event-driven-spot-algo");

  assert.equal(strategies.length, 2);
  assert.ok(strategies.some((item: { strategyId: string }) => item.strategyId === "momentum-spot-algo"));
  assert.ok(strategies.some((item: { strategyId: string }) => item.strategyId === "event-driven-spot-algo"));
  assert.match(momentum.strategyVersionHash, /^[a-f0-9]{64}$/);
  assert.match(eventDriven.strategyVersionHash, /^[a-f0-9]{64}$/);
  assert.equal(loadStrategyDefinition("momentum-spot-algo").strategyVersionHash, momentum.strategyVersionHash);
});

test("setActiveStrategyForAgent persists exactly one active strategy per agent and rejects unknown ids", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-strategy-"));

  try {
    const first = await setActiveStrategyForAgent("prooftrade-agent-001", "momentum-spot-algo", {
      dataDir: tempDir,
    });
    const second = await setActiveStrategyForAgent("prooftrade-agent-001", "event-driven-spot-algo", {
      dataDir: tempDir,
    });
    const persisted = await getActiveStrategyForAgent("prooftrade-agent-001", { dataDir: tempDir });

    assert.equal(first.strategyId, "momentum-spot-algo");
    assert.equal(second.strategyId, "event-driven-spot-algo");
    assert.equal(persisted?.strategyId, "event-driven-spot-algo");
    await assert.rejects(
      setActiveStrategyForAgent("prooftrade-agent-001", "unknown-strategy", { dataDir: tempDir }),
      /Unknown strategy/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runStrategyDecision and normalizeStrategyDecision produce a payload-compatible shadow decision", async () => {
  const input = loadSampleInput();
  const strategy = loadStrategyDefinition("momentum-spot-algo");
  const context = buildStrategyContextFromInput(input, strategy);
  const output = await runStrategyDecision(strategy, context);
  const normalized = normalizeStrategyDecision({
    baseInput: input,
    strategy,
    output,
    decisionId: "dec_strategy_001",
    timestamp: "2026-03-16T08:00:00Z",
  });

  assert.equal(output.strategyId, "momentum-spot-algo");
  assert.equal(output.requestedExecutionMode, "algo");
  assert.equal(normalized.strategy_ref.strategy_id, "momentum-spot-algo");
  assert.equal(normalized.decision.side, "buy");
  assert.equal(normalized.decision.intent_type, "long");
  assert.equal(normalized.market_context.symbol, "BTC-USDT");
});

test("runStrategyDecision uses richer OKX context fields to block unsafe deterministic entries", async () => {
  const strategy = loadStrategyDefinition("momentum-spot-algo");
  const input = loadSampleInput({
    payload: {
      ...loadSampleInput().payload,
      market_context: {
        ...loadSampleInput().payload.market_context,
        bid_price: 70000,
        ask_price: 70250,
        change_24h_pct: 2.3,
      },
      portfolio_context: {
        ...loadSampleInput().payload.portfolio_context,
        total_equity: 1000,
        unrealized_pnl: -40,
        current_positions: [{ instId: "BTC-USDT", pos: "0.02" }],
      },
    },
  });
  const context = buildStrategyContextFromInput(input, strategy);
  const output = await runStrategyDecision(strategy, context);

  assert.equal(output.requestedExecutionMode, "no_trade");
  assert.equal(output.decision.intentType, "no_trade");
  assert.match(output.strategyRationale, /Spread too wide|under stress/);
});

test("evaluateAndPersist and generateLicenseCertificate persist strategy identity into local trust records", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-strategy-"));

  try {
    const strategy = loadStrategyDefinition("momentum-spot-algo");
    const input = loadSampleInput({
      payload: {
        ...loadSampleInput().payload,
        strategy_ref: {
          strategy_id: strategy.strategyId,
          strategy_version: strategy.version,
          strategy_version_hash: strategy.strategyVersionHash,
        },
      },
    });

    await evaluateAndPersist(input, {
      currentLevel: "L2",
      dataDir: tempDir,
    });
    const certificate = await generateLicenseCertificate("prooftrade-agent-001", {
      dataDir: tempDir,
    });

    const licensePath = path.join(tempDir, "licenses", "prooftrade-agent-001.json");
    const agentPath = path.join(tempDir, "agents", "prooftrade-agent-001.json");
    const license = JSON.parse(readFileSync(licensePath, "utf8"));
    const agent = JSON.parse(readFileSync(agentPath, "utf8"));

    assert.equal(agent.strategyId, "momentum-spot-algo");
    assert.equal(license.strategyId, "momentum-spot-algo");
    assert.equal(certificate.strategy_id, "momentum-spot-algo");
    assert.equal(certificate.strategy_version_hash, strategy.strategyVersionHash);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
