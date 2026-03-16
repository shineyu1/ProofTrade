import { buildOnchainPublicationBundle, publishProofTradeBundle } from "../src/xlayer";

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

async function main() {
  const [, , agentId, ...restArgs] = process.argv;
  if (!agentId) {
    throw new Error("Usage: npm run publish:xlayer -- <agentId> [--network mainnet|testnet] [--data-dir <dir>] [--agent-uri <uri>] [--evidence-base-uri <uri>] [--rpc <url>]");
  }

  const networkFlagIndex = restArgs.findIndex((arg) => arg === "--network");
  const dataDirFlagIndex = restArgs.findIndex((arg) => arg === "--data-dir");
  const agentUriFlagIndex = restArgs.findIndex((arg) => arg === "--agent-uri");
  const evidenceBaseUriFlagIndex = restArgs.findIndex((arg) => arg === "--evidence-base-uri");
  const rpcFlagIndex = restArgs.findIndex((arg) => arg === "--rpc");

  const network = networkFlagIndex >= 0 ? restArgs[networkFlagIndex + 1] : "mainnet";
  const dataDir = dataDirFlagIndex >= 0 ? restArgs[dataDirFlagIndex + 1] : undefined;
  const agentUri = agentUriFlagIndex >= 0 ? restArgs[agentUriFlagIndex + 1] : undefined;
  const evidenceBaseUri = evidenceBaseUriFlagIndex >= 0 ? restArgs[evidenceBaseUriFlagIndex + 1] : undefined;
  const rpcUrl = rpcFlagIndex >= 0 ? restArgs[rpcFlagIndex + 1] : undefined;

  if (network !== "mainnet" && network !== "testnet") {
    throw new Error("--network must be mainnet or testnet.");
  }

  const bundle = await buildOnchainPublicationBundle(agentId, {
    ...(dataDir ? { dataDir } : {}),
    ...(agentUri ? { agentUri } : {}),
    ...(evidenceBaseUri ? { evidenceBaseUri } : {}),
    network,
  });
  const result = await publishProofTradeBundle(bundle, {
    registryAddress: requireAddressEnv("PROOFTRADE_REGISTRY_ADDRESS"),
    privateKey: requireHexEnv("X_LAYER_PRIVATE_KEY"),
    ...(rpcUrl ? { rpcUrl } : {}),
    network,
  });

  console.log("Published ProofTrade state");
  console.log("Agent:", agentId);
  console.log("Chain ID:", result.chainId);
  console.log("register tx:", result.registerTxHash);
  console.log("validation tx:", result.validationTxHash);
  console.log("license tx:", result.licenseTxHash);
  console.log("audit tx:", result.auditTxHash);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
