import { readFile } from "node:fs/promises";
import path from "node:path";
import { EvaluationInputSchema } from "../src/payload";
import { evaluateAndPersist } from "../src/state";
import { generateLicenseCertificate } from "../src/certificate";
import { generateAuditReport } from "../src/auditor";
import { applyLicenseBoardDecision } from "../src/license-board";
import { evaluateDecision } from "../src/evaluator";
import { buildCommitmentHash, type EvaluationInput } from "../src/payload";
import type { LlmTaskExecutionOptions } from "../src/llm-command-adapter";

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
    evaluateDecision(buildHistoricalInput(parsed, `bootstrap_audit_${index}`), "L2"));
}

function buildLlmOptions(
  command: string | undefined,
  argsJson: string | undefined,
  providerLabel: string,
): LlmTaskExecutionOptions | undefined {
  if (!command) {
    return undefined;
  }

  let args: string[] = [];
  if (argsJson) {
    const parsed = JSON.parse(argsJson);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new Error("LLM args must be a JSON string array.");
    }
    args = parsed;
  }

  return {
    invocation: {
      command,
      args,
      providerLabel,
    },
  };
}

async function main() {
  const [, , fileArg, ...restArgs] = process.argv;

  if (!fileArg) {
    console.error("Usage: npm run audit -- <path-to-evaluation-input.json> [--auditor <id>] [--data-dir <dir>] [--bootstrap-l3] [--llm-auditor-command <cmd>] [--llm-auditor-args-json <json-array>]");
    process.exit(1);
  }

  const auditorFlagIndex = restArgs.findIndex((arg) => arg === "--auditor");
  const dataDirFlagIndex = restArgs.findIndex((arg) => arg === "--data-dir");
  const llmAuditorCommandFlagIndex = restArgs.findIndex((arg) => arg === "--llm-auditor-command");
  const llmAuditorArgsFlagIndex = restArgs.findIndex((arg) => arg === "--llm-auditor-args-json");
  const bootstrapL3 = restArgs.includes("--bootstrap-l3");

  const auditorAgentId = auditorFlagIndex >= 0 ? restArgs[auditorFlagIndex + 1] : "auditor-agent-001";
  const dataDir = dataDirFlagIndex >= 0 ? restArgs[dataDirFlagIndex + 1] : undefined;
  const llmAuditor = buildLlmOptions(
    llmAuditorCommandFlagIndex >= 0 ? restArgs[llmAuditorCommandFlagIndex + 1] : undefined,
    llmAuditorArgsFlagIndex >= 0 ? restArgs[llmAuditorArgsFlagIndex + 1] : undefined,
    "custom-auditor",
  );

  const fullPath = path.resolve(process.cwd(), fileArg);
  const raw = await readFile(fullPath, "utf8");
  const parsed = EvaluationInputSchema.parse(JSON.parse(raw));
  const priorEvaluations = bootstrapL3 ? buildBootstrapEvaluations(parsed) : [];

  await evaluateAndPersist(parsed, {
    ...(bootstrapL3 ? { currentLevel: "L2" } : {}),
    ...(priorEvaluations.length > 0 ? { priorEvaluations } : {}),
    ...(dataDir ? { dataDir } : {}),
  });

  const report = await generateAuditReport(parsed.payload.agent_id, {
    ...(dataDir ? { dataDir } : {}),
    ...(auditorAgentId ? { auditorAgentId } : {}),
    ...(llmAuditor ? { llm: llmAuditor } : {}),
  });
  const board = await applyLicenseBoardDecision(parsed.payload.agent_id, {
    ...(dataDir ? { dataDir } : {}),
  });
  const certificate = await generateLicenseCertificate(parsed.payload.agent_id, {
    ...(dataDir ? { dataDir } : {}),
  });

  const targetDataDir = dataDir ?? path.join(process.cwd(), "data");
  console.log("Agent:", parsed.payload.agent_id);
  console.log("Auditor:", report.auditor_agent_id);
  console.log("Audit verdict:", report.audit_verdict);
  console.log("Recommended level:", report.recommended_level);
  console.log("License Board action:", board.decision.final_action);
  console.log("Issued level:", board.license.currentLevel);
  console.log("Certificate path:", path.join(targetDataDir, "certificates", `${parsed.payload.agent_id}.json`));
  console.log("Audit report path:", path.join(targetDataDir, "audits", `${parsed.payload.agent_id}.json`));
  console.log("License Board path:", path.join(targetDataDir, "license-board-decisions", `${parsed.payload.agent_id}.json`));
  console.log("Certificate level:", certificate.current_level);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
