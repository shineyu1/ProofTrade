import { deployProofTradeRegistry } from "../src/xlayer";

function requireHexEnv(name: string): `0x${string}` {
  const value = process.env[name];
  if (!value || !/^0x[a-fA-F0-9]+$/.test(value)) {
    throw new Error(`${name} is required and must be a 0x-prefixed hex string.`);
  }
  return value as `0x${string}`;
}

async function main() {
  const [, , ...restArgs] = process.argv;
  const networkFlagIndex = restArgs.findIndex((arg) => arg === "--network");
  const rpcFlagIndex = restArgs.findIndex((arg) => arg === "--rpc");
  const network = networkFlagIndex >= 0 ? restArgs[networkFlagIndex + 1] : "mainnet";
  const rpcUrl = rpcFlagIndex >= 0 ? restArgs[rpcFlagIndex + 1] : undefined;

  if (network !== "mainnet" && network !== "testnet") {
    throw new Error("--network must be mainnet or testnet.");
  }

  const result = await deployProofTradeRegistry({
    privateKey: requireHexEnv("X_LAYER_PRIVATE_KEY"),
    ...(rpcUrl ? { rpcUrl } : {}),
    network,
  });

  console.log("Registry deployed");
  console.log("Network:", network);
  console.log("Chain ID:", result.chainId);
  console.log("Address:", result.address);
  console.log("Deployment tx:", result.txHash);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
