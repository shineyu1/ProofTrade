import { readFile } from "node:fs/promises";
import path from "node:path";
import { EvaluationInputSchema } from "../src/payload";
import { applyRuntimeGuard } from "../src/runtime-guard";
import { runOpenClawWorkflow } from "../src/openclaw";

async function main() {
  const [, , fileArg, ...restArgs] = process.argv;
  if (!fileArg) {
    throw new Error("Usage: npm run guard -- <path-to-evaluation-input.json> [--current-price <price> | --profile <name>] [--data-dir <dir>] [--bootstrap-l3] [--auditor <id>] [--max-drawdown-bps <bps>] [--hard-revoke-bps <bps>] [--source <name>]");
  }

  const currentPriceFlagIndex = restArgs.findIndex((arg) => arg === "--current-price");
  const dataDirFlagIndex = restArgs.findIndex((arg) => arg === "--data-dir");
  const maxDrawdownFlagIndex = restArgs.findIndex((arg) => arg === "--max-drawdown-bps");
  const hardRevokeFlagIndex = restArgs.findIndex((arg) => arg === "--hard-revoke-bps");
  const sourceFlagIndex = restArgs.findIndex((arg) => arg === "--source");
  const auditorFlagIndex = restArgs.findIndex((arg) => arg === "--auditor");
  const profileFlagIndex = restArgs.findIndex((arg) => arg === "--profile");
  const bootstrapL3 = restArgs.includes("--bootstrap-l3");

  const currentPriceValue = currentPriceFlagIndex >= 0 ? Number(restArgs[currentPriceFlagIndex + 1]) : undefined;
  const profile = profileFlagIndex >= 0 ? restArgs[profileFlagIndex + 1] : undefined;
  if (!(Number.isFinite(currentPriceValue) && currentPriceValue !== undefined && currentPriceValue > 0) && !profile) {
    throw new Error("Provide either --current-price <positive number> or --profile <name>.");
  }

  const fullPath = path.resolve(process.cwd(), fileArg);
  const raw = await readFile(fullPath, "utf8");
  const input = EvaluationInputSchema.parse(JSON.parse(raw));
  const dataDir = dataDirFlagIndex >= 0 ? restArgs[dataDirFlagIndex + 1] : path.join(process.cwd(), "data");

  if (bootstrapL3) {
    const result = await runOpenClawWorkflow(input, {
      workflow: "guard",
      dataDir,
      bootstrapL3: true,
      ...(auditorFlagIndex >= 0 ? { auditorAgentId: restArgs[auditorFlagIndex + 1] } : {}),
      ...(profile ? { profile } : {}),
      runtimeGuard: {
        ...(Number.isFinite(currentPriceValue) && currentPriceValue !== undefined && currentPriceValue > 0
          ? { currentPrice: currentPriceValue }
          : {}),
        ...(maxDrawdownFlagIndex >= 0 ? { maxDrawdownBps: Number(restArgs[maxDrawdownFlagIndex + 1]) } : {}),
        ...(hardRevokeFlagIndex >= 0 ? { hardRevokeDrawdownBps: Number(restArgs[hardRevokeFlagIndex + 1]) } : {}),
        ...(sourceFlagIndex >= 0 ? { observationSource: restArgs[sourceFlagIndex + 1] } : {}),
      },
    });

    console.log(result.transcript.join("\n"));
    console.log("Report path:", result.artifacts.revocationPath);
    return;
  }

  const result = await applyRuntimeGuard(input, {
    dataDir,
    ...(Number.isFinite(currentPriceValue) && currentPriceValue !== undefined && currentPriceValue > 0
      ? { currentPrice: currentPriceValue }
      : {}),
    ...(profile ? { profile } : {}),
    ...(maxDrawdownFlagIndex >= 0 ? { maxDrawdownBps: Number(restArgs[maxDrawdownFlagIndex + 1]) } : {}),
    ...(hardRevokeFlagIndex >= 0 ? { hardRevokeDrawdownBps: Number(restArgs[hardRevokeFlagIndex + 1]) } : {}),
    ...(sourceFlagIndex >= 0 ? { observationSource: restArgs[sourceFlagIndex + 1] } : {}),
  });

  console.log("Runtime guard action:", result.action);
  console.log("Final level:", result.finalLevel);
  console.log("Observed drawdown:", result.report.observed_drawdown_bps, "bps");
  console.log("Report path:", path.join(dataDir, "revocations", `${input.payload.agent_id}.json`));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
