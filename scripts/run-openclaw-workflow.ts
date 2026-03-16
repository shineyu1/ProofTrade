import { readFile } from "node:fs/promises";
import path from "node:path";
import { EvaluationInputSchema } from "../src/payload";
import { runOpenClawWorkflow, type OpenClawWorkflow } from "../src/openclaw";
import type { LlmTaskExecutionOptions } from "../src/llm-command-adapter";

function requireWorkflow(value: string | undefined): OpenClawWorkflow {
  if (value === "status" || value === "review" || value === "execute" || value === "submit" || value === "guard" || value === "publish" || value === "full-demo") {
    return value;
  }
  throw new Error("Workflow must be one of: status, review, execute, submit, guard, publish, full-demo.");
}

function buildLlmOptions(
  command: string | undefined,
  argsJson: string | undefined,
  providerLabel: string,
): LlmTaskExecutionOptions | undefined {
  if (!command) {
    return undefined;
  }

  let args: string[] = [];
  if (argsJson) {
    const parsed = JSON.parse(argsJson);
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
      throw new Error("LLM args must be a JSON string array.");
    }
    args = parsed;
  }

  return {
    invocation: {
      command,
      args,
      providerLabel,
    },
  };
}

async function main() {
  const [, , workflowArg, fileArg, ...restArgs] = process.argv;
  const workflow = requireWorkflow(workflowArg);

  if (!fileArg) {
    throw new Error("Usage: npm run openclaw -- <workflow> <path-to-evaluation-input.json> [--strategy <id>] [--mode algo|bot] [--data-dir <dir>] [--bootstrap-l3] [--auditor <id>] [--profile <name>] [--publish-xlayer] [--network mainnet|testnet] [--agent-uri <uri>] [--evidence-base-uri <uri>] [--rpc <url>] [--current-price <price>] [--max-drawdown-bps <bps>] [--hard-revoke-bps <bps>] [--source <name>] [--llm-auditor-command <cmd>] [--llm-auditor-args-json <json-array>] [--llm-strategy-command <cmd>] [--llm-strategy-args-json <json-array>]");
  }

  const fullPath = path.resolve(process.cwd(), fileArg);
  const raw = await readFile(fullPath, "utf8");
  const input = EvaluationInputSchema.parse(JSON.parse(raw));

  const modeFlagIndex = restArgs.findIndex((arg) => arg === "--mode");
  const strategyFlagIndex = restArgs.findIndex((arg) => arg === "--strategy");
  const dataDirFlagIndex = restArgs.findIndex((arg) => arg === "--data-dir");
  const auditorFlagIndex = restArgs.findIndex((arg) => arg === "--auditor");
  const profileFlagIndex = restArgs.findIndex((arg) => arg === "--profile");
  const networkFlagIndex = restArgs.findIndex((arg) => arg === "--network");
  const agentUriFlagIndex = restArgs.findIndex((arg) => arg === "--agent-uri");
  const evidenceBaseUriFlagIndex = restArgs.findIndex((arg) => arg === "--evidence-base-uri");
  const rpcFlagIndex = restArgs.findIndex((arg) => arg === "--rpc");
  const currentPriceFlagIndex = restArgs.findIndex((arg) => arg === "--current-price");
  const maxDrawdownFlagIndex = restArgs.findIndex((arg) => arg === "--max-drawdown-bps");
  const hardRevokeFlagIndex = restArgs.findIndex((arg) => arg === "--hard-revoke-bps");
  const sourceFlagIndex = restArgs.findIndex((arg) => arg === "--source");
  const llmAuditorCommandFlagIndex = restArgs.findIndex((arg) => arg === "--llm-auditor-command");
  const llmAuditorArgsFlagIndex = restArgs.findIndex((arg) => arg === "--llm-auditor-args-json");
  const llmStrategyCommandFlagIndex = restArgs.findIndex((arg) => arg === "--llm-strategy-command");
  const llmStrategyArgsFlagIndex = restArgs.findIndex((arg) => arg === "--llm-strategy-args-json");

  const currentPrice = currentPriceFlagIndex >= 0 ? Number(restArgs[currentPriceFlagIndex + 1]) : undefined;
  const profile = profileFlagIndex >= 0 ? restArgs[profileFlagIndex + 1] : undefined;
  if (
    workflow === "guard" &&
    (!(Number.isFinite(currentPrice) && currentPrice !== undefined && currentPrice > 0) && !profile)
  ) {
    throw new Error("Workflow 'guard' requires either --current-price <positive number> or --profile <name>.");
  }

  const llmAuditor = buildLlmOptions(
    llmAuditorCommandFlagIndex >= 0 ? restArgs[llmAuditorCommandFlagIndex + 1] : undefined,
    llmAuditorArgsFlagIndex >= 0 ? restArgs[llmAuditorArgsFlagIndex + 1] : undefined,
    "custom-auditor",
  );
  const llmStrategy = buildLlmOptions(
    llmStrategyCommandFlagIndex >= 0 ? restArgs[llmStrategyCommandFlagIndex + 1] : undefined,
    llmStrategyArgsFlagIndex >= 0 ? restArgs[llmStrategyArgsFlagIndex + 1] : undefined,
    "custom-strategy",
  );

  const result = await runOpenClawWorkflow(input, {
    workflow,
    ...(strategyFlagIndex >= 0 ? { strategyId: restArgs[strategyFlagIndex + 1] } : {}),
    ...(modeFlagIndex >= 0 ? { mode: restArgs[modeFlagIndex + 1] as "algo" | "bot" } : {}),
    ...(dataDirFlagIndex >= 0 ? { dataDir: restArgs[dataDirFlagIndex + 1] } : {}),
    ...(auditorFlagIndex >= 0 ? { auditorAgentId: restArgs[auditorFlagIndex + 1] } : {}),
    ...(profile ? { profile } : {}),
    ...(restArgs.includes("--bootstrap-l3") ? { bootstrapL3: true } : {}),
    ...(restArgs.includes("--publish-xlayer") ? { publishToXLayer: true } : {}),
    ...((llmAuditor || llmStrategy)
      ? {
          llm: {
            ...(llmAuditor ? { auditor: llmAuditor } : {}),
            ...(llmStrategy ? { strategy: llmStrategy } : {}),
          },
        }
      : {}),
    ...(workflow === "guard"
      ? {
          runtimeGuard: {
            ...(Number.isFinite(currentPrice) && currentPrice !== undefined && currentPrice > 0
              ? { currentPrice: currentPrice as number }
              : {}),
            ...(maxDrawdownFlagIndex >= 0 ? { maxDrawdownBps: Number(restArgs[maxDrawdownFlagIndex + 1]) } : {}),
            ...(hardRevokeFlagIndex >= 0 ? { hardRevokeDrawdownBps: Number(restArgs[hardRevokeFlagIndex + 1]) } : {}),
            ...(sourceFlagIndex >= 0 ? { observationSource: restArgs[sourceFlagIndex + 1] } : {}),
          },
        }
      : {}),
    xlayer: {
      ...(networkFlagIndex >= 0 ? { network: restArgs[networkFlagIndex + 1] as "mainnet" | "testnet" } : {}),
      ...(agentUriFlagIndex >= 0 ? { agentUri: restArgs[agentUriFlagIndex + 1] } : {}),
      ...(evidenceBaseUriFlagIndex >= 0 ? { evidenceBaseUri: restArgs[evidenceBaseUriFlagIndex + 1] } : {}),
      ...(rpcFlagIndex >= 0 ? { rpcUrl: restArgs[rpcFlagIndex + 1] } : {}),
    },
  });

  console.log(result.transcript.join("\n"));
  console.log("License path:", result.artifacts.licensePath);
  if (result.artifacts.auditPath) console.log("Audit path:", result.artifacts.auditPath);
  if (result.artifacts.boardDecisionPath) console.log("Board decision path:", result.artifacts.boardDecisionPath);
  if (result.artifacts.certificatePath) console.log("Certificate path:", result.artifacts.certificatePath);
  if (result.artifacts.executionPath) console.log("Execution path:", result.artifacts.executionPath);
  if (result.artifacts.submissionPath) console.log("Submission path:", result.artifacts.submissionPath);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
