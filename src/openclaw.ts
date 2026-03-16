import path from "node:path";
import { generateAuditReport, type AuditReport } from "./auditor";
import { generateLicenseCertificate, type LicenseCertificate } from "./certificate";
import { evaluateDecision } from "./evaluator";
import { executeProtected, type ProtectedExecutionRecord } from "./execution";
import { applyLicenseBoardDecision, type LicenseBoardDecision } from "./license-board";
import { buildCommitmentHash, EvaluationInputSchema, type EvaluationInput } from "./payload";
import {
  prepareAndSubmitProtectedExecution,
  type CommandRunner,
  type OkxDemoSubmissionRecord,
} from "./okx-provider";
import {
  evaluateAndPersist,
  type LicenseStateRecord,
  type PersistResult,
} from "./state";
import {
  applyRuntimeGuard,
  type RuntimeGuardReport,
} from "./runtime-guard";
import { buildStrategyContextFromInput, syncInputWithOkxContext } from "./strategy-context";
import { loadStrategyDefinition } from "./strategy-loader";
import { getActiveStrategyForAgent, setActiveStrategyForAgent } from "./strategy-registry";
import { normalizeStrategyDecision } from "./strategy-normalizer";
import { runStrategyDecision } from "./strategy-runner";
import type { ExecutionMode, LicenseLevel } from "./types";
import {
  publishProofTradeState,
  type PublishProofTradeBundleOptions,
  type PublishResult,
  type XLayerNetworkProfile,
} from "./xlayer";
import type { LlmTaskExecutionOptions } from "./llm-command-adapter";

export type OpenClawWorkflow =
  | "status"
  | "review"
  | "execute"
  | "submit"
  | "guard"
  | "publish"
  | "full-demo";

export interface OpenClawXLayerOptions {
  network?: XLayerNetworkProfile;
  agentUri?: string;
  evidenceBaseUri?: string;
  rpcUrl?: string;
  privateKey?: `0x${string}`;
  registryAddress?: `0x${string}`;
}

export interface OpenClawPublishInvocationOptions {
  dataDir?: string;
  network?: XLayerNetworkProfile;
  agentUri?: string;
  evidenceBaseUri?: string;
  rpcUrl?: string;
  privateKey?: `0x${string}`;
  registryAddress?: `0x${string}`;
}

export interface OpenClawWorkflowArtifacts {
  dataDir: string;
  agentPath: string;
  commitmentPath: string;
  attestationPath: string;
  licensePath: string;
  auditPath?: string;
  boardDecisionPath?: string;
  certificatePath?: string;
  revocationPath?: string;
  executionPath?: string;
  submissionPath?: string;
}

export interface OpenClawRuntimeGuardOptions {
  currentPrice?: number;
  maxDrawdownBps?: number;
  hardRevokeDrawdownBps?: number;
  observationSource?: string;
}

export interface OpenClawWorkflowOptions {
  workflow: OpenClawWorkflow;
  dataDir?: string;
  strategyId?: string;
  mode?: ExecutionMode;
  bootstrapL3?: boolean;
  auditorAgentId?: string;
  currentLevel?: LicenseLevel;
  agentName?: string;
  profile?: string;
  runner?: CommandRunner;
  okxHomeDir?: string;
  llm?: {
    auditor?: LlmTaskExecutionOptions;
    strategy?: LlmTaskExecutionOptions;
  };
  publishToXLayer?: boolean;
  runtimeGuard?: OpenClawRuntimeGuardOptions;
  xlayer?: OpenClawXLayerOptions;
  publisher?: (
    agentId: string,
    options: OpenClawPublishInvocationOptions,
  ) => Promise<PublishResult>;
}

