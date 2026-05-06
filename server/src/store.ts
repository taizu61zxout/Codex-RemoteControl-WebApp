import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const ARCHIVE_RETENTION_DAYS = 5;

export type SessionRecord = {
  id: string;
  title: string;
  codexThreadId: string | null;
  workingDirectory: string | null;
  model: string | null;
  intelligence: string | null;
  sandboxMode: string | null;
  approvalPolicy: string | null;
  fullAccessEnabled: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ArchivedSessionRecord = SessionRecord & {
  archivedAt: string;
  expiresAt: string;
};

export type MessageRecord = {
  id: string;
  sessionId: string;
  role: string;
  kind: string;
  content: string;
  metadataJson: string | null;
  createdAt: string;
};

export type ApprovalRuleRecord = {
  id: string;
  sessionId: string;
  commandPrefix: string;
  createdAt: string;
};

function mapSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    codexThreadId:
      typeof row.codexThreadId === "string" ? row.codexThreadId : null,
    workingDirectory:
      typeof row.workingDirectory === "string" ? row.workingDirectory : null,
    model: typeof row.model === "string" ? row.model : null,
    intelligence:
      typeof row.intelligence === "string" ? row.intelligence : null,
    sandboxMode: typeof row.sandboxMode === "string" ? row.sandboxMode : null,
    approvalPolicy:
      typeof row.approvalPolicy === "string" ? row.approvalPolicy : null,
    fullAccessEnabled: Boolean(row.fullAccessEnabled),
    status: String(row.status),
    createdAt: String(row.createdAt),
    updatedAt: String(row.updatedAt)
  };
}

