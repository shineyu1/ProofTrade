import { privateKeyToAccount } from "viem/accounts";
import { defaultXLayerNetworkConfig, type XLayerNetworkProfile } from "../src/xlayer";

async function main() {
  const [, , ...restArgs] = process.argv;
  const networkFlagIndex = restArgs.findIndex((arg) => arg === "--network");
  const network = (networkFlagIndex >= 0 ? restArgs[networkFlagIndex + 1] : "testnet") as XLayerNetworkProfile;
  const privateKey = process.env.X_LAYER_PRIVATE_KEY as `0x${string}` | undefined;

  if (!privateKey) {
    console.error("Missing X_LAYER_PRIVATE_KEY in environment.");
    process.exit(1);
  }

  const account = privateKeyToAccount(privateKey);
  const config = defaultXLayerNetworkConfig(network);

  console.log("Network:", config.networkName);
  console.log("Chain ID:", config.chainId);
  console.log("RPC URL:", config.rpcUrl);
  console.log("Explorer:", config.explorerUrl);
  console.log("Address:", account.address);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
