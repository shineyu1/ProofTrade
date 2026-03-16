import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runStructuredLlmTask, type LlmTaskExecutionOptions } from "./llm-command-adapter";
import type { AttestationRecord, LicenseStateRecord } from "./state";
import type { LicenseLevel } from "./types";

export type AuditVerdict = "approved" | "rejected" | "retrain";

export interface AuditFinding {
  code: string;
  severity: "info" | "warning" | "critical";
  summary: string;
}

export interface AuditReport {
  report_version: string;
  audit_report_id: string;
  agent_id: string;
  strategy_id?: string;
  strategy_version_hash?: string;
  auditor_agent_id: string;
  audit_window_type: string;
  reviewed_attestation_id: string;
  reviewed_license_level: LicenseLevel;
  recommended_level: LicenseLevel;
  audit_verdict: AuditVerdict;
  audit_engine: "deterministic" | "llm";
  audit_provider?: string;
  findings: AuditFinding[];
  rationale: string;
  issued_at: string;
}

export interface GenerateAuditReportOptions {
  dataDir?: string;
  auditorAgentId?: string;
  llm?: LlmTaskExecutionOptions;
}

const AuditFindingSchema = z.object({
  code: z.string().min(1),
  severity: z.enum(["info", "warning", "critical"]),
  summary: z.string().min(1),
});

const LlmAuditOutputSchema = z.object({
  recommended_level: z.enum(["L0", "L1", "L2", "L3"]),
  audit_verdict: z.enum(["approved", "rejected", "retrain"]),
  findings: z.array(AuditFindingSchema).min(1),
  rationale: z.string().min(1),
});

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function verdictFromState(attestation: AttestationRecord, license: LicenseStateRecord): {
  verdict: AuditVerdict;
  recommendedLevel: LicenseLevel;
  findings: AuditFinding[];
  rationale: string;
} {
  const findings: AuditFinding[] = [];

  if (attestation.failCountLast5 > 0 || license.revoked) {
    findings.push({
      code: "recent_failures_detected",
      severity: "critical",
      summary: "Recent failures or revocation state indicate the agent is not eligible for promotion.",
    });
    return {
      verdict: "rejected",
      recommendedLevel: "L1",
      findings,
      rationale: "Recent severe failures break the trust threshold and block promotion.",
    };
  }

  if (attestation.warningCountLast5 > 0 || attestation.averagePolicyComplianceBps < 9500) {
    findings.push({
      code: "stability_gap",
      severity: "warning",
      summary: "The agent still shows instability or weaker policy compliance inside the audit window.",
    });
    return {
      verdict: "retrain",
      recommendedLevel: "L2",
      findings,
      rationale: "The agent should remain in shadow mode for additional refinement before promotion.",
    };
  }

  findings.push({
    code: "shadow_window_approved",
    severity: "info",
    summary: "The reviewed window shows stable shadow behavior and no material policy drift.",
  });

  return {
    verdict: "approved",
    recommendedLevel: attestation.recommendedLevel,
    findings,
    rationale: attestation.recommendedLevel === "L3"
      ? "The reviewed window shows disciplined behavior and supports protected execution eligibility."
      : "The reviewed window is stable, but no higher execution tier is being recommended in this window.",
  };
}

async function verdictFromLlm(
  attestation: AttestationRecord,
  license: LicenseStateRecord,
  options: GenerateAuditReportOptions,
): Promise<
  | {
      verdict: AuditVerdict;
      recommendedLevel: LicenseLevel;
      findings: AuditFinding[];
      rationale: string;
      provider: string;
    }
  | undefined
> {
  const result = await runStructuredLlmTask(
    {
      task: "auditor",
      systemPrompt: [
        "You are the ProofTrade Auditor Agent.",
        "Review the provided trading trust window and return only a structured audit verdict.",
        "Decide whether the agent should be approved, rejected, or retrained for promotion.",
        "Be conservative. Promotion to L3 requires stable compliance, controlled drawdown, and no material trust failures.",
      ].join("\n"),
      input: {
        attestation,
        license,
      },
    },
    LlmAuditOutputSchema,
    options.llm,
  );

  if (!result) {
    return undefined;
  }

  return {
    verdict: result.output.audit_verdict,
    recommendedLevel: result.output.recommended_level,
    findings: result.output.findings,
    rationale: result.output.rationale,
    provider: result.provider,
  };
}

export async function generateAuditReport(
  agentId: string,
  options: GenerateAuditReportOptions = {},
): Promise<AuditReport> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const auditorAgentId = options.auditorAgentId ?? "auditor-agent";
  const license = await readJson<LicenseStateRecord>(path.join(dataDir, "licenses", `${agentId}.json`));
  const attestation = await readJson<AttestationRecord>(
    path.join(dataDir, "attestations", `${license.lastAttestationId}.json`),
  );
  const issuedAt = new Date().toISOString();
  const llmVerdict = await verdictFromLlm(attestation, license, options);
  const verdict = llmVerdict ?? verdictFromState(attestation, license);

  const report: AuditReport = {
    report_version: "1.0.0",
    audit_report_id: `audit_${agentId}_${Date.parse(issuedAt)}`,
    agent_id: agentId,
    ...(license.strategyId
      ? {
          strategy_id: license.strategyId,
          strategy_version_hash: license.strategyVersionHash,
        }
      : {}),
    auditor_agent_id: auditorAgentId,
    audit_window_type: attestation.windowType,
    reviewed_attestation_id: attestation.attestationId,
    reviewed_license_level: license.currentLevel,
    recommended_level: verdict.recommendedLevel,
    audit_verdict: verdict.verdict,
    audit_engine: llmVerdict ? "llm" : "deterministic",
    ...(llmVerdict ? { audit_provider: llmVerdict.provider } : {}),
    findings: verdict.findings,
    rationale: verdict.rationale,
    issued_at: issuedAt,
  };

  await writeJson(path.join(dataDir, "audits", `${agentId}.json`), report);
  return report;
}