function archiveCutoffIso() {
  return new Date(
    Date.now() - ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

function archiveExpiresAt(archivedAt: string) {
  return new Date(
    new Date(archivedAt).getTime() + ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();
}

export function purgeExpiredArchivedSessions(database: DatabaseSync) {
  const cutoff = archiveCutoffIso();
  const expiredRows = database
    .prepare(
      `
        SELECT id
        FROM sessions
        WHERE archived = 1
          AND archived_at IS NOT NULL
          AND archived_at <= ?
      `
    )
    .all(cutoff) as Array<{ id: string }>;

  if (expiredRows.length === 0) {
    return [];
  }

  for (const row of expiredRows) {
    database
      .prepare("DELETE FROM approval_rules WHERE session_id = ?")
      .run(row.id);
    database
      .prepare("DELETE FROM messages WHERE session_id = ?")
      .run(row.id);
  }

  const result = database
    .prepare(
      `
        DELETE FROM sessions
        WHERE archived = 1
          AND archived_at IS NOT NULL
          AND archived_at <= ?
      `
    )
    .run(cutoff);

  return expiredRows.map((row) => row.id);
}

export function deleteArchivedSession(database: DatabaseSync, sessionId: string) {
  const archived = database
    .prepare(
      `
        SELECT id
        FROM sessions
        WHERE id = ? AND archived = 1
      `
    )
    .get(sessionId) as { id: string } | undefined;

  if (!archived) {
    return false;
  }

  database
    .prepare("DELETE FROM approval_rules WHERE session_id = ?")
    .run(sessionId);

  database
    .prepare("DELETE FROM messages WHERE session_id = ?")
    .run(sessionId);

  const result = database
    .prepare("DELETE FROM sessions WHERE id = ? AND archived = 1")
    .run(sessionId);

  return Number(result.changes ?? 0) > 0;
}

export function resetRunningSessions(database: DatabaseSync) {
  const result = database
    .prepare(
      `
        UPDATE sessions
        SET status = 'idle'
        WHERE archived = 0
          AND status = 'running'
      `
    )
    .run();

  return Number(result.changes ?? 0);
}

export function listSessions(database: DatabaseSync) {
  purgeExpiredArchivedSessions(database);

  const rows = database
    .prepare(
      `
        SELECT
          id,
          title,
          codex_thread_id AS codexThreadId,
          working_directory AS workingDirectory,
          model,
          intelligence,
          sandbox_mode AS sandboxMode,
          approval_policy AS approvalPolicy,
          full_access_enabled AS fullAccessEnabled,
          status,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM sessions
        WHERE archived = 0
        ORDER BY updated_at DESC
      `
    )
    .all() as Array<Record<string, unknown>>;

  return rows.map(mapSession);
}

export function listArchivedSessions(database: DatabaseSync) {
  purgeExpiredArchivedSessions(database);

  const rows = database
    .prepare(
      `
        SELECT
          id,
          title,
          codex_thread_id AS codexThreadId,
          working_directory AS workingDirectory,
          model,
          intelligence,
          sandbox_mode AS sandboxMode,
          approval_policy AS approvalPolicy,
          full_access_enabled AS fullAccessEnabled,
          status,
          created_at AS createdAt,
          updated_at AS updatedAt,
          archived_at AS archivedAt
        FROM sessions
        WHERE archived = 1
          AND archived_at IS NOT NULL
        ORDER BY archived_at DESC
      `
    )
    .all() as Array<Record<string, unknown>>;

  return rows
    .map((row) => {
      const session = mapSession(row);
      const archivedAt =
        typeof row.archivedAt === "string" ? row.archivedAt : null;

      if (!archivedAt) {
        return null;
      }

      return {
        ...session,
        archivedAt,
        expiresAt: archiveExpiresAt(archivedAt)
      } satisfies ArchivedSessionRecord;
    })
    .filter((entry): entry is ArchivedSessionRecord => entry !== null);
}

export function getSession(database: DatabaseSync, sessionId: string) {
  purgeExpiredArchivedSessions(database);

  const row = database
    .prepare(
      `
        SELECT
          id,
          title,
          codex_thread_id AS codexThreadId,
          working_directory AS workingDirectory,
          model,
          intelligence,
          sandbox_mode AS sandboxMode,
          approval_policy AS approvalPolicy,
          full_access_enabled AS fullAccessEnabled,
          status,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM sessions
        WHERE id = ? AND archived = 0
      `
    )
    .get(sessionId) as Record<string, unknown> | undefined;

  return row ? mapSession(row) : null;
}

export function createSession(
  database: DatabaseSync,
  input: {
    title?: string;
    workingDirectory?: string | null;
    model?: string | null;
    intelligence?: string | null;
    sandboxMode?: string | null;
    approvalPolicy?: string | null;
    fullAccessEnabled?: boolean;
  }
) {
  const now = new Date().toISOString();
  const id = randomUUID();
  const title =
    typeof input.title === "string" && input.title.trim().length > 0
      ? input.title.trim()
      : "新しいチャット";

  database
    .prepare(
      `
        INSERT INTO sessions (
          id,
          title,
          codex_thread_id,
          working_directory,
          model,
          intelligence,
          sandbox_mode,
          approval_policy,
          full_access_enabled,
          archived,
          status,
          created_at,
          updated_at
        ) VALUES (
          @id,
          @title,
          NULL,
          @workingDirectory,
          @model,
          @intelligence,
          @sandboxMode,
          @approvalPolicy,
          @fullAccessEnabled,
          0,
          'idle',
          @createdAt,
          @updatedAt
        )
      `
    )
    .run({
      id,
      title,
      workingDirectory: input.workingDirectory ?? null,
      model: input.model ?? null,
      intelligence: input.intelligence ?? "medium",
      sandboxMode: input.sandboxMode ?? "workspace-write",
      approvalPolicy: input.approvalPolicy ?? "never",
      fullAccessEnabled: Number(input.fullAccessEnabled ?? false),
      createdAt: now,
      updatedAt: now
    });

  return getSession(database, id);
}

export function updateSessionStatus(
  database: DatabaseSync,
  sessionId: string,
  status: string
) {
  database
    .prepare(
      `
        UPDATE sessions
        SET status = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(status, new Date().toISOString(), sessionId);
}

export function updateSessionThreadId(
  database: DatabaseSync,
  sessionId: string,
  threadId: string
) {
  database
    .prepare(
      `
        UPDATE sessions
        SET codex_thread_id = ?, updated_at = ?
        WHERE id = ?
      `
    )
    .run(threadId, new Date().toISOString(), sessionId);
}

export function renameOrArchiveSession(
  database: DatabaseSync,
  sessionId: string,
  body: { title?: string; archived?: boolean }
) {
  const current = database
    .prepare(
      "SELECT title, archived FROM sessions WHERE id = ?"
    )
    .get(sessionId) as { title: string; archived: number } | undefined;

  if (!current) {
    return false;
  }

  database
    .prepare(
      `
        UPDATE sessions
        SET
          title = @title,
          archived = @archived,
          archived_at = @archivedAt,
          updated_at = @updatedAt
        WHERE id = @id
      `
    )
    .run({
      id: sessionId,
      title:
        typeof body.title === "string" && body.title.trim().length > 0
          ? body.title.trim()
          : current.title,
      archived:
        typeof body.archived === "boolean"
          ? Number(body.archived)
          : current.archived,
      archivedAt:
        typeof body.archived === "boolean"
          ? body.archived
            ? new Date().toISOString()
            : null
          : null,
      updatedAt: new Date().toISOString()
    });

  return true;
}

export function updateSessionSettings(
  database: DatabaseSync,
  sessionId: string,
  input: {
    title?: string;
    workingDirectory?: string | null;
    model?: string | null;
    intelligence?: string | null;
    sandboxMode?: string | null;
    approvalPolicy?: string | null;
    fullAccessEnabled?: boolean;
  }
) {
  const current = database
    .prepare(
      `
        SELECT
          title,
          working_directory AS workingDirectory,
          model,
          intelligence,
          sandbox_mode AS sandboxMode,
          approval_policy AS approvalPolicy,
          full_access_enabled AS fullAccessEnabled
        FROM sessions
        WHERE id = ? AND archived = 0
      `
    )
    .get(sessionId) as
    | {
        title: string;
        workingDirectory: string | null;
        model: string | null;
        intelligence: string | null;
        sandboxMode: string | null;
        approvalPolicy: string | null;
        fullAccessEnabled: number;
      }
    | undefined;

  if (!current) {
    return null;
  }

  database
    .prepare(
      `
        UPDATE sessions
        SET
          title = @title,
          working_directory = @workingDirectory,
          model = @model,
          intelligence = @intelligence,
          sandbox_mode = @sandboxMode,
          approval_policy = @approvalPolicy,
          full_access_enabled = @fullAccessEnabled,
          updated_at = @updatedAt
        WHERE id = @id
      `
    )
    .run({
      id: sessionId,
      title:
        typeof input.title === "string" && input.title.trim().length > 0
          ? input.title.trim()
          : current.title,
      workingDirectory:
        input.workingDirectory === undefined
          ? current.workingDirectory
          : input.workingDirectory,
      model: input.model === undefined ? current.model : input.model,
      intelligence:
        input.intelligence === undefined
          ? current.intelligence
          : input.intelligence,
      sandboxMode:
        input.sandboxMode === undefined
          ? current.sandboxMode
          : input.sandboxMode,
      approvalPolicy:
        input.approvalPolicy === undefined
          ? current.approvalPolicy
          : input.approvalPolicy,
      fullAccessEnabled:
        input.fullAccessEnabled === undefined
          ? current.fullAccessEnabled
          : Number(input.fullAccessEnabled),
      updatedAt: new Date().toISOString()
    });

  return getSession(database, sessionId);
}

export function listMessages(database: DatabaseSync, sessionId: string) {
  return database
    .prepare(
      `
        SELECT
          id,
          session_id AS sessionId,
          role,
          kind,
          content,
          metadata_json AS metadataJson,
          created_at AS createdAt
        FROM messages
        WHERE session_id = ?
        ORDER BY created_at ASC
      `
    )
    .all(sessionId) as MessageRecord[];
}

export function createMessage(
  database: DatabaseSync,
  input: {
    sessionId: string;
    role: string;
    kind: string;
    content: string;
    metadataJson?: string | null;
  }
) {
  const message: MessageRecord = {
    id: randomUUID(),
    sessionId: input.sessionId,
    role: input.role,
    kind: input.kind,
    content: input.content,
    metadataJson: input.metadataJson ?? null,
    createdAt: new Date().toISOString()
  };

  database
    .prepare(
      `
        INSERT INTO messages (
          id,
          session_id,
          role,
          kind,
          content,
          metadata_json,
          created_at
        ) VALUES (
          @id,
          @sessionId,
          @role,
          @kind,
          @content,
          @metadataJson,
          @createdAt
        )
      `
    )
    .run(message);

  updateSessionStatus(database, input.sessionId, "active");

  return message;
}

export function updateMessageMetadata(
  database: DatabaseSync,
  messageId: string,
  metadataJson: string | null
) {
  const existing = database
    .prepare(
      `
        SELECT
          id,
          session_id AS sessionId,
          role,
          kind,
          content,
          metadata_json AS metadataJson,
          created_at AS createdAt
        FROM messages
        WHERE id = ?
      `
    )
    .get(messageId) as MessageRecord | undefined;

  if (!existing) {
    return null;
  }

  database
    .prepare(
      `
        UPDATE messages
        SET metadata_json = ?
        WHERE id = ?
      `
    )
    .run(metadataJson, messageId);

  return {
    ...existing,
    metadataJson
  } satisfies MessageRecord;
}

export function createApprovalRule(
  database: DatabaseSync,
  input: {
    sessionId: string;
    commandPrefix: string;
  }
) {
  const rule: ApprovalRuleRecord = {
    id: randomUUID(),
    sessionId: input.sessionId,
    commandPrefix: input.commandPrefix,
    createdAt: new Date().toISOString()
  };

  database
    .prepare(
      `
        INSERT INTO approval_rules (
          id,
          session_id,
          command_prefix,
          created_at
        ) VALUES (
          @id,
          @sessionId,
          @commandPrefix,
          @createdAt
        )
        ON CONFLICT(session_id, command_prefix) DO UPDATE SET
          created_at = excluded.created_at
      `
    )
    .run(rule);

  return rule;
}

export function findApprovalRuleForCommand(
  database: DatabaseSync,
  sessionId: string,
  command: string
) {
  const rows = database
    .prepare(
      `
        SELECT
          id,
          session_id AS sessionId,
          command_prefix AS commandPrefix,
          created_at AS createdAt
        FROM approval_rules
        WHERE session_id = ?
        ORDER BY length(command_prefix) DESC, created_at DESC
      `
    )
    .all(sessionId) as ApprovalRuleRecord[];

  return (
    rows.find((rule) => command === rule.commandPrefix || command.startsWith(`${rule.commandPrefix} `)) ??
    null
  );
}
