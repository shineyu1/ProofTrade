import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { EvaluationInput } from "../src/payload";

const payloadModule = require("../src/payload.ts");
const evaluatorModule = require("../src/evaluator.ts");
const stateModule = require("../src/state.ts");
const auditorModule = require("../src/auditor.ts");
const licenseBoardModule = require("../src/license-board.ts");
const strategyLoaderModule = require("../src/strategy-loader.ts");
const strategyContextModule = require("../src/strategy-context.ts");
const strategyRunnerModule = require("../src/strategy-runner.ts");
const runtimeGuardModule = require("../src/runtime-guard.ts");

const { EvaluationInputSchema, ShadowTradePayloadSchema, buildCommitmentHash } = payloadModule;
const { evaluateDecision } = evaluatorModule;
const { evaluateAndPersist } = stateModule;
const { generateAuditReport } = auditorModule;
const { applyLicenseBoardDecision } = licenseBoardModule;
const { loadStrategyDefinition } = strategyLoaderModule;
const { buildStrategyContextFromInput, syncInputWithOkxContext } = strategyContextModule;
const { runStrategyDecision } = strategyRunnerModule;
const { applyRuntimeGuard } = runtimeGuardModule;

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

function buildHistoricalInput(base: EvaluationInput, decisionId: string): EvaluationInput {
  const payload = {
    ...base.payload,
    decision_id: decisionId,
  };
  const commitment = {
    ...base.commitment,
    commitment_id: `commit_${decisionId}`,
    commitment_hash: buildCommitmentHash(payload),
  };

  return EvaluationInputSchema.parse({
    ...base,
    payload,
    commitment,
  });
}

async function seedApprovedL3Agent(tempDir: string): Promise<void> {
  const baseInput = loadSampleInput();
  const priorEvaluations = Array.from({ length: 9 }, (_, index) =>
    evaluateDecision(buildHistoricalInput(baseInput, `seed_${index}`), "L2"));

  await evaluateAndPersist(loadSampleInput(), {
    currentLevel: "L2",
    priorEvaluations,
    dataDir: tempDir,
  });

  await generateAuditReport("prooftrade-agent-001", {
    dataDir: tempDir,
    auditorAgentId: "auditor-agent-001",
  });
  await applyLicenseBoardDecision("prooftrade-agent-001", { dataDir: tempDir });
}

test("runStrategyDecision supports a prompt-based strategy skill through an injected LLM command", async () => {
  const strategy = loadStrategyDefinition("momentum-spot-algo");
  const context = buildStrategyContextFromInput(loadSampleInput(), strategy);

  const output = await runStrategyDecision(strategy, context, {
    llm: {
      invocation: {
        command: "mock-strategy",
        args: ["--json"],
        providerLabel: "user-openclaw",
      },
      runner: async (_command: string, _args: string[], stdin: string) => {
        const payload = JSON.parse(stdin);
        assert.equal(payload.task, "strategy");
        return {
          stdout: JSON.stringify({
            requestedExecutionMode: "algo",
            strategyRationale: "Prompt-selected protected long setup from user-defined OpenClaw strategy.",
            decision: {
              intentType: "long",
              side: "buy",
              sizeRule: { mode: "percent_balance", value: 4 },
              entryCondition: "llm_market_now",
              stopLossRule: { mode: "percent", value: 1.1 },
              takeProfitRule: { mode: "percent", value: 1.9 },
              timeHorizon: "2h",
              confidenceScore: 0.77,
              noTradeAllowed: true,
            },
          }),
          stderr: "",
          exitCode: 0,
        };
      },
    },
  });

  assert.equal(output.requestedExecutionMode, "algo");
  assert.equal(output.decision.entryCondition, "llm_market_now");
  assert.match(output.strategyRationale, /OpenClaw strategy/);
});