export interface OpenClawWorkflowResult {
  workflow: OpenClawWorkflow;
  agentId: string;
  evaluation: PersistResult["evaluation"];
  recommendation: PersistResult["recommendation"];
  license: LicenseStateRecord;
  transcript: string[];
  artifacts: OpenClawWorkflowArtifacts;
  audit?: AuditReport;
  boardDecision?: LicenseBoardDecision;
  certificate?: LicenseCertificate;
  runtimeGuard?: RuntimeGuardReport;
  execution?: ProtectedExecutionRecord;
  submission?: OkxDemoSubmissionRecord;
  publication?: PublishResult;
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

function buildBootstrapEvaluations(base: EvaluationInput) {
  return Array.from({ length: 9 }, (_, index) =>
    evaluateDecision(buildHistoricalInput(base, `bootstrap_${index}`), "L2"));
}

async function resolveEffectiveInput(
  input: EvaluationInput,
  dataDir: string,
  transcript: string[],
  strategyId?: string,
  profile?: string,
  runner?: CommandRunner,
  okxHomeDir?: string,
  strategyLlm?: LlmTaskExecutionOptions,
): Promise<EvaluationInput> {
  const { input: contextSyncedInput, context: liveContext } = await syncInputWithOkxContext(input, {
    ...(profile ? { profile } : {}),
    ...(runner ? { runner } : {}),
    ...(okxHomeDir ? { okxHomeDir } : {}),
  });

  if (liveContext) {
    const liveContextDetails = [
      `last=${liveContext.lastPrice}`,
      ...(liveContext.bidPrice !== undefined ? [`bid=${liveContext.bidPrice}`] : []),
      ...(liveContext.askPrice !== undefined ? [`ask=${liveContext.askPrice}`] : []),
      ...(liveContext.high24h !== undefined ? [`high24h=${liveContext.high24h}`] : []),
      ...(liveContext.low24h !== undefined ? [`low24h=${liveContext.low24h}`] : []),
      ...(liveContext.vol24h !== undefined ? [`vol24h=${liveContext.vol24h}`] : []),
      ...(liveContext.change24hPct !== undefined ? [`change24h=${liveContext.change24hPct}%`] : []),
      `balance=${liveContext.availableBalance}`,
      ...(liveContext.totalEquity !== undefined ? [`totalEq=${liveContext.totalEquity}`] : []),
      ...(liveContext.unrealizedPnl !== undefined ? [`upl=${liveContext.unrealizedPnl}`] : []),
      `positions=${liveContext.positions.length}`,
    ].join(", ");
    transcript.push(
      `Live OKX context synced: ${liveContextDetails}`,
    );
  }

  if (strategyId) {
    await setActiveStrategyForAgent(contextSyncedInput.payload.agent_id, strategyId, { dataDir });
  }

  const activeStrategy = await getActiveStrategyForAgent(contextSyncedInput.payload.agent_id, { dataDir });
  if (!activeStrategy) {
    return contextSyncedInput;
  }

  const strategy = loadStrategyDefinition(activeStrategy.strategyId);
  const context = buildStrategyContextFromInput(contextSyncedInput, strategy);
  const output = await runStrategyDecision(strategy, context, {
    ...(strategyLlm ? { llm: strategyLlm } : {}),
  });
  const normalizedPayload = normalizeStrategyDecision({
    baseInput: contextSyncedInput,
    strategy,
    output,
    decisionId: contextSyncedInput.payload.decision_id,
    timestamp: contextSyncedInput.payload.timestamp,
  });

  transcript.push(`Active strategy: ${strategy.strategyId}`);
  transcript.push(`Strategy requested execution mode: ${output.requestedExecutionMode}`);

  return EvaluationInputSchema.parse({
    ...contextSyncedInput,
    payload: normalizedPayload,
    commitment: {
      ...contextSyncedInput.commitment,
      commitment_hash: buildCommitmentHash(normalizedPayload),
    },
  });
}

function buildArtifacts(dataDir: string, persist: PersistResult): OpenClawWorkflowArtifacts {
  return {
    dataDir,
    agentPath: path.join(dataDir, "agents", `${persist.agent.agentId}.json`),
    commitmentPath: path.join(dataDir, "commitments", `${persist.commitment.commitmentId}.json`),
    attestationPath: path.join(dataDir, "attestations", `${persist.attestation.attestationId}.json`),
    licensePath: path.join(dataDir, "licenses", `${persist.license.agentId}.json`),
  };
}

function requireMode(workflow: OpenClawWorkflow, mode?: ExecutionMode): ExecutionMode {
  if (mode) {
    return mode;
  }
  throw new Error(`Workflow '${workflow}' requires --mode algo|bot.`);
}

function requireHexEnv(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value || !/^0x[a-fA-F0-9]+$/.test(value)) {
    throw new Error(`${name} is required and must be a 0x-prefixed hex string.`);
  }
  return value as `0x${string}`;
}

function requireAddressEnv(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`${name} is required and must be a 20-byte 0x-prefixed address.`);
  }
  return value as `0x${string}`;
}

