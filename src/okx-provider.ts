import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { executeProtected, type ExecutionOptions, type ProtectedExecutionRecord } from "./execution";
import { buildOkxDemoRequest, type OkxDemoRequest } from "./okx-adapter";
import type { EvaluationInput } from "./payload";

const execFileAsync = promisify(execFile);

export interface OkxCliInvocation {
  command: string;
  args: string[];
}

export interface CommandRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandRunnerResult>;

export interface OkxProviderOptions {
  executionId: string;
  dataDir?: string;
  profile?: string;
  runner?: CommandRunner;
  okxHomeDir?: string;
}

export interface ProtectedSubmissionOptions extends ExecutionOptions {
  profile?: string;
  runner?: CommandRunner;
  okxHomeDir?: string;
}

export interface OkxDemoSubmissionRecord {
  submissionId: string;
  provider: "okx-trade-cli";
  executionId: string;
  profile?: string;
  status: "accepted" | "rejected";
  remoteRequestId: string;
  submittedAt: string;
  request: OkxDemoRequest;
  invocation: OkxCliInvocation;
  response: unknown;
  errorMessage?: string;
}

export interface ProtectedSubmissionFlowResult {
  execution: ProtectedExecutionRecord;
  request: OkxDemoRequest;
  submission: OkxDemoSubmissionRecord;
}

export function defaultOkxCommand(): string {
  return process.platform === "win32"
    ? path.join(process.cwd(), "node_modules", ".bin", "okx.cmd")
    : path.join(process.cwd(), "node_modules", ".bin", "okx");
}

export function createDefaultCommandRunner(): CommandRunner {
  return async (command, args) => {
    const invocation = resolveRunnerInvocation(command, args);
    const result = await execFileAsync(invocation.command, invocation.args, { cwd: process.cwd() });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: 0,
    };
  };
}

