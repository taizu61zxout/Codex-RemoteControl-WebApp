import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export type RawRateLimitWindow = {
  used_percent?: unknown;
  window_minutes?: unknown;
  resets_at?: unknown;
};

export type RawCodexRateLimits = {
  primary?: RawRateLimitWindow;
  secondary?: RawRateLimitWindow;
  credits?: unknown;
  plan_type?: unknown;
  rate_limit_reached_type?: unknown;
};

type RawTokenCountPayload = {
  rate_limits?: {
    primary?: RawRateLimitWindow;
    secondary?: RawRateLimitWindow;
    credits?: unknown;
    plan_type?: unknown;
    rate_limit_reached_type?: unknown;
  };
};

export type UsageWindow = {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;
  resetsAtIso: string | null;
  resetInSeconds: number | null;
};

export type CodexUsageSnapshot = {
  available: boolean;
  updatedAt: string | null;
  sourcePath: string | null;
  planType: string | null;
  rateLimitReachedType: string | null;
  primary: UsageWindow | null;
  secondary: UsageWindow | null;
};

const maxFilesToInspect = 80;
const maxTailBytes = 1024 * 1024 * 2;

function listSessionFiles(directory: string): string[] {
  const results: string[] = [];

  const visit = (currentPath: string) => {
    let entries: fs.Dirent[] = [];

    try {
      entries = fs.readdirSync(currentPath, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      const nextPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        visit(nextPath);
        continue;
      }

      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(nextPath);
      }
    }
  };

  visit(directory);
  return results;
}

function readTail(filePath: string) {
  const stats = fs.statSync(filePath, {
    throwIfNoEntry: false
  });

  if (!stats?.isFile()) {
    return "";
  }

  const start = Math.max(0, stats.size - maxTailBytes);
  const length = stats.size - start;
  const descriptor = fs.openSync(filePath, "r");

  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(descriptor, buffer, 0, length, start);
    return buffer.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeWindow(value: RawRateLimitWindow | undefined): UsageWindow | null {
  if (!value) {
    return null;
  }

  const usedPercent = numberOrNull(value.used_percent);
  const windowMinutes = numberOrNull(value.window_minutes);
  const resetsAt = numberOrNull(value.resets_at);
  const resetInSeconds = resetsAt === null ? null : Math.max(0, resetsAt - Math.floor(Date.now() / 1000));

  return {
    usedPercent,
    remainingPercent: usedPercent === null ? null : Math.max(0, 100 - usedPercent),
    windowMinutes,
    resetsAt,
    resetsAtIso: resetsAt === null ? null : new Date(resetsAt * 1000).toISOString(),
    resetInSeconds
  };
}

function parseTokenCountLine(line: string) {
  if (!line.includes("\"token_count\"")) {
    return null;
  }

  try {
    const parsed = JSON.parse(line) as {
      timestamp?: unknown;
      payload?: RawTokenCountPayload & { type?: unknown };
    };

    if (parsed.payload?.type !== "token_count" || !parsed.payload.rate_limits) {
      return null;
    }

    return {
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : null,
      rateLimits: parsed.payload.rate_limits
    };
  } catch {
    return null;
  }
}

export function createCodexUsageSnapshot(
  rateLimits: RawCodexRateLimits,
  options: {
    updatedAt?: string | null;
    sourcePath?: string | null;
  } = {}
): CodexUsageSnapshot {
  return {
    available: true,
    updatedAt: options.updatedAt ?? null,
    sourcePath: options.sourcePath ?? null,
    planType:
      typeof rateLimits.plan_type === "string"
        ? rateLimits.plan_type
        : null,
    rateLimitReachedType:
      typeof rateLimits.rate_limit_reached_type === "string"
        ? rateLimits.rate_limit_reached_type
        : null,
    primary: normalizeWindow(rateLimits.primary),
    secondary: normalizeWindow(rateLimits.secondary)
  };
}

function refreshWindow(window: UsageWindow | null): UsageWindow | null {
  if (!window) {
    return null;
  }

  return {
    ...window,
    resetInSeconds:
      window.resetsAt === null
        ? null
        : Math.max(0, window.resetsAt - Math.floor(Date.now() / 1000))
  };
}

export function refreshCodexUsageSnapshot(
  snapshot: CodexUsageSnapshot
): CodexUsageSnapshot {
  return {
    ...snapshot,
    primary: refreshWindow(snapshot.primary),
    secondary: refreshWindow(snapshot.secondary)
  };
}

export function readCodexUsageSnapshot(): CodexUsageSnapshot {
  const sessionsDirectory = path.join(config.homeDir, ".codex", "sessions");
  const files = listSessionFiles(sessionsDirectory)
    .map((filePath) => ({
      filePath,
      modifiedAt: fs.statSync(filePath, {
        throwIfNoEntry: false
      })?.mtimeMs ?? 0
    }))
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(0, maxFilesToInspect);

  for (const file of files) {
    const lines = readTail(file.filePath).split("\n").reverse();

    for (const line of lines) {
      const tokenCount = parseTokenCountLine(line);

      if (!tokenCount) {
        continue;
      }

      return createCodexUsageSnapshot(tokenCount.rateLimits, {
        updatedAt: tokenCount.timestamp,
        sourcePath: file.filePath
      });
    }
  }

  return {
    available: false,
    updatedAt: null,
    sourcePath: null,
    planType: null,
    rateLimitReachedType: null,
    primary: null,
    secondary: null
  };
}
