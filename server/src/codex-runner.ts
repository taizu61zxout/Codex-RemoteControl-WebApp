import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import {
  createCodexUsageSnapshot,
  type CodexUsageSnapshot,
  type RawCodexRateLimits
} from "./codex-usage.js";
import type { SessionRecord } from "./store.js";

type RunnerEvent =
  | { type: "turn.started" }
  | { type: "thread.started"; threadId: string }
  | { type: "progress"; label: string; text: string }
  | { type: "assistant.message"; text: string }
  | { type: "command.started"; commandId: string; command: string }
  | {
      type: "command.completed";
      commandId: string;
      command: string;
      output: string;
      exitCode: number | null;
    }
  | {
      type: "approval.requested";
      commandId: string;
      command: string;
      reason: string | null;
    }
  | { type: "usage.updated"; usage: CodexUsageSnapshot }
  | { type: "turn.completed" }
  | { type: "log"; stream: "stdout" | "stderr"; text: string };

type RunnerOptions = {
  session: SessionRecord;
  prompt: string;
  onEvent: (event: RunnerEvent) => void;
  onExit: (exitCode: number | null) => void;
  onError: (error: Error) => void;
};

const codexBinary = process.env.CODEX_BIN ?? "/opt/homebrew/bin/codex";

export function buildCodexConfigArgs(session: SessionRecord) {
  const args: string[] = [];

  if (session.intelligence) {
    args.push(
      "--config",
      `model_reasoning_effort=${JSON.stringify(session.intelligence)}`
    );
  }

  return args;
}

export function buildCodexArgs(session: SessionRecord, prompt: string) {
  const args: string[] = [];
  const approvalPolicy = session.approvalPolicy ?? "on-request";

  if (approvalPolicy !== "inherit") {
    args.push("--ask-for-approval", approvalPolicy);
  }

  args.push(...buildCodexConfigArgs(session));

  args.push("exec", "--json", "--skip-git-repo-check");

  if (session.model) {
    args.push("--model", session.model);
  }

  if (session.workingDirectory) {
    args.push("--cd", session.workingDirectory);
  }

  if (session.sandboxMode) {
    args.push("--sandbox", session.sandboxMode);
  }

  if (session.codexThreadId) {
    args.push("resume", session.codexThreadId, prompt);
    return args;
  }

  args.push(prompt);

  return args;
}

export function getCodexBinary() {
  return codexBinary;
}

function shouldSuppressLogLine(line: string) {
  return (
    line === "Reading additional input from stdin..." ||
    line.includes("ignoring interface.defaultPrompt") ||
    line.includes("Received unexpected message notification") ||
    line.includes("Failed to terminate MCP process group") ||
    line.includes("Failed to kill MCP process group") ||
    line.includes("failed to record rollout items") ||
    line.includes("resuming session with different model")
  );
}

function normalizeLine(line: string) {
  return line
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\r/g, "")
    .replace(/\u0008/g, "")
    .replace(/^[\u0000-\u001f\u007f]+/, "")
    .trim();
}

