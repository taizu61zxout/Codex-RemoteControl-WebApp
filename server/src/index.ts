import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  HttpError,
  ensureCsrfToken,
  requireAuth,
  requireCsrf
} from "./auth.js";
import {
  buildCodexArgs,
  getCodexBinary,
  startCodexTurn
} from "./codex-runner.js";
import {
  readCodexUsageSnapshot,
  refreshCodexUsageSnapshot
} from "./codex-usage.js";
import type { CodexUsageSnapshot } from "./codex-usage.js";
import { config } from "./config.js";
import { initializeDatabase } from "./db.js";
import {
  buildPromptWithAttachedFiles,
  listSessionFiles,
  readSessionFilePreview
} from "./session-files.js";
import {
  createApprovalRule,
  createMessage,
  createSession,
  deleteArchivedSession,
  findApprovalRuleForCommand,
  getSession,
  listArchivedSessions,
  listMessages,
  listSessions,
  purgeExpiredArchivedSessions,
  resetRunningSessions,
  renameOrArchiveSession,
  updateMessageMetadata,
  updateSessionSettings,
  updateSessionStatus,
  updateSessionThreadId
} from "./store.js";
import {
  createGitCommit,
  getGitSnapshot,
  runCodexReview
} from "./workspace-tools.js";

type RealtimeSocket = {
  readyState: number;
  send: (payload: string) => void;
  on: (event: "close", listener: () => void) => void;
};

type ActiveRun = {
  child: ChildProcessWithoutNullStreams;
  args: string[];
  binary: string;
  startedAt: string;
  lastEventAt: string;
  lastEventKind: string;
  lastLogLine: string | null;
  threadId: string | null;
  timeoutHandle: NodeJS.Timeout | null;
  progress: Array<{
    label: string;
    text: string;
    createdAt: string;
  }>;
  pendingApprovals: Record<
    string,
    {
      command: string;
      reason: string | null;
    }
  >;
  workingDirectory: string | null;
  snapshotBefore: Record<string, { size: number; mtimeMs: number }> | null;
  lastAssistantMessageId: string | null;
  fileActivity: {
    created: string[];
    modified: string[];
    deleted: string[];
  } | null;
};

const database = initializeDatabase();
const activeRuns = new Map<string, ActiveRun>();
const sockets = new Set<RealtimeSocket>();
const RUN_START_TIMEOUT_MS = 90_000;
const RUN_IDLE_TIMEOUT_MS = 10 * 60_000;
const archivePurgeInterval = 6 * 60 * 60 * 1000;
let latestCodexUsage: CodexUsageSnapshot | null = null;