function resolvePublishOptions(
  options: OpenClawWorkflowOptions,
): PublishProofTradeBundleOptions {
  const resolved: PublishProofTradeBundleOptions = {
    privateKey: options.xlayer?.privateKey ?? requireHexEnv("X_LAYER_PRIVATE_KEY"),
    registryAddress: options.xlayer?.registryAddress ?? requireAddressEnv("PROOFTRADE_REGISTRY_ADDRESS"),
  };

  if (options.dataDir) resolved.dataDir = options.dataDir;
  if (options.xlayer?.network) resolved.network = options.xlayer.network;
  if (options.xlayer?.agentUri) resolved.agentUri = options.xlayer.agentUri;
  if (options.xlayer?.evidenceBaseUri) resolved.evidenceBaseUri = options.xlayer.evidenceBaseUri;
  if (options.xlayer?.rpcUrl) resolved.rpcUrl = options.xlayer.rpcUrl;

  return resolved;
}

function buildPublishInvocationOptions(options: OpenClawWorkflowOptions): OpenClawPublishInvocationOptions {
  const resolved: OpenClawPublishInvocationOptions = {};

  if (options.dataDir) resolved.dataDir = options.dataDir;
  if (options.xlayer?.network) resolved.network = options.xlayer.network;
  if (options.xlayer?.agentUri) resolved.agentUri = options.xlayer.agentUri;
  if (options.xlayer?.evidenceBaseUri) resolved.evidenceBaseUri = options.xlayer.evidenceBaseUri;
  if (options.xlayer?.rpcUrl) resolved.rpcUrl = options.xlayer.rpcUrl;
  if (options.xlayer?.privateKey) resolved.privateKey = options.xlayer.privateKey;
  if (options.xlayer?.registryAddress) resolved.registryAddress = options.xlayer.registryAddress;

  return resolved;
}

