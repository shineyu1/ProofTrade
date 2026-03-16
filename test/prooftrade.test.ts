import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { EvaluationInput } from "../src/payload";

const evaluatorModule = require("../src/evaluator.ts");
const payloadModule = require("../src/payload.ts");
const stateModule = require("../src/state.ts");
const executionModule = require("../src/execution.ts");
const okxAdapterModule = require("../src/okx-adapter.ts");
const okxProviderModule = require("../src/okx-provider.ts");
const certificateModule = require("../src/certificate.ts");
const replayModule = require("../src/replay.ts");
const auditorModule = require("../src/auditor.ts");
const licenseBoardModule = require("../src/license-board.ts");
const xlayerModule = require("../src/xlayer.ts");
const {
  EvaluationInputSchema,
  ShadowTradePayloadSchema,
  buildCommitmentHash,
} = payloadModule;
const {
  evaluateDecision,
  recommendLicenseLevel,
  summarizeRollingWindow,
} = evaluatorModule;
const { evaluateAndPersist } = stateModule;
const { executeProtected } = executionModule;
const { buildOkxDemoRequest } = okxAdapterModule;
const {
  buildOkxCliInvocation,
  ensureOkxProfile,
  submitOkxDemoRequest,
  prepareAndSubmitProtectedExecution,
  resolveRunnerInvocation,
} = okxProviderModule;
const { generateLicenseCertificate } = certificateModule;
const { runShadowReplay } = replayModule;
const { generateAuditReport } = auditorModule;
const { applyLicenseBoardDecision } = licenseBoardModule;
const {
  buildOnchainPublicationBundle,
  compileProofTradeRegistry,
  defaultXLayerNetworkConfig,
} = xlayerModule;

const SAMPLE_HASH = "8e49bb978139918f7cec2be830de115085f99e78637b4c348179726443795221";

function loadRawSample(): unknown {
  const fullPath = path.join(process.cwd(), "examples", "sample-evaluation-input.json");
  return JSON.parse(readFileSync(fullPath, "utf8"));
}

function loadSampleInput(overrides?: Partial<EvaluationInput>): EvaluationInput {
  const raw = loadRawSample() as EvaluationInput;
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
  const merged: EvaluationInput = {
    ...mergedWithoutHash,
    commitment: {
      ...mergedWithoutHash.commitment,
      commitment_hash: overrides?.commitment?.commitment_hash ?? commitmentHash,
    },
  };

  return EvaluationInputSchema.parse(merged);
}

