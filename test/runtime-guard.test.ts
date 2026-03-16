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
const executionModule = require("../src/execution.ts");
const runtimeGuardModule = require("../src/runtime-guard.ts");

const { EvaluationInputSchema, ShadowTradePayloadSchema, buildCommitmentHash } = payloadModule;
const { evaluateDecision } = evaluatorModule;
const { evaluateAndPersist } = stateModule;
const { generateAuditReport } = auditorModule;
const { applyLicenseBoardDecision } = licenseBoardModule;
const { executeProtected } = executionModule;
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

async function seedApprovedL3Agent(tempDir: string): Promise<void> {
  const baseInput = loadSampleInput();
  const priorEvaluations = Array.from({ length: 9 }, (_, index) =>
    evaluateDecision(
      loadSampleInput({
        payload: {
          ...baseInput.payload,
          decision_id: `dec_guard_${index}`,
        },
      }),
      "L2",
    ));

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

test("applyRuntimeGuard downgrades an L3 agent to L2 when runtime drawdown breaches the threshold", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-guard-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const result = await applyRuntimeGuard(loadSampleInput(), {
      dataDir: tempDir,
      currentPrice: 82600,
      maxDrawdownBps: 150,
      hardRevokeDrawdownBps: 400,
    });

    const licensePath = path.join(tempDir, "licenses", "prooftrade-agent-001.json");
    const reportPath = path.join(tempDir, "revocations", "prooftrade-agent-001.json");
    const license = JSON.parse(readFileSync(licensePath, "utf8"));
    const report = JSON.parse(readFileSync(reportPath, "utf8"));

    assert.equal(result.action, "downgrade");
    assert.equal(result.finalLevel, "L2");
    assert.equal(license.currentLevel, "L2");
    assert.equal(license.revoked, false);
    assert.deepEqual(license.allowedExecutionModes, []);
    assert.equal(report.guard_action, "downgrade");
    assert.equal(report.final_level, "L2");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("applyRuntimeGuard revokes an L3 agent when runtime drawdown breaches the hard stop", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-guard-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const result = await applyRuntimeGuard(loadSampleInput(), {
      dataDir: tempDir,
      currentPrice: 77000,
      maxDrawdownBps: 150,
      hardRevokeDrawdownBps: 500,
    });

    const licensePath = path.join(tempDir, "licenses", "prooftrade-agent-001.json");
    const license = JSON.parse(readFileSync(licensePath, "utf8"));

    assert.equal(result.action, "revoke");
    assert.equal(result.finalLevel, "L1");
    assert.equal(license.currentLevel, "L1");
    assert.equal(license.revoked, true);
    assert.equal(license.active, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("executeProtected rejects after runtime guard downgrades the agent back to L2", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-guard-"));

  try {
    await seedApprovedL3Agent(tempDir);
    await applyRuntimeGuard(loadSampleInput(), {
      dataDir: tempDir,
      currentPrice: 82600,
      maxDrawdownBps: 150,
      hardRevokeDrawdownBps: 400,
    });

    await assert.rejects(
      executeProtected(loadSampleInput(), {
        mode: "algo",
        dataDir: tempDir,
      }),
      /does not permit algo execution/,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