test("generateAuditReport supports an LLM-backed auditor command with deterministic fallback preserved", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-llm-audit-"));

  try {
    const baseInput = loadSampleInput();
    const priorEvaluations = Array.from({ length: 9 }, (_, index) =>
      evaluateDecision(buildHistoricalInput(baseInput, `llm_audit_${index}`), "L2"));

    await evaluateAndPersist(loadSampleInput(), {
      currentLevel: "L2",
      priorEvaluations,
      dataDir: tempDir,
    });

    const report = await generateAuditReport("prooftrade-agent-001", {
      dataDir: tempDir,
      auditorAgentId: "auditor-agent-llm",
      llm: {
        invocation: {
          command: "mock-auditor",
          args: ["--json"],
          providerLabel: "user-openclaw-auditor",
        },
        runner: async (_command: string, _args: string[], stdin: string) => {
          const payload = JSON.parse(stdin);
          assert.equal(payload.task, "auditor");
          return {
            stdout: JSON.stringify({
              recommended_level: "L3",
              audit_verdict: "approved",
              findings: [
                {
                  code: "llm_audit_clear",
                  severity: "info",
                  summary: "Prompt-based auditor found stable behavior across the reviewed shadow window.",
                },
              ],
              rationale: "The prompt-based auditor agrees that protected execution can be unlocked.",
            }),
            stderr: "",
            exitCode: 0,
          };
        },
      },
    });

    assert.equal(report.audit_engine, "llm");
    assert.equal(report.audit_provider, "user-openclaw-auditor");
    assert.equal(report.audit_verdict, "approved");
    assert.equal(report.recommended_level, "L3");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("syncInputWithOkxContext enriches strategy context with thicker live OKX market and portfolio fields", async () => {
  const synced = await syncInputWithOkxContext(loadSampleInput(), {
    profile: "demo",
    runner: async (_command: string, args: string[]) => {
      const joined = args.join(" ");

      if (joined.includes("market ticker BTC-USDT --json")) {
        return {
          stdout: JSON.stringify([
            {
              instId: "BTC-USDT",
              last: "73384.5",
              bidPx: "73380.1",
              askPx: "73389.9",
              high24h: "74200",
              low24h: "72150",
              vol24h: "12894.2",
              sodUtc0: "72800",
            },
          ]),
          stderr: "",
          exitCode: 0,
        };
      }

      if (joined.includes("--profile demo --demo --json account balance USDT")) {
        return {
          stdout: JSON.stringify([
            {
              totalEq: "913.54",
              details: [
                {
                  ccy: "USDT",
                  availBal: "903.23",
                },
              ],
            },
          ]),
          stderr: "",
          exitCode: 0,
        };
      }

      if (joined.includes("--profile demo --demo --json account positions --instId BTC-USDT")) {
        return {
          stdout: JSON.stringify([{ instId: "BTC-USDT", pos: "0.02", upl: "-6.50" }]),
          stderr: "",
          exitCode: 0,
        };
      }

      throw new Error(`Unexpected runner args: ${joined}`);
    },
  });

  assert.equal(synced.input.payload.market_context.bid_price, 73380.1);
  assert.equal(synced.input.payload.market_context.ask_price, 73389.9);
  assert.equal(synced.input.payload.market_context.high_24h, 74200);
  assert.equal(synced.input.payload.market_context.low_24h, 72150);
  assert.equal(synced.input.payload.market_context.vol_24h, 12894.2);
  assert.equal(synced.input.payload.portfolio_context.total_equity, 913.54);
  assert.equal(synced.input.payload.portfolio_context.unrealized_pnl, -6.5);
  assert.equal(synced.context.positions.length, 1);
});

test("applyRuntimeGuard can use a live OKX profile source when current price is not passed manually", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-live-guard-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const result = await applyRuntimeGuard(loadSampleInput(), {
      dataDir: tempDir,
      profile: "demo",
      runner: async (_command: string, args: string[]) => {
        const joined = args.join(" ");
        if (joined.includes("market ticker BTC-USDT --json")) {
          return {
            stdout: JSON.stringify([{ instId: "BTC-USDT", last: "82600" }]),
            stderr: "",
            exitCode: 0,
          };
        }
        throw new Error(`Unexpected runner args: ${joined}`);
      },
      maxDrawdownBps: 150,
      hardRevokeDrawdownBps: 400,
    });

    assert.equal(result.action, "downgrade");
    assert.equal(result.finalLevel, "L2");
    assert.equal(result.report.observation_source, "okx_live_ticker");
    assert.equal(result.report.current_price, 82600);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
