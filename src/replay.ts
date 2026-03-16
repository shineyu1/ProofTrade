import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { evaluateDecision, type DecisionEvaluation } from "./evaluator";
import { buildCommitmentHash, EvaluationInputSchema, type EvaluationInput } from "./payload";
import { generateLicenseCertificate, type LicenseCertificate } from "./certificate";
import { generateAuditReport } from "./auditor";
import { applyLicenseBoardDecision } from "./license-board";
import { evaluateAndPersist } from "./state";
import type { LicenseLevel } from "./types";

export interface RunShadowReplayOptions {
  dataDir?: string;
  scenarioName?: string;
  decisionCount?: number;
}

export interface ShadowReplayResult {
  scenarioName: string;
  finalLevel: LicenseLevel;
  accessGranted: boolean;
  transcript: string[];
  certificate: LicenseCertificate;
  evidenceDir: string;
}

function buildReplayInput(base: EvaluationInput, decisionIndex: number): EvaluationInput {
  const decisionId = `replay_${decisionIndex.toString().padStart(4, "0")}`;
  const timestamp = new Date(Date.parse(base.payload.timestamp) + decisionIndex * 60_000).toISOString();
  const payload = {
    ...base.payload,
    decision_id: decisionId,
    timestamp,
  };
  const commitment = {
    ...base.commitment,
    commitment_id: `commit_${decisionId}`,
    commitment_hash: buildCommitmentHash(payload),
    created_at: timestamp,
    expires_at: new Date(Date.parse(timestamp) + payload.evaluation.window_sec * 1000).toISOString(),
  };

  return EvaluationInputSchema.parse({
    ...base,
    payload,
    commitment,
  });
}

async function writeEvidenceFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

export async function runShadowReplay(
  baseInput: EvaluationInput,
  options: RunShadowReplayOptions = {},
): Promise<ShadowReplayResult> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const scenarioName = options.scenarioName ?? "historical-shadow-replay";
  const decisionCount = options.decisionCount ?? 10;
  const transcript: string[] = [
    `Scenario: ${scenarioName}`,
    `Agent: ${baseInput.payload.agent_id}`,
    "Mode: historical replay",
    "",
  ];
  const priorEvaluations: DecisionEvaluation[] = [];
  let finalLevel: LicenseLevel = "L2";

  for (let index = 1; index <= decisionCount; index += 1) {
    const replayInput = buildReplayInput(baseInput, index);
    const result = await evaluateAndPersist(replayInput, {
      currentLevel: "L2",
      priorEvaluations,
      dataDir,
    });
    priorEvaluations.push(result.evaluation);
    finalLevel = result.license.currentLevel;

    transcript.push(
      `Decision ${index}: ${result.evaluation.decisionId} | verdict=${result.evaluation.verdict} | policy=${result.evaluation.policyComplianceBps}bps | pnl=${result.evaluation.syntheticPnlBps}bps | level=${result.license.currentLevel}${result.license.pendingPromotionTo ? ` | pending=${result.license.pendingPromotionTo}` : ""}`,
    );
  }

  const audit = await generateAuditReport(baseInput.payload.agent_id, {
    dataDir,
    auditorAgentId: "auditor-agent-001",
  });
  const board = await applyLicenseBoardDecision(baseInput.payload.agent_id, { dataDir });
  const certificate = await generateLicenseCertificate(baseInput.payload.agent_id, { dataDir });
  const evidenceDir = path.join(dataDir, "evidence", scenarioName);
  finalLevel = board.license.currentLevel;
  const accessGranted = finalLevel === "L3";

  transcript.push("");
  transcript.push(`Audit verdict: ${audit.audit_verdict}`);
  transcript.push(`License Board action: ${board.decision.final_action}`);
  transcript.push(`Final level: ${finalLevel}`);
  transcript.push(
    accessGranted
      ? "ACCESS GRANTED: Upgraded to L3"
      : "ACCESS DENIED: Agent remains below protected execution threshold",
  );

  await writeEvidenceFile(path.join(evidenceDir, "shadow-replay.log"), `${transcript.join("\n")}\n`);
  await writeEvidenceFile(
    path.join(evidenceDir, "license_certificate.json"),
    `${JSON.stringify(certificate, null, 2)}\n`,
  );

  return {
    scenarioName,
    finalLevel,
    accessGranted,
    transcript,
    certificate,
    evidenceDir,
  };
}