export async function runOpenClawWorkflow(
  input: EvaluationInput,
  options: OpenClawWorkflowOptions,
): Promise<OpenClawWorkflowResult> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const transcript: string[] = [];
  const effectiveInput = await resolveEffectiveInput(
    input,
    dataDir,
    transcript,
    options.strategyId,
    options.profile,
    options.runner,
    options.okxHomeDir,
    options.llm?.strategy,
  );
  const priorEvaluations = options.bootstrapL3 ? buildBootstrapEvaluations(effectiveInput) : [];
  const initialPersist = await evaluateAndPersist(effectiveInput, {
    ...(options.currentLevel ? { currentLevel: options.currentLevel } : {}),
    ...(options.bootstrapL3 ? { currentLevel: "L2" } : {}),
    ...(priorEvaluations.length > 0 ? { priorEvaluations } : {}),
    ...(options.agentName ? { agentName: options.agentName } : {}),
    dataDir,
  });
  const artifacts = buildArtifacts(dataDir, initialPersist);
  let license = initialPersist.license;
  let audit: AuditReport | undefined;
  let boardDecision: LicenseBoardDecision | undefined;
  let certificate: LicenseCertificate | undefined;
  let runtimeGuard: RuntimeGuardReport | undefined;
  let execution: ProtectedExecutionRecord | undefined;
  let submission: OkxDemoSubmissionRecord | undefined;
  let publication: PublishResult | undefined;

  transcript.push(`OpenClaw workflow: ${options.workflow}`);
  transcript.push(`Agent: ${effectiveInput.payload.agent_id}`);
  transcript.push(`Commitment verified: ${initialPersist.evaluation.commitmentVerified}`);
  transcript.push(`Evaluation verdict: ${initialPersist.evaluation.verdict}`);
  transcript.push(`Recommended action: ${initialPersist.recommendation.action}`);
  transcript.push(`Current license level: ${license.currentLevel}`);
  if (license.pendingPromotionTo) {
    transcript.push(`Pending promotion: ${license.pendingPromotionTo}`);
  }

  const reviewWorkflows = new Set<OpenClawWorkflow>(["review", "execute", "submit", "guard", "publish", "full-demo"]);
  if (reviewWorkflows.has(options.workflow)) {
    audit = await generateAuditReport(effectiveInput.payload.agent_id, {
      dataDir,
      ...(options.auditorAgentId ? { auditorAgentId: options.auditorAgentId } : {}),
      ...(options.llm?.auditor ? { llm: options.llm.auditor } : {}),
    });
    boardDecision = (await applyLicenseBoardDecision(effectiveInput.payload.agent_id, { dataDir })).decision;
    certificate = await generateLicenseCertificate(effectiveInput.payload.agent_id, { dataDir });
    license = {
      ...license,
      currentLevel: boardDecision.final_level,
      allowedExecutionModes: boardDecision.allowed_execution_modes,
      active: boardDecision.final_action !== "revoke",
      revoked: boardDecision.final_action === "revoke",
      reason: boardDecision.rationale,
    };
    artifacts.auditPath = path.join(dataDir, "audits", `${effectiveInput.payload.agent_id}.json`);
    artifacts.boardDecisionPath = path.join(dataDir, "license-board-decisions", `${effectiveInput.payload.agent_id}.json`);
    artifacts.certificatePath = path.join(dataDir, "certificates", `${effectiveInput.payload.agent_id}.json`);
    transcript.push(`Audit verdict: ${audit.audit_verdict}`);
    transcript.push(`License Board action: ${boardDecision.final_action}`);
    transcript.push(`Issued level: ${boardDecision.final_level}`);
  }

  if (options.workflow === "guard") {
    if (!options.runtimeGuard) {
      throw new Error("Workflow 'guard' requires runtimeGuard options with a live profile or current price.");
    }

    const guard = await applyRuntimeGuard(effectiveInput, {
      dataDir,
      ...(options.runtimeGuard.currentPrice ? { currentPrice: options.runtimeGuard.currentPrice } : {}),
      ...(options.runtimeGuard.maxDrawdownBps ? { maxDrawdownBps: options.runtimeGuard.maxDrawdownBps } : {}),
      ...(options.runtimeGuard.hardRevokeDrawdownBps ? { hardRevokeDrawdownBps: options.runtimeGuard.hardRevokeDrawdownBps } : {}),
      ...(options.runtimeGuard.observationSource ? { observationSource: options.runtimeGuard.observationSource } : {}),
      ...(options.profile ? { profile: options.profile } : {}),
      ...(options.runner ? { runner: options.runner } : {}),
      ...(options.okxHomeDir ? { okxHomeDir: options.okxHomeDir } : {}),
    });
    runtimeGuard = guard.report;
    license = guard.license;
    artifacts.revocationPath = path.join(dataDir, "revocations", `${effectiveInput.payload.agent_id}.json`);
    certificate = await generateLicenseCertificate(effectiveInput.payload.agent_id, { dataDir });
    artifacts.certificatePath = path.join(dataDir, "certificates", `${effectiveInput.payload.agent_id}.json`);
    transcript.push(`Runtime guard action: ${guard.action}`);
    transcript.push(`Runtime guard final level: ${guard.finalLevel}`);
  }

  if (options.workflow === "execute" || options.workflow === "full-demo") {
    const mode = requireMode(options.workflow, options.mode);
    execution = await executeProtected(effectiveInput, {
      mode,
      dataDir,
    });
    artifacts.executionPath = path.join(dataDir, "executions", `${execution.executionId}.json`);
    transcript.push(`Protected execution prepared: ${execution.executionId}`);
    transcript.push(`Execution mode: ${execution.executionMode}`);
  }

  if (options.workflow === "submit") {
    const mode = requireMode(options.workflow, options.mode);
    const result = await prepareAndSubmitProtectedExecution(effectiveInput, {
      mode,
      dataDir,
      ...(options.profile ? { profile: options.profile } : {}),
      ...(options.runner ? { runner: options.runner } : {}),
      ...(options.okxHomeDir ? { okxHomeDir: options.okxHomeDir } : {}),
    });
    execution = result.execution;
    submission = result.submission;
    artifacts.executionPath = path.join(dataDir, "executions", `${execution.executionId}.json`);
    artifacts.submissionPath = path.join(dataDir, "okx-submissions", `${submission.submissionId}.json`);
    transcript.push(`Protected execution prepared: ${execution.executionId}`);
    transcript.push(`OKX demo submission accepted: ${submission.submissionId}`);
  }

  const shouldPublish = options.workflow === "publish" || options.publishToXLayer === true;
  if (shouldPublish) {
    const publishOptions = buildPublishInvocationOptions(options);
    if (options.publisher) {
      publication = await options.publisher(effectiveInput.payload.agent_id, publishOptions);
    } else {
      publication = await publishProofTradeState(
        effectiveInput.payload.agent_id,
        resolvePublishOptions(options),
      );
    }
    transcript.push(`X Layer publication completed: chain ${publication.chainId}`);
    transcript.push(`register tx: ${publication.registerTxHash}`);
  }

  return {
    workflow: options.workflow,
    agentId: effectiveInput.payload.agent_id,
    evaluation: initialPersist.evaluation,
    recommendation: initialPersist.recommendation,
    license,
    transcript,
    artifacts,
    ...(audit ? { audit } : {}),
    ...(boardDecision ? { boardDecision } : {}),
    ...(certificate ? { certificate } : {}),
    ...(runtimeGuard ? { runtimeGuard } : {}),
    ...(execution ? { execution } : {}),
    ...(submission ? { submission } : {}),
    ...(publication ? { publication } : {}),
  };
}