function isPathInsideDirectory(targetPath: string, directoryPath: string) {
  const relative = path.relative(directoryPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function shouldIgnoreSnapshotEntry(
  absolutePath: string,
  relativePath: string,
  name: string
) {
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const normalizedAbsolutePath = path.resolve(absolutePath);
  const generatedDirectories = [
    config.dataDir,
    path.join(config.rootDir, "client", "dist"),
    path.join(config.rootDir, "server", "dist")
  ].map((entry) => path.resolve(entry));
  const ignoredDatabaseFiles = new Set(
    [
      config.databasePath,
      `${config.databasePath}-shm`,
      `${config.databasePath}-wal`,
      `${config.databasePath}-journal`
    ].map((entry) => path.resolve(entry))
  );

  return (
    name === ".git" ||
    name === "node_modules" ||
    name === ".DS_Store" ||
    ignoredDatabaseFiles.has(normalizedAbsolutePath) ||
    generatedDirectories.some((directoryPath) =>
      isPathInsideDirectory(normalizedAbsolutePath, directoryPath)
    ) ||
    normalizedPath === "data" ||
    normalizedPath.startsWith("data/") ||
    normalizedPath === "client/dist" ||
    normalizedPath.startsWith("client/dist/") ||
    normalizedPath === "server/dist" ||
    normalizedPath.startsWith("server/dist/")
  );
}

function collectWorkspaceSnapshot(rootPath: string) {
  const snapshot: Record<string, { size: number; mtimeMs: number }> = {};

  const walk = (currentPath: string, relativePath = "") => {
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const absolutePath = path.join(currentPath, entry.name);
      const nextRelativePath = relativePath
        ? path.posix.join(relativePath, entry.name)
        : entry.name;

      if (shouldIgnoreSnapshotEntry(absolutePath, nextRelativePath, entry.name)) {
        continue;
      }

      if (entry.isDirectory()) {
        walk(absolutePath, nextRelativePath);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const stats = fs.statSync(absolutePath);
      snapshot[nextRelativePath] = {
        size: stats.size,
        mtimeMs: stats.mtimeMs
      };
    }
  };

  walk(rootPath);
  return snapshot;
}

function diffWorkspaceSnapshots(
  before: Record<string, { size: number; mtimeMs: number }>,
  after: Record<string, { size: number; mtimeMs: number }>
) {
  const created: string[] = [];
  const modified: string[] = [];
  const deleted: string[] = [];

  for (const [filePath, entry] of Object.entries(after)) {
    const previous = before[filePath];

    if (!previous) {
      created.push(filePath);
      continue;
    }

    if (previous.mtimeMs !== entry.mtimeMs || previous.size !== entry.size) {
      modified.push(filePath);
    }
  }

  for (const filePath of Object.keys(before)) {
    if (!after[filePath]) {
      deleted.push(filePath);
    }
  }

  const sortPaths = (items: string[]) => items.sort((left, right) => left.localeCompare(right));

  return {
    created: sortPaths(created),
    modified: sortPaths(modified),
    deleted: sortPaths(deleted)
  };
}

function getUploadsRootDirectory() {
  return path.join(config.dataDir, "uploads");
}

function cleanupOrphanUploadDirectories() {
  const uploadsRoot = getUploadsRootDirectory();
  const stats = fs.statSync(uploadsRoot, {
    throwIfNoEntry: false
  });

  if (!stats?.isDirectory()) {
    return;
  }

  const sessionIds = new Set(
    (
      database.prepare("SELECT id FROM sessions").all() as Array<{ id: string }>
    ).map((row) => row.id)
  );

  for (const entry of fs.readdirSync(uploadsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || sessionIds.has(entry.name)) {
      continue;
    }

    fs.rmSync(path.join(uploadsRoot, entry.name), {
      recursive: true,
      force: true
    });
  }
}

function purgeExpiredArchivedSessionsAndUploads() {
  purgeExpiredArchivedSessions(database);
  cleanupOrphanUploadDirectories();
}

purgeExpiredArchivedSessionsAndUploads();
resetRunningSessions(database);

setInterval(() => {
  purgeExpiredArchivedSessionsAndUploads();
}, archivePurgeInterval).unref();

const app = Fastify({
  logger: true,
  bodyLimit: 32 * 1024 * 1024
});

const hiddenEntryNames = new Set([".codex", ".ssh"]);
const DIRECTORY_SEARCH_LIMIT = 80;
const DIRECTORY_SEARCH_DEPTH = 5;
const UPLOAD_FILE_LIMIT = 8;
const UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
const UPLOAD_TOTAL_MAX_BYTES = 24 * 1024 * 1024;

type UploadedFileInput = {
  name?: string;
  type?: string;
  contentBase64?: string;
};

function sanitizeUploadFileName(name: string) {
  const baseName = path.basename(name).replace(/[^\w.\-()[\] ]+/g, "_").trim();
  return baseName.length > 0 ? baseName.slice(0, 120) : "upload";
}

function getUploadDirectory(sessionId: string) {
  return path.join(config.dataDir, "uploads", sessionId);
}

function saveUploadedFiles(sessionId: string, files: UploadedFileInput[]) {
  const selectedFiles = files.slice(0, UPLOAD_FILE_LIMIT);
  const uploadDirectory = getUploadDirectory(sessionId);
  fs.mkdirSync(uploadDirectory, {
    recursive: true
  });

  let totalBytes = 0;

  return selectedFiles.map((file) => {
    const contentBase64 = file.contentBase64 ?? "";
    const buffer = Buffer.from(contentBase64, "base64");

    if (buffer.length === 0) {
      throw new HttpError(400, "空のファイルはアップロードできません。");
    }

    if (buffer.length > UPLOAD_MAX_BYTES) {
      throw new HttpError(400, "1ファイルの上限は10MBです。");
    }

    totalBytes += buffer.length;

    if (totalBytes > UPLOAD_TOTAL_MAX_BYTES) {
      throw new HttpError(400, "一度にアップロードできる合計サイズは24MBまでです。");
    }

    const safeName = sanitizeUploadFileName(file.name ?? "upload");
    const filePath = path.join(uploadDirectory, `${Date.now()}-${randomUUID()}-${safeName}`);
    fs.writeFileSync(filePath, buffer);

    return {
      name: safeName,
      type: typeof file.type === "string" ? file.type : "application/octet-stream",
      path: filePath,
      size: buffer.length
    };
  });
}

function assertInsideHomeDirectory(targetPath: string) {
  const resolved = path.resolve(targetPath);
  const homeDirectory = config.homeDir;

  if (
    resolved !== homeDirectory &&
    !resolved.startsWith(`${homeDirectory}${path.sep}`)
  ) {
    throw new HttpError(403, "ホームディレクトリの外は参照できません。");
  }

  return resolved;
}

function normalizeBrowserPath(requestedPath?: string) {
  return assertInsideHomeDirectory(requestedPath ?? config.downloadsDir);
}

function validateWorkingDirectory(requestedPath?: string | null) {
  if (requestedPath == null || requestedPath.trim().length === 0) {
    return null;
  }

  const resolved = assertInsideHomeDirectory(requestedPath);
  const stats = fs.statSync(resolved, {
    throwIfNoEntry: false
  });

  if (!stats?.isDirectory()) {
    throw new HttpError(400, "有効なフォルダを選択してください。");
  }

  return resolved;
}

function listDirectoryEntries(currentPath: string) {
  const entries = fs
    .readdirSync(currentPath, {
      withFileTypes: true
    })
    .filter((entry) => !hiddenEntryNames.has(entry.name))
    .map((entry) => {
      const fullPath = path.join(currentPath, entry.name);
      const stats = fs.statSync(fullPath, {
        throwIfNoEntry: false
      });

      return {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        updatedAt: stats?.mtime.toISOString() ?? null
      };
    })
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "ja");
    });

  return {
    currentPath,
    homePath: config.homeDir,
    initialPath: config.downloadsDir,
    parentPath:
      currentPath === config.homeDir ? null : path.dirname(currentPath),
    entries
  };
}

