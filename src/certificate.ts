import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AttestationRecord, LicenseStateRecord, AgentRecord } from "./state";
import type { ExecutionMode, LicenseLevel } from "./types";

export interface LicenseCertificate {
  certificate_version: string;
  certificate_id: string;
  agent_id: string;
  agent_name: string;
  strategy_id?: string;
  strategy_version_hash?: string;
  current_level: LicenseLevel;
  current_level_label: string;
  allowed_execution_modes: ExecutionMode[];
  policy_hash: string;
  prompt_hash: string;
  evaluation_window_type: string;
  valid_shadow_trade_count: number;
  average_policy_compliance_bps: number;
  rolling_max_drawdown_bps: number;
  average_risk_adjusted_score: number;
  warning_count_last_5: number;
  fail_count_last_5: number;
  attestation_id: string;
  issued_at: string;
  updated_at: string;
  active: boolean;
  revoked: boolean;
  reason: string;
}

export interface GenerateLicenseCertificateOptions {
  dataDir?: string;
}

function levelLabel(level: LicenseLevel): string {
  switch (level) {
    case "L0":
      return "L0_Observe";
    case "L1":
      return "L1_Advise";
    case "L2":
      return "L2_Shadow";
    case "L3":
      return "L3_Protected_Execution";
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function generateLicenseCertificate(
  agentId: string,
  options: GenerateLicenseCertificateOptions = {},
): Promise<LicenseCertificate> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const licensePath = path.join(dataDir, "licenses", `${agentId}.json`);
  const agentPath = path.join(dataDir, "agents", `${agentId}.json`);

  const license = await readJson<LicenseStateRecord>(licensePath);
  const agent = await readJson<AgentRecord>(agentPath);
  const attestationPath = path.join(dataDir, "attestations", `${license.lastAttestationId}.json`);
  const attestation = await readJson<AttestationRecord>(attestationPath);

  const certificate: LicenseCertificate = {
    certificate_version: "1.0.0",
    certificate_id: `cert_${agentId}_${license.currentLevel.toLowerCase()}`,
    agent_id: agent.agentId,
    agent_name: agent.name,
    ...(license.strategyId
      ? {
          strategy_id: license.strategyId,
          strategy_version_hash: license.strategyVersionHash,
        }
      : {}),
    current_level: license.currentLevel,
    current_level_label: levelLabel(license.currentLevel),
    allowed_execution_modes: license.allowedExecutionModes,
    policy_hash: agent.policyHash,
    prompt_hash: agent.promptHash,
    evaluation_window_type: attestation.windowType,
    valid_shadow_trade_count: attestation.validShadowTradeCount,
    average_policy_compliance_bps: attestation.averagePolicyComplianceBps,
    rolling_max_drawdown_bps: attestation.rollingMaxDrawdownBps,
    average_risk_adjusted_score: attestation.averageRiskAdjustedScore,
    warning_count_last_5: attestation.warningCountLast5,
    fail_count_last_5: attestation.failCountLast5,
    attestation_id: attestation.attestationId,
    issued_at: attestation.issuedAt,
    updated_at: license.updatedAt,
    active: license.active,
    revoked: license.revoked,
    reason: license.reason,
  };

  await writeJson(path.join(dataDir, "certificates", `${agentId}.json`), certificate);
  return certificate;
}
