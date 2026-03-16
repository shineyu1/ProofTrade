import { readFile } from "node:fs/promises";
import path from "node:path";
import solc from "solc";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  stringToHex,
  type Abi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AgentRecord, AttestationRecord, LicenseStateRecord } from "./state";
import type { AuditReport } from "./auditor";
import type { ExecutionMode, LicenseLevel } from "./types";

export type XLayerNetworkProfile = "mainnet" | "testnet";

export interface XLayerNetworkConfig {
  chainId: number;
  networkName: string;
  rpcUrl: string;
  explorerUrl: string;
}

export interface OnchainIdentityPublication {
  agentId: string;
  agentKey: `0x${string}`;
  agentUri: string;
  promptHash: `0x${string}`;
  policyHash: `0x${string}`;
  active: boolean;
  updatedAt: string;
  metadataHash: `0x${string}`;
}

export interface OnchainLicensePublication {
  agentId: string;
  agentKey: `0x${string}`;
  currentLevel: LicenseLevel;
  allowedExecutionModes: ExecutionMode[];
  active: boolean;
  revoked: boolean;
  certificateHash: `0x${string}`;
  evidenceUri: string;
  issuedAt: string;
}

export interface OnchainValidationPublication {
  agentId: string;
  agentKey: `0x${string}`;
  validationId: string;
  validationType: "attestation";
  validationHash: `0x${string}`;
  evidenceUri: string;
  issuedAt: string;
}

export interface OnchainAuditPublication {
  agentId: string;
  agentKey: `0x${string}`;
  auditReportId: string;
  auditorAgentId: string;
  verdict: string;
  auditHash: `0x${string}`;
  evidenceUri: string;
  issuedAt: string;
}

export interface OnchainPublicationBundle {
  network: XLayerNetworkConfig;
  identity: OnchainIdentityPublication;
  license: OnchainLicensePublication;
  validation: OnchainValidationPublication;
  audit: OnchainAuditPublication;
}

export interface BuildOnchainPublicationBundleOptions {
  dataDir?: string;
  network?: XLayerNetworkProfile;
  agentUri?: string;
  evidenceBaseUri?: string;
}

export interface CompiledRegistry {
  abi: Abi;
  bytecode: `0x${string}`;
}

export interface DeployRegistryOptions {
  privateKey: `0x${string}`;
  rpcUrl?: string;
  network?: XLayerNetworkProfile;
}

export interface DeployRegistryResult {
  address: `0x${string}`;
  txHash: `0x${string}`;
  chainId: number;
}

export interface PublishOptions extends DeployRegistryOptions {
  registryAddress: `0x${string}`;
}

export interface PublishProofTradeBundleOptions extends PublishOptions, BuildOnchainPublicationBundleOptions {}

export interface PublishResult {
  registerTxHash: `0x${string}`;
  validationTxHash: `0x${string}`;
  licenseTxHash: `0x${string}`;
  auditTxHash: `0x${string}`;
  chainId: number;
}

const CONTRACT_NAME = "ProofTradeRegistry";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);

  return `{${entries.join(",")}}`;
}

function hashString(value: string): `0x${string}` {
  return keccak256(stringToHex(value));
}

function normalizeHash(value: string): `0x${string}` {
  if (/^0x[a-fA-F0-9]{64}$/.test(value)) {
    return value.toLowerCase() as `0x${string}`;
  }
  return hashString(value);
}

function toUnixSeconds(timestamp: string): bigint {
  return BigInt(Math.floor(Date.parse(timestamp) / 1000));
}

async function readJson<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

function buildChain(config: XLayerNetworkConfig) {
  return defineChain({
    id: config.chainId,
    name: config.networkName,
    nativeCurrency: {
      name: "OKB",
      symbol: "OKB",
      decimals: 18,
    },
    rpcUrls: {
      default: {
        http: [config.rpcUrl],
      },
    },
    blockExplorers: {
      default: {
        name: "OKX Explorer",
        url: config.explorerUrl,
      },
    },
  });
}

