import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { EvaluationInput } from "../src/payload";

const { EvaluationInputSchema, ShadowTradePayloadSchema, buildCommitmentHash } = require("../src/payload.ts");
const { runOpenClawWorkflow } = require("../src/openclaw.ts");
const { getActiveStrategyForAgent } = require("../src/strategy-registry.ts");

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

test("runOpenClawWorkflow executes the local promotion and protected execution flow", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-openclaw-"));

  try {
    const result = await runOpenClawWorkflow(loadSampleInput(), {
      workflow: "full-demo",
      mode: "algo",
      bootstrapL3: true,
      auditorAgentId: "auditor-agent-001",
      dataDir: tempDir,
    });

    const licensePath = path.join(tempDir, "licenses", "prooftrade-agent-001.json");
    const executionPath = path.join(tempDir, "executions", `${result.execution?.executionId}.json`);
    const license = JSON.parse(readFileSync(licensePath, "utf8"));
    const execution = JSON.parse(readFileSync(executionPath, "utf8"));

    assert.equal(result.license.currentLevel, "L3");
    assert.match(result.transcript.join("\n"), /Audit verdict: approved/);
    assert.match(result.transcript.join("\n"), /Protected execution prepared/);
    assert.equal(license.currentLevel, "L3");
    assert.deepEqual(license.allowedExecutionModes, ["algo", "bot"]);
    assert.equal(execution.executionMode, "algo");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runOpenClawWorkflow can activate a white-listed strategy skill and persist strategy-bound trust records", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-openclaw-"));

  try {
    const result = await runOpenClawWorkflow(loadSampleInput(), {
      workflow: "full-demo",
      mode: "algo",
      bootstrapL3: true,
      auditorAgentId: "auditor-agent-001",
      dataDir: tempDir,
      strategyId: "momentum-spot-algo",
    });

    const agentPath = path.join(tempDir, "agents", "prooftrade-agent-001.json");
    const licensePath = path.join(tempDir, "licenses", "prooftrade-agent-001.json");
    const certificatePath = path.join(tempDir, "certificates", "prooftrade-agent-001.json");
    const binding = await getActiveStrategyForAgent("prooftrade-agent-001", { dataDir: tempDir });
    const agent = JSON.parse(readFileSync(agentPath, "utf8"));
    const license = JSON.parse(readFileSync(licensePath, "utf8"));
    const certificate = JSON.parse(readFileSync(certificatePath, "utf8"));

    assert.equal(binding?.strategyId, "momentum-spot-algo");
    assert.equal(agent.strategyId, "momentum-spot-algo");
    assert.equal(license.strategyId, "momentum-spot-algo");
    assert.equal(certificate.strategy_id, "momentum-spot-algo");
    assert.match(result.transcript.join("\n"), /Active strategy: momentum-spot-algo/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runOpenClawWorkflow syncs live OKX market and account context into the strategy path before submit", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-openclaw-"));

  try {
    const result = await runOpenClawWorkflow(loadSampleInput(), {
      workflow: "submit",
      mode: "algo",
      bootstrapL3: true,
      auditorAgentId: "auditor-agent-001",
      dataDir: tempDir,
      strategyId: "momentum-spot-algo",
      profile: "demo",
      runner: async (_command: string, args: string[]) => {
        const joined = args.join(" ");

        if (joined.includes("market ticker BTC-USDT --json")) {
          return {
            stdout: JSON.stringify([{
              instId: "BTC-USDT",
              last: "70000",
              bidPx: "69990",
              askPx: "70010",
              high24h: "70800",
              low24h: "68950",
              vol24h: "12450.5",
              sodUtc0: "69400",
            }]),
            stderr: "",
            exitCode: 0,
          };
        }

        if (joined.includes("--profile demo --demo --json account balance USDT")) {
          return {
            stdout: JSON.stringify([
              {
                totalEq: "2600.00",
                details: [
                  {
                    ccy: "USDT",
                    availBal: "2500.00",
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
            stdout: JSON.stringify([{ instId: "BTC-USDT", pos: "0.01", upl: "-3.50" }]),
            stderr: "",
            exitCode: 0,
          };
        }

        if (joined.includes("spot algo place")) {
          return {
            stdout: JSON.stringify([
              {
                algoId: "algo-live-001",
                sCode: "0",
                sMsg: "",
                tag: "CLI",
              },
            ]),
            stderr: "",
            exitCode: 0,
          };
        }

        throw new Error(`Unexpected runner args: ${joined}`);
      },
    });

    const submissionPath = path.join(tempDir, "okx-submissions", "okx_demo_exec_dec_20260315_0001_algo.json");
    const submission = JSON.parse(readFileSync(submissionPath, "utf8"));

    assert.equal(result.submission?.remoteRequestId, "algo-live-001");
    assert.equal(submission.request.payload.sz, "125.00");
    assert.equal(submission.request.payload.tpOrdPx, "68600.00");
    assert.equal(submission.request.payload.slOrdPx, "71050.00");
    assert.match(result.transcript.join("\n"), /bid=69990/);
    assert.match(result.transcript.join("\n"), /ask=70010/);
    assert.match(result.transcript.join("\n"), /high24h=70800/);
    assert.match(result.transcript.join("\n"), /totalEq=2600/);
    assert.match(result.transcript.join("\n"), /upl=-3\.5/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runOpenClawWorkflow can publish the approved agent state to X Layer through an injected publisher", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-openclaw-"));
  let captured: { agentId: string; options: Record<string, unknown> } | undefined;

  try {
    const result = await runOpenClawWorkflow(loadSampleInput(), {
      workflow: "publish",
      bootstrapL3: true,
      auditorAgentId: "auditor-agent-001",
      dataDir: tempDir,
      xlayer: {
        network: "testnet",
        agentUri: "ipfs://prooftrade-testnet/agent.json",
        evidenceBaseUri: "ipfs://prooftrade-testnet/evidence",
      },
      publisher: async (agentId: string, options: Record<string, unknown>) => {
        captured = { agentId, options };
        return {
          registerTxHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
          validationTxHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
          licenseTxHash: "0x3333333333333333333333333333333333333333333333333333333333333333",
          auditTxHash: "0x4444444444444444444444444444444444444444444444444444444444444444",
          chainId: 1952,
        };
      },
    });

    assert.equal(result.license.currentLevel, "L3");
    assert.equal(result.publication?.chainId, 1952);
    assert.equal(captured?.agentId, "prooftrade-agent-001");
    assert.equal(captured?.options.network, "testnet");
    assert.equal(captured?.options.agentUri, "ipfs://prooftrade-testnet/agent.json");
    assert.match(result.transcript.join("\n"), /X Layer publication completed/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runOpenClawWorkflow can downgrade an approved L3 agent back to L2 through the runtime guard workflow", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-openclaw-"));

  try {
    const result = await runOpenClawWorkflow(loadSampleInput(), {
      workflow: "guard",
      bootstrapL3: true,
      auditorAgentId: "auditor-agent-001",
      dataDir: tempDir,
      runtimeGuard: {
        currentPrice: 82600,
        maxDrawdownBps: 150,
        hardRevokeDrawdownBps: 400,
      },
    });

    const licensePath = path.join(tempDir, "licenses", "prooftrade-agent-001.json");
    const reportPath = path.join(tempDir, "revocations", "prooftrade-agent-001.json");
    const license = JSON.parse(readFileSync(licensePath, "utf8"));
    const report = JSON.parse(readFileSync(reportPath, "utf8"));

    assert.equal(result.license.currentLevel, "L2");
    assert.equal(result.runtimeGuard?.guard_action, "downgrade");
    assert.equal(license.currentLevel, "L2");
    assert.equal(report.guard_action, "downgrade");
    assert.match(result.transcript.join("\n"), /Runtime guard action: downgrade/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