async function seedApprovedL3Agent(tempDir: string): Promise<void> {
  const baseInput = loadSampleInput();
  const priorEvaluations = Array.from({ length: 9 }, (_, index) =>
    evaluateDecision(
      loadSampleInput({
        payload: {
          ...baseInput.payload,
          decision_id: `dec_seed_${index}`,
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

test("buildCommitmentHash matches the canonical sample hash", () => {
  const raw = loadRawSample() as EvaluationInput;
  const payload = ShadowTradePayloadSchema.parse(raw.payload);

  assert.equal(buildCommitmentHash(payload), SAMPLE_HASH);
});

test("EvaluationInputSchema accepts the corrected sample input", () => {
  const input = loadSampleInput();

  assert.equal(input.payload.agent_id, "prooftrade-agent-001");
  assert.equal(input.commitment.commitment_hash, SAMPLE_HASH);
});

test("sample evaluation fixture stores the canonical commitment hash", () => {
  const raw = loadRawSample() as EvaluationInput;

  assert.equal(raw.commitment.commitment_hash, SAMPLE_HASH);
});

test("evaluateDecision returns a pass for the corrected sample", () => {
  const input = loadSampleInput();

  const evaluation = evaluateDecision(input, "L2");
  const recommendation = recommendLicenseLevel("L2", [evaluation]);

  assert.equal(evaluation.commitmentVerified, true);
  assert.equal(evaluation.policyComplianceBps, 10_000);
  assert.equal(evaluation.syntheticPnlBps, 200);
  assert.equal(evaluation.maxAdverseExcursionBps, 0);
  assert.equal(evaluation.riskAdjustedScore, 200);
  assert.equal(evaluation.verdict, "pass");
  assert.equal(recommendation.action, "keep");
  assert.equal(recommendation.recommendedLevel, "L2");
});

test("evaluateDecision fails when the commitment hash does not match", () => {
  const input = loadSampleInput({
    commitment: {
      commitment_id: "commit_bad",
      commitment_hash: "bad_hash",
      created_at: "2026-03-15T14:30:00Z",
      expires_at: "2026-03-15T18:30:00Z",
    },
  });

  const evaluation = evaluateDecision(input, "L2");
  const recommendation = recommendLicenseLevel("L2", [evaluation]);

  assert.equal(evaluation.commitmentVerified, false);
  assert.equal(evaluation.verdict, "fail");
  assert.match(evaluation.reasons.join("; "), /commitment hash mismatch/);
  assert.equal(recommendation.action, "revoke");
  assert.equal(recommendation.recommendedLevel, "L1");
});

test("recommendLicenseLevel upgrades L2 to L3 after ten valid passing shadow trades", () => {
  const baseInput = loadSampleInput();
  const evaluations = Array.from({ length: 10 }, (_, index) =>
    evaluateDecision(
      loadSampleInput({
        payload: {
          ...baseInput.payload,
          decision_id: `dec_pass_${index}`,
        },
      }),
      "L2",
    ));

  const recommendation = recommendLicenseLevel("L2", evaluations);

  assert.equal(recommendation.action, "upgrade");
  assert.equal(recommendation.recommendedLevel, "L3");
  assert.deepEqual(recommendation.allowedExecutionModes, ["algo", "bot"]);
});

test("no_trade counts as half toward the L3 upgrade volume", () => {
  const baseInput = loadSampleInput();
  const passingTrades = Array.from({ length: 9 }, (_, index) =>
    evaluateDecision(
      loadSampleInput({
        payload: {
          ...baseInput.payload,
          decision_id: `dec_trade_${index}`,
        },
      }),
      "L2",
    ));
  const noTradeEvaluation = evaluateDecision(
    loadSampleInput({
      payload: {
        ...baseInput.payload,
        decision_id: "dec_no_trade",
        decision: {
          ...baseInput.payload.decision,
          intent_type: "no_trade",
          side: "no_trade",
        },
      },
    }),
    "L2",
  );

  const summary = summarizeRollingWindow([...passingTrades, noTradeEvaluation]);
  const recommendation = recommendLicenseLevel("L2", [...passingTrades, noTradeEvaluation]);

  assert.equal(summary.validShadowTradeCount, 9.5);
  assert.equal(recommendation.action, "keep");
  assert.equal(recommendation.recommendedLevel, "L2");
  assert.deepEqual(recommendation.allowedExecutionModes, []);
});

test("evaluateAndPersist stores agent, commitment, attestation, and license JSON records", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    const baseInput = loadSampleInput();
    const priorEvaluations = Array.from({ length: 9 }, (_, index) =>
      evaluateDecision(
        loadSampleInput({
          payload: {
            ...baseInput.payload,
            decision_id: `dec_history_${index}`,
          },
        }),
        "L2",
      ));

    const result = await evaluateAndPersist(loadSampleInput(), {
      currentLevel: "L2",
      priorEvaluations,
      dataDir: tempDir,
    });

    const agentPath = path.join(tempDir, "agents", `${result.agent.agentId}.json`);
    const commitmentPath = path.join(tempDir, "commitments", `${result.commitment.commitmentId}.json`);
    const attestationPath = path.join(tempDir, "attestations", `${result.attestation.attestationId}.json`);
    const licensePath = path.join(tempDir, "licenses", `${result.license.agentId}.json`);

    const agentRecord = JSON.parse(readFileSync(agentPath, "utf8"));
    const commitmentRecord = JSON.parse(readFileSync(commitmentPath, "utf8"));
    const attestationRecord = JSON.parse(readFileSync(attestationPath, "utf8"));
    const licenseRecord = JSON.parse(readFileSync(licensePath, "utf8"));

    assert.equal(agentRecord.agentId, "prooftrade-agent-001");
    assert.equal(commitmentRecord.commitmentVerified, true);
    assert.equal(attestationRecord.recommendedLevel, "L3");
    assert.equal(licenseRecord.currentLevel, "L2");
    assert.equal(licenseRecord.pendingPromotionTo, "L3");
    assert.deepEqual(licenseRecord.allowedExecutionModes, []);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("applyLicenseBoardDecision upgrades a pending L2 candidate to L3 after audit approval", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const licensePath = path.join(tempDir, "licenses", "prooftrade-agent-001.json");
    const decisionPath = path.join(tempDir, "license-board-decisions", "prooftrade-agent-001.json");
    const licenseRecord = JSON.parse(readFileSync(licensePath, "utf8"));
    const decisionRecord = JSON.parse(readFileSync(decisionPath, "utf8"));

    assert.equal(licenseRecord.currentLevel, "L3");
    assert.deepEqual(licenseRecord.allowedExecutionModes, ["algo", "bot"]);
    assert.equal(decisionRecord.final_level, "L3");
    assert.equal(decisionRecord.final_action, "upgrade");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("executeProtected rejects execution when the agent is still at L2", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await evaluateAndPersist(loadSampleInput(), {
      currentLevel: "L2",
      dataDir: tempDir,
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

test("executeProtected persists an algo execution record for an L3 agent", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const execution = await executeProtected(loadSampleInput(), {
      mode: "algo",
      dataDir: tempDir,
    });

    const executionPath = path.join(tempDir, "executions", `${execution.executionId}.json`);
    const executionRecord = JSON.parse(readFileSync(executionPath, "utf8"));

    assert.equal(executionRecord.executionMode, "algo");
    assert.equal(executionRecord.okxSkill, "algo");
    assert.equal(executionRecord.environment, "demo");
    assert.equal(executionRecord.protection.stopLoss.mode, "percent");
    assert.equal(executionRecord.protection.takeProfit.mode, "percent");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("executeProtected persists a low-risk bot execution record for an L3 agent", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const execution = await executeProtected(loadSampleInput(), {
      mode: "bot",
      dataDir: tempDir,
    });

    const executionPath = path.join(tempDir, "executions", `${execution.executionId}.json`);
    const executionRecord = JSON.parse(readFileSync(executionPath, "utf8"));

    assert.equal(executionRecord.executionMode, "bot");
    assert.equal(executionRecord.okxSkill, "bot");
    assert.equal(executionRecord.environment, "demo");
    assert.equal(executionRecord.botConfig.strategyType, "grid");
    assert.equal(executionRecord.botConfig.riskTier, "low");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildOkxDemoRequest maps algo execution to a protected OKX algo request", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const execution = await executeProtected(loadSampleInput(), {
      mode: "algo",
      dataDir: tempDir,
    });

    const request = buildOkxDemoRequest(loadSampleInput(), execution);

    assert.equal(request.skill, "algo");
    assert.equal(request.environment, "demo");
    assert.equal(request.payload.instId, "BTC-USDT");
    assert.equal(request.payload.side, "buy");
    assert.equal(request.payload.ordType, "oco");
    assert.equal(request.payload.tpTriggerPxType, "last");
    assert.equal(request.payload.slTriggerPxType, "last");
    assert.equal(request.payload.tpOrdPx, "82565.49");
    assert.equal(request.payload.slOrdPx, "85514.26");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildOkxDemoRequest maps bot execution to an OKX grid bot request", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const execution = await executeProtected(loadSampleInput(), {
      mode: "bot",
      dataDir: tempDir,
    });

    const request = buildOkxDemoRequest(loadSampleInput(), execution);

    assert.equal(request.skill, "bot");
    assert.equal(request.environment, "demo");
    assert.equal(request.payload.strategyType, "grid");
    assert.equal(request.payload.instId, "BTC-USDT");
    assert.equal(request.payload.gridCount, 6);
    assert.equal(request.payload.riskTier, "low");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("submitOkxDemoRequest persists an accepted demo submission record", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const execution = await executeProtected(loadSampleInput(), {
      mode: "algo",
      dataDir: tempDir,
    });
    const request = buildOkxDemoRequest(loadSampleInput(), execution);
    const invocation = buildOkxCliInvocation(request, { profile: "demo-profile" });
    const submission = await submitOkxDemoRequest(request, {
      executionId: execution.executionId,
      dataDir: tempDir,
      profile: "demo-profile",
      runner: async (command, args) => {
        assert.match(command, /okx(\.cmd)?$/);
        assert.deepEqual(args, invocation.args);
        return {
          stdout: JSON.stringify({ code: "0", data: [{ algoId: "12345" }] }),
          stderr: "",
          exitCode: 0,
        };
      },
    });

    const submissionPath = path.join(tempDir, "okx-submissions", `${submission.submissionId}.json`);
    const submissionRecord = JSON.parse(readFileSync(submissionPath, "utf8"));
    const executionPath = path.join(tempDir, "executions", `${execution.executionId}.json`);
    const executionRecord = JSON.parse(readFileSync(executionPath, "utf8"));

    assert.equal(submissionRecord.status, "accepted");
    assert.equal(submissionRecord.provider, "okx-trade-cli");
    assert.equal(submissionRecord.request.skill, "algo");
    assert.equal(submissionRecord.executionId, execution.executionId);
    assert.equal(submissionRecord.profile, "demo-profile");
    assert.equal(executionRecord.remoteRequestId, "12345");
    assert.equal(executionRecord.submissionStatus, "accepted");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("submitOkxDemoRequest extracts remote algoId from top-level OKX array responses", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const execution = await executeProtected(loadSampleInput(), {
      mode: "algo",
      dataDir: tempDir,
    });
    const request = buildOkxDemoRequest(loadSampleInput(), execution);
    const submission = await submitOkxDemoRequest(request, {
      executionId: execution.executionId,
      dataDir: tempDir,
      profile: "demo-profile",
      runner: async () => ({
        stdout: JSON.stringify([
          {
            algoClOrdId: "",
            algoId: "3393818274675634176",
            clOrdId: "",
            sCode: "0",
            sMsg: "",
            tag: "CLI",
          },
        ]),
        stderr: "",
        exitCode: 0,
      }),
    });

    const executionPath = path.join(tempDir, "executions", `${execution.executionId}.json`);
    const executionRecord = JSON.parse(readFileSync(executionPath, "utf8"));

    assert.equal(submission.remoteRequestId, "3393818274675634176");
    assert.equal(executionRecord.remoteRequestId, "3393818274675634176");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("submitOkxDemoRequest rejects and persists provider-side business errors", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const execution = await executeProtected(loadSampleInput(), {
      mode: "algo",
      dataDir: tempDir,
    });
    const request = buildOkxDemoRequest(loadSampleInput(), execution);

    await assert.rejects(
      submitOkxDemoRequest(request, {
        executionId: execution.executionId,
        dataDir: tempDir,
        profile: "demo-profile",
        runner: async () => ({
          stdout: JSON.stringify([
            {
              algoClOrdId: "",
              algoId: "",
              clOrdId: "",
              sCode: "51277",
              sMsg: "TP trigger price cannot be higher than the last price",
              tag: "",
            },
          ]),
          stderr: "",
          exitCode: 0,
        }),
      }),
      /TP trigger price cannot be higher than the last price/,
    );

    const submissionPath = path.join(tempDir, "okx-submissions", `okx_demo_${execution.executionId}.json`);
    const submissionRecord = JSON.parse(readFileSync(submissionPath, "utf8"));
    const executionPath = path.join(tempDir, "executions", `${execution.executionId}.json`);
    const executionRecord = JSON.parse(readFileSync(executionPath, "utf8"));

    assert.equal(submissionRecord.status, "rejected");
    assert.equal(submissionRecord.errorMessage, "TP trigger price cannot be higher than the last price");
    assert.equal(executionRecord.submissionStatus, "rejected");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("prepareAndSubmitProtectedExecution performs the full protected demo submission flow", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const result = await prepareAndSubmitProtectedExecution(loadSampleInput(), {
      mode: "bot",
      dataDir: tempDir,
      profile: "demo-profile",
      runner: async () => ({
        stdout: JSON.stringify({ code: "0", data: [{ algoId: "bot-678" }] }),
        stderr: "",
        exitCode: 0,
      }),
    });

    assert.equal(result.execution.executionMode, "bot");
    assert.equal(result.request.skill, "bot");
    assert.equal(result.submission.status, "accepted");

    const submissionPath = path.join(tempDir, "okx-submissions", `${result.submission.submissionId}.json`);
    const submissionRecord = JSON.parse(readFileSync(submissionPath, "utf8"));
    assert.equal(submissionRecord.request.payload.strategyType, "grid");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildOkxCliInvocation maps algo requests to the official spot algo CLI command", () => {
  const request = {
    skill: "algo",
    environment: "demo",
    payload: {
      instId: "BTC-USDT",
      tdMode: "cash",
      side: "buy",
      ordType: "oco",
      tpTriggerPxType: "last",
      slTriggerPxType: "last",
      tpOrdPx: "85935.00",
      slOrdPx: "82986.74",
      sz: "500.00",
    },
  };

  const invocation = buildOkxCliInvocation(request, { profile: "demo-profile" });

  assert.match(invocation.command, /okx(\.cmd)?$/);
  assert.deepEqual(invocation.args, [
    "--profile",
    "demo-profile",
    "--demo",
    "--json",
    "spot",
    "algo",
    "place",
    "--instId",
    "BTC-USDT",
    "--side",
    "buy",
    "--sz",
    "500.00",
    "--ordType",
    "oco",
    "--tpTriggerPx",
    "85935.00",
    "--tpOrdPx=-1",
    "--slTriggerPx",
    "82986.74",
    "--slOrdPx=-1",
    "--tdMode",
    "cash",
  ]);
});

test("buildOkxCliInvocation maps bot requests to the official grid bot CLI command", () => {
  const request = {
    skill: "bot",
    environment: "demo",
    payload: {
      instId: "BTC-USDT",
      strategyType: "grid",
      mode: "neutral",
      gridCount: 6,
      investmentAmount: "500.00",
      riskTier: "low",
    },
  };

  const invocation = buildOkxCliInvocation(request, {});

  assert.match(invocation.command, /okx(\.cmd)?$/);
  assert.deepEqual(invocation.args, [
    "--demo",
    "--json",
    "bot",
    "grid",
    "create",
    "--instId",
    "BTC-USDT",
    "--algoOrdType",
    "grid",
    "--maxPx",
    "525.00",
    "--minPx",
    "475.00",
    "--gridNum",
    "6",
    "--quoteSz",
    "500.00",
    "--direction",
    "neutral",
  ]);
});

test("resolveRunnerInvocation wraps Windows .cmd CLI calls through cmd.exe", () => {
  const invocation = resolveRunnerInvocation("C:\\repo\\node_modules\\.bin\\okx.cmd", ["spot", "algo", "place"], "win32");

  assert.equal(invocation.command, "cmd.exe");
  assert.deepEqual(invocation.args, [
    "/d",
    "/s",
    "/c",
    "C:\\repo\\node_modules\\.bin\\okx.cmd spot algo place",
  ]);
});

test("ensureOkxProfile throws when the config file is missing", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  await assert.rejects(
    ensureOkxProfile({ profile: "demo", okxHomeDir: tempDir }),
    /OKX config not found/,
  );

  rmSync(tempDir, { recursive: true, force: true });
});

test("ensureOkxProfile passes when the requested profile exists", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));
  mkdirSync(tempDir, { recursive: true });
  writeFileSync(
    path.join(tempDir, "config.toml"),
    [
      'default_profile = "demo"',
      "",
      "[profiles.demo]",
      'site = "global"',
      'api_key = "demo-key"',
      'secret_key = "demo-secret"',
      'passphrase = "demo-passphrase"',
      "demo = true",
      "",
    ].join("\n"),
    "utf8",
  );

  await ensureOkxProfile({ profile: "demo", okxHomeDir: tempDir });

  rmSync(tempDir, { recursive: true, force: true });
});

test("generateLicenseCertificate writes a professional L3 certificate JSON", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);

    const certificate = await generateLicenseCertificate("prooftrade-agent-001", {
      dataDir: tempDir,
    });

    const certificatePath = path.join(tempDir, "certificates", "prooftrade-agent-001.json");
    const record = JSON.parse(readFileSync(certificatePath, "utf8"));

    assert.equal(record.agent_id, "prooftrade-agent-001");
    assert.equal(record.current_level, "L3");
    assert.equal(record.current_level_label, "L3_Protected_Execution");
    assert.deepEqual(record.allowed_execution_modes, ["algo", "bot"]);
    assert.equal(record.policy_hash, loadSampleInput().payload.policy_ref.policy_hash);
    assert.equal(certificate.valid_shadow_trade_count, 10);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runShadowReplay produces an L3 upgrade evidence trail and certificate", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    const replay = await runShadowReplay(loadSampleInput(), {
      dataDir: tempDir,
      scenarioName: "extreme-volatility-replay",
      decisionCount: 10,
    });

    assert.equal(replay.finalLevel, "L3");
    assert.equal(replay.accessGranted, true);
    assert.match(replay.transcript.join("\n"), /ACCESS GRANTED: Upgraded to L3/);

    const transcriptPath = path.join(tempDir, "evidence", "extreme-volatility-replay", "shadow-replay.log");
    const certificatePath = path.join(tempDir, "evidence", "extreme-volatility-replay", "license_certificate.json");
    const transcript = readFileSync(transcriptPath, "utf8");
    const certificate = JSON.parse(readFileSync(certificatePath, "utf8"));

    assert.match(transcript, /Decision 10/);
    assert.equal(certificate.current_level, "L3");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildOnchainPublicationBundle derives identity, license, and validation publications from local state", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    await seedApprovedL3Agent(tempDir);
    await generateLicenseCertificate("prooftrade-agent-001", { dataDir: tempDir });

    const bundle = await buildOnchainPublicationBundle("prooftrade-agent-001", {
      dataDir: tempDir,
      agentUri: "ipfs://prooftrade/agent.json",
      evidenceBaseUri: "ipfs://prooftrade/evidence",
    });

    assert.equal(bundle.network.chainId, 196);
    assert.equal(bundle.identity.agentId, "prooftrade-agent-001");
    assert.equal(bundle.identity.agentUri, "ipfs://prooftrade/agent.json");
    assert.equal(bundle.license.currentLevel, "L3");
    assert.deepEqual(bundle.license.allowedExecutionModes, ["algo", "bot"]);
    assert.equal(bundle.validation.validationType, "attestation");
    assert.equal(bundle.audit.verdict, "approved");
    assert.equal(bundle.audit.auditorAgentId, "auditor-agent-001");
    assert.match(bundle.identity.agentKey, /^0x[a-f0-9]{64}$/);
    assert.match(bundle.license.certificateHash, /^0x[a-f0-9]{64}$/);
    assert.match(bundle.audit.auditHash, /^0x[a-f0-9]{64}$/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("compileProofTradeRegistry compiles the X Layer registry contract with the required entrypoints", async () => {
  const compiled = await compileProofTradeRegistry();
  const functionNames = compiled.abi
    .filter((item: { type: string }) => item.type === "function")
    .map((item: { name?: string }) => item.name)
    .filter(Boolean);

  assert.ok(compiled.bytecode.startsWith("0x"));
  assert.ok(compiled.bytecode.length > 10);
  assert.ok(functionNames.includes("registerOrUpdateAgent"));
  assert.ok(functionNames.includes("publishValidation"));
  assert.ok(functionNames.includes("publishLicense"));
  assert.ok(functionNames.includes("publishAudit"));
  assert.deepEqual(defaultXLayerNetworkConfig("mainnet"), {
    chainId: 196,
    networkName: "X Layer mainnet",
    rpcUrl: "https://rpc.xlayer.tech",
    explorerUrl: "https://www.okx.com/web3/explorer/xlayer",
  });
  assert.deepEqual(defaultXLayerNetworkConfig("testnet"), {
    chainId: 1952,
    networkName: "X Layer testnet",
    rpcUrl: "https://testrpc.xlayer.tech/terigon",
    explorerUrl: "https://www.okx.com/web3/explorer/xlayer-test",
  });
});

test("generateAuditReport writes an approval report for an L3-ready agent window", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "prooftrade-"));

  try {
    const baseInput = loadSampleInput();
    const priorEvaluations = Array.from({ length: 9 }, (_, index) =>
      evaluateDecision(
        loadSampleInput({
          payload: {
            ...baseInput.payload,
            decision_id: `dec_audit_${index}`,
          },
        }),
        "L2",
      ));

    await evaluateAndPersist(loadSampleInput(), {
      currentLevel: "L2",
      priorEvaluations,
      dataDir: tempDir,
    });
    await generateLicenseCertificate("prooftrade-agent-001", { dataDir: tempDir });

    const report = await generateAuditReport("prooftrade-agent-001", {
      dataDir: tempDir,
      auditorAgentId: "auditor-agent-001",
    });
    const reportPath = path.join(tempDir, "audits", "prooftrade-agent-001.json");
    const record = JSON.parse(readFileSync(reportPath, "utf8"));

    assert.equal(report.audit_verdict, "approved");
    assert.equal(report.recommended_level, "L3");
    assert.equal(report.reviewed_license_level, "L2");
    assert.equal(report.auditor_agent_id, "auditor-agent-001");
    assert.equal(record.audit_verdict, "approved");
    assert.ok(Array.isArray(record.findings));
    assert.ok(record.findings.length > 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