function searchDirectories(basePath: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length < 2) {
    return [];
  }

  const results: Array<{
    name: string;
    path: string;
    isDirectory: boolean;
    isFile: boolean;
    updatedAt: string | null;
  }> = [];

  const visit = (currentPath: string, depth: number) => {
    if (depth > DIRECTORY_SEARCH_DEPTH || results.length >= DIRECTORY_SEARCH_LIMIT) {
      return;
    }

    let entries: fs.Dirent[] = [];

    try {
      entries = fs.readdirSync(currentPath, {
        withFileTypes: true
      });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= DIRECTORY_SEARCH_LIMIT) {
        return;
      }

      if (hiddenEntryNames.has(entry.name) || !entry.isDirectory()) {
        continue;
      }

      const fullPath = path.join(currentPath, entry.name);
      const stats = fs.statSync(fullPath, {
        throwIfNoEntry: false
      });

      if (entry.name.toLowerCase().includes(normalizedQuery)) {
        results.push({
          name: entry.name,
          path: fullPath,
          isDirectory: true,
          isFile: false,
          updatedAt: stats?.mtime.toISOString() ?? null
        });
      }

      visit(fullPath, depth + 1);
    }
  };

  visit(basePath, 0);
  return results;
}

function broadcast(payload: Record<string, unknown>) {
  const serialized = JSON.stringify(payload);

  for (const socket of sockets) {
    if (socket.readyState === 1) {
      socket.send(serialized);
    }
  }
}

function createFailureMessage(
  sessionId: string,
  reason: string,
  detail?: string | null
) {
  return createMessage(database, {
    sessionId,
    role: "system",
    kind: "status",
    content: detail ? `${reason}\n${detail}` : reason,
    metadataJson: buildRunMetadata(sessionId)
  });
}

function buildRunMetadata(sessionId: string) {
  const current = activeRuns.get(sessionId);

  if (!current) {
    return null;
  }

  const payload: Record<string, unknown> = {};

  if (current.progress.length > 0) {
    payload.codexProgress = [...current.progress].reverse();
  }

  if (current.fileActivity) {
    payload.codexFileActivity = current.fileActivity;
  }

  payload.codexTiming = {
    startedAt: current.startedAt
  };

  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
}

function attachRunArtifactsToLatestMessage(sessionId: string, completedAt?: string) {
  const current = activeRuns.get(sessionId);

  if (!current?.lastAssistantMessageId || !current.workingDirectory || !current.snapshotBefore) {
    return;
  }

  const snapshotAfter = collectWorkspaceSnapshot(current.workingDirectory);
  const fileActivity = diffWorkspaceSnapshots(current.snapshotBefore, snapshotAfter);
  const hasActivity =
    fileActivity.created.length > 0 ||
    fileActivity.modified.length > 0 ||
    fileActivity.deleted.length > 0;

  current.fileActivity = hasActivity ? fileActivity : null;
  const metadataJson = buildRunMetadata(sessionId);

  let nextMetadataJson = metadataJson;
  if (metadataJson && completedAt) {
    try {
      const parsed = JSON.parse(metadataJson) as Record<string, unknown>;
      parsed.codexTiming = {
        startedAt: current.startedAt,
        completedAt,
        elapsedMs: Math.max(
          0,
          new Date(completedAt).getTime() - new Date(current.startedAt).getTime()
        )
      };
      nextMetadataJson = JSON.stringify(parsed);
    } catch {
      nextMetadataJson = metadataJson;
    }
  }

  const updatedMessage = updateMessageMetadata(
    database,
    current.lastAssistantMessageId,
    nextMetadataJson
  );

  if (!updatedMessage) {
    return;
  }

  broadcast({
    type: "message.created",
    sessionId,
    message: updatedMessage
  });
}

