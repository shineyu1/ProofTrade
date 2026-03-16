import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AuditReport } from "./auditor";
import type { AttestationRecord, LicenseStateRecord } from "./state";
import type { ExecutionMode, LicenseLevel } from "./types";

export type LicenseBoardAction = "keep" | "upgrade" | "downgrade" | "revoke";

export interface LicenseBoardDecision {
  decision_version: string;
  decision_id: string;
  agent_id: string;
  strategy_id?: string;
  strategy_version_hash?: string;
  reviewed_attestation_id: string;
  reviewed_audit_report_id: string;
  previous_level: LicenseLevel;
  attested_recommended_level: LicenseLevel;
  audit_recommended_level: LicenseLevel;
  final_level: LicenseLevel;
  final_action: LicenseBoardAction;
  allowed_execution_modes: ExecutionMode[];
  rationale: string;
  issued_at: string;
}

export interface ApplyLicenseBoardDecisionOptions {
  dataDir?: string;
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function allowedExecutionModesForLevel(level: LicenseLevel): ExecutionMode[] {
  return level === "L3" ? ["algo", "bot"] : [];
}

function levelOrder(level: LicenseLevel): number {
  switch (level) {
    case "L0":
      return 0;
    case "L1":
      return 1;
    case "L2":
      return 2;
    case "L3":
      return 3;
  }
}

function decideLicenseOutcome(
  attestation: AttestationRecord,
  audit: AuditReport,
  license: LicenseStateRecord,
): Pick<LicenseBoardDecision, "final_level" | "final_action" | "allowed_execution_modes" | "rationale"> {
  if (audit.audit_verdict === "approved" && attestation.recommendedLevel === "L3") {
    return {
      final_level: "L3",
      final_action: levelOrder(license.currentLevel) < levelOrder("L3") ? "upgrade" : "keep",
      allowed_execution_modes: allowedExecutionModesForLevel("L3"),
      rationale: "License Board approved protected execution after quantitative and auditor review.",
    };
  }

  if (audit.audit_verdict === "retrain") {
    return {
      final_level: "L2",
      final_action: levelOrder(license.currentLevel) > levelOrder("L2") ? "downgrade" : "keep",
      allowed_execution_modes: allowedExecutionModesForLevel("L2"),
      rationale: "License Board requires additional shadow-mode training before protected execution.",
    };
  }

  return {
    final_level: audit.recommended_level,
    final_action: "revoke",
    allowed_execution_modes: allowedExecutionModesForLevel(audit.recommended_level),
    rationale: "License Board rejected promotion due to audit failures or severe trust violations.",
  };
}

export async function applyLicenseBoardDecision(
  agentId: string,
  options: ApplyLicenseBoardDecisionOptions = {},
): Promise<{ decision: LicenseBoardDecision; license: LicenseStateRecord }> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const licensePath = path.join(dataDir, "licenses", `${agentId}.json`);
  const license = await readJson<LicenseStateRecord>(licensePath);
  const attestation = await readJson<AttestationRecord>(
    path.join(dataDir, "attestations", `${license.lastAttestationId}.json`),
  );
  const audit = await readJson<AuditReport>(path.join(dataDir, "audits", `${agentId}.json`));
  const issuedAt = new Date().toISOString();
  const outcome = decideLicenseOutcome(attestation, audit, license);

  const decision: LicenseBoardDecision = {
    decision_version: "1.0.0",
    decision_id: `board_${agentId}_${Date.parse(issuedAt)}`,
    agent_id: agentId,
    ...(license.strategyId
      ? {
          strategy_id: license.strategyId,
          strategy_version_hash: license.strategyVersionHash,
        }
      : {}),
    reviewed_attestation_id: attestation.attestationId,
    reviewed_audit_report_id: audit.audit_report_id,
    previous_level: license.currentLevel,
    attested_recommended_level: attestation.recommendedLevel,
    audit_recommended_level: audit.recommended_level,
    final_level: outcome.final_level,
    final_action: outcome.final_action,
    allowed_execution_modes: outcome.allowed_execution_modes,
    rationale: outcome.rationale,
    issued_at: issuedAt,
  };

  const updatedLicenseBase = {
    ...license,
    currentLevel: decision.final_level,
    allowedExecutionModes: decision.allowed_execution_modes,
    active: decision.final_action !== "revoke",
    revoked: decision.final_action === "revoke",
    updatedAt: issuedAt,
    reason: decision.rationale,
  };
  const updatedLicense: LicenseStateRecord = {
    ...updatedLicenseBase,
  };
  delete updatedLicense.pendingPromotionTo;
  delete updatedLicense.pendingPromotionReason;

  await writeJson(path.join(dataDir, "license-board-decisions", `${agentId}.json`), decision);
  await writeJson(licensePath, updatedLicense);

  return {
    decision,
    license: updatedLicense,
  };
}