export function resolveRunnerInvocation(
  command: string,
  args: string[],
  platform: NodeJS.Platform = process.platform,
): OkxCliInvocation {
  if (platform === "win32" && command.toLowerCase().endsWith(".cmd")) {
    const commandLine = [command, ...args]
      .map((value) => (/[\s"]/u.test(value) ? `"${value.replace(/"/gu, '""')}"` : value))
      .join(" ");
    return {
      command: "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
    };
  }

  return { command, args };
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export function parseOkxResponse(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    return { raw: stdout };
  }
}

function inferRemoteRequestId(response: unknown, fallback: string): string {
  if (Array.isArray(response) && response.length > 0) {
    const first = response[0] as Record<string, unknown>;
    if (typeof first?.algoId === "string" && first.algoId) return first.algoId;
    if (typeof first?.ordId === "string" && first.ordId) return first.ordId;
  }

  if (
    response &&
    typeof response === "object" &&
    "data" in response &&
    Array.isArray((response as { data?: unknown[] }).data) &&
    (response as { data: unknown[] }).data.length > 0
  ) {
    const first = (response as { data: Array<Record<string, unknown>> }).data[0];
    if (typeof first?.algoId === "string") return first.algoId;
    if (typeof first?.ordId === "string") return first.ordId;
  }

  return fallback;
}

function extractOkxErrorMessage(response: unknown): string | undefined {
  if (Array.isArray(response)) {
    const firstError = response.find(
      (item) =>
        item &&
        typeof item === "object" &&
        "sCode" in item &&
        typeof (item as { sCode?: unknown }).sCode === "string" &&
        (item as { sCode: string }).sCode !== "0",
    ) as { sMsg?: unknown } | undefined;

    if (typeof firstError?.sMsg === "string" && firstError.sMsg.trim()) {
      return firstError.sMsg.trim();
    }
  }

  if (response && typeof response === "object") {
    const objectResponse = response as { code?: unknown; msg?: unknown };
    if (typeof objectResponse.code === "string" && objectResponse.code !== "0") {
      if (typeof objectResponse.msg === "string" && objectResponse.msg.trim()) {
        return objectResponse.msg.trim();
      }
      return `OKX returned error code ${objectResponse.code}`;
    }
  }

  return undefined;
}

function buildCommonArgs(profile?: string): string[] {
  return [
    ...(profile ? ["--profile", profile] : []),
    "--demo",
    "--json",
  ];
}

function buildBotPriceBand(investmentAmount: string): { minPx: string; maxPx: string } {
  const amount = Number(investmentAmount);
  const minPx = (amount * 0.95).toFixed(2);
  const maxPx = (amount * 1.05).toFixed(2);
  return { minPx, maxPx };
}

function buildMarketTickerInvocation(instId: string): OkxCliInvocation {
  return {
    command: defaultOkxCommand(),
    args: ["market", "ticker", instId, "--json"],
  };
}

function resolveOkxConfigPath(okxHomeDir?: string): string {
  const homeDir = okxHomeDir ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".okx");
  return path.join(homeDir, "config.toml");
}

export async function ensureOkxProfile(options: { profile?: string; okxHomeDir?: string }): Promise<void> {
  const configPath = resolveOkxConfigPath(options.okxHomeDir);

  try {
    await access(configPath);
  } catch {
    throw new Error(`OKX config not found at ${configPath}. Run 'npx okx config --help' and create a demo profile first.`);
  }

  const config = await readFile(configPath, "utf8");
  const profileName = options.profile;
  if (!profileName) {
    if (!/default_profile\s*=/.test(config)) {
      throw new Error(`OKX config exists at ${configPath} but no default_profile is configured.`);
    }
    return;
  }

  if (!new RegExp(`\\[profiles\\.${profileName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`).test(config)) {
    throw new Error(`OKX profile '${profileName}' was not found in ${configPath}.`);
  }
}

async function readLiveLastPrice(instId: string): Promise<number> {
  return readOkxLiveLastPrice(instId);
}

export async function readOkxLiveLastPrice(
  instId: string,
  options: { runner?: CommandRunner } = {},
): Promise<number> {
  const invocation = buildMarketTickerInvocation(instId);
  const runner = options.runner ?? createDefaultCommandRunner();
  const runnerResult = await runner(invocation.command, invocation.args);
  const response = parseOkxResponse(runnerResult.stdout);

  if (Array.isArray(response) && response.length > 0) {
    const first = response[0] as { last?: unknown };
    const last = Number(first.last);
    if (Number.isFinite(last) && last > 0) {
      return last;
    }
  }

  throw new Error(`Unable to read live OKX market price for ${instId}.`);
}

export function buildOkxCliInvocation(
  request: OkxDemoRequest,
  options: { profile?: string } = {},
): OkxCliInvocation {
  const common = buildCommonArgs(options.profile);

  if (request.skill === "algo") {
    return {
      command: defaultOkxCommand(),
      args: [
        ...common,
        "spot",
        "algo",
        "place",
        "--instId",
        request.payload.instId,
        "--side",
        request.payload.side,
        "--sz",
        request.payload.sz,
        "--ordType",
        request.payload.ordType,
        "--tpTriggerPx",
        request.payload.tpOrdPx,
        "--tpOrdPx=-1",
        "--slTriggerPx",
        request.payload.slOrdPx,
        "--slOrdPx=-1",
        "--tdMode",
        request.payload.tdMode,
      ],
    };
  }

  const { minPx, maxPx } = buildBotPriceBand(request.payload.investmentAmount);
  return {
    command: defaultOkxCommand(),
    args: [
      ...common,
      "bot",
      "grid",
      "create",
      "--instId",
      request.payload.instId,
      "--algoOrdType",
      request.payload.strategyType,
      "--maxPx",
      maxPx,
      "--minPx",
      minPx,
      "--gridNum",
      String(request.payload.gridCount),
      "--quoteSz",
      request.payload.investmentAmount,
      "--direction",
      request.payload.mode,
    ],
  };
}

export async function submitOkxDemoRequest(
  request: OkxDemoRequest,
  options: OkxProviderOptions,
): Promise<OkxDemoSubmissionRecord> {
  const dataDir = options.dataDir ?? path.join(process.cwd(), "data");
  if (!options.runner) {
    await ensureOkxProfile({
      ...(options.profile ? { profile: options.profile } : {}),
      ...(options.okxHomeDir ? { okxHomeDir: options.okxHomeDir } : {}),
    });
  }
  const invocation = buildOkxCliInvocation(request, options.profile ? { profile: options.profile } : {});
  const runner = options.runner ?? createDefaultCommandRunner();
  const runnerResult = await runner(invocation.command, invocation.args);
  const response = parseOkxResponse(runnerResult.stdout);
  const errorMessage = extractOkxErrorMessage(response);
  const submissionId = `okx_demo_${options.executionId}`;
  const submission: OkxDemoSubmissionRecord = {
    submissionId,
    provider: "okx-trade-cli",
    executionId: options.executionId,
    ...(options.profile ? { profile: options.profile } : {}),
    status: errorMessage ? "rejected" : "accepted",
    remoteRequestId: inferRemoteRequestId(response, `local_${options.executionId}`),
    submittedAt: new Date().toISOString(),
    request,
    invocation,
    response,
    ...(errorMessage ? { errorMessage } : {}),
  };

  await writeJsonFile(path.join(dataDir, "okx-submissions", `${submissionId}.json`), submission);
  const executionPath = path.join(dataDir, "executions", `${options.executionId}.json`);
  const existingExecution = await readJsonFile<Record<string, unknown>>(executionPath);
  await writeJsonFile(executionPath, {
    ...existingExecution,
    remoteRequestId: submission.remoteRequestId,
    submissionStatus: submission.status,
  });

  if (errorMessage) {
    throw new Error(`OKX demo submission rejected: ${errorMessage}`);
  }
  return submission;
}

export async function prepareAndSubmitProtectedExecution(
  input: EvaluationInput,
  options: ProtectedSubmissionOptions,
): Promise<ProtectedSubmissionFlowResult> {
  const execution = await executeProtected(input, options);
  const liveMarketOverride = !options.runner && execution.executionMode === "algo"
    ? await readLiveLastPrice(execution.symbol)
    : undefined;
  const request = buildOkxDemoRequest(
    input,
    execution,
    liveMarketOverride ? { marketPriceOverride: liveMarketOverride } : {},
  );
  const submission = await submitOkxDemoRequest(request, {
    executionId: execution.executionId,
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    ...(options.profile ? { profile: options.profile } : {}),
    ...(options.runner ? { runner: options.runner } : {}),
    ...(options.okxHomeDir ? { okxHomeDir: options.okxHomeDir } : {}),
  });

  return {
    execution,
    request,
    submission,
  };
}