function clearRunTimeout(sessionId: string) {
  const current = activeRuns.get(sessionId);

  if (current?.timeoutHandle) {
    clearTimeout(current.timeoutHandle);
    current.timeoutHandle = null;
  }
}

function scheduleRunTimeout(sessionId: string) {
  const current = activeRuns.get(sessionId);

  if (!current) {
    return;
  }

  clearRunTimeout(sessionId);

  const timer = setTimeout(() => {
    const latest = activeRuns.get(sessionId);

    if (!latest) {
      return;
    }

    const elapsedMs =
      Date.now() - new Date(latest.lastEventAt).getTime();
    const thresholdMs = latest.threadId ? RUN_IDLE_TIMEOUT_MS : RUN_START_TIMEOUT_MS;

    if (elapsedMs < thresholdMs) {
      scheduleRunTimeout(sessionId);
      return;
    }

    latest.child.kill("SIGTERM");
    activeRuns.delete(sessionId);
    updateSessionStatus(database, sessionId, "failed");

    const failureMessage = createFailureMessage(
      sessionId,
      latest.threadId
        ? "Codex CLI が長時間反応しなかったため、この実行を失敗扱いにしました。"
        : "Codex CLI の起動がタイムアウトしたため、この実行を失敗扱いにしました。",
      latest.lastLogLine
    );

    broadcast({
      type: "message.created",
      sessionId,
      message: failureMessage
    });

    broadcast({
      type: "session.status",
      sessionId,
      status: "failed"
    });
  }, current.threadId ? RUN_IDLE_TIMEOUT_MS : RUN_START_TIMEOUT_MS);

  current.timeoutHandle = timer;
}

function markRunProgress(
  sessionId: string,
  kind: string,
  logLine?: string | null
) {
  const current = activeRuns.get(sessionId);

  if (!current) {
    return;
  }

  current.lastEventAt = new Date().toISOString();
  current.lastEventKind = kind;
  if (logLine) {
    current.lastLogLine = logLine;
  }
  scheduleRunTimeout(sessionId);
}

function recordRunProgress(sessionId: string, label: string, text: string) {
  const current = activeRuns.get(sessionId);

  if (!current) {
    return;
  }

  const progress = {
    label,
    text,
    createdAt: new Date().toISOString()
  };

  current.progress = [progress, ...current.progress].slice(0, 30);
  markRunProgress(sessionId, `progress:${label}`, text);

  broadcast({
    type: "session.progress",
    sessionId,
    progress
  });
}

function tokenizeCommand(command: string) {
  return command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
}

function getApprovalRulePrefix(command: string) {
  const tokens = tokenizeCommand(command);

  if (tokens.length === 0) {
    return command.trim();
  }

  if (tokens[0] === "npm" && tokens[1] === "run" && tokens[2]) {
    return tokens.slice(0, 3).join(" ");
  }

  if (tokens[0] === "git" && tokens[1]) {
    return tokens.slice(0, 2).join(" ");
  }

  if ((tokens[0] === "node" || tokens[0] === "python" || tokens[0] === "python3") && tokens[1]) {
    return tokens.slice(0, 2).join(" ");
  }

  return tokens.slice(0, Math.min(tokens.length, 2)).join(" ");
}

function clearPendingApproval(sessionId: string, commandId: string | null) {
  const current = activeRuns.get(sessionId);

  if (current && commandId) {
    delete current.pendingApprovals[commandId];
  }

  broadcast({
    type: "session.approval.cleared",
    sessionId,
    commandId,
    decision: "approve"
  });
}

await app.register(cors, {
  origin: true
});

await app.register(cookie);
await app.register(websocket);

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof HttpError) {
    reply.status(error.statusCode).send({
      error: error.message
    });
    return;
  }

  app.log.error(error);
  reply.status(500).send({
    error: "Internal server error."
  });
});

app.get("/api/health", async () => {
  return {
    status: "ok",
    service: "codex-remote-server",
    websocket: "/ws",
    timestamp: new Date().toISOString()
  };
});

