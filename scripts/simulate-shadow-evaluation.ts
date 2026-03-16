import { readFile } from "node:fs/promises";
import path from "node:path";
import { EvaluationInputSchema } from "../src/payload";
import { runShadowReplay } from "../src/replay";

async function main() {
  const [, , fileArg = "examples/sample-evaluation-input.json", ...restArgs] = process.argv;
  const scenarioFlagIndex = restArgs.findIndex((arg) => arg === "--scenario");
  const dataDirFlagIndex = restArgs.findIndex((arg) => arg === "--data-dir");
  const countFlagIndex = restArgs.findIndex((arg) => arg === "--count");
  const scenarioName = scenarioFlagIndex >= 0 ? restArgs[scenarioFlagIndex + 1] : "historical-shadow-replay";
  const dataDir = dataDirFlagIndex >= 0 ? restArgs[dataDirFlagIndex + 1] : undefined;
  const count = countFlagIndex >= 0 ? Number(restArgs[countFlagIndex + 1]) : undefined;

  const fullPath = path.resolve(process.cwd(), fileArg);
  const raw = await readFile(fullPath, "utf8");
  const input = EvaluationInputSchema.parse(JSON.parse(raw));
  const replay = await runShadowReplay(input, {
    ...(scenarioName ? { scenarioName } : {}),
    ...(dataDir ? { dataDir } : {}),
    ...(Number.isFinite(count) ? { decisionCount: count } : {}),
  });

  process.stdout.write(`${replay.transcript.join("\n")}\n`);
  process.stdout.write(`Evidence directory: ${replay.evidenceDir}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
