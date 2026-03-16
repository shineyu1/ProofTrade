import { readFile } from "node:fs/promises";
import path from "node:path";
import { evaluateDecision } from "./evaluator";
import { buildCommitmentHash, EvaluationInputSchema, type EvaluationInput } from "./payload";
import { executeProtected } from "./execution";
import { buildOkxDemoRequest } from "./okx-adapter";
import { prepareAndSubmitProtectedExecution } from "./okx-provider";
import { evaluateAndPersist } from "./state";
import { generateAuditReport } from "./auditor";
import { applyLicenseBoardDecision } from "./license-board";

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

function buildBootstrapEvaluations(parsed: EvaluationInput) {
  return Array.from({ length: 9 }, (_, index) =>
    evaluateDecision(buildHistoricalInput(parsed, `bootstrap_${index}`), "L2"));
}

async function bootstrapProtectedExecutionEligibility(
  parsed: EvaluationInput,
  options: { dataDir?: string; auditorAgentId?: string },
) {
  const priorEvaluations = buildBootstrapEvaluations(parsed);

  await evaluateAndPersist(parsed, {
    currentLevel: "L2",
    priorEvaluations,
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
  });
  await generateAuditReport(parsed.payload.agent_id, {
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    ...(options.auditorAgentId ? { auditorAgentId: options.auditorAgentId } : {}),
  });
  await applyLicenseBoardDecision(parsed.payload.agent_id, {
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
  });
}

async function main() {
  const [, , command, fileArg, ...restArgs] = process.argv;

  if (!["evaluate", "execute", "submit"].includes(command ?? "") || !fileArg) {
    console.error("Usage: npm run evaluate -- <path-to-evaluation-input.json>");
    console.error("   or: npm run execute -- <path-to-evaluation-input.json> --mode algo|bot");
    console.error("   or: npm run submit -- <path-to-evaluation-input.json> --mode algo|bot");
    console.error("Optional flags: --data-dir <dir> --profile <name> --bootstrap-l3 --auditor <id>");
    process.exit(1);
  }

  const dataDirFlagIndex = restArgs.findIndex((arg) => arg === "--data-dir");
  const dataDir = dataDirFlagIndex >= 0 ? restArgs[dataDirFlagIndex + 1] : undefined;
  const profileFlagIndex = restArgs.findIndex((arg) => arg === "--profile");
  const profile = profileFlagIndex >= 0 ? restArgs[profileFlagIndex + 1] : undefined;
  const auditorFlagIndex = restArgs.findIndex((arg) => arg === "--auditor");
  const auditorAgentId = auditorFlagIndex >= 0 ? restArgs[auditorFlagIndex + 1] : "auditor-agent-001";
  const bootstrapL3 = restArgs.includes("--bootstrap-l3");

  const fullPath = path.resolve(process.cwd(), fileArg);
  const raw = await readFile(fullPath, "utf8");
  const parsed = EvaluationInputSchema.parse(JSON.parse(raw));
  const priorEvaluations = bootstrapL3 ? buildBootstrapEvaluations(parsed) : [];
  if (command === "evaluate") {
    const result = await evaluateAndPersist(parsed, {
      ...(priorEvaluations.length > 0 ? { priorEvaluations } : {}),
      ...(bootstrapL3 ? { currentLevel: "L2" } : {}),
      ...(dataDir ? { dataDir } : {}),
    });
    const { evaluation, recommendation, license } = result;

    console.log("Agent:", evaluation.agentId);
    console.log("Decision:", evaluation.decisionId);
    console.log("Commitment verified:", evaluation.commitmentVerified);
    console.log("Policy compliance:", evaluation.policyComplianceBps, "bps");
    console.log("Synthetic PnL:", evaluation.syntheticPnlBps, "bps");
    console.log("Max adverse excursion:", evaluation.maxAdverseExcursionBps, "bps");
    console.log("Risk-adjusted score:", evaluation.riskAdjustedScore);
    console.log("Verdict:", evaluation.verdict);
    if (evaluation.reasons.length > 0) {
      console.log("Reasons:", evaluation.reasons.join("; "));
    }
    console.log("Recommended action:", recommendation.action);
    console.log("Recommended level:", recommendation.recommendedLevel);
    console.log("Allowed execution modes:", recommendation.allowedExecutionModes.join(", ") || "none");
    console.log("Recommendation reason:", recommendation.reason);
    if (license.pendingPromotionTo) {
      console.log("Pending promotion to:", license.pendingPromotionTo);
      console.log("Pending promotion reason:", license.pendingPromotionReason);
    }
    console.log("License state path:", path.join(result.dataDir, "licenses", `${license.agentId}.json`));
    return;
  }

  const modeFlagIndex = restArgs.findIndex((arg) => arg === "--mode");
  const modeValue = modeFlagIndex >= 0 ? restArgs[modeFlagIndex + 1] : undefined;
  if (modeValue !== "algo" && modeValue !== "bot") {
    console.error("Execute mode must be provided as --mode algo|bot");
    process.exit(1);
  }

  if (bootstrapL3) {
    await bootstrapProtectedExecutionEligibility(parsed, {
      ...(dataDir ? { dataDir } : {}),
      ...(auditorAgentId ? { auditorAgentId } : {}),
    });
  }

  if (command === "execute") {
    const execution = await executeProtected(parsed, {
      mode: modeValue,
      ...(dataDir ? { dataDir } : {}),
    });
    const request = buildOkxDemoRequest(parsed, execution);

    console.log("Execution prepared:", execution.executionId);
    console.log("Agent:", execution.agentId);
    console.log("Decision:", execution.decisionId);
    console.log("Mode:", execution.executionMode);
    console.log("OKX skill:", execution.okxSkill);
    console.log("Environment:", execution.environment);
    console.log("Execution record path:", path.join(dataDir ?? path.join(process.cwd(), "data"), "executions", `${execution.executionId}.json`));
    console.log("OKX request skill:", request.skill);
    return;
  }

  const result = await prepareAndSubmitProtectedExecution(parsed, {
    mode: modeValue,
    ...(dataDir ? { dataDir } : {}),
    ...(profile ? { profile } : {}),
  });
  console.log("Execution prepared:", result.execution.executionId);
  console.log("Submission:", result.submission.submissionId);
  console.log("Provider:", result.submission.provider);
  console.log("Status:", result.submission.status);
  console.log("Remote request id:", result.submission.remoteRequestId);
  console.log("Submission record path:", path.join(dataDir ?? path.join(process.cwd(), "data"), "okx-submissions", `${result.submission.submissionId}.json`));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