app.get("/api/bootstrap", async (request, reply) => {
  const csrfToken = ensureCsrfToken(request, reply);
  const row = database
    .prepare("SELECT value FROM app_metadata WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;

  return {
    appName: "Codex Remote",
    phase: "phase-4",
    schemaVersion: row?.value ?? "unknown",
    csrfToken
  };
});

app.get("/api/codex/usage", async (request) => {
  requireAuth(request);
  return latestCodexUsage
    ? refreshCodexUsageSnapshot(latestCodexUsage)
    : readCodexUsageSnapshot();
});

app.get("/api/sessions/:id/runtime", async (request) => {
  requireAuth(request);

  const params = request.params as { id: string };
  const session = getSession(database, params.id);

  if (!session) {
    throw new HttpError(404, "Session not found.");
  }

  const activeRun = activeRuns.get(params.id);
  const pendingApprovalEntry = activeRun
    ? Object.entries(activeRun.pendingApprovals)[0] ?? null
    : null;

  return {
    codex: {
      binary: getCodexBinary(),
      mode: "child_process",
      linkedVia: "backend spawns local Codex CLI with `codex exec --json`"
    },
    run: activeRun
      ? {
          pid: activeRun.child.pid,
          binary: activeRun.binary,
          args: activeRun.args,
          startedAt: activeRun.startedAt,
          lastEventAt: activeRun.lastEventAt,
          lastEventKind: activeRun.lastEventKind,
          lastLogLine: activeRun.lastLogLine,
          threadId: activeRun.threadId,
          progress: activeRun.progress,
          pendingApproval: pendingApprovalEntry
            ? {
                commandId: pendingApprovalEntry[0],
                command: pendingApprovalEntry[1].command,
                reason: pendingApprovalEntry[1].reason
              }
            : null
        }
      : null
  };
});

app.get("/api/sessions", async (request, reply) => {
  ensureCsrfToken(request, reply);
  requireAuth(request);

  const sessions = listSessions(database);
  cleanupOrphanUploadDirectories();
  return {
    sessions
  };
});

app.get("/api/trash", async (request, reply) => {
  ensureCsrfToken(request, reply);
  requireAuth(request);

  const sessions = listArchivedSessions(database);
  cleanupOrphanUploadDirectories();
  return {
    sessions
  };
});

app.post("/api/sessions", async (request) => {
  requireCsrf(request);
  requireAuth(request);

  const body = request.body as
    | {
        title?: string;
        workingDirectory?: string;
        model?: string;
        intelligence?: string;
        sandboxMode?: string;
        approvalPolicy?: string;
        fullAccessEnabled?: boolean;
      }
    | undefined;

  const session = createSession(database, {
    title: body?.title,
    workingDirectory: validateWorkingDirectory(body?.workingDirectory),
    model: body?.model ?? null,
    intelligence: body?.intelligence ?? null,
    sandboxMode: body?.fullAccessEnabled
      ? "danger-full-access"
      : body?.sandboxMode ?? "workspace-write",
    approvalPolicy: body?.approvalPolicy ?? "on-request",
    fullAccessEnabled: body?.fullAccessEnabled ?? false
  });

  if (!session) {
    throw new HttpError(500, "Failed to create session.");
  }

  broadcast({
    type: "session.created",
    session
  });

  return {
    session
  };
});

app.patch("/api/sessions/:id", async (request) => {
  requireCsrf(request);
  requireAuth(request);

  const params = request.params as { id: string };
  const body = request.body as
    | {
        title?: string;
        archived?: boolean;
        workingDirectory?: string | null;
        model?: string | null;
        intelligence?: string | null;
        sandboxMode?: string | null;
        approvalPolicy?: string | null;
        fullAccessEnabled?: boolean;
      }
    | undefined;

  if (body?.archived !== undefined) {
    const ok = renameOrArchiveSession(database, params.id, {
      title: body?.title,
      archived: body.archived
    });

    if (!ok) {
      throw new HttpError(404, "Session not found.");
    }
  } else {
    const session = updateSessionSettings(database, params.id, {
      title: body?.title,
      workingDirectory:
        body?.workingDirectory === undefined
          ? undefined
          : validateWorkingDirectory(body.workingDirectory),
      model: body?.model,
      intelligence: body?.intelligence,
      sandboxMode: body?.fullAccessEnabled
        ? "danger-full-access"
        : body?.sandboxMode,
      approvalPolicy: body?.approvalPolicy,
      fullAccessEnabled: body?.fullAccessEnabled
    });

    if (!session) {
      throw new HttpError(404, "Session not found.");
    }
  }

  const session = getSession(database, params.id);

  broadcast({
    type: "session.updated",
    sessionId: params.id,
    session
  });

  return {
    ok: true
  };
});

app.get("/api/directories", async (request) => {
  requireAuth(request);

  const query = request.query as { path?: string } | undefined;
  const currentPath = normalizeBrowserPath(query?.path);
  const stats = fs.statSync(currentPath, {
    throwIfNoEntry: false
  });

  if (!stats?.isDirectory()) {
    throw new HttpError(404, "フォルダが見つかりません。");
  }

  return listDirectoryEntries(currentPath);
});

app.get("/api/directories/search", async (request) => {
  requireAuth(request);

  const query = request.query as { path?: string; query?: string } | undefined;
  const basePath = normalizeBrowserPath(query?.path);
  const searchQuery = query?.query?.trim() ?? "";

  return {
    currentPath: basePath,
    query: searchQuery,
    entries: searchDirectories(basePath, searchQuery)
  };
});

app.delete("/api/sessions/:id", async (request) => {
  requireCsrf(request);
  requireAuth(request);

  const params = request.params as { id: string };
  const ok = renameOrArchiveSession(database, params.id, {
    archived: true
  });

  if (!ok) {
    throw new HttpError(404, "Session not found.");
  }

  broadcast({
    type: "session.archived",
    sessionId: params.id
  });

  return {
    ok: true
  };
});

app.delete("/api/trash/:id", async (request) => {
  requireCsrf(request);
  requireAuth(request);

  const params = request.params as { id: string };
  const ok = deleteArchivedSession(database, params.id);

  if (!ok) {
    throw new HttpError(404, "Session not found.");
  }

  cleanupOrphanUploadDirectories();

  broadcast({
    type: "session.deleted",
    sessionId: params.id
  });

  return {
    ok: true
  };
});

app.get("/api/sessions/:id/messages", async (request) => {
  requireAuth(request);

  const params = request.params as { id: string };
  const session = getSession(database, params.id);

  if (!session) {
    throw new HttpError(404, "Session not found.");
  }

  return {
    messages: listMessages(database, params.id)
  };
});

app.get("/api/sessions/:id/files", async (request) => {
  requireAuth(request);

  const params = request.params as { id: string };
  const query = request.query as { path?: string } | undefined;
  const session = getSession(database, params.id);

  if (!session) {
    throw new HttpError(404, "Session not found.");
  }

  try {
    return listSessionFiles(session, query?.path);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "ファイル一覧を取得できません。"
    );
  }
});