function handleLine(
  line: string,
  stream: "stdout" | "stderr",
  onEvent: (event: RunnerEvent) => void
) {
  const trimmed = normalizeLine(line);

  if (trimmed.length === 0) {
    return;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;

      if (
        parsed.type === "response_item" &&
        typeof parsed.payload === "object" &&
        parsed.payload !== null
      ) {
        const payload = parsed.payload as Record<string, unknown>;

        if (payload.type === "reasoning") {
          const summary = Array.isArray(payload.summary)
            ? payload.summary
                .map((entry) => {
                  if (typeof entry === "string") {
                    return entry;
                  }

                  if (
                    typeof entry === "object" &&
                    entry !== null &&
                    "text" in entry &&
                    typeof entry.text === "string"
                  ) {
                    return entry.text;
                  }

                  return null;
                })
                .filter((entry): entry is string => entry !== null && entry.trim().length > 0)
            : [];

          onEvent({
            type: "progress",
            label: summary.length > 0 ? "推論サマリー" : "推論中",
            text:
              summary.length > 0
                ? summary.join("\n")
                : "Codex CLI が推論を進めています。"
          });
          return;
        }
      }

      if (
        parsed.type === "thread.started" &&
        typeof parsed.thread_id === "string"
      ) {
        onEvent({
          type: "thread.started",
          threadId: parsed.thread_id
        });
        return;
      }

      if (
        parsed.type === "event_msg" &&
        typeof parsed.payload === "object" &&
        parsed.payload !== null
      ) {
        const payload = parsed.payload as Record<string, unknown>;

        if (
          payload.type === "agent_message" &&
          typeof payload.message === "string" &&
          payload.message.trim().length > 0
        ) {
          onEvent({
            type: "progress",
            label: typeof payload.phase === "string" ? payload.phase : "進行",
            text: payload.message
          });
          return;
        }

        if (
          payload.type === "exec_command_end" &&
          typeof payload.aggregated_output === "string"
        ) {
          const command = Array.isArray(payload.command)
            ? payload.command.filter((entry): entry is string => typeof entry === "string").join(" ")
            : "command";
          onEvent({
            type: "progress",
            label: "コマンド完了",
            text: `${command}\n${payload.aggregated_output}`.trim()
          });
          return;
        }

        if (
          payload.type === "token_count" &&
          typeof payload.rate_limits === "object" &&
          payload.rate_limits !== null
        ) {
          onEvent({
            type: "usage.updated",
            usage: createCodexUsageSnapshot(
              payload.rate_limits as RawCodexRateLimits,
              {
                updatedAt:
                  typeof parsed.timestamp === "string"
                    ? parsed.timestamp
                    : new Date().toISOString()
              }
            )
          });
          return;
        }
      }

      if (
        parsed.type === "item.started" &&
        typeof parsed.item === "object" &&
        parsed.item !== null
      ) {
        const item = parsed.item as Record<string, unknown>;

        if (
          item.type === "command_execution" &&
          typeof item.id === "string" &&
          typeof item.command === "string"
        ) {
          onEvent({
            type: "command.started",
            commandId: item.id,
            command: item.command
          });
          return;
        }
      }

      if (
        parsed.type === "item.completed" &&
        typeof parsed.item === "object" &&
        parsed.item !== null
      ) {
        const item = parsed.item as Record<string, unknown>;

        if (
          item.type === "command_execution" &&
          typeof item.id === "string" &&
          typeof item.command === "string"
        ) {
          onEvent({
            type: "command.completed",
            commandId: item.id,
            command: item.command,
            output:
              typeof item.aggregated_output === "string"
                ? item.aggregated_output
                : "",
            exitCode:
              typeof item.exit_code === "number" ? item.exit_code : null
          });
          return;
        }

        if (
          item.type === "agent_message" &&
          typeof item.text === "string" &&
          item.text.trim().length > 0
        ) {
          onEvent({
            type: "assistant.message",
            text: item.text
          });
          return;
        }
      }

      if (parsed.type === "turn.completed") {
        onEvent({
          type: "turn.completed"
        });
        return;
      }

      if (parsed.type === "turn.started") {
        onEvent({
          type: "turn.started"
        });
        return;
      }

      if (
        parsed.type === "approval.required" &&
        typeof parsed.command === "string"
      ) {
        onEvent({
          type: "approval.requested",
          commandId:
            typeof parsed.id === "string" ? parsed.id : "approval-required",
          command: parsed.command,
          reason:
            typeof parsed.reason === "string" ? parsed.reason : null
        });
        return;
      }
    } catch {
      onEvent({
        type: "log",
        stream,
        text: trimmed
      });
      return;
    }
  }

  if (shouldSuppressLogLine(trimmed)) {
    return;
  }

  onEvent({
    type: "log",
    stream,
    text: trimmed
  });
}

export function startCodexTurn(options: RunnerOptions) {
  const child = spawn(codexBinary, buildCodexArgs(options.session, options.prompt), {
    cwd: options.session.workingDirectory ?? process.cwd(),
    env: process.env
  });

  const stdout = readline.createInterface({
    input: child.stdout
  });
  const stderr = readline.createInterface({
    input: child.stderr
  });

  stdout.on("line", (line) => {
    handleLine(line, "stdout", options.onEvent);
  });

  stderr.on("line", (line) => {
    handleLine(line, "stderr", options.onEvent);
  });

  child.on("error", (error) => {
    options.onError(error);
  });

  child.on("close", (code) => {
    stdout.close();
    stderr.close();
    if (!child.stdin.destroyed) {
      child.stdin.end();
    }
    options.onExit(code);
  });

  return child;
}
