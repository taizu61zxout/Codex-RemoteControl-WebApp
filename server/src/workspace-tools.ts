import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCodexConfigArgs } from "./codex-runner.js";
import type { SessionRecord } from "./store.js";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT = 1024 * 1024 * 8;
const DIFF_LIMIT = 16000;

type GitFileEntry = {
  path: string;
  stagedStatus: string;
  unstagedStatus: string;
  status: string;
};

export type GitSnapshot = {
  available: boolean;
  repoRoot: string | null;
  branch: string | null;
  summary: string | null;
  files: GitFileEntry[];
  stagedDiff: string;
  workingDiff: string;
  lastCommit: string | null;
};

export type ReviewResult = {
  summary: string;
  rawLines: string[];
};

function truncateOutput(value: string) {
  return value.length > DIFF_LIMIT
    ? `${value.slice(0, DIFF_LIMIT)}\n\n... output truncated ...`
    : value;
}

function ensureWorkingDirectory(session: SessionRecord) {
  if (!session.workingDirectory) {
    throw new Error("作業フォルダが未設定です。");
  }

  return session.workingDirectory;
}

async function runCommand(command: string, args: string[], cwd: string) {
  return execFileAsync(command, args, {
    cwd,
    env: process.env,
    maxBuffer: MAX_OUTPUT
  });
}

async function resolveGitRoot(cwd: string) {
  try {
    const result = await runCommand("git", ["rev-parse", "--show-toplevel"], cwd);
    return result.stdout.trim();
  } catch {
    return null;
  }
}

function normalizeStatusCode(value: string) {
  if (value === "?") {
    return "untracked";
  }

  if (value === "A") {
    return "added";
  }

  if (value === "M") {
    return "modified";
  }

  if (value === "D") {
    return "deleted";
  }

  if (value === "R") {
    return "renamed";
  }

  if (value === "C") {
    return "copied";
  }

  if (value === "U") {
    return "conflicted";
  }

  return "clean";
}

function mergeStatus(stagedStatus: string, unstagedStatus: string) {
  if (stagedStatus === "conflicted" || unstagedStatus === "conflicted") {
    return "conflicted";
  }

  if (unstagedStatus !== "clean") {
    return unstagedStatus;
  }

  return stagedStatus;
}

function parseStatusEntries(output: string) {
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const summary = lines[0]?.startsWith("## ") ? lines[0].slice(3) : null;
  const files = lines
    .slice(summary ? 1 : 0)
    .map((line) => {
      const staged = line[0] ?? " ";
      const unstaged = line[1] ?? " ";
      const path = line.slice(3).trim();
      const stagedStatus = normalizeStatusCode(staged.trim() || " ");
      const unstagedStatus = normalizeStatusCode(unstaged.trim() || " ");

      return {
        path,
        stagedStatus,
        unstagedStatus,
        status: mergeStatus(stagedStatus, unstagedStatus)
      };
    });

  return {
    summary,
    files
  };
}

export async function getGitSnapshot(session: SessionRecord): Promise<GitSnapshot> {
  const cwd = ensureWorkingDirectory(session);
  const repoRoot = await resolveGitRoot(cwd);

  if (!repoRoot) {
    return {
      available: false,
      repoRoot: null,
      branch: null,
      summary: null,
      files: [],
      stagedDiff: "",
      workingDiff: "",
      lastCommit: null
    };
  }

  const [statusResult, stagedDiffResult, workingDiffResult, lastCommitResult] =
    await Promise.all([
      runCommand("git", ["status", "--short", "--branch"], cwd),
      runCommand("git", ["diff", "--cached", "--"], cwd),
      runCommand("git", ["diff", "--"], cwd),
      runCommand("git", ["log", "-1", "--pretty=%h %s"], cwd).catch(() => ({
        stdout: "",
        stderr: ""
      }))
    ]);

  const parsedStatus = parseStatusEntries(statusResult.stdout);
  const branch = parsedStatus.summary?.split("...")[0] ?? parsedStatus.summary ?? null;

  return {
    available: true,
    repoRoot,
    branch,
    summary: parsedStatus.summary,
    files: parsedStatus.files,
    stagedDiff: truncateOutput(stagedDiffResult.stdout),
    workingDiff: truncateOutput(workingDiffResult.stdout),
    lastCommit: lastCommitResult.stdout.trim() || null
  };
}

export async function createGitCommit(session: SessionRecord, message: string) {
  const cwd = ensureWorkingDirectory(session);
  const repoRoot = await resolveGitRoot(cwd);

  if (!repoRoot) {
    throw new Error("Git リポジトリではありません。");
  }

  await runCommand("git", ["add", "-A"], cwd);
  await runCommand("git", ["commit", "-m", message], cwd);

  return getGitSnapshot(session);
}

export async function runCodexReview(session: SessionRecord): Promise<ReviewResult> {
  const cwd = ensureWorkingDirectory(session);
  const repoRoot = await resolveGitRoot(cwd);

  if (!repoRoot) {
    throw new Error("Git リポジトリではありません。");
  }

  const args = [
    ...buildCodexConfigArgs(session),
    "exec",
    "review",
    "--json",
    "--uncommitted"
  ];

  if (session.model) {
    args.push("--model", session.model);
  }

  const result = await runCommand("codex", args, cwd);
  const lines = `${result.stdout}\n${result.stderr}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  let summary = "";

  for (const line of lines) {
    if (!line.startsWith("{")) {
      continue;
    }

    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;

      if (
        parsed.type === "item.completed" &&
        typeof parsed.item === "object" &&
        parsed.item !== null
      ) {
        const item = parsed.item as Record<string, unknown>;

        if (item.type === "agent_message" && typeof item.text === "string") {
          summary = item.text;
        }
      }
    } catch {
      continue;
    }
  }

  return {
    summary: summary || "レビュー結果を取得できませんでした。",
    rawLines: lines.slice(-40)
  };
}