app.get("/api/sessions/:id/files/content", async (request) => {
  requireAuth(request);

  const params = request.params as { id: string };
  const query = request.query as { path?: string } | undefined;
  const session = getSession(database, params.id);

  if (!session) {
    throw new HttpError(404, "Session not found.");
  }

  if (!query?.path) {
    throw new HttpError(400, "path is required.");
  }

  try {
    return readSessionFilePreview(session, query.path);
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "ファイルプレビューを取得できません。"
    );
  }
});

app.post("/api/sessions/:id/uploads", async (request) => {
  requireCsrf(request);
  requireAuth(request);

  const params = request.params as { id: string };
  const body = request.body as { files?: UploadedFileInput[] } | undefined;
  const session = getSession(database, params.id);

  if (!session) {
    throw new HttpError(404, "Session not found.");
  }

  if (!Array.isArray(body?.files) || body.files.length === 0) {
    throw new HttpError(400, "アップロードするファイルを選択してください。");
  }

  const files = saveUploadedFiles(params.id, body.files);

  return {
    files
  };
});

app.get("/api/sessions/:id/git", async (request) => {
  requireAuth(request);

  const params = request.params as { id: string };
  const session = getSession(database, params.id);

  if (!session) {
    throw new HttpError(404, "Session not found.");
  }

  try {
    const snapshot = await getGitSnapshot(session);
    return snapshot;
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "Git 情報を取得できません。"
    );
  }
});

app.post("/api/sessions/:id/git/commit", async (request) => {
  requireCsrf(request);
  requireAuth(request);

  const params = request.params as { id: string };
  const body = request.body as { message?: string } | undefined;
  const message = body?.message?.trim();

  if (!message) {
    throw new HttpError(400, "コミットメッセージを入力してください。");
  }

  const session = getSession(database, params.id);

  if (!session) {
    throw new HttpError(404, "Session not found.");
  }

  try {
    const snapshot = await createGitCommit(session, message);
    return {
      ok: true,
      snapshot
    };
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "コミットに失敗しました。"
    );
  }
});

app.post("/api/sessions/:id/review", async (request) => {
  requireCsrf(request);
  requireAuth(request);

  const params = request.params as { id: string };
  const session = getSession(database, params.id);

  if (!session) {
    throw new HttpError(404, "Session not found.");
  }

  try {
    const result = await runCodexReview(session);
    return {
      ok: true,
      review: result
    };
  } catch (error) {
    throw new HttpError(
      400,
      error instanceof Error ? error.message : "レビュー実行に失敗しました。"
    );
  }
});