export function defaultXLayerNetworkConfig(network: XLayerNetworkProfile = "mainnet"): XLayerNetworkConfig {
  if (network === "testnet") {
    return {
      chainId: 1952,
      networkName: "X Layer testnet",
      rpcUrl: "https://testrpc.xlayer.tech/terigon",
      explorerUrl: "https://www.okx.com/web3/explorer/xlayer-test",
    };
  }

  return {
    chainId: 196,
    networkName: "X Layer mainnet",
    rpcUrl: "https://rpc.xlayer.tech",
    explorerUrl: "https://www.okx.com/web3/explorer/xlayer",
  };
}

export async function buildOnchainPublicationBundle(
  agentId: string,
  options: BuildOnchainPublicationBundleOptions = {},
): Promise<OnchainPublicationBundle> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  const network = defaultXLayerNetworkConfig(options.network ?? "mainnet");
  const agent = await readJson<AgentRecord>(path.join(dataDir, "agents", `${agentId}.json`));
  const license = await readJson<LicenseStateRecord>(path.join(dataDir, "licenses", `${agentId}.json`));
  const attestation = await readJson<AttestationRecord>(
    path.join(dataDir, "attestations", `${license.lastAttestationId}.json`),
  );
  const certificate = await readJson<Record<string, unknown>>(path.join(dataDir, "certificates", `${agentId}.json`));
  const audit = await readJson<AuditReport>(path.join(dataDir, "audits", `${agentId}.json`));

  const agentKey = hashString(agent.agentId);
  const agentUri = options.agentUri ?? `prooftrade://agents/${agent.agentId}`;
  const evidenceBaseUri = options.evidenceBaseUri ?? "prooftrade://evidence";

  return {
    network,
    identity: {
      agentId: agent.agentId,
      agentKey,
      agentUri,
      promptHash: normalizeHash(agent.promptHash),
      policyHash: normalizeHash(agent.policyHash),
      active: agent.status === "active",
      updatedAt: agent.updatedAt,
      metadataHash: hashString(stableStringify(agent)),
    },
    license: {
      agentId: agent.agentId,
      agentKey,
      currentLevel: license.currentLevel,
      allowedExecutionModes: license.allowedExecutionModes,
      active: license.active,
      revoked: license.revoked,
      certificateHash: hashString(stableStringify(certificate)),
      evidenceUri: `${evidenceBaseUri}/${agent.agentId}/license_certificate.json`,
      issuedAt: license.updatedAt,
    },
    validation: {
      agentId: agent.agentId,
      agentKey,
      validationId: attestation.attestationId,
      validationType: "attestation",
      validationHash: hashString(stableStringify(attestation)),
      evidenceUri: `${evidenceBaseUri}/${agent.agentId}/attestation.json`,
      issuedAt: attestation.issuedAt,
    },
    audit: {
      agentId: agent.agentId,
      agentKey,
      auditReportId: audit.audit_report_id,
      auditorAgentId: audit.auditor_agent_id,
      verdict: audit.audit_verdict,
      auditHash: hashString(stableStringify(audit)),
      evidenceUri: `${evidenceBaseUri}/${agent.agentId}/audit_report.json`,
      issuedAt: audit.issued_at,
    },
  };
}

export async function compileProofTradeRegistry(): Promise<CompiledRegistry> {
  const contractPath = path.join(process.cwd(), "contracts", `${CONTRACT_NAME}.sol`);
  const source = await readFile(contractPath, "utf8");
  const input = {
    language: "Solidity",
    sources: {
      [`${CONTRACT_NAME}.sol`]: {
        content: source,
      },
    },
    settings: {
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"],
        },
      },
    },
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    contracts?: Record<string, Record<string, { abi: Abi; evm: { bytecode: { object: string } } }>>;
    errors?: Array<{ severity: string; formattedMessage: string }>;
  };

  const errors = output.errors?.filter((item) => item.severity === "error") ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
  }

  const contract = output.contracts?.[`${CONTRACT_NAME}.sol`]?.[CONTRACT_NAME];
  if (!contract) {
    throw new Error(`Unable to find compiled contract ${CONTRACT_NAME}.`);
  }

  return {
    abi: contract.abi,
    bytecode: `0x${contract.evm.bytecode.object}` as `0x${string}`,
  };
}

