import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";

export type LlmTaskKind = "auditor" | "strategy";

export interface LlmCommandInvocation {
  command: string;
  args: string[];
  providerLabel: string;
}

export interface LlmCommandRunnerResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export type LlmCommandRunner = (
  command: string,
  args: string[],
  stdin: string,
) => Promise<LlmCommandRunnerResult>;

export interface LlmTaskExecutionOptions {
  invocation?: Partial<LlmCommandInvocation>;
  runner?: LlmCommandRunner;
  strict?: boolean;
}

export interface StructuredLlmTaskRequest {
  task: LlmTaskKind;
  systemPrompt: string;
  input: unknown;
}

export interface StructuredLlmTaskResult<T> {
  output: T;
  provider: string;
  rawResponse: unknown;
}

function envCommandName(task: LlmTaskKind): string {
  return task === "auditor" ? "PROOFTRADE_AUDITOR_COMMAND" : "PROOFTRADE_STRATEGY_COMMAND";
}

function envArgsName(task: LlmTaskKind): string {
  return task === "auditor" ? "PROOFTRADE_AUDITOR_ARGS_JSON" : "PROOFTRADE_STRATEGY_ARGS_JSON";
}

function parseArgsJson(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return parsed;
    }
  } catch {
    throw new Error("LLM args env var must be a JSON string array.");
  }

  throw new Error("LLM args env var must be a JSON string array.");
}

function defaultProviderLabel(command: string): string {
  return path.basename(command).replace(/\.(cmd|exe|bat)$/iu, "");
}

export function resolveLlmInvocation(
  task: LlmTaskKind,
  options: LlmTaskExecutionOptions = {},
): LlmCommandInvocation | undefined {
  const explicitCommand = options.invocation?.command;
  const explicitArgs = options.invocation?.args;
  const explicitLabel = options.invocation?.providerLabel;

  if (explicitCommand) {
    return {
      command: explicitCommand,
      args: explicitArgs ?? [],
      providerLabel: explicitLabel ?? defaultProviderLabel(explicitCommand),
    };
  }

  const taskCommand = process.env[envCommandName(task)];
  const genericCommand = process.env.PROOFTRADE_LLM_COMMAND;
  const command = taskCommand ?? genericCommand;
  if (!command) {
    return undefined;
  }

  const args = taskCommand
    ? parseArgsJson(process.env[envArgsName(task)])
    : parseArgsJson(process.env.PROOFTRADE_LLM_ARGS_JSON);

  return {
    command,
    args,
    providerLabel: explicitLabel ?? defaultProviderLabel(command),
  };
}

export function createDefaultLlmCommandRunner(): LlmCommandRunner {
  return async (command, args, stdin) =>
    new Promise<LlmCommandRunnerResult>((resolve, reject) => {
      const child = spawn(command, args, {
        cwd: process.cwd(),
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      child.on("error", reject);
      child.on("close", (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code ?? 0,
        });
      });

      child.stdin.write(stdin);
      child.stdin.end();
    });
}

function parseJsonResponse(stdout: string): unknown {
  return JSON.parse(stdout);
}

export async function runStructuredLlmTask<T>(
  request: StructuredLlmTaskRequest,
  schema: z.ZodType<T>,
  options: LlmTaskExecutionOptions = {},
): Promise<StructuredLlmTaskResult<T> | undefined> {
  const invocation = resolveLlmInvocation(request.task, options);
  if (!invocation) {
    return undefined;
  }

  const runner = options.runner ?? createDefaultLlmCommandRunner();
  const stdin = JSON.stringify(
    {
      task: request.task,
      system_prompt: request.systemPrompt,
      input: request.input,
    },
    null,
    2,
  );

  try {
    const result = await runner(invocation.command, invocation.args, stdin);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || `LLM command exited with code ${result.exitCode}.`);
    }

    const rawResponse = parseJsonResponse(result.stdout);
    const output = schema.parse(rawResponse);

    return {
      output,
      provider: invocation.providerLabel,
      rawResponse,
    };
  } catch (error) {
    if (options.strict) {
      throw error;
    }
    return undefined;
  }
}