app.post("/api/sessions/:id/approval", async (request) => {
  requireCsrf(request);
  requireAuth(request);

  const params = request.params as { id: string };
  const body = request.body as
    | {
        decision?: "approve" | "approve_for_session" | "deny" | "abort";
        commandId?: string;
        command?: string;
      }
    | undefined;

  if (
    body?.decision !== "approve" &&
    body?.decision !== "approve_for_session" &&
    body?.decision !== "deny" &&
    body?.decision !== "abort"
  ) {
    throw new HttpError(400, "decision must be approve, approve_for_session, deny, or abort.");
  }

  const activeRun = activeRuns.get(params.id);

  if (!activeRun) {
    throw new HttpError(409, "承認待ちの実行は見つかりません。");
  }

  if (body.decision === "abort") {
    recordRunProgress(params.id, "承認応答", "この実行を停止しました。");
    const failureMessage = createFailureMessage(
      params.id,
      "承認待ちの実行を停止しました。"
    );

    clearRunTimeout(params.id);
    activeRun.child.kill("SIGTERM");
    activeRuns.delete(params.id);
    updateSessionStatus(database, params.id, "failed");

    broadcast({
      type: "message.created",
      sessionId: params.id,
      message: failureMessage
    });

    broadcast({
      type: "session.status",
      sessionId: params.id,
      status: "failed"
    });
  } else {
    const command =
      (body.commandId ? activeRun.pendingApprovals[body.commandId]?.command : null) ??
      body.command ??
      "";

    if (body.decision === "approve_for_session" && command.trim().length > 0) {
      const commandPrefix = getApprovalRulePrefix(command);
      createApprovalRule(database, {
        sessionId: params.id,
        commandPrefix
      });
      recordRunProgress(
        params.id,
        "自動許可を追加",
        `このチャットでは今後「${commandPrefix}」で始まるコマンドを自動で許可します。`
      );
    }

    recordRunProgress(
      params.id,
      "承認応答",
      body.decision === "approve" || body.decision === "approve_for_session"
        ? "コマンド実行を許可しました。"
        : "コマンド実行を拒否しました。"
    );
    activeRun.child.stdin.write(
      body.decision === "approve" || body.decision === "approve_for_session"
        ? "y\n"
        : "n\n"
    );
    if (body.commandId) {
      delete activeRun.pendingApprovals[body.commandId];
    }
  }

  broadcast({
    type: "session.approval.cleared",
    sessionId: params.id,
    commandId: body.commandId ?? null,
    decision: body.decision
  });

  return {
    ok: true
  };
});