function licenseLevelCode(level: LicenseLevel): number {
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

function resolveNetworkConfig(options: { network?: XLayerNetworkProfile; rpcUrl?: string }): XLayerNetworkConfig {
  const defaults = defaultXLayerNetworkConfig(options.network ?? "mainnet");
  return {
    ...defaults,
    ...(options.rpcUrl ? { rpcUrl: options.rpcUrl } : {}),
  };
}

export async function deployProofTradeRegistry(options: DeployRegistryOptions): Promise<DeployRegistryResult> {
  const compiled = await compileProofTradeRegistry();
  const network = resolveNetworkConfig(options);
  const chain = buildChain(network);
  const account = privateKeyToAccount(options.privateKey);
  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });

  const txHash = await walletClient.deployContract({
    abi: compiled.abi,
    bytecode: compiled.bytecode,
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (!receipt.contractAddress) {
    throw new Error("Registry deployment did not return a contract address.");
  }

  return {
    address: receipt.contractAddress,
    txHash,
    chainId: network.chainId,
  };
}

async function writeContract(
  abi: Abi,
  functionName: "registerOrUpdateAgent" | "publishValidation" | "publishLicense" | "publishAudit",
  args: readonly unknown[],
  options: PublishOptions,
): Promise<`0x${string}`> {
  const network = resolveNetworkConfig(options);
  const chain = buildChain(network);
  const account = privateKeyToAccount(options.privateKey);
  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
  const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });

  const txHash = await walletClient.writeContract({
    address: options.registryAddress,
    abi,
    functionName,
    args,
    account,
    chain,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return txHash;
}

export async function publishProofTradeBundle(
  bundle: OnchainPublicationBundle,
  options: PublishOptions,
): Promise<PublishResult> {
  const compiled = await compileProofTradeRegistry();

  const registerTxHash = await writeContract(
    compiled.abi,
    "registerOrUpdateAgent",
    [
      bundle.identity.agentKey,
      bundle.identity.agentId,
      bundle.identity.agentUri,
      bundle.identity.promptHash,
      bundle.identity.policyHash,
      bundle.identity.active,
      toUnixSeconds(bundle.identity.updatedAt),
    ],
    options,
  );

  const validationTxHash = await writeContract(
    compiled.abi,
    "publishValidation",
    [
      bundle.validation.agentKey,
      bundle.validation.validationId,
      bundle.validation.validationType,
      bundle.validation.validationHash,
      bundle.validation.evidenceUri,
      toUnixSeconds(bundle.validation.issuedAt),
    ],
    options,
  );

  const licenseTxHash = await writeContract(
    compiled.abi,
    "publishLicense",
    [
      bundle.license.agentKey,
      licenseLevelCode(bundle.license.currentLevel),
      bundle.license.active,
      bundle.license.revoked,
      bundle.license.certificateHash,
      bundle.license.evidenceUri,
      toUnixSeconds(bundle.license.issuedAt),
    ],
    options,
  );

  const auditTxHash = await writeContract(
    compiled.abi,
    "publishAudit",
    [
      bundle.audit.agentKey,
      bundle.audit.auditReportId,
      bundle.audit.auditorAgentId,
      bundle.audit.verdict,
      bundle.audit.auditHash,
      bundle.audit.evidenceUri,
      toUnixSeconds(bundle.audit.issuedAt),
    ],
    options,
  );

  return {
    registerTxHash,
    validationTxHash,
    licenseTxHash,
    auditTxHash,
    chainId: bundle.network.chainId,
  };
}

export async function publishProofTradeState(
  agentId: string,
  options: PublishProofTradeBundleOptions,
): Promise<PublishResult> {
  const bundle = await buildOnchainPublicationBundle(agentId, options);
  return publishProofTradeBundle(bundle, options);
}