app.post("/api/sessions/:id/messages", async (request) => {
  requireCsrf(request);
  requireAuth(request);

  const params = request.params as { id: string };
  const body = request.body as
    | { content?: string; attachedFiles?: string[] }
    | undefined;
  const content = body?.content?.trim();

  if (!content) {
    throw new HttpError(400, "Message content is required.");
  }

  const session = getSession(database, params.id);

  if (!session) {
    throw new HttpError(404, "Session not found.");
  }

  if (activeRuns.has(params.id)) {
    throw new HttpError(409, "This chat is already running.");
  }

  if (session.title.startsWith("新しいチャット")) {
    const nextTitle = content.slice(0, 32);
    const updatedSession = updateSessionSettings(database, params.id, {
      title: nextTitle.length === content.length ? nextTitle : `${nextTitle}…`
    });

    broadcast({
      type: "session.updated",
      sessionId: params.id,
      session: updatedSession
    });
  }

  const userMessage = createMessage(database, {
    sessionId: params.id,
    role: "user",
    kind: "chat",
    content,
    metadataJson: JSON.stringify({
      attachedFiles:
        Array.isArray(body?.attachedFiles) && body.attachedFiles.length > 0
          ? body.attachedFiles
          : []
    })
  });

  updateSessionStatus(database, params.id, "running");

  broadcast({
    type: "message.created",
    sessionId: params.id,
    message: userMessage
  });

  broadcast({
    type: "session.status",
    sessionId: params.id,
    status: "running"
  });

  const child = startCodexTurn({
    session,
    prompt: buildPromptWithAttachedFiles(
      session,
      content,
      Array.isArray(body?.attachedFiles) ? body.attachedFiles : []
    ),
    onEvent: (event) => {
      if (event.type === "turn.started") {
        markRunProgress(params.id, "turn.started");
        return;
      }

      if (event.type === "thread.started") {
        markRunProgress(params.id, "thread.started");
        updateSessionThreadId(database, params.id, event.threadId);
        const activeRun = activeRuns.get(params.id);
        if (activeRun) {
          activeRun.threadId = event.threadId;
        }
        broadcast({
          type: "session.thread",
          sessionId: params.id,
          threadId: event.threadId
        });
        return;
      }

      if (event.type === "progress") {
        recordRunProgress(params.id, event.label, event.text);
        return;
      }

      if (event.type === "assistant.message") {
        markRunProgress(params.id, "assistant.message", event.text);
        const assistantMessage = createMessage(database, {
          sessionId: params.id,
          role: "assistant",
          kind: "chat",
          content: event.text,
          metadataJson: buildRunMetadata(params.id)
        });
        const activeRun = activeRuns.get(params.id);
        if (activeRun) {
          activeRun.lastAssistantMessageId = assistantMessage.id;
        }

        broadcast({
          type: "message.created",
          sessionId: params.id,
          message: assistantMessage
        });
        return;
      }

      if (event.type === "command.started") {
        markRunProgress(params.id, "command.started", event.command);
        broadcast({
          type: "session.command.started",
          sessionId: params.id,
          commandId: event.commandId,
          command: event.command
        });
        return;
      }

      if (event.type === "command.completed") {
        markRunProgress(params.id, "command.completed", event.output || event.command);
        broadcast({
          type: "session.command.completed",
          sessionId: params.id,
          commandId: event.commandId,
          command: event.command,
          output: event.output,
          exitCode: event.exitCode
        });
        return;
      }

      if (event.type === "approval.requested") {
        const activeRun = activeRuns.get(params.id);
        const approvalRule = findApprovalRuleForCommand(
          database,
          params.id,
          event.command
        );

        recordRunProgress(
          params.id,
          approvalRule ? "自動許可" : "承認待ち",
          approvalRule
            ? `保存済みルール「${approvalRule.commandPrefix}」に一致したため、実行を自動許可しました。\n${event.command}`
            : event.reason
              ? `${event.command}\n${event.reason}`
              : event.command
        );

        if (approvalRule) {
          activeRun?.child.stdin.write("y\n");
          clearPendingApproval(params.id, event.commandId);
          return;
        }

        if (activeRun) {
          activeRun.pendingApprovals[event.commandId] = {
            command: event.command,
            reason: event.reason
          };
        }

        broadcast({
          type: "session.approval.requested",
          sessionId: params.id,
          commandId: event.commandId,
          command: event.command,
          reason: event.reason
        });
        return;
      }

      if (event.type === "usage.updated") {
        latestCodexUsage = event.usage;
        markRunProgress(params.id, "usage.updated");
        broadcast({
          type: "codex.usage",
          usage: event.usage
        });
        return;
      }

      if (event.type === "turn.completed") {
        markRunProgress(params.id, "turn.completed");
        return;
      }

      markRunProgress(params.id, `log:${event.stream}`, event.text);
      broadcast({
        type: "session.log",
        sessionId: params.id,
        stream: event.stream,
        text: event.text
      });
    },
    onExit: (code) => {
      const activeRun = activeRuns.get(params.id);

      if (!activeRun) {
        return;
      }

      clearRunTimeout(params.id);

      const finalStatus = code === 0 ? "idle" : "failed";
      if (code === 0) {
        attachRunArtifactsToLatestMessage(params.id, new Date().toISOString());
      }

      activeRuns.delete(params.id);
      updateSessionStatus(database, params.id, finalStatus);

      if (code !== 0) {
        const failureMessage = createFailureMessage(
          params.id,
          `Codex CLI の実行が失敗しました。(exit code: ${code ?? "-"})`,
          activeRun?.lastLogLine ?? null
        );

        broadcast({
          type: "message.created",
          sessionId: params.id,
          message: failureMessage
        });
      }

      broadcast({
        type: "session.status",
        sessionId: params.id,
        status: finalStatus
      });
    },
    onError: (error) => {
      clearRunTimeout(params.id);
      activeRuns.delete(params.id);
      updateSessionStatus(database, params.id, "failed");

      const failureMessage = createFailureMessage(
        params.id,
        "Codex CLI の起動または実行に失敗しました。",
        error.message
      );

      broadcast({
        type: "message.created",
        sessionId: params.id,
        message: failureMessage
      });

      broadcast({
        type: "session.status",
        sessionId: params.id,
        status: "failed"
      });

      broadcast({
        type: "session.error",
        sessionId: params.id,
        error: error.message
      });
    }
  });

  activeRuns.set(params.id, {
    child,
    args: buildCodexArgs(session, buildPromptWithAttachedFiles(
      session,
      content,
      Array.isArray(body?.attachedFiles) ? body.attachedFiles : []
    )),
    binary: getCodexBinary(),
    startedAt: new Date().toISOString(),
    lastEventAt: new Date().toISOString(),
    lastEventKind: "spawned",
    lastLogLine: null,
    threadId: null,
    timeoutHandle: null,
    progress: [],
    pendingApprovals: {},
    workingDirectory: session.workingDirectory,
    snapshotBefore:
      session.workingDirectory && fs.statSync(session.workingDirectory, { throwIfNoEntry: false })?.isDirectory()
        ? collectWorkspaceSnapshot(session.workingDirectory)
        : null,
    lastAssistantMessageId: null,
    fileActivity: null
  });
  scheduleRunTimeout(params.id);

  return {
    accepted: true,
    message: userMessage
  };
});

app.get(
  "/ws",
  { websocket: true },
  (socket) => {
    const client = socket as unknown as RealtimeSocket;
    sockets.add(client);

    client.send(
      JSON.stringify({
        type: "server.ready",
        message: "phase-4 websocket connected",
        timestamp: new Date().toISOString()
      })
    );

    client.on("close", () => {
      sockets.delete(client);
    });
  }
);

const start = async () => {
  try {
    await app.listen({
      host: config.host,
      port: config.port
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

await start();
