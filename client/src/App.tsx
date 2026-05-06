import {
  Archive,
  AlertTriangle,
  Bot,
  ChevronLeft,
  Cpu,
  Ellipsis,
  FileText,
  FolderOpen,
  Search,
  LoaderCircle,
  Menu,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Paperclip,
  RefreshCw,
  Send,
  Settings2,
  Square,
  Sparkles,
  TerminalSquare,
  X
} from "lucide-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type BootstrapResponse = {
  appName: string;
  phase: string;
  schemaVersion: string;
  csrfToken: string;
};

type SessionRecord = {
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

type ArchivedSessionRecord = SessionRecord & {
  archivedAt: string;
  expiresAt: string;
};

type MessageRecord = {
  id: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  kind: string;
  content: string;
  metadataJson: string | null;
  createdAt: string;
};

type DirectoryEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  updatedAt: string | null;
};

type DirectoryListingResponse = {
  currentPath: string;
  homePath: string;
  initialPath: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
};

type DirectorySearchResponse = {
  currentPath: string;
  query: string;
  entries: DirectoryEntry[];
};

type SessionFileListingResponse = {
  rootPath: string;
  currentPath: string;
  parentPath: string | null;
  entries: DirectoryEntry[];
};

type SessionFilePreview = {
  path: string;
  content: string;
  truncated: boolean;
};

type GitFileEntry = {
  path: string;
  stagedStatus: string;
  unstagedStatus: string;
  status: string;
};

type GitSnapshot = {
  available: boolean;
  repoRoot: string | null;
  branch: string | null;
  summary: string | null;
  files: GitFileEntry[];
  stagedDiff: string;
  workingDiff: string;
  lastCommit: string | null;
};

type ReviewResult = {
  summary: string;
  rawLines: string[];
};

type SessionRuntimeResponse = {
  codex: {
    binary: string;
    mode: string;
    linkedVia: string;
  };
  run: {
    pid: number;
    binary: string;
    args: string[];
    startedAt: string;
    lastEventAt: string;
    lastEventKind: string;
    lastLogLine: string | null;
    threadId: string | null;
    progress: RunProgress[];
    pendingApproval: PendingApproval | null;
  } | null;
};

type RunProgress = {
  label: string;
  text: string;
  createdAt: string;
};

type FileActivity = {
  created: string[];
  modified: string[];
  deleted: string[];
};

type CodexTiming = {
  startedAt: string;
  completedAt?: string;
  elapsedMs?: number;
};

type CodexUsageWindow = {
  usedPercent: number | null;
  remainingPercent: number | null;
  windowMinutes: number | null;
  resetsAt: number | null;
  resetsAtIso: string | null;
  resetInSeconds: number | null;
};

type CodexUsageResponse = {
  available: boolean;
  updatedAt: string | null;
  planType: string | null;
  rateLimitReachedType: string | null;
  primary: CodexUsageWindow | null;
  secondary: CodexUsageWindow | null;
};

type UploadedFileResponse = {
  name: string;
  type: string;
  path: string;
  size: number;
};

type BootstrapState = "loading" | "app";
type SocketState = "connecting" | "open" | "closed" | "error";
type BrowserTarget = "create" | "session";
type InspectorTab = "files" | "settings" | "git" | "review";
type AppScreen = "list" | "chat";
type ListTab = "chats" | "trash";

type CommandActivity = {
  commandId: string;
  command: string;
  output: string;
  exitCode: number | null;
  status: "running" | "completed";
};

type ApprovalDecision = "approve" | "approve_for_session" | "deny" | "abort";

type PendingApproval = {
  commandId: string;
  command: string;
  reason: string | null;
};

type RunActivityState =
  | "idle"
  | "booting"
  | "thinking"
  | "responding"
  | "command"
  | "approval"
  | "failed"
  | "reconnecting";

type SessionEvent =
  | { type: "server.ready"; message: string }
  | { type: "session.created"; session: SessionRecord }
  | { type: "session.updated"; sessionId: string; session: SessionRecord | null }
  | { type: "session.archived"; sessionId: string }
  | { type: "session.deleted"; sessionId: string }
  | { type: "session.status"; sessionId: string; status: string }
  | { type: "session.thread"; sessionId: string; threadId: string }
  | { type: "message.created"; sessionId: string; message: MessageRecord }
  | {
      type: "session.command.started";
      sessionId: string;
      commandId: string;
      command: string;
    }
  | {
      type: "session.command.completed";
      sessionId: string;
      commandId: string;
      command: string;
      output: string;
      exitCode: number | null;
    }
  | {
      type: "session.approval.requested";
      sessionId: string;
      commandId: string;
      command: string;
      reason: string | null;
    }
  | {
      type: "session.approval.cleared";
      sessionId: string;
      commandId: string | null;
      decision: ApprovalDecision;
    }
  | { type: "session.log"; sessionId: string; stream: string; text: string }
  | { type: "session.progress"; sessionId: string; progress: RunProgress }
  | { type: "codex.usage"; usage: CodexUsageResponse }
  | { type: "session.error"; sessionId: string; error: string };

type SessionDraft = {
  title: string;
  workingDirectory: string;
  model: string;
  intelligence: string;
  sandboxMode: string;
  fullAccessEnabled: boolean;
};

type SessionSettingsPayload = {
  title: string;
  workingDirectory: string | null;
  model: string | null;
  intelligence: string | null;
  sandboxMode: string;
  approvalPolicy: string;
  fullAccessEnabled: boolean;
};

type SessionSaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const selectClassName =
  "flex h-11 w-full rounded-xl border border-white/10 bg-[#141a20] px-3 py-2 text-sm text-stone-100 shadow-sm outline-none transition focus-visible:border-amber-300/40 focus-visible:ring-2 focus-visible:ring-amber-300/20";

const intelligenceOptions = [
  { label: "低", value: "low" },
  { label: "中", value: "medium" },
  { label: "高", value: "high" },
  { label: "非常に高い", value: "xhigh" }
];

const modelOptions = [
  "gpt-5.5",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.2"
];

const sandboxOptions = [
  { label: "ワークスペース編集", value: "workspace-write" },
  { label: "読み取りのみ", value: "read-only" }
];

function emptyToNull(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toSessionDraft(session: SessionRecord | null): SessionDraft {
  return {
    title: session?.title ?? "",
    workingDirectory: session?.workingDirectory ?? "",
    model: session?.model ?? "",
    intelligence: session?.intelligence ?? "medium",
    sandboxMode: session?.sandboxMode === "read-only" ? "read-only" : "workspace-write",
    fullAccessEnabled: session?.fullAccessEnabled ?? false
  };
}

function toSessionSettingsPayload(draft: SessionDraft): SessionSettingsPayload {
  return {
    title: draft.title,
    workingDirectory: emptyToNull(draft.workingDirectory),
    model: emptyToNull(draft.model),
    intelligence: emptyToNull(draft.intelligence),
    sandboxMode: draft.fullAccessEnabled ? "danger-full-access" : draft.sandboxMode,
    approvalPolicy: "on-request",
    fullAccessEnabled: draft.fullAccessEnabled
  };
}

function serializeSessionSettings(payload: SessionSettingsPayload) {
  return JSON.stringify(payload);
}

async function readJson<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);

  if (!response.ok) {
    let message = "リクエストに失敗しました。";

    try {
      const data = (await response.json()) as { error?: string };
      if (typeof data.error === "string") {
        message = data.error;
      }
    } catch {
      message = response.statusText || message;
    }

    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return (await response.json()) as T;
}

function isUnauthorizedError(cause: unknown) {
  return typeof cause === "object" && cause !== null && "status" in cause && cause.status === 401;
}

function formatRemainingDays(expiresAt: string) {
  const remainingMs = new Date(expiresAt).getTime() - Date.now();
  const remainingDays = Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  return remainingDays;
}

function readRouteFromHash() {
  const hash = window.location.hash || "#/";

  if (hash.startsWith("#/chat/")) {
    return {
      screen: "chat" as const,
      listTab: "chats" as const,
      sessionId: decodeURIComponent(hash.slice("#/chat/".length))
    };
  }

  if (hash === "#/trash") {
    return {
      screen: "list" as const,
      listTab: "trash" as const,
      sessionId: null
    };
  }

  return {
    screen: "list" as const,
    listTab: "chats" as const,
    sessionId: null
  };
}

function formatStatus(status: string) {
  switch (status) {
    case "running":
      return {
        label: "実行中",
        variant: "warning" as const
      };
    case "failed":
      return {
        label: "失敗",
        variant: "danger" as const
      };
    case "active":
      return {
        label: "準備中",
        variant: "secondary" as const
      };
    default:
      return {
        label: "待機中",
        variant: "success" as const
      };
  }
}

function buildReviewCards(summary: string) {
  const lines = summary
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sections: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string[] } | null = null;

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line) || /^(\d+\.|-)\s/.test(line)) {
      if (current) {
        sections.push({
          title: current.title,
          body: current.body.join("\n")
        });
      }

      current = {
        title: line.replace(/^#{1,6}\s/, "").replace(/^(\d+\.|-)\s/, ""),
        body: []
      };
      continue;
    }

    if (!current) {
      current = {
        title: "Summary",
        body: []
      };
    }

    current.body.push(line);
  }

  if (current) {
    sections.push({
      title: current.title,
      body: current.body.join("\n")
    });
  }

  return sections.length > 0
    ? sections
    : [
        {
          title: "Summary",
          body: summary
        }
      ];
}

function getRelativePath(rootPath: string | null | undefined, targetPath: string) {
  if (!rootPath) {
    return targetPath;
  }

  if (targetPath === rootPath) {
    return ".";
  }

  return targetPath.startsWith(`${rootPath}/`)
    ? targetPath.slice(rootPath.length + 1)
    : targetPath;
}

function getAttachmentLabel(rootPath: string | null | undefined, targetPath: string) {
  const relativePath = getRelativePath(rootPath, targetPath);

  if (relativePath !== targetPath) {
    return relativePath;
  }

  return targetPath.split(/[\\/]/).filter(Boolean).pop() ?? targetPath;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return window.btoa(binary);
}

function parseAttachedFiles(metadataJson: string | null) {
  if (!metadataJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(metadataJson) as { attachedFiles?: unknown };
    return Array.isArray(parsed.attachedFiles)
      ? parsed.attachedFiles.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseCodexProgress(metadataJson: string | null) {
  if (!metadataJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(metadataJson) as { codexProgress?: unknown };

    if (!Array.isArray(parsed.codexProgress)) {
      return [];
    }

    return parsed.codexProgress.filter((item): item is RunProgress => {
      if (!item || typeof item !== "object") {
        return false;
      }

      const candidate = item as Partial<RunProgress>;
      return (
        typeof candidate.label === "string" &&
        typeof candidate.text === "string" &&
        typeof candidate.createdAt === "string"
      );
    });
  } catch {
    return [];
  }
}

function parseCodexFileActivity(metadataJson: string | null) {
  if (!metadataJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadataJson) as { codexFileActivity?: unknown };
    const activity = parsed.codexFileActivity;

    if (!activity || typeof activity !== "object") {
      return null;
    }

    const candidate = activity as Partial<FileActivity>;
    const normalize = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];

    return {
      created: normalize(candidate.created),
      modified: normalize(candidate.modified),
      deleted: normalize(candidate.deleted)
    } satisfies FileActivity;
  } catch {
    return null;
  }
}

function parseCodexTiming(metadataJson: string | null) {
  if (!metadataJson) {
    return null;
  }

  try {
    const parsed = JSON.parse(metadataJson) as { codexTiming?: unknown };
    const timing = parsed.codexTiming;

    if (!timing || typeof timing !== "object") {
      return null;
    }

    const candidate = timing as Partial<CodexTiming>;
    if (typeof candidate.startedAt !== "string") {
      return null;
    }

    return {
      startedAt: candidate.startedAt,
      completedAt:
        typeof candidate.completedAt === "string" ? candidate.completedAt : undefined,
      elapsedMs:
        typeof candidate.elapsedMs === "number" ? candidate.elapsedMs : undefined
    } satisfies CodexTiming;
  } catch {
    return null;
  }
}

function ProgressAccordion({
  progress,
  title = "Codex の進行状況"
}: {
  progress: RunProgress[];
  title?: string;
}) {
  if (progress.length === 0) {
    return null;
  }

  return (
    <details className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-stone-200">
      <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
        {title}
      </summary>
      <div className="mt-3 space-y-3">
        {progress.map((entry, index) => (
          <div
            key={`${entry.createdAt}-${index}`}
            className="rounded-xl border border-white/8 bg-[#0b0f13] px-3 py-2"
          >
            <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-stone-500">
              <span>{entry.label}</span>
              <span>
                {new Date(entry.createdAt).toLocaleTimeString("ja-JP")}
              </span>
            </div>
            <p className="whitespace-pre-wrap break-words text-xs leading-5 text-stone-300 [overflow-wrap:anywhere]">
              {entry.text}
            </p>
          </div>
        ))}
      </div>
    </details>
  );
}

function InlineRunIndicator({
  state,
  label,
  detail,
  progress,
  activeCommand,
  elapsedMs
}: {
  state: RunActivityState;
  label: string;
  detail: string;
  progress: RunProgress[];
  activeCommand: CommandActivity | null;
  elapsedMs: number | null;
}) {
  if (state === "idle" || state === "failed" || state === "reconnecting") {
    return null;
  }

  const liveProgress = progress
    .filter((entry) => entry.text.trim().length > 0)
    .slice(0, 8)
    .reverse();
  const tone =
    state === "approval"
      ? "border-amber-300/24 bg-amber-300/[0.07] text-amber-50"
      : "border-cyan-300/18 bg-cyan-300/[0.055] text-cyan-50";

  return (
    <div
      className={cn(
        "mr-auto w-full rounded-xl border px-3 py-2.5 text-sm",
        tone
      )}
    >
      <div className="flex items-center gap-3">
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="inline-flex size-2 rounded-full bg-current opacity-90 motion-status-dot motion-status-dot-1" />
          <span className="inline-flex size-2 rounded-full bg-current opacity-70 motion-status-dot motion-status-dot-2" />
          <span className="inline-flex size-2 rounded-full bg-current opacity-50 motion-status-dot motion-status-dot-3" />
        </div>
        <div className="min-w-0">
          <p className="font-medium">{label}</p>
          <p className="mt-0.5 text-xs leading-5 text-current/72">{detail}</p>
        </div>
      </div>

      {elapsedMs !== null ? (
        <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/8 bg-black/12 px-2.5 py-1 text-[11px] text-current/72">
          <Cpu className="size-3" />
          <span>経過 {formatDuration(elapsedMs)}</span>
        </div>
      ) : null}

      {activeCommand ? (
        <div className="mt-2 rounded-lg border border-white/8 bg-black/16 px-2.5 py-2">
          <div className="mb-1 flex items-center gap-2 text-[11px] text-current/60">
            <TerminalSquare className="size-3" />
            <span>実行中</span>
          </div>
          <p className="break-words font-mono text-xs leading-5 text-current/82 [overflow-wrap:anywhere]">
            {activeCommand.command}
          </p>
        </div>
      ) : null}

      {liveProgress.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          {liveProgress.map((entry, index) => (
            <div
              key={`${entry.createdAt}-${index}`}
              className="rounded-lg border border-white/8 bg-black/12 px-2.5 py-2"
            >
              <div className="mb-1 flex items-center justify-between gap-3 text-[11px] text-current/55">
                <span>{entry.label}</span>
                <span>{new Date(entry.createdAt).toLocaleTimeString("ja-JP")}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-xs leading-5 text-current/82 [overflow-wrap:anywhere]">
                {entry.text}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FileActivityCard({
  activity,
  rootPath
}: {
  activity: FileActivity | null;
  rootPath: string | null | undefined;
}) {
  if (
    !activity ||
    (activity.created.length === 0 &&
      activity.modified.length === 0 &&
      activity.deleted.length === 0)
  ) {
    return null;
  }

  const sections = [
    {
      title: "作成",
      files: activity.created,
      tone: "border-emerald-300/14 bg-emerald-300/8 text-emerald-100"
    },
    {
      title: "編集",
      files: activity.modified,
      tone: "border-cyan-300/14 bg-cyan-300/8 text-cyan-100"
    },
    {
      title: "削除",
      files: activity.deleted,
      tone: "border-rose-300/14 bg-rose-300/8 text-rose-100"
    }
  ].filter((section) => section.files.length > 0);

  return (
    <div className="mt-4 rounded-2xl border border-white/10 bg-[#0b1015] p-3 shadow-[0_18px_48px_rgba(0,0,0,0.22)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-stone-500">
          Codex の変更
        </p>
        <span className="text-xs text-stone-500">
          {sections.reduce((total, section) => total + section.files.length, 0)} 件
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {sections.map((section) => (
          <div
            key={section.title}
            className={cn(
              "rounded-xl border px-3 py-2",
              section.tone
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-medium">{section.title}</p>
              <span className="text-[11px] opacity-70">{section.files.length}</span>
            </div>
            <div className="space-y-1.5">
              {section.files.slice(0, 8).map((filePath) => (
                <p
                  key={filePath}
                  className="rounded-lg bg-black/14 px-2 py-1 font-mono text-[11px] leading-5"
                >
                  {getAttachmentLabel(rootPath, filePath)}
                </p>
              ))}
              {section.files.length > 8 ? (
                <p className="text-[11px] opacity-70">
                  ほか {section.files.length - 8} 件
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TimingBadge({
  timing,
  nowMs
}: {
  timing: CodexTiming | null;
  nowMs: number;
}) {
  if (!timing) {
    return null;
  }

  const elapsedMs =
    typeof timing.elapsedMs === "number"
      ? timing.elapsedMs
      : Math.max(0, nowMs - new Date(timing.startedAt).getTime());

  return (
    <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[11px] text-stone-400">
      <Cpu className="size-3" />
      <span>
        {timing.completedAt ? "作業時間" : "経過"} {formatDuration(elapsedMs)}
      </span>
    </div>
  );
}

function mergeMessages(
  existing: MessageRecord[],
  incoming: MessageRecord[]
) {
  const byId = new Map<string, MessageRecord>();

  for (const message of existing) {
    byId.set(message.id, message);
  }

  for (const message of incoming) {
    byId.set(message.id, message);
  }

  return [...byId.values()].sort(
    (left, right) =>
      new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
  );
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));

  if (totalSeconds < 60) {
    return `${totalSeconds}秒`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes < 60) {
    return `${minutes}分${seconds.toString().padStart(2, "0")}秒`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}時間${remainingMinutes.toString().padStart(2, "0")}分`;
}

function formatUsagePercent(value: number | null | undefined) {
  if (typeof value !== "number") {
    return "--";
  }

  return `${Math.max(0, Math.round(value))}%`;
}

function formatResetIn(seconds: number | null | undefined) {
  if (typeof seconds !== "number") {
    return "不明";
  }

  if (seconds < 60) {
    return "1分未満";
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}分`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}時間${remainingMinutes}分` : `${hours}時間`;
  }

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}日${remainingHours}時間` : `${days}日`;
}

function getResetInSeconds(window: CodexUsageWindow | null | undefined, nowMs: number) {
  if (typeof window?.resetsAt === "number") {
    return Math.max(0, window.resetsAt - Math.floor(nowMs / 1000));
  }

  return window?.resetInSeconds ?? null;
}

function formatUsageReset(window: CodexUsageWindow | null | undefined, nowMs: number) {
  return `リセット ${formatResetIn(getResetInSeconds(window, nowMs))}`;
}

function getInspectorTabLabel(tab: InspectorTab) {
  switch (tab) {
    case "files":
      return "Files";
    case "settings":
      return "設定";
    case "git":
      return "Git";
    case "review":
      return "Review";
  }
}

function getInspectorTabButtonClass(tab: InspectorTab, currentTab: InspectorTab) {
  return cn(
    "inline-flex h-9 items-center justify-center rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/30",
    tab === currentTab
      ? "bg-amber-300 text-stone-950 hover:bg-amber-200"
      : "text-stone-300 hover:bg-white/[0.06]"
  );
}

export function App() {
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const inspectorScrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedSessionIdRef = useRef<string | null>(null);
  const [bootstrap, setBootstrap] = useState<BootstrapResponse | null>(null);
  const [view, setView] = useState<BootstrapState>("loading");
  const [screen, setScreen] = useState<AppScreen>("list");
  const [listTab, setListTab] = useState<ListTab>("chats");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const [desktopInspectorVisible, setDesktopInspectorVisible] = useState(true);
  const [socketState, setSocketState] = useState<SocketState>("connecting");
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [archivedSessions, setArchivedSessions] = useState<ArchivedSessionRecord[]>([]);
  const [messagesBySession, setMessagesBySession] = useState<
    Record<string, MessageRecord[]>
  >({});
  const [logsBySession, setLogsBySession] = useState<Record<string, string[]>>({});
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SessionRecord | null>(null);
  const [deleteArchivedTarget, setDeleteArchivedTarget] =
    useState<ArchivedSessionRecord | null>(null);
  const [draft, setDraft] = useState("");
  const [createWorkingDirectory, setCreateWorkingDirectory] = useState("");
  const [sessionDraft, setSessionDraft] = useState<SessionDraft>(toSessionDraft(null));
  const [directoryListing, setDirectoryListing] =
    useState<DirectoryListingResponse | null>(null);
  const [directorySearchQuery, setDirectorySearchQuery] = useState("");
  const [directorySearchResults, setDirectorySearchResults] = useState<DirectoryEntry[]>([]);
  const [directorySearchBusy, setDirectorySearchBusy] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const [browserTarget, setBrowserTarget] = useState<BrowserTarget>("session");
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("files");
  const [sessionFiles, setSessionFiles] = useState<SessionFileListingResponse | null>(null);
  const [filePreview, setFilePreview] = useState<SessionFilePreview | null>(null);
  const [filesBusy, setFilesBusy] = useState(false);
  const [attachedFilesBySession, setAttachedFilesBySession] = useState<
    Record<string, string[]>
  >({});
  const [commandsBySession, setCommandsBySession] = useState<
    Record<string, CommandActivity[]>
  >({});
  const [progressBySession, setProgressBySession] = useState<
    Record<string, RunProgress[]>
  >({});
  const [sessionRuntimeBySession, setSessionRuntimeBySession] = useState<
    Record<string, SessionRuntimeResponse>
  >({});
  const [codexUsage, setCodexUsage] = useState<CodexUsageResponse | null>(null);
  const [pendingApprovalsBySession, setPendingApprovalsBySession] = useState<
    Record<string, PendingApproval | null>
  >({});
  const [responseSettlingUntilBySession, setResponseSettlingUntilBySession] =
    useState<Record<string, number>>({});
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [gitSnapshot, setGitSnapshot] = useState<GitSnapshot | null>(null);
  const [gitBusy, setGitBusy] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewResult, setReviewResult] = useState<ReviewResult | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitBusy, setCommitBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingSession, setSavingSession] = useState(false);
  const [sessionSaveState, setSessionSaveState] = useState<SessionSaveState>("idle");
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [loadingDirectory, setLoadingDirectory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autosaveRequestIdRef = useRef(0);
  const autosaveBaselineRef = useRef("");
  const skipNextAutosaveRef = useRef(true);
  const draftTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const selectedSession = sessions.find((item) => item.id === selectedSessionId) ?? null;
  const sessionRuntime = selectedSessionId
    ? sessionRuntimeBySession[selectedSessionId] ?? null
    : null;
  const attachedFiles = selectedSessionId ? attachedFilesBySession[selectedSessionId] ?? [] : [];
  const commandActivities = selectedSessionId ? commandsBySession[selectedSessionId] ?? [] : [];
  const progressEvents = selectedSessionId ? progressBySession[selectedSessionId] ?? [] : [];
  const pendingApproval = selectedSessionId
    ? pendingApprovalsBySession[selectedSessionId] ?? null
    : null;
  const deferredMessages = useDeferredValue(
    selectedSessionId ? messagesBySession[selectedSessionId] ?? [] : []
  );
  const latestAssistantMessageId = useMemo(() => {
    for (let index = deferredMessages.length - 1; index >= 0; index -= 1) {
      const message = deferredMessages[index];
      if (message.role === "assistant") {
        return message.id;
      }
    }

    return null;
  }, [deferredMessages]);
  const deferredLogs = useDeferredValue(
    selectedSessionId ? logsBySession[selectedSessionId] ?? [] : []
  );
  const activeCount = sessions.filter((item) => item.status === "running").length;
  const readyCount = sessions.filter((item) => item.status === "idle").length;
  const isSessionRunning = selectedSession?.status === "running";
  const liveLogs = useMemo(() => [...deferredLogs].reverse().slice(-6), [deferredLogs]);
  const activeCommand = useMemo(
    () => commandActivities.find((item) => item.status === "running") ?? null,
    [commandActivities]
  );
  const [runtimeNow, setRuntimeNow] = useState(() => Date.now());
  const [usageNow, setUsageNow] = useState(() => Date.now());
  const activeRun = sessionRuntime?.run ?? null;
  const runLagMs = activeRun ? runtimeNow - new Date(activeRun.lastEventAt).getTime() : null;
  const runElapsedMs = activeRun ? runtimeNow - new Date(activeRun.startedAt).getTime() : null;
  const responseSettlingUntil = selectedSessionId
    ? responseSettlingUntilBySession[selectedSessionId] ?? 0
    : 0;
  const isResponseSettling = responseSettlingUntil > runtimeNow;
  const sessionDraftPayload = useMemo(
    () => toSessionSettingsPayload(sessionDraft),
    [sessionDraft]
  );
  const sessionDraftFingerprint = useMemo(
    () => serializeSessionSettings(sessionDraftPayload),
    [sessionDraftPayload]
  );

  useEffect(() => {
    const textarea = draftTextareaRef.current;

    if (!textarea) {
      return;
    }

    const minHeight = 42;
    const maxHeight = 208;
    textarea.style.height = `${minHeight}px`;
    const nextHeight = Math.min(
      maxHeight,
      Math.max(minHeight, textarea.scrollHeight)
    );
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, [draft, selectedSessionId]);
  const selectedSessionFingerprint = useMemo(() => {
    if (!selectedSession) {
      return "";
    }

    return serializeSessionSettings(toSessionSettingsPayload(toSessionDraft(selectedSession)));
  }, [selectedSession]);
  const runStartupSlow =
    !!activeRun &&
    !activeRun.threadId &&
    runElapsedMs !== null &&
    runElapsedMs > 30_000;
  const runStalled =
    !!activeRun && runLagMs !== null && runLagMs > 120_000;
  const showActivityCard =
    !!selectedSession &&
    (socketState !== "open" ||
      selectedSession.status === "failed" ||
      !!pendingApproval);
  const runActivityState = useMemo<RunActivityState>(() => {
    if (selectedSession?.status === "failed") {
      return "failed";
    }

    if (pendingApproval) {
      return "approval";
    }

    if (socketState !== "open" && !isSessionRunning) {
      return "reconnecting";
    }

    if (!isSessionRunning && isResponseSettling) {
      return "responding";
    }

    if (!isSessionRunning) {
      return "idle";
    }

    if (!activeRun?.threadId) {
      return "booting";
    }

    if (activeCommand) {
      return "command";
    }

    if (activeRun.lastEventKind === "assistant.message") {
      const assistantPauseMs =
        runtimeNow - new Date(activeRun.lastEventAt).getTime();

      return assistantPauseMs < 900 ? "responding" : "thinking";
    }

    return "thinking";
  }, [
    activeCommand,
    activeRun,
    isSessionRunning,
    isResponseSettling,
    pendingApproval,
    runtimeNow,
    selectedSession?.status,
    socketState
  ]);
  const runActivityLabel = useMemo(() => {
    switch (runActivityState) {
      case "failed":
        return "実行に失敗しました";
      case "approval":
        return "Codex が承認待ちです";
      case "reconnecting":
        return "接続を確認しています";
      case "booting":
        return "Codex を起動中です";
      case "command":
        return "Codex が実行中です";
      case "responding":
        return "Codex が回答中です";
      case "thinking":
        return "Codex が思考中です";
      default:
        return "待機中";
    }
  }, [runActivityState]);
  const runActivityDescription = useMemo(() => {
    switch (runActivityState) {
      case "failed":
        return "失敗理由は直近の赤いメッセージに表示します。";
      case "approval":
        return "必要な操作の許可を待っています。";
      case "reconnecting":
        return "接続を戻しています。戻りしだい自動で同期します。";
      case "booting":
        return activeRun
          ? `起動済み PID ${activeRun.pid}`
          : "ローカル Codex CLI を起動しています。";
      case "command":
        return activeCommand
          ? "コマンドの実行結果を待っています。"
          : "ローカルコマンドを実行しています。";
      case "responding":
        return isSessionRunning
          ? "回答を画面へ返しています。続きがある場合はこのまま更新されます。"
          : "最後の回答を画面へ反映しています。";
      case "thinking":
        return "いま出した内容の続きを考えています。";
      default:
        return "状態を確認しています。";
    }
  }, [activeCommand, activeRun, isSessionRunning, runActivityState]);
  const inspectorVisible = inspectorOpen || (isDesktopViewport && desktopInspectorVisible);
  const inspectorPanelOpen = isDesktopViewport ? desktopInspectorVisible : inspectorOpen;
  const desktopSidebarWidthClass = desktopSidebarCollapsed
    ? "lg:w-[76px]"
    : "lg:w-[320px] xl:w-[348px]";

  const touchRuntimeEvent = (
    sessionId: string,
    lastEventKind: string,
    update?: (run: NonNullable<SessionRuntimeResponse["run"]>) => NonNullable<SessionRuntimeResponse["run"]>
  ) => {
    startTransition(() => {
      setSessionRuntimeBySession((current) => {
        const runtime = current[sessionId];

        if (!runtime?.run) {
          return current;
        }

        const nextRunBase = {
          ...runtime.run,
          lastEventAt: new Date().toISOString(),
          lastEventKind
        };
        const nextRun = update ? update(nextRunBase) : nextRunBase;

        return {
          ...current,
          [sessionId]: {
            ...runtime,
            run: nextRun
          }
        };
      });
    });
  };

  const scrollTimelineToBottom = (
    behavior: ScrollBehavior = "auto",
    attempts = 1
  ) => {
    const run = (remainingAttempts: number) => {
      window.requestAnimationFrame(() => {
        const node = timelineRef.current;

        if (!node) {
          return;
        }

        node.scrollTo({
          top: node.scrollHeight,
          behavior
        });

        if (remainingAttempts > 1) {
          run(remainingAttempts - 1);
        }
      });
    };

    run(Math.max(1, attempts));
  };

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const syncViewport = () => {
      const nextIsDesktop = media.matches;
      setIsDesktopViewport(nextIsDesktop);
      if (!nextIsDesktop) {
        setDesktopSidebarCollapsed(false);
        setDesktopInspectorVisible(true);
      }
    };

    syncViewport();
    media.addEventListener("change", syncViewport);

    return () => {
      media.removeEventListener("change", syncViewport);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let reconnectTimer: number | null = null;
    let reconnectDelay = 1000;
    let socket: WebSocket | null = null;

    const loadBootstrap = async () => {
      try {
        const data = await readJson<BootstrapResponse>("/api/bootstrap");

        if (!active) {
          return;
        }

        setBootstrap(data);
        setView("app");
        await loadSessions(data.csrfToken);
        await loadArchivedSessions(data.csrfToken);
        await loadCodexUsage(data.csrfToken);
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : "初期化に失敗しました。");
          setView("app");
        }
      }
    };

    const connectSocket = () => {
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      setSocketState("connecting");
      socket = new WebSocket(`${protocol}://${window.location.host}/ws`);

      socket.addEventListener("open", () => {
        reconnectDelay = 1000;
        setSocketState("open");
      });

      socket.addEventListener("message", (event) => {
        try {
          const data = JSON.parse(String(event.data)) as SessionEvent;
          handleRealtimeEvent(data);
        } catch {
          return;
        }
      });

      socket.addEventListener("close", () => {
        if (!active) {
          return;
        }

        setSocketState("closed");
        reconnectTimer = window.setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
          connectSocket();
        }, reconnectDelay);
      });

      socket.addEventListener("error", () => {
        setSocketState("error");
      });
    };

    void loadBootstrap();
    connectSocket();

    return () => {
      active = false;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      socket?.close();
    };
  }, []);

  useEffect(() => {
    selectedSessionIdRef.current = selectedSessionId;
  }, [selectedSessionId]);

  useEffect(() => {
    if (view !== "app" || socketState !== "open" || !bootstrap) {
      return;
    }

    void loadSessions();
    void loadCodexUsage();
    if (selectedSessionIdRef.current) {
      void loadMessages(selectedSessionIdRef.current);
      void loadSessionRuntime(selectedSessionIdRef.current);
    }
  }, [bootstrap, socketState, view]);

  useEffect(() => {
    if (!bootstrap || view !== "app" || !selectedSessionId) {
      return;
    }

    if (socketState === "open" && selectedSession?.status !== "running") {
      return;
    }

    const timer = window.setInterval(() => {
      void loadSessions();
      void loadMessages(selectedSessionId);
      void loadSessionRuntime(selectedSessionId);
    }, 2500);

    return () => {
      window.clearInterval(timer);
    };
  }, [bootstrap, selectedSession?.status, selectedSessionId, socketState, view]);

  useEffect(() => {
    const applyRoute = () => {
      const route = readRouteFromHash();
      setScreen(route.screen);
      setListTab(route.listTab);
      setSelectedSessionId(route.sessionId);
    };

    applyRoute();
    window.addEventListener("hashchange", applyRoute);

    return () => {
      window.removeEventListener("hashchange", applyRoute);
    };
  }, []);

  useEffect(() => {
    if (!selectedSessionId || messagesBySession[selectedSessionId]) {
      return;
    }

    void loadMessages(selectedSessionId);
    void loadSessionRuntime(selectedSessionId);
  }, [selectedSessionId, messagesBySession]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    void loadSessionRuntime(selectedSessionId);
  }, [selectedSessionId]);

  useEffect(() => {
    setSessionDraft(toSessionDraft(selectedSession));
    autosaveBaselineRef.current = selectedSessionFingerprint;
    skipNextAutosaveRef.current = true;
    setSavingSession(false);
    setSessionSaveState("idle");
    setGitSnapshot(null);
    setReviewResult(null);
    setCommitMessage("");
    setSessionFiles(null);
    setFilePreview(null);
  }, [selectedSession?.id]);

  useEffect(() => {
    autosaveBaselineRef.current = selectedSessionFingerprint;
  }, [selectedSessionFingerprint]);

  useEffect(() => {
    if (!inspectorVisible && error === "作業フォルダが未設定です。") {
      setError(null);
    }
  }, [error, inspectorVisible]);

  useEffect(() => {
    if (!bootstrap || !selectedSession) {
      return;
    }

    if (skipNextAutosaveRef.current) {
      skipNextAutosaveRef.current = false;
      return;
    }

    if (sessionDraftFingerprint === autosaveBaselineRef.current) {
      if (!savingSession && sessionSaveState !== "error") {
        setSessionSaveState("saved");
      }

      return;
    }

    setSessionSaveState("dirty");

    if (savingSession) {
      return;
    }

    const timer = window.setTimeout(() => {
      void saveSessionSettings(
        selectedSession.id,
        sessionDraftPayload,
        sessionDraftFingerprint,
        bootstrap.csrfToken
      );
    }, 500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    bootstrap?.csrfToken,
    savingSession,
    selectedSession?.id,
    sessionDraftFingerprint,
    sessionDraftPayload,
    sessionSaveState
  ]);

  useEffect(() => {
    if (!selectedSession || selectedSession.status === "running") {
      return;
    }

    setSending(false);
  }, [selectedSession?.id, selectedSession?.status]);

  useEffect(() => {
    if (screen === "chat" && selectedSessionId && sessions.length > 0 && !selectedSession) {
      window.location.hash = "#/";
    }
  }, [screen, selectedSessionId, selectedSession, sessions.length]);

  useEffect(() => {
    if (
      inspectorVisible &&
      inspectorTab === "git" &&
      selectedSession &&
      !gitSnapshot &&
      !gitBusy
    ) {
      void loadGitSnapshot(selectedSession.id);
    }
  }, [gitBusy, gitSnapshot, inspectorTab, inspectorVisible, selectedSession]);

  useEffect(() => {
    if (
      inspectorVisible &&
      inspectorTab === "files" &&
      selectedSession &&
      !sessionFiles &&
      !filesBusy
    ) {
      void loadSessionFiles(selectedSession.id);
    }
  }, [filesBusy, inspectorTab, inspectorVisible, selectedSession, sessionFiles]);

  useEffect(() => {
    if (!browserOpen || !directoryListing) {
      return;
    }

    const query = directorySearchQuery.trim();

    if (query.length < 2) {
      setDirectorySearchResults([]);
      setDirectorySearchBusy(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      if (!bootstrap) {
        return;
      }

      setDirectorySearchBusy(true);

      try {
        const data = await readJson<DirectorySearchResponse>(
          `/api/directories/search?path=${encodeURIComponent(
            directoryListing.currentPath
          )}&query=${encodeURIComponent(query)}`,
          {
            headers: {
              "x-csrf-token": bootstrap.csrfToken
            }
          }
        );

        setDirectorySearchResults(data.entries);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "フォルダ検索に失敗しました。");
      } finally {
        setDirectorySearchBusy(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [browserOpen, bootstrap, directoryListing, directorySearchQuery]);

  useEffect(() => {
    const node = timelineRef.current;
    if (!node) {
      return;
    }

    scrollTimelineToBottom("auto", 3);
  }, [
    deferredMessages.length,
    isSessionRunning,
    pendingApproval?.commandId,
    selectedSessionId
  ]);

  useEffect(() => {
    if (screen !== "chat" || !selectedSessionId) {
      return;
    }

    scrollTimelineToBottom("auto", 4);
    const timer = window.setTimeout(() => {
      scrollTimelineToBottom("auto", 2);
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
  }, [screen, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId || (!isSessionRunning && !activeRun && !isResponseSettling)) {
      return;
    }

    const timer = window.setInterval(() => {
      setRuntimeNow(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeRun, isResponseSettling, isSessionRunning, selectedSessionId]);

  useEffect(() => {
    if (!bootstrap || view !== "app") {
      return;
    }

    const timer = window.setInterval(() => {
      void loadCodexUsage();
    }, 60_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [bootstrap, view]);

  useEffect(() => {
    if (!codexUsage?.available) {
      return;
    }

    const timer = window.setInterval(() => {
      setUsageNow(Date.now());
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [codexUsage?.available]);

  useEffect(() => {
    if (!bootstrap || view !== "app" || activeCount < 1) {
      return;
    }

    const timer = window.setInterval(() => {
      void loadCodexUsage();
    }, 15_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeCount, bootstrap, view]);

  const currentDirectoryLabel = useMemo(() => {
    if (!directoryListing) {
      return "";
    }

    return directoryListing.currentPath.replace(directoryListing.homePath, "~");
  }, [directoryListing]);
  const availableModelOptions = useMemo(() => {
    if (!sessionDraft.model || modelOptions.includes(sessionDraft.model)) {
      return modelOptions;
    }

    return [sessionDraft.model, ...modelOptions];
  }, [sessionDraft.model]);

  const handleRealtimeEvent = (event: SessionEvent) => {
    if (event.type === "session.created") {
      startTransition(() => {
        setSessions((current) => {
          if (current.some((item) => item.id === event.session.id)) {
            return current;
          }

          return [event.session, ...current];
        });
      });
      return;
    }

    if (event.type === "session.updated" && event.session) {
      const nextSession = event.session;
      startTransition(() => {
        setSessions((current) =>
          current.map((item) => (item.id === event.sessionId ? nextSession : item))
        );
      });
      return;
    }

    if (event.type === "session.archived") {
      startTransition(() => {
        setSessions((current) => current.filter((item) => item.id !== event.sessionId));
        setMessagesBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setLogsBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
      });
      return;
    }

    if (event.type === "session.deleted") {
      startTransition(() => {
        setSessions((current) => current.filter((item) => item.id !== event.sessionId));
        setArchivedSessions((current) =>
          current.filter((item) => item.id !== event.sessionId)
        );
        setMessagesBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setLogsBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setAttachedFilesBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setSessionRuntimeBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
        setResponseSettlingUntilBySession((current) => {
          const next = { ...current };
          delete next[event.sessionId];
          return next;
        });
      });
      return;
    }

    if (event.type === "session.status") {
      startTransition(() => {
        setSessions((current) =>
          current.map((item) =>
            item.id === event.sessionId
              ? {
                  ...item,
                  status: event.status
                }
              : item
          )
        );
      });
      if (event.status === "running") {
        void loadCodexUsage();
      }
      if (event.status !== "running") {
        void loadCodexUsage();
        setPendingApprovalsBySession((current) => ({
          ...current,
          [event.sessionId]: null
        }));
        setSessionRuntimeBySession((current) => {
          const runtime = current[event.sessionId];

          if (!runtime) {
            return current;
          }

          return {
            ...current,
            [event.sessionId]: {
              ...runtime,
              run: null
            }
          };
        });
      }
      if (event.sessionId === selectedSessionId && event.status !== "running") {
        setSending(false);
      }
      return;
    }

    if (event.type === "session.thread") {
      startTransition(() => {
        setSessions((current) =>
          current.map((item) =>
            item.id === event.sessionId
              ? {
                  ...item,
                  codexThreadId: event.threadId
                }
              : item
          )
        );
      });
      return;
    }

    if (event.type === "message.created") {
      startTransition(() => {
        setMessagesBySession((current) => ({
          ...current,
          [event.sessionId]: mergeMessages(current[event.sessionId] ?? [], [
            event.message
          ])
        }));
      });
      if (event.message.role === "assistant") {
        setResponseSettlingUntilBySession((current) => ({
          ...current,
          [event.sessionId]: Date.now() + 1_800
        }));
        touchRuntimeEvent(event.sessionId, "assistant.message");
        window.requestAnimationFrame(() => {
          scrollTimelineToBottom("auto", 2);
        });
      }
      void loadCodexUsage();
      return;
    }

    if (event.type === "session.command.started") {
      startTransition(() => {
        setCommandsBySession((current) => ({
          ...current,
          [event.sessionId]: [
            {
              commandId: event.commandId,
              command: event.command,
              output: "",
              exitCode: null,
              status: "running" as const
            },
            ...(current[event.sessionId] ?? [])
          ].slice(0, 12)
        }));
      });
      touchRuntimeEvent(event.sessionId, "command.started");
      return;
    }

    if (event.type === "session.command.completed") {
      startTransition(() => {
        setCommandsBySession((current) => ({
          ...current,
          [event.sessionId]: (current[event.sessionId] ?? []).map((item) =>
            item.commandId === event.commandId
              ? {
                  ...item,
                  output: event.output,
                  exitCode: event.exitCode,
                  status: "completed"
                }
              : item
          )
        }));
      });
      setPendingApprovalsBySession((current) => {
        const existing = current[event.sessionId];
        if (!existing || existing.commandId !== event.commandId) {
          return current;
        }

        return {
          ...current,
          [event.sessionId]: null
        };
      });
      touchRuntimeEvent(event.sessionId, "command.completed");
      return;
    }

    if (event.type === "session.approval.requested") {
      startTransition(() => {
        setPendingApprovalsBySession((current) => ({
          ...current,
          [event.sessionId]: {
            commandId: event.commandId,
            command: event.command,
            reason: event.reason
          }
        }));
      });
      touchRuntimeEvent(event.sessionId, "approval.requested");
      return;
    }

    if (event.type === "session.approval.cleared") {
      startTransition(() => {
        setPendingApprovalsBySession((current) => ({
          ...current,
          [event.sessionId]: null
        }));
      });
      touchRuntimeEvent(event.sessionId, "approval.cleared");
      return;
    }

    if (event.type === "session.log") {
      startTransition(() => {
        setLogsBySession((current) => ({
          ...current,
          [event.sessionId]: [event.text, ...(current[event.sessionId] ?? [])].slice(0, 20)
        }));
      });
      return;
    }

    if (event.type === "session.progress") {
      startTransition(() => {
        setProgressBySession((current) => ({
          ...current,
          [event.sessionId]: [
            event.progress,
            ...(current[event.sessionId] ?? [])
          ].slice(0, 30)
        }));
      });
      touchRuntimeEvent(
        event.sessionId,
        `progress:${event.progress.label}`
      );
      return;
    }

    if (event.type === "codex.usage") {
      setCodexUsage(event.usage);
      return;
    }

    if (event.type === "session.error" && event.sessionId === selectedSessionId) {
      setError(event.error);
      setSending(false);
    }
  };

  const loadSessions = async (csrfToken = bootstrap?.csrfToken) => {
    if (!csrfToken) {
      return;
    }

    try {
      const data = await readJson<{ sessions: SessionRecord[] }>("/api/sessions", {
        headers: {
          "x-csrf-token": csrfToken
        }
      });

      startTransition(() => {
        setSessions(data.sessions);
        setSelectedSessionId((current) => current ?? data.sessions[0]?.id ?? null);
      });
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        setSessions([]);
        setMessagesBySession({});
        setSessionRuntimeBySession({});
        setSelectedSessionId(null);
        setView("app");
        setError("サーバとの接続状態を確認しています。");
        return;
      }

      throw cause;
    }
  };

  const loadArchivedSessions = async (csrfToken = bootstrap?.csrfToken) => {
    if (!csrfToken) {
      return;
    }

    const data = await readJson<{ sessions: ArchivedSessionRecord[] }>("/api/trash", {
      headers: {
        "x-csrf-token": csrfToken
      }
    });

    startTransition(() => {
      setArchivedSessions(data.sessions);
    });
  };

  const loadCodexUsage = async (csrfToken = bootstrap?.csrfToken) => {
    if (!csrfToken) {
      return;
    }

    try {
      const data = await readJson<CodexUsageResponse>("/api/codex/usage", {
        headers: {
          "x-csrf-token": csrfToken
        }
      });

      setCodexUsage(data);
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        setCodexUsage(null);
      }
    }
  };

  const loadMessages = async (sessionId: string) => {
    if (!bootstrap) {
      return;
    }

    try {
      const data = await readJson<{ messages: MessageRecord[] }>(
        `/api/sessions/${sessionId}/messages`,
        {
          headers: {
            "x-csrf-token": bootstrap.csrfToken
          }
        }
      );

      startTransition(() => {
        setMessagesBySession((current) => ({
          ...current,
          [sessionId]: mergeMessages(current[sessionId] ?? [], data.messages)
        }));
      });
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        setSessions([]);
        setMessagesBySession({});
        setSessionRuntimeBySession({});
        setSelectedSessionId(null);
        setView("app");
        setError("サーバとの接続状態を確認しています。");
        return;
      }

      throw cause;
    }
  };

  const loadSessionRuntime = async (sessionId: string) => {
    if (!bootstrap) {
      return;
    }

    try {
      const data = await readJson<SessionRuntimeResponse>(
        `/api/sessions/${sessionId}/runtime`,
        {
          headers: {
            "x-csrf-token": bootstrap.csrfToken
          }
        }
      );

      startTransition(() => {
        setSessionRuntimeBySession((current) => ({
          ...current,
          [sessionId]: data
        }));
        setPendingApprovalsBySession((current) => ({
          ...current,
          [sessionId]: data.run?.pendingApproval ?? null
        }));
        if (data.run?.progress) {
          setProgressBySession((current) => ({
            ...current,
            [sessionId]: data.run?.progress ?? []
          }));
        }
      });
    } catch (cause) {
      if (isUnauthorizedError(cause)) {
        setSessions([]);
        setMessagesBySession({});
        setSessionRuntimeBySession({});
        setSelectedSessionId(null);
        setView("app");
        setError("サーバとの接続状態を確認しています。");
        return;
      }

      if (sessionId === selectedSessionId) {
        setError(
          cause instanceof Error ? cause.message : "実行状況の取得に失敗しました。"
        );
      }
    }
  };

  const loadDirectory = async (nextPath?: string) => {
    if (!bootstrap) {
      return;
    }

    setLoadingDirectory(true);

    try {
      const search = nextPath
        ? `?path=${encodeURIComponent(nextPath)}`
        : "";
      const data = await readJson<DirectoryListingResponse>(`/api/directories${search}`, {
        headers: {
          "x-csrf-token": bootstrap.csrfToken
        }
      });

      setDirectoryListing(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "フォルダ一覧を取得できません。");
    } finally {
      setLoadingDirectory(false);
    }
  };

  const loadGitSnapshot = async (sessionId = selectedSessionId) => {
    if (!bootstrap || !sessionId) {
      return;
    }

    setGitBusy(true);
    setError(null);

    try {
      const data = await readJson<GitSnapshot>(`/api/sessions/${sessionId}/git`, {
        headers: {
          "x-csrf-token": bootstrap.csrfToken
        }
      });

      setGitSnapshot(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Git 情報を取得できません。");
    } finally {
      setGitBusy(false);
    }
  };

  const loadSessionFiles = async (
    sessionId = selectedSessionId,
    nextPath?: string
  ) => {
    if (!bootstrap || !sessionId) {
      return;
    }

    const sessionForFiles = sessions.find((item) => item.id === sessionId);

    if (!sessionForFiles?.workingDirectory) {
      setSessionFiles(null);
      setFilePreview(null);
      return;
    }

    setFilesBusy(true);
    setError(null);

    try {
      const search = nextPath ? `?path=${encodeURIComponent(nextPath)}` : "";
      const data = await readJson<SessionFileListingResponse>(
        `/api/sessions/${sessionId}/files${search}`,
        {
          headers: {
            "x-csrf-token": bootstrap.csrfToken
          }
        }
      );

      setSessionFiles(data);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ファイル一覧を取得できません。");
    } finally {
      setFilesBusy(false);
    }
  };

  const loadFilePreview = async (targetPath: string) => {
    if (!bootstrap || !selectedSession) {
      return;
    }

    setFilesBusy(true);
    setError(null);

    try {
      const data = await readJson<SessionFilePreview>(
        `/api/sessions/${selectedSession.id}/files/content?path=${encodeURIComponent(targetPath)}`,
        {
          headers: {
            "x-csrf-token": bootstrap.csrfToken
          }
        }
      );

      setFilePreview(data);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "ファイルプレビューを取得できません。"
      );
    } finally {
      setFilesBusy(false);
    }
  };

  const openDirectoryBrowser = async (target: BrowserTarget) => {
    setBrowserTarget(target);
    setBrowserOpen(true);
    setError(null);
    setDirectorySearchQuery("");
    setDirectorySearchResults([]);

    await loadDirectory(
      target === "create"
        ? createWorkingDirectory || undefined
        : sessionDraft.workingDirectory || undefined
    );
  };

  const handleCreateChat = async () => {
    if (!bootstrap) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const data = await readJson<{ session: SessionRecord }>("/api/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": bootstrap.csrfToken
        },
        body: JSON.stringify({
          workingDirectory: emptyToNull(createWorkingDirectory)
        })
      });

      startTransition(() => {
        setSessions((current) => {
          if (current.some((item) => item.id === data.session.id)) {
            return current;
          }

          return [data.session, ...current];
        });
        setSelectedSessionId(data.session.id);
      });
      openChat(data.session.id);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "チャットの作成に失敗しました。"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleArchiveSession = async (sessionId: string) => {
    if (!bootstrap) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await readJson<{ ok: true }>(`/api/sessions/${sessionId}`, {
        method: "DELETE",
        headers: {
          "x-csrf-token": bootstrap.csrfToken
        }
      });

      startTransition(() => {
        const nextSessions = sessions.filter((item) => item.id !== sessionId);
        setSessions(nextSessions);
        const nextSelected =
          selectedSessionId === sessionId ? nextSessions[0]?.id ?? null : selectedSessionId;
        setSelectedSessionId(nextSelected);
        if (!nextSelected) {
          openList("chats");
        }
      });
      await loadArchivedSessions();
      setArchiveTarget(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "チャットの整理に失敗しました。"
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRestoreSession = async (sessionId: string) => {
    if (!bootstrap) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await readJson<{ ok: true }>(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": bootstrap.csrfToken
        },
        body: JSON.stringify({
          archived: false
        })
      });

      await loadSessions();
      await loadArchivedSessions();
      openList("chats");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "チャットの復元に失敗しました。");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteArchivedSessionNow = async (sessionId: string) => {
    if (!bootstrap) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await readJson<{ ok: true }>(`/api/trash/${sessionId}`, {
        method: "DELETE",
        headers: {
          "x-csrf-token": bootstrap.csrfToken
        }
      });

      setDeleteArchivedTarget(null);
      await loadArchivedSessions();
      await loadSessions();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "チャットの完全削除に失敗しました。"
      );
    } finally {
      setBusy(false);
    }
  };

  const saveSessionSettings = async (
    sessionId: string,
    payload: SessionSettingsPayload,
    fingerprint: string,
    csrfToken: string
  ) => {
    const requestId = ++autosaveRequestIdRef.current;

    if (!sessionId) {
      return;
    }

    setSavingSession(true);
    setSessionSaveState("saving");
    setError(null);

    try {
      await readJson<{ ok: true }>(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": csrfToken
        },
        body: JSON.stringify(payload)
      });

      if (autosaveRequestIdRef.current !== requestId) {
        return;
      }

      autosaveBaselineRef.current = fingerprint;
      setSessionSaveState("saved");
    } catch (cause) {
      if (autosaveRequestIdRef.current !== requestId) {
        return;
      }

      setSessionSaveState("error");
      setError(
        cause instanceof Error ? cause.message : "セッション設定の保存に失敗しました。"
      );
    } finally {
      if (autosaveRequestIdRef.current === requestId) {
        setSavingSession(false);
      }
    }
  };

  const handleRunReview = async () => {
    if (!bootstrap || !selectedSession) {
      return;
    }

    setReviewBusy(true);
    setError(null);

    try {
      const data = await readJson<{ ok: true; review: ReviewResult }>(
        `/api/sessions/${selectedSession.id}/review`,
        {
          method: "POST",
          headers: {
            "x-csrf-token": bootstrap.csrfToken
          }
        }
      );

      setReviewResult(data.review);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "レビュー実行に失敗しました。");
    } finally {
      setReviewBusy(false);
    }
  };

  const handleCreateCommit = async () => {
    if (!bootstrap || !selectedSession || !commitMessage.trim()) {
      return;
    }

    setCommitBusy(true);
    setError(null);

    try {
      const data = await readJson<{ ok: true; snapshot: GitSnapshot }>(
        `/api/sessions/${selectedSession.id}/git/commit`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": bootstrap.csrfToken
          },
          body: JSON.stringify({
            message: commitMessage
          })
        }
      );

      setGitSnapshot(data.snapshot);
      setCommitMessage("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "コミット作成に失敗しました。");
    } finally {
      setCommitBusy(false);
    }
  };

  const handleApprovalDecision = async (decision: ApprovalDecision) => {
    if (!bootstrap || !selectedSession || !pendingApproval) {
      return;
    }

    setApprovalBusy(true);
    setError(null);

    try {
      await readJson<{ ok: true }>(`/api/sessions/${selectedSession.id}/approval`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-csrf-token": bootstrap.csrfToken
        },
        body: JSON.stringify({
          decision,
          commandId: pendingApproval.commandId,
          command: pendingApproval.command
        })
      });

      setPendingApprovalsBySession((current) => ({
        ...current,
        [selectedSession.id]: null
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "承認操作に失敗しました。");
    } finally {
      setApprovalBusy(false);
    }
  };

  const toggleAttachedFile = (targetPath: string) => {
    if (!selectedSessionId) {
      return;
    }

    setAttachedFilesBySession((current) => {
      const existing = current[selectedSessionId] ?? [];
      const next = existing.includes(targetPath)
        ? existing.filter((item) => item !== targetPath)
        : [...existing, targetPath];

      return {
        ...current,
        [selectedSessionId]: next
      };
    });
  };

  const removeAttachedFile = (targetPath: string) => {
    if (!selectedSessionId) {
      return;
    }

    setAttachedFilesBySession((current) => ({
      ...current,
      [selectedSessionId]: (current[selectedSessionId] ?? []).filter(
        (item) => item !== targetPath
      )
    }));
  };

  const handleUploadFiles = async (files: FileList | null) => {
    if (!bootstrap || !selectedSessionId || !files || files.length === 0) {
      return;
    }

    setUploadingFiles(true);
    setError(null);

    try {
      const selectedFiles = Array.from(files).slice(0, 8);
      const payloadFiles = await Promise.all(
        selectedFiles.map(async (file) => ({
          name: file.name,
          type: file.type || "application/octet-stream",
          contentBase64: arrayBufferToBase64(await file.arrayBuffer())
        }))
      );
      const data = await readJson<{ files: UploadedFileResponse[] }>(
        `/api/sessions/${selectedSessionId}/uploads`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": bootstrap.csrfToken
          },
          body: JSON.stringify({
            files: payloadFiles
          })
        }
      );

      setAttachedFilesBySession((current) => {
        const existing = current[selectedSessionId] ?? [];
        const next = [
          ...existing,
          ...data.files.map((file) => file.path).filter((filePath) => !existing.includes(filePath))
        ];

        return {
          ...current,
          [selectedSessionId]: next
        };
      });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "ファイルのアップロードに失敗しました。"
      );
    } finally {
      setUploadingFiles(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleSendMessage = async () => {
    if (!bootstrap || !selectedSessionId || !draft.trim()) {
      return;
    }

    setSending(true);
    setError(null);
    scrollTimelineToBottom();

    try {
      const data = await readJson<{ accepted: true; message: MessageRecord }>(
        `/api/sessions/${selectedSessionId}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-csrf-token": bootstrap.csrfToken
          },
          body: JSON.stringify({
            content: draft,
            attachedFiles
          })
        }
      );

      setDraft("");
      setSending(false);
      setMessagesBySession((current) => ({
        ...current,
        [selectedSessionId]: mergeMessages(current[selectedSessionId] ?? [], [
          data.message
        ])
      }));
      scrollTimelineToBottom();
      setSessions((current) =>
        current.map((session) =>
          session.id === selectedSessionId
            ? {
                ...session,
                status: "running"
              }
            : session
        )
      );
      setAttachedFilesBySession((current) => ({
        ...current,
        [selectedSessionId]: []
      }));
      void loadSessions();
      void loadMessages(selectedSessionId);
      void loadSessionRuntime(selectedSessionId);
      scrollTimelineToBottom();
    } catch (cause) {
      setSending(false);
      setError(
        cause instanceof Error ? cause.message : "メッセージ送信に失敗しました。"
      );
    }
  };

  const applyDirectorySelection = () => {
    if (!directoryListing) {
      return;
    }

    if (browserTarget === "create") {
      setCreateWorkingDirectory(directoryListing.currentPath);
    } else {
      setSessionDraft((current) => ({
        ...current,
        workingDirectory: directoryListing.currentPath
      }));
    }

    setBrowserOpen(false);
  };

  const openList = (tab: ListTab = "chats") => {
    setInspectorOpen(false);
    window.location.hash = tab === "trash" ? "#/trash" : "#/";
  };

  const openChat = (sessionId: string) => {
    setInspectorOpen(false);
    window.location.hash = `#/chat/${encodeURIComponent(sessionId)}`;
  };

  const openInspector = (tab?: InspectorTab) => {
    if (tab) {
      setInspectorTab(tab);
    }

    if (window.matchMedia("(min-width: 1024px)").matches) {
      setDesktopInspectorVisible(true);
      return;
    }

    setInspectorOpen(true);
  };

  const scrollInspectorToTop = () => {
    window.requestAnimationFrame(() => {
      inspectorScrollRef.current?.scrollTo({
        top: 0,
        behavior: "smooth"
      });
    });
  };

  const selectInspectorTab = (tab: InspectorTab) => {
    openInspector(tab);
    scrollInspectorToTop();

    if (tab === "files") {
      void loadSessionFiles();
    }

    if (tab === "git") {
      void loadGitSnapshot();
    }
  };

  const handleInspectorTabPress = (tab: InspectorTab) => {
    selectInspectorTab(tab);
  };

  const closeInspectorPanel = () => {
    if (isDesktopViewport) {
      setDesktopInspectorVisible(false);
      return;
    }

    setInspectorOpen(false);
  };

  const toggleDesktopInspectorPanel = () => {
    setDesktopInspectorVisible((current) => !current);
  };

  if (view === "loading") {
    return (
      <main className="min-h-screen bg-transparent px-4 py-8 text-stone-100 sm:px-6 lg:px-10">
        <div className="mx-auto flex min-h-[70vh] max-w-6xl items-center justify-center">
          <Card className="w-full max-w-lg border-white/8 bg-[#10151b]/96">
            <CardContent className="flex items-center gap-4 p-8">
              <LoaderCircle className="size-6 animate-spin text-amber-300" />
              <div>
                <p className="text-sm uppercase tracking-[0.24em] text-stone-500">
                  Codex Remote
                </p>
                <p className="mt-1 text-base text-stone-300">
                  ローカル環境とセッション状態を読み込んでいます。
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main
      className={cn(
        "bg-transparent text-stone-100",
        screen === "chat" ? "h-dvh overflow-hidden px-0 py-0" : "min-h-screen px-4 py-6 sm:px-6 lg:px-10"
      )}
    >
      <div
        className={cn(
          screen === "chat"
            ? "flex h-full min-h-0 flex-col lg:flex-row"
            : "mx-auto flex max-w-7xl flex-col gap-6"
        )}
      >
        {screen === "list" ? (
          <>
            <header className="motion-fade-in flex flex-col gap-4 rounded-[24px] border border-white/8 bg-[#0d1217]/90 p-4 shadow-[0_28px_80px_rgba(0,0,0,0.32)] backdrop-blur lg:flex-row lg:items-center lg:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="rounded-2xl border border-white/8 bg-white/[0.04] px-3 py-2 text-sm font-medium text-stone-100">
                  Codex Remote
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-stone-100">
                    {listTab === "trash" ? "ゴミ箱" : "チャット一覧"}
                  </p>
                  <p className="truncate text-xs text-stone-500">
                    {listTab === "trash" ? "削除済みチャット" : "保存済みチャットを表示"}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-stone-400">
                  <span
                    className="inline-flex flex-col items-center rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1 leading-tight"
                    title={`5時間枠 リセットまで ${formatResetIn(getResetInSeconds(codexUsage?.primary, usageNow))}`}
                  >
                    <span>5h 残{formatUsagePercent(codexUsage?.primary?.remainingPercent)}</span>
                    <span className="text-[10px] text-stone-500">
                      {formatUsageReset(codexUsage?.primary, usageNow)}
                    </span>
                  </span>
                  <span
                    className="inline-flex flex-col items-center rounded-xl border border-white/10 bg-white/[0.04] px-2.5 py-1 leading-tight"
                    title={`週枠 リセットまで ${formatResetIn(getResetInSeconds(codexUsage?.secondary, usageNow))}`}
                  >
                    <span>週 残{formatUsagePercent(codexUsage?.secondary?.remainingPercent)}</span>
                    <span className="text-[10px] text-stone-500">
                      {formatUsageReset(codexUsage?.secondary, usageNow)}
                    </span>
                  </span>
                </div>
                <Badge variant={socketState === "open" ? "success" : "warning"}>
                  WebSocket {socketState === "open" ? "接続済み" : socketState}
                </Badge>
                <Badge variant="secondary">{activeCount} active / {readyCount} ready</Badge>
                <Button variant="outline" onClick={() => void loadSessions()} disabled={busy}>
                  <RefreshCw className="size-4" />
                  再読込
                </Button>
              </div>
            </header>

            <section className="mx-auto w-full max-w-4xl">
              <Card className="motion-fade-in overflow-hidden">
                <CardHeader className="border-b border-white/8">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle>{listTab === "chats" ? "チャット" : "ゴミ箱"}</CardTitle>
                      <CardDescription>
                        {listTab === "chats"
                          ? "一覧から開くと、個別のチャット画面へ移動します。"
                          : "削除したチャットは 5 日間ここに残り、その間は復元できます。"}
                      </CardDescription>
                    </div>
                    <Badge variant="secondary">
                      {listTab === "chats" ? sessions.length : archivedSessions.length} 件
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4 p-4">
                  <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/8 bg-white/[0.03] p-1">
                    <Button
                      variant={listTab === "chats" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => openList("chats")}
                    >
                      チャット
                    </Button>
                    <Button
                      variant={listTab === "trash" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => {
                        openList("trash");
                        void loadArchivedSessions();
                      }}
                    >
                      ゴミ箱
                    </Button>
                  </div>

                  {listTab === "chats" ? (
                    <>
                      <div className="space-y-3 rounded-[24px] border border-white/8 bg-white/[0.03] p-4">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                            作業フォルダ
                          </label>
                          <div className="flex gap-2">
                            <Input
                              value={createWorkingDirectory}
                              onChange={(event) => setCreateWorkingDirectory(event.target.value)}
                              placeholder="未選択なら既定の作業位置で開始"
                            />
                            <Button
                              variant="outline"
                              onClick={() => void openDirectoryBrowser("create")}
                            >
                              <FolderOpen className="size-4" />
                              参照
                            </Button>
                          </div>
                        </div>

                        <Button
                          className="motion-soft-glow w-full"
                          onClick={handleCreateChat}
                          disabled={busy}
                        >
                          <MessageSquarePlus className="size-4" />
                          新しいチャット
                        </Button>
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium text-stone-300">保存済みチャット</p>
                          <Badge variant="secondary">{sessions.length}</Badge>
                        </div>
                        {sessions.length > 0 ? (
                          sessions.map((session) => {
                            const status = formatStatus(session.status);

                            return (
                              <div
                                key={session.id}
                                className={cn(
                                  "rounded-xl border p-3 transition",
                                  session.id === selectedSessionId
                                    ? "border-amber-300/30 bg-amber-300/10"
                                    : "border-white/8 bg-white/[0.03] hover:border-white/14"
                                )}
                              >
                                <button
                                  type="button"
                                  className="w-full text-left"
                                  onClick={() => openChat(session.id)}
                                >
                                  <div className="flex items-start justify-between gap-3">
                                    <div className="min-w-0">
                                      <p className="truncate font-medium text-stone-100">
                                        {session.title}
                                      </p>
                                      <p className="mt-1 text-xs text-stone-500">
                                        {new Date(session.updatedAt).toLocaleString("ja-JP")}
                                      </p>
                                    </div>
                                    <Badge variant={status.variant}>{status.label}</Badge>
                                  </div>
                                </button>
                                <div className="mt-3 flex justify-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setArchiveTarget(session)}
                                    disabled={busy}
                                  >
                                    <Archive className="size-4" />
                                    削除
                                  </Button>
                                </div>
                              </div>
                            );
                          })
                        ) : (
                          <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                            まだチャットがありません。上のフォームから最初の 1 件を作れます。
                          </div>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      {archivedSessions.length > 0 ? (
                        archivedSessions.map((session) => (
                          <div
                            key={`trash-${session.id}`}
                            className="rounded-xl border border-white/8 bg-white/[0.03] p-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="truncate font-medium text-stone-100">
                                  {session.title}
                                </p>
                                <p className="mt-1 text-xs text-stone-500">
                                  削除: {new Date(session.archivedAt).toLocaleString("ja-JP")}
                                </p>
                                <p className="mt-1 text-xs text-stone-500">
                                  完全削除まであと {formatRemainingDays(session.expiresAt)} 日
                                </p>
                              </div>
                              <Badge variant="warning">ゴミ箱</Badge>
                            </div>
                            <div className="mt-3 flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteArchivedTarget(session)}
                                disabled={busy}
                              >
                                今すぐ削除
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void handleRestoreSession(session.id)}
                                disabled={busy}
                              >
                                復元
                              </Button>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                          ゴミ箱は空です。
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {error ? (
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error}
              </div>
            ) : null}
          </>
        ) : null}

        {screen === "chat" ? (
          <div className="motion-fade-in flex h-full min-h-0 min-w-0 flex-1 bg-[#050709] lg:overflow-hidden">
            <aside
              className={cn(
                "hidden h-full shrink-0 flex-col border-r border-white/8 bg-[#070b0f] transition-[width] duration-200 lg:flex",
                desktopSidebarWidthClass
              )}
            >
              {desktopSidebarCollapsed ? (
                <div className="flex h-full flex-col items-center justify-between px-3 py-4">
                  <div className="flex w-full flex-col items-center gap-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-10 w-10 rounded-full border border-white/10 bg-white/[0.04] p-0"
                      onClick={() => setDesktopSidebarCollapsed(false)}
                      aria-label="チャット一覧を表示"
                    >
                      <PanelLeftOpen className="size-4" />
                    </Button>
                    <Button
                      className="h-10 w-10 rounded-full p-0"
                      onClick={handleCreateChat}
                      disabled={busy}
                      aria-label="新しいチャット"
                    >
                      <MessageSquarePlus className="size-4" />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    className="h-10 w-10 rounded-full p-0"
                    onClick={() => openList("trash")}
                    aria-label="ゴミ箱"
                  >
                    <Archive className="size-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <div className="border-b border-white/8 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-stone-100">Codex Remote</p>
                        <p className="mt-1 text-xs text-stone-500">保存済みチャット</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{sessions.length}</Badge>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.04] p-0"
                          onClick={() => setDesktopSidebarCollapsed(true)}
                          aria-label="チャット一覧を折りたたむ"
                        >
                          <PanelLeftClose className="size-4" />
                        </Button>
                      </div>
                    </div>
                    <Button
                      className="mt-4 w-full"
                      onClick={handleCreateChat}
                      disabled={busy}
                    >
                      <MessageSquarePlus className="size-4" />
                      新しいチャット
                    </Button>
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-3">
                    <div className="space-y-2">
                      {sessions.length > 0 ? (
                        sessions.map((session) => {
                          const status = formatStatus(session.status);

                          return (
                            <button
                              key={session.id}
                              type="button"
                              className={cn(
                                "w-full rounded-xl border px-3 py-3 text-left transition",
                                session.id === selectedSessionId
                                  ? "border-cyan-300/28 bg-cyan-300/10"
                                  : "border-white/8 bg-white/[0.03] hover:border-white/14 hover:bg-white/[0.05]"
                              )}
                              onClick={() => openChat(session.id)}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-stone-100">
                                    {session.title}
                                  </p>
                                  <p className="mt-1 truncate text-[11px] text-stone-500">
                                    {session.workingDirectory ?? "作業フォルダ未設定"}
                                  </p>
                                </div>
                                <Badge variant={status.variant}>{status.label}</Badge>
                              </div>
                              <p className="mt-2 text-[11px] text-stone-500">
                                {new Date(session.updatedAt).toLocaleString("ja-JP")}
                              </p>
                            </button>
                          );
                        })
                      ) : (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                          まだチャットがありません。
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-white/8 p-3">
                    <Button
                      variant="ghost"
                      className="w-full justify-start"
                      onClick={() => openList("trash")}
                    >
                      <Archive className="size-4" />
                      ゴミ箱
                    </Button>
                  </div>
                </>
              )}
            </aside>

          <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#050709] lg:border-r lg:border-white/8">
            <div className="z-20 flex shrink-0 items-center justify-between gap-2 border-b border-white/8 bg-[#050709]/92 px-3 py-2 backdrop-blur sm:px-4 sm:py-2.5">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.04] p-0 hover:bg-white/[0.08] lg:hidden"
                  onClick={() => openList("chats")}
                  aria-label="チャット一覧"
                >
                  <Menu className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden h-9 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs text-stone-300 hover:bg-white/[0.08] lg:inline-flex"
                  onClick={() => setDesktopSidebarCollapsed((current) => !current)}
                >
                  {desktopSidebarCollapsed ? (
                    <PanelLeftOpen className="size-4" />
                  ) : (
                    <PanelLeftClose className="size-4" />
                  )}
                  {desktopSidebarCollapsed ? "一覧を表示" : "一覧を隠す"}
                </Button>
              </div>

              <div className="min-w-0 flex-1 px-2 text-center lg:px-4 lg:text-left">
                <p className="truncate text-[13px] font-medium text-stone-100">
                  {selectedSession?.title ?? "チャット"}
                </p>
                <p className="truncate text-xs text-stone-500">
                  {selectedSession?.workingDirectory ?? "作業フォルダ未設定"}
                </p>
                <div className="mt-1 flex min-w-0 flex-wrap items-center justify-center gap-1 text-[10px] text-stone-400">
                  <span
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 leading-tight"
                    title={`5時間枠 リセットまで ${formatResetIn(getResetInSeconds(codexUsage?.primary, usageNow))}`}
                  >
                    <span>5h 残{formatUsagePercent(codexUsage?.primary?.remainingPercent)}</span>
                    <span className="text-stone-500">
                      {formatUsageReset(codexUsage?.primary, usageNow)}
                    </span>
                  </span>
                  <span
                    className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-0.5 leading-tight"
                    title={`週枠 リセットまで ${formatResetIn(getResetInSeconds(codexUsage?.secondary, usageNow))}`}
                  >
                    <span>週 残{formatUsagePercent(codexUsage?.secondary?.remainingPercent)}</span>
                    <span className="text-stone-500">
                      {formatUsageReset(codexUsage?.secondary, usageNow)}
                    </span>
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="hidden items-center gap-1.5 lg:flex">
                  <button
                    type="button"
                    className="inline-flex h-9 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 text-xs font-medium text-stone-300 transition-colors hover:bg-white/[0.08] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300/30"
                    onPointerDown={() => {
                      if (!desktopInspectorVisible) {
                        selectInspectorTab("settings");
                        return;
                      }

                      toggleDesktopInspectorPanel();
                    }}
                  >
                    {desktopInspectorVisible ? (
                      <PanelRightClose className="size-4" />
                    ) : (
                      <PanelRightOpen className="size-4" />
                    )}
                    {desktopInspectorVisible ? "設定を隠す" : "設定を表示"}
                  </button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 rounded-full border border-white/10 bg-white/[0.04] p-0 hover:bg-white/[0.08] lg:hidden"
                  onClick={() => selectInspectorTab("settings")}
                  aria-label="チャット設定とツール"
                >
                  <Ellipsis className="size-4" />
                </Button>
              </div>
            </div>

            {error ? (
              <div className="px-3 pb-2 sm:px-5">
                <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {error}
                </div>
              </div>
            ) : null}

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 pb-3 sm:px-5 sm:pb-5">
                <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
                <div ref={timelineRef} className="min-h-0 flex-1 overflow-y-auto">
                  {selectedSession ? (
                    deferredMessages.length > 0 || showActivityCard ? (
                      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-1 pb-8 pt-4 sm:px-2 sm:pt-6">
                        {deferredMessages.map((message) => {
                          const messageAttachments =
                            message.role === "user"
                              ? parseAttachedFiles(message.metadataJson)
                              : [];
                          const isUserMessage = message.role === "user";
                          const isSystemMessage = message.role === "system";
                          const messageProgress = isUserMessage
                            ? []
                            : parseCodexProgress(message.metadataJson);
                          const messageFileActivity = isUserMessage
                            ? null
                            : parseCodexFileActivity(message.metadataJson);
                          const messageTiming = isUserMessage
                            ? null
                            : parseCodexTiming(message.metadataJson);

                          return (
                            <article
                              key={message.id}
                              className={cn(
                                isUserMessage
                                  ? "ml-auto max-w-[82%] rounded-2xl border border-white/10 bg-[#1a2129] px-3.5 py-2.5 text-[15px] leading-6 text-stone-100 shadow-[0_14px_36px_rgba(0,0,0,0.16)] sm:px-4 sm:py-3"
                                  : isSystemMessage
                                    ? "mr-auto max-w-[92%] rounded-2xl border border-rose-400/20 bg-rose-500/10 px-3.5 py-2.5 text-[15px] leading-6 text-rose-50 shadow-[0_14px_36px_rgba(0,0,0,0.16)] sm:px-4 sm:py-3"
                                    : "w-full px-0 py-1 text-[15px] leading-7 text-stone-100"
                              )}
                            >
                              {messageAttachments.length > 0 ? (
                                <div className="mb-3 flex flex-wrap gap-2">
                                  {messageAttachments.map((filePath) => (
                                    <div
                                      key={filePath}
                                      className="inline-flex max-w-full items-center gap-1 rounded-full border border-white/10 bg-white/[0.05] px-3 py-1 text-[11px] text-current/80"
                                    >
                                      <Paperclip className="size-3" />
                                      <span className="truncate">
                                        {getAttachmentLabel(selectedSession?.workingDirectory, filePath)}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                                {message.content}
                              </p>
                              <FileActivityCard
                                activity={messageFileActivity}
                                rootPath={selectedSession?.workingDirectory}
                              />
                              {message.id === latestAssistantMessageId ? (
                                <TimingBadge timing={messageTiming} nowMs={runtimeNow} />
                              ) : null}
                              {messageProgress.length > 0 ? (
                                <div className="mt-4">
                                  <ProgressAccordion
                                    progress={messageProgress}
                                    title="Codex の過程"
                                  />
                                </div>
                              ) : null}
                            </article>
                          );
                        })}

                        <InlineRunIndicator
                          state={runActivityState}
                          label={runActivityLabel}
                          detail={runActivityDescription}
                          progress={progressEvents}
                          activeCommand={activeCommand}
                          elapsedMs={runElapsedMs}
                        />

                        {showActivityCard ? (
                          <article className="mr-auto max-w-[92%] rounded-2xl border border-cyan-300/14 bg-[#0d141a] px-4 py-3 text-stone-100 shadow-[0_14px_36px_rgba(0,0,0,0.16)]">
                            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-cyan-100/75">
                              <Bot className="size-3.5" />
                              {runActivityLabel}
                            </div>

                            <div className="flex items-center gap-3 text-sm text-stone-200">
                              {runActivityState === "failed" ? (
                                <>
                                  <AlertTriangle className="size-4 text-rose-300" />
                                  <p>{runActivityDescription}</p>
                                </>
                              ) : runActivityState === "reconnecting" ? (
                                <>
                                  <RefreshCw className="size-4 animate-spin text-amber-300" />
                                  <p>{runActivityDescription}</p>
                                </>
                              ) : runActivityState === "approval" ? (
                                <>
                                  <AlertTriangle className="size-4 text-amber-300" />
                                  <p>{runActivityDescription}</p>
                                </>
                              ) : isSessionRunning ? (
                                <>
                                  <LoaderCircle className="size-4 animate-spin text-cyan-300" />
                                  <p>{runActivityDescription}</p>
                                </>
                              ) : (
                                <>
                                  <TerminalSquare className="size-4 text-cyan-300" />
                                  <p>{runActivityDescription}</p>
                                </>
                              )}
                            </div>

                            {isSessionRunning && !activeRun ? (
                              <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                                90 秒以内に CLI 起動が確認できなければ失敗扱いにします。
                              </div>
                            ) : null}

                            {runStartupSlow ? (
                              <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                                Codex CLI の起動に時間がかかっています。開始から {formatDuration(runElapsedMs ?? 0)} 経過しています。
                              </div>
                            ) : null}

                            {runStalled ? (
                              <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-xs text-amber-100">
                                最後の反応から {formatDuration(runLagMs ?? 0)} 経っています。10 分以上まったく反応がない場合だけ失敗扱いにします。
                              </div>
                            ) : null}

                            {activeCommand ? (
                              <div className="mt-3 rounded-xl border border-white/8 bg-[#0a1015] px-3 py-2">
                                <p className="break-words font-mono text-xs text-stone-300 [overflow-wrap:anywhere]">
                                  {activeCommand.command}
                                </p>
                              </div>
                            ) : null}

                            {isSessionRunning && liveLogs.length > 0 ? (
                              <div className="mt-3 rounded-xl border border-white/8 bg-[#0a1015] px-3 py-2">
                                <div className="space-y-2">
                                  {liveLogs.map((log, index) => (
                                    <p
                                      key={`${log}-${index}`}
                                      className="whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-stone-400 [overflow-wrap:anywhere]"
                                    >
                                      {log}
                                    </p>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </article>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex h-full min-h-[52vh] flex-col items-center justify-center px-6 text-center">
                        <div className="max-w-xl space-y-3">
                          <p className="text-lg font-medium text-stone-100 sm:text-xl">
                            まだメッセージはありません。
                          </p>
                          <p className="text-sm leading-7 text-stone-500 sm:text-base">
                            下の入力欄から日本語で指示できます。
                          </p>
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="flex h-full min-h-[52vh] flex-col items-center justify-center px-6 text-center">
                      <div className="max-w-xl space-y-3">
                        <p className="text-lg font-medium text-stone-100 sm:text-xl">
                          チャットを選択してください。
                        </p>
                        <p className="text-sm leading-7 text-stone-500 sm:text-base">
                          一覧から移動すると、ここがそのチャットの画面になります。
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mx-auto w-full max-w-3xl shrink-0 pb-1">
                  {pendingApproval ? (
                    <div className="mb-2 rounded-2xl border border-amber-300/24 bg-amber-300/10 p-3 text-sm text-amber-50 shadow-[0_18px_48px_rgba(0,0,0,0.28)]">
                      <div className="flex items-start gap-2.5">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-300" />
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-medium">Codex が実行許可を求めています</p>
                            <Badge variant="warning">選択待ち</Badge>
                          </div>
                          <p className="mt-1.5 max-h-20 overflow-auto break-all rounded-xl border border-amber-200/12 bg-black/18 px-2 py-1.5 font-mono text-[11px] leading-5 text-amber-100/85">
                            {pendingApproval.command}
                          </p>
                          {pendingApproval.reason ? (
                            <p className="mt-1.5 text-xs leading-5 text-amber-100/75">
                              {pendingApproval.reason}
                            </p>
                          ) : null}
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              className="h-8"
                              onClick={() => void handleApprovalDecision("approve")}
                              disabled={approvalBusy}
                            >
                              許可して続行
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 border-amber-200/30 bg-amber-200/10 text-amber-50 hover:bg-amber-200/16"
                              onClick={() => void handleApprovalDecision("approve_for_session")}
                              disabled={approvalBusy}
                            >
                              この種類は今後許可
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8"
                              onClick={() => void handleApprovalDecision("deny")}
                              disabled={approvalBusy}
                            >
                              拒否して続行
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 border border-rose-300/20 text-rose-100 hover:bg-rose-500/10"
                              onClick={() => void handleApprovalDecision("abort")}
                              disabled={approvalBusy}
                            >
                              この実行を停止
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {selectedSession && deferredMessages.length === 0 ? (
                    <div className="mb-4 grid gap-2 sm:grid-cols-3">
                      <button
                        type="button"
                        className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4 text-left transition hover:border-white/16 hover:bg-white/[0.05]"
                        onClick={() =>
                          setDraft("このプロジェクト向けの画像案を考えて、必要なら作成まで進めて。")
                        }
                      >
                        <div className="flex items-center gap-3">
                          <Sparkles className="size-5 text-stone-300" />
                          <div>
                            <p className="text-sm font-medium text-stone-100">画像を生成</p>
                            <p className="mt-1 text-xs text-stone-500">ビジュアル案を出す</p>
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4 text-left transition hover:border-white/16 hover:bg-white/[0.05]"
                        onClick={() =>
                          setDraft("このコードベースで必要な修正を進めて。まず関連ファイルを見てから変更して。")
                        }
                      >
                        <div className="flex items-center gap-3">
                          <FileText className="size-5 text-stone-300" />
                          <div>
                            <p className="text-sm font-medium text-stone-100">記述または編集</p>
                            <p className="mt-1 text-xs text-stone-500">実装や修正を頼む</p>
                          </div>
                        </div>
                      </button>

                      <button
                        type="button"
                        className="rounded-[24px] border border-white/8 bg-white/[0.03] px-4 py-4 text-left transition hover:border-white/16 hover:bg-white/[0.05]"
                        onClick={() =>
                          setDraft("この件について調べて、要点と次のアクションを日本語で整理して。")
                        }
                      >
                        <div className="flex items-center gap-3">
                          <Search className="size-5 text-stone-300" />
                          <div>
                            <p className="text-sm font-medium text-stone-100">何かを調べる</p>
                            <p className="mt-1 text-xs text-stone-500">調査から始める</p>
                          </div>
                        </div>
                      </button>
                    </div>
                  ) : null}

                    <div className="rounded-2xl border border-white/10 bg-[#12171d]/96 p-2 shadow-[0_22px_56px_rgba(0,0,0,0.32)] backdrop-blur sm:p-2.5">
                    {selectedSession ? (
                      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
                        <Badge variant={socketState === "open" ? "success" : "warning"}>
                          {socketState === "open"
                            ? "ライブ接続中"
                            : socketState === "connecting"
                              ? "接続中"
                              : socketState === "error"
                                ? "接続エラー"
                                : "再接続待ち"}
                        </Badge>
                        <Badge variant={isSessionRunning ? "warning" : "secondary"}>
                          {runActivityLabel}
                        </Badge>
                      </div>
                    ) : null}

                    {attachedFiles.length > 0 ? (
                      <div className="mb-2 flex flex-wrap gap-2">
                        {attachedFiles.map((filePath) => (
                          <button
                            key={filePath}
                            type="button"
                            className="inline-flex max-w-full items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-stone-300 transition hover:border-white/20 hover:bg-white/[0.06]"
                            onClick={() => removeAttachedFile(filePath)}
                          >
                            <Paperclip className="size-3.5 text-amber-300" />
                            <span className="truncate">
                              {getAttachmentLabel(selectedSession?.workingDirectory, filePath)}
                            </span>
                            <X className="size-3.5 text-stone-500" />
                          </button>
                        ))}
                      </div>
                    ) : null}

                    <div className="flex items-end gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(event) => void handleUploadFiles(event.target.files)}
                      />
                      <Button
                        variant="ghost"
                        className="h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/[0.03] p-0 hover:bg-white/[0.08]"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={!selectedSession || uploadingFiles}
                        aria-label="ファイルをアップロード"
                      >
                        {uploadingFiles ? (
                          <LoaderCircle className="size-4 animate-spin" />
                        ) : (
                          <Paperclip className="size-4" />
                        )}
                      </Button>

                      <Textarea
                        ref={draftTextareaRef}
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        placeholder={
                          isSessionRunning
                            ? `${runActivityLabel}。返答と進捗を待っています...`
                            : socketState !== "open"
                              ? "ライブ接続を戻しています..."
                              : "Codex に質問..."
                        }
                        disabled={!selectedSession || sending || isSessionRunning}
                        className="min-h-[42px] max-h-[208px] resize-none border-0 bg-transparent px-0 py-1.5 text-[15px] shadow-none focus-visible:border-transparent focus-visible:ring-0"
                      />

                      <Button
                        className="h-10 w-10 shrink-0 rounded-full p-0"
                        onClick={handleSendMessage}
                        disabled={
                          !selectedSession ||
                          sending ||
                          uploadingFiles ||
                          isSessionRunning ||
                          socketState !== "open" ||
                          draft.trim().length === 0
                        }
                        aria-label={
                          sending || isSessionRunning
                            ? "Codex が処理中のため送信できません"
                            : "メッセージを送信"
                        }
                      >
                        {sending || isSessionRunning ? (
                          <Square className="size-3.5 fill-current" />
                        ) : (
                          <Send className="size-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          </div>
        ) : null}
      </div>

      {screen === "chat" ? (
        <>
          {inspectorOpen && !isDesktopViewport ? (
            <button
              type="button"
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={() => setInspectorOpen(false)}
              aria-label="ツールシートを閉じる"
            />
          ) : null}
          <div
            className={cn(
              "fixed inset-y-0 right-0 z-50 flex h-dvh w-[min(420px,calc(100vw-1.5rem))] flex-col overflow-hidden border-l border-white/8 bg-[#0b1015] shadow-[0_28px_90px_rgba(0,0,0,0.48)] transition-transform duration-200 lg:w-[400px] xl:w-[440px]",
              inspectorPanelOpen
                ? "translate-x-0"
                : "pointer-events-none translate-x-full"
            )}
          >
          <button
            type="button"
            className="absolute inset-0 hidden"
            onClick={() => setInspectorOpen(false)}
          />
          <div className="motion-sheet-up absolute inset-x-3 bottom-3 top-auto max-h-[78vh] overflow-hidden rounded-[30px] border border-white/10 bg-[#0f141a]/96 shadow-[0_32px_80px_rgba(0,0,0,0.46)] backdrop-blur sm:inset-x-auto sm:bottom-4 sm:right-4 sm:top-20 sm:w-[420px] sm:max-h-[calc(100vh-6.5rem)] lg:static lg:flex lg:h-full lg:w-full lg:max-h-none lg:flex-col lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
              <div className="min-w-0">
                <p className="text-sm font-medium text-stone-100">チャット設定とツール</p>
                <p className="truncate text-xs text-stone-500">
                  {selectedSession?.title ?? "チャット未選択"}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 rounded-full p-0"
                onClick={closeInspectorPanel}
                aria-label="ツールシートを閉じる"
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="grid grid-cols-4 gap-2 border-b border-white/8 p-3">
              <button
                type="button"
                className={getInspectorTabButtonClass("files", inspectorTab)}
                onPointerDown={() => handleInspectorTabPress("files")}
                onClick={() => handleInspectorTabPress("files")}
              >
                Files
              </button>
              <button
                type="button"
                className={getInspectorTabButtonClass("settings", inspectorTab)}
                onPointerDown={() => handleInspectorTabPress("settings")}
                onClick={() => handleInspectorTabPress("settings")}
              >
                設定
              </button>
              <button
                type="button"
                className={getInspectorTabButtonClass("git", inspectorTab)}
                onPointerDown={() => handleInspectorTabPress("git")}
                onClick={() => handleInspectorTabPress("git")}
              >
                Git
              </button>
              <button
                type="button"
                className={getInspectorTabButtonClass("review", inspectorTab)}
                onPointerDown={() => handleInspectorTabPress("review")}
                onClick={() => handleInspectorTabPress("review")}
              >
                Review
              </button>
            </div>

            <div
              ref={inspectorScrollRef}
              className="max-h-[calc(78vh-7.5rem)] space-y-4 overflow-y-auto p-4 sm:max-h-[calc(100vh-13rem)] lg:max-h-none lg:flex-1"
            >
              <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3">
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                  現在のパネル
                </p>
                <p className="mt-2 text-sm font-medium text-stone-100">
                  {getInspectorTabLabel(inspectorTab)}
                </p>
              </div>

              {inspectorTab === "files" ? (
                selectedSession ? (
                  selectedSession.workingDirectory ? (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-stone-200">参照ファイル</p>
                          <p className="mt-1 text-xs text-stone-500">
                            {sessionFiles
                              ? getRelativePath(
                                  selectedSession.workingDirectory,
                                  sessionFiles.currentPath
                                )
                              : "読み込み待ち"}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => void loadSessionFiles()}
                          disabled={filesBusy}
                        >
                          <RefreshCw className={cn("size-4", filesBusy ? "animate-spin" : "")} />
                          更新
                        </Button>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void loadSessionFiles(
                              selectedSession.id,
                              sessionFiles?.parentPath ?? undefined
                            )
                          }
                          disabled={!sessionFiles?.parentPath || filesBusy}
                        >
                          <ChevronLeft className="size-4" />
                          戻る
                        </Button>
                        <Badge variant="secondary">{attachedFiles.length} 添付</Badge>
                      </div>

                      <div className="max-h-72 overflow-y-auto rounded-2xl border border-white/8 bg-[#0b0f13]">
                        {sessionFiles ? (
                          sessionFiles.entries.length > 0 ? (
                            <div className="divide-y divide-white/8">
                              {sessionFiles.entries.map((entry) => {
                                const isAttached = attachedFiles.includes(entry.path);

                                return (
                                  <div
                                    key={entry.path}
                                    className="flex items-center gap-2 px-3 py-2 transition hover:bg-white/[0.03]"
                                  >
                                    <button
                                      type="button"
                                      className="min-w-0 flex-1 text-left"
                                      onClick={() =>
                                        entry.isDirectory
                                          ? void loadSessionFiles(selectedSession.id, entry.path)
                                          : void loadFilePreview(entry.path)
                                      }
                                    >
                                      <div className="flex items-center gap-2">
                                        {entry.isDirectory ? (
                                          <FolderOpen className="size-4 text-stone-500" />
                                        ) : (
                                          <FileText className="size-4 text-stone-500" />
                                        )}
                                        <p className="truncate text-sm text-stone-100">
                                          {entry.name}
                                        </p>
                                      </div>
                                      <p className="mt-1 text-xs text-stone-500">
                                        {entry.updatedAt
                                          ? new Date(entry.updatedAt).toLocaleString("ja-JP")
                                          : entry.isDirectory
                                            ? "フォルダ"
                                            : "ファイル"}
                                      </p>
                                    </button>
                                    {entry.isFile ? (
                                      <Button
                                        variant={isAttached ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => toggleAttachedFile(entry.path)}
                                      >
                                        <Paperclip className="size-3.5" />
                                        {isAttached ? "添付済み" : "添付"}
                                      </Button>
                                    ) : null}
                                  </div>
                                );
                              })}
                            </div>
                          ) : (
                            <div className="p-4 text-sm text-stone-500">
                              この場所には表示できる項目がありません。
                            </div>
                          )
                        ) : (
                          <div className="p-4 text-sm text-stone-500">
                            読み込み後にファイル一覧を表示します。
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium text-stone-200">プレビュー</p>
                          {filePreview?.truncated ? (
                            <Badge variant="warning">一部のみ表示</Badge>
                          ) : null}
                        </div>
                        {filePreview ? (
                          <>
                            <p className="mt-2 truncate text-xs text-stone-500">
                              {getRelativePath(selectedSession.workingDirectory, filePreview.path)}
                            </p>
                            <pre className="mt-3 max-h-64 overflow-auto rounded-2xl border border-white/8 bg-[#0b0f13] p-3 text-xs text-stone-300">
                              {filePreview.content}
                            </pre>
                          </>
                        ) : (
                          <p className="mt-2 text-sm text-stone-500">
                            ファイルをタップするとここに内容を表示します。
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                      参照ファイルを使うには、先に作業フォルダを設定してください。
                    </div>
                  )
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                    チャット選択後に参照ファイルを追加できます。
                  </div>
                )
              ) : null}

              {inspectorTab === "settings" ? (
                selectedSession ? (
                  <>
                    <div className="grid gap-3">
                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <label className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                          タイトル
                        </label>
                        <Input
                          value={sessionDraft.title}
                          onChange={(event) =>
                            setSessionDraft((current) => ({
                              ...current,
                              title: event.target.value
                            }))
                          }
                          className="mt-2"
                        />
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <label className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                          作業フォルダ
                        </label>
                        <div className="mt-2 flex gap-2">
                          <Input
                            value={sessionDraft.workingDirectory}
                            onChange={(event) =>
                              setSessionDraft((current) => ({
                                ...current,
                                workingDirectory: event.target.value
                              }))
                            }
                            placeholder="未設定"
                          />
                          <Button
                            variant="outline"
                            onClick={() => void openDirectoryBrowser("session")}
                          >
                            <FolderOpen className="size-4" />
                            参照
                          </Button>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="space-y-2">
                            <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                              <Cpu className="size-3.5" />
                              モデル
                            </label>
                            <select
                              className={selectClassName}
                              value={sessionDraft.model}
                              onChange={(event) =>
                                setSessionDraft((current) => ({
                                  ...current,
                                  model: event.target.value
                                }))
                              }
                            >
                              <option value="">自動</option>
                              {availableModelOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                  {option === sessionDraft.model &&
                                  !modelOptions.includes(option)
                                    ? " (現在値)"
                                    : ""}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                              インテリジェンス
                            </label>
                            <select
                              className={selectClassName}
                              value={sessionDraft.intelligence}
                              onChange={(event) =>
                                setSessionDraft((current) => ({
                                  ...current,
                                  intelligence: event.target.value
                                }))
                              }
                            >
                              {intelligenceOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <div className="space-y-2">
                          <label className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                            サンドボックス
                          </label>
                          <select
                            className={selectClassName}
                            value={sessionDraft.sandboxMode}
                            disabled={sessionDraft.fullAccessEnabled}
                            onChange={(event) =>
                              setSessionDraft((current) => ({
                                ...current,
                                sandboxMode: event.target.value
                              }))
                            }
                          >
                            {sandboxOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <label className="flex items-start gap-3 rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                        <input
                          type="checkbox"
                          className="mt-1 size-4 rounded border-white/20 bg-[#0f1318] text-amber-300"
                          checked={sessionDraft.fullAccessEnabled}
                          onChange={(event) =>
                            setSessionDraft((current) => ({
                              ...current,
                              fullAccessEnabled: event.target.checked
                            }))
                          }
                        />
                        <div>
                          <p className="text-sm font-medium text-stone-100">フルアクセスを許可</p>
                          <p className="mt-1 text-xs leading-5 text-stone-400">
                            有効にするとサンドボックスよりフルアクセスを優先します。
                          </p>
                        </div>
                      </label>
                    </div>

                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-stone-300">
                      <div className="flex items-center gap-2">
                        {savingSession ? (
                          <LoaderCircle className="size-4 animate-spin text-amber-300" />
                        ) : null}
                        <span>
                          {sessionSaveState === "saving"
                            ? "設定を自動保存しています…"
                            : sessionSaveState === "error"
                              ? "設定の自動保存に失敗しました。"
                              : sessionSaveState === "dirty"
                                ? "変更を検出しました。まもなく自動保存します。"
                                : "変更内容は自動で保存されます。"}
                        </span>
                      </div>
                    </div>

                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                    チャット選択後に設定を編集できます。
                  </div>
                )
              ) : null}

              {inspectorTab === "git" ? (
                selectedSession ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-stone-200">Git 状態</p>
                        <p className="mt-1 text-xs text-stone-500">
                          {gitSnapshot?.repoRoot ?? "まだ取得していません。"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadGitSnapshot()}
                        disabled={gitBusy}
                      >
                        <RefreshCw className={cn("size-4", gitBusy ? "animate-spin" : "")} />
                        更新
                      </Button>
                    </div>

                    {gitSnapshot ? (
                      gitSnapshot.available ? (
                        <>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Branch</p>
                              <p className="mt-2 text-sm font-medium text-stone-100">
                                {gitSnapshot.branch ?? "unknown"}
                              </p>
                              <p className="mt-1 text-xs text-stone-500">
                                {gitSnapshot.lastCommit ?? "コミット履歴なし"}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-stone-500">Summary</p>
                              <p className="mt-2 text-sm font-medium text-stone-100">
                                {gitSnapshot.summary ?? "差分なし"}
                              </p>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                              変更ファイル
                            </p>
                            <div className="max-h-48 space-y-2 overflow-y-auto">
                              {gitSnapshot.files.length > 0 ? (
                                gitSnapshot.files.map((file) => (
                                  <div
                                    key={file.path}
                                    className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2"
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <p className="truncate text-sm text-stone-100">{file.path}</p>
                                      <Badge variant="secondary">{file.status}</Badge>
                                    </div>
                                    <p className="mt-1 text-xs text-stone-500">
                                      staged: {file.stagedStatus} / unstaged: {file.unstagedStatus}
                                    </p>
                                  </div>
                                ))
                              ) : (
                                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                                  変更は見つかりませんでした。
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                              コミットメッセージ
                            </label>
                            <Input
                              value={commitMessage}
                              onChange={(event) => setCommitMessage(event.target.value)}
                              placeholder="例: Refine full-screen chat layout"
                            />
                            <Button
                              className="w-full"
                              onClick={handleCreateCommit}
                              disabled={commitBusy || commitMessage.trim().length === 0}
                            >
                              {commitBusy ? (
                                <>
                                  <LoaderCircle className="size-4 animate-spin" />
                                  コミット中
                                </>
                              ) : (
                                "全変更をコミット"
                              )}
                            </Button>
                          </div>

                          <div className="space-y-3">
                            <div>
                              <p className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                                Staged Diff
                              </p>
                              <pre className="mt-2 max-h-40 overflow-auto rounded-2xl border border-white/8 bg-[#0b0f13] p-3 text-xs text-stone-300">
                                {gitSnapshot.stagedDiff || "まだ staged diff はありません。"}
                              </pre>
                            </div>
                            <div>
                              <p className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                                Working Diff
                              </p>
                              <pre className="mt-2 max-h-48 overflow-auto rounded-2xl border border-white/8 bg-[#0b0f13] p-3 text-xs text-stone-300">
                                {gitSnapshot.workingDiff || "まだ working diff はありません。"}
                              </pre>
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                          この作業フォルダは Git リポジトリではありません。
                        </div>
                      )
                    ) : (
                      <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                        「更新」を押すと Git 状態を取得します。
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                    チャット選択後に Git 情報を表示します。
                  </div>
                )
              ) : null}

              {inspectorTab === "review" ? (
                selectedSession ? (
                  <div className="space-y-4">
                    <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4">
                      <p className="text-sm font-medium text-stone-100">自動レビュー</p>
                      <p className="mt-2 text-sm leading-6 text-stone-400">
                        現在の未コミット変更に対して `codex review --uncommitted` を実行します。
                      </p>
                      <Button
                        className="mt-4 w-full"
                        onClick={handleRunReview}
                        disabled={reviewBusy}
                      >
                        {reviewBusy ? (
                          <>
                            <LoaderCircle className="size-4 animate-spin" />
                            レビュー中
                          </>
                        ) : (
                          "レビューを実行"
                        )}
                      </Button>
                    </div>

                    {reviewResult ? (
                      <>
                        <div className="grid gap-3">
                          {buildReviewCards(reviewResult.summary).map((card, index) => (
                            <div
                              key={`${card.title}-${index}`}
                              className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"
                            >
                              <p className="text-sm font-medium text-stone-100">{card.title}</p>
                              <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-stone-300">
                                {card.body}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="rounded-2xl border border-white/8 bg-[#0b0f13] p-4">
                          <p className="text-xs font-medium uppercase tracking-[0.18em] text-stone-500">
                            Raw Output
                          </p>
                          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-stone-300">
                            {reviewResult.rawLines.join("\n")}
                          </pre>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                        まだレビューは実行していません。
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                    チャット選択後にレビューを実行できます。
                  </div>
                )
              ) : null}

              <div className="rounded-[26px] border border-white/8 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Settings2 className="size-4 text-stone-500" />
                    <p className="text-sm font-medium text-stone-200">ライブログ</p>
                  </div>
                  <Badge variant="secondary">{commandActivities.length} 件</Badge>
                </div>

                {selectedSession ? (
                  commandActivities.length > 0 ? (
                    <div className="space-y-2">
                      {commandActivities.map((item) => (
                        <div
                          key={item.commandId}
                          className="rounded-2xl border border-white/8 bg-[#0b0f13] p-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <p className="min-w-0 break-all font-mono text-xs text-stone-200">
                              {item.command}
                            </p>
                            <Badge
                              variant={
                                item.status === "running"
                                  ? "warning"
                                  : item.exitCode === 0
                                    ? "success"
                                    : "danger"
                              }
                            >
                              {item.status === "running"
                                ? "実行中"
                                : item.exitCode === 0
                                  ? "完了"
                                  : `終了 ${item.exitCode ?? "-"}`}
                            </Badge>
                          </div>
                          {item.output ? (
                            <pre className="mt-3 max-h-32 overflow-auto rounded-xl border border-white/8 bg-[#090d11] p-3 text-[11px] text-stone-300">
                              {item.output}
                            </pre>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                      まだコマンド実行はありません。
                    </div>
                  )
                ) : (
                  <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                    チャット選択後にログを表示します。
                  </div>
                )}

                <div className="mt-4 max-h-[240px] space-y-2 overflow-y-auto">
                  {selectedSession ? (
                    deferredLogs.length > 0 ? (
                      deferredLogs.map((log, index) => (
                        <div
                          key={`${log}-${index}`}
                          className="rounded-lg border border-white/8 bg-[#0b0f13] px-3 py-2 font-mono text-xs text-stone-300"
                        >
                          {log}
                        </div>
                      ))
                    ) : (
                      <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                        まだログはありません。
                      </div>
                    )
                  ) : (
                    <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.03] p-4 text-sm text-stone-500">
                      チャット選択後にログを表示します。
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          </div>
        </>
      ) : null}

      {archiveTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0f141a]/96 shadow-[0_32px_80px_rgba(0,0,0,0.4)] backdrop-blur">
            <div className="border-b border-white/8 px-5 py-4">
              <p className="text-base font-medium text-stone-100">このチャットを削除しますか？</p>
              <p className="mt-2 text-sm leading-6 text-stone-400">
                「{archiveTarget.title}」はすぐには完全削除されず、いったんゴミ箱に移動します。5日経過すると自動で完全削除されます。
              </p>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-2xl border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                {archiveTarget.status === "running"
                  ? "このチャットは実行中なので、まず処理が終わってから削除するのが安全です。"
                  : "削除すると一覧から見えなくなり、5日間はゴミ箱扱いで保持されます。"}
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setArchiveTarget(null)} disabled={busy}>
                  キャンセル
                </Button>
                <Button
                  variant="outline"
                  onClick={() => void handleArchiveSession(archiveTarget.id)}
                  disabled={busy || archiveTarget.status === "running"}
                >
                  <Archive className="size-4" />
                  削除する
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteArchivedTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-[28px] border border-white/10 bg-[#0f141a]/96 shadow-[0_32px_80px_rgba(0,0,0,0.4)] backdrop-blur">
            <div className="border-b border-white/8 px-5 py-4">
              <p className="text-base font-medium text-stone-100">このチャットを完全削除しますか？</p>
              <p className="mt-2 text-sm leading-6 text-stone-400">
                「{deleteArchivedTarget.title}」を今すぐ完全削除します。チャット本体に加えて、添付ファイルも含めて元に戻せなくなります。
              </p>
            </div>
            <div className="space-y-3 px-5 py-4">
              <div className="rounded-2xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-rose-300" />
                  <p>
                    自動削除日を待たずに、この場で完全に消去します。必要なら先に復元してください。
                  </p>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  onClick={() => setDeleteArchivedTarget(null)}
                  disabled={busy}
                >
                  キャンセル
                </Button>
                <Button
                  variant="outline"
                  className="border-rose-400/30 text-rose-200 hover:bg-rose-500/10"
                  onClick={() => void handleDeleteArchivedSessionNow(deleteArchivedTarget.id)}
                  disabled={busy}
                >
                  今すぐ完全削除
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {browserOpen && directoryListing ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-3xl rounded-[28px] border border-white/10 bg-[#0f141a]/96 shadow-[0_32px_80px_rgba(0,0,0,0.4)] backdrop-blur">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 px-5 py-4">
              <div>
                <p className="text-sm font-medium text-stone-100">作業フォルダを選択</p>
                <p className="mt-1 text-xs text-stone-500">{currentDirectoryLabel}</p>
              </div>
              <Button variant="ghost" onClick={() => setBrowserOpen(false)}>
                閉じる
              </Button>
            </div>

            <div className="space-y-4 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDirectorySearchQuery("");
                    void loadDirectory(directoryListing.parentPath ?? undefined);
                  }}
                  disabled={!directoryListing.parentPath || loadingDirectory}
                >
                  <ChevronLeft className="size-4" />
                  戻る
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDirectorySearchQuery("");
                    void loadDirectory(directoryListing.initialPath);
                  }}
                  disabled={loadingDirectory}
                >
                  Downloads
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDirectorySearchQuery("");
                    void loadDirectory(directoryListing.homePath);
                  }}
                  disabled={loadingDirectory}
                >
                  Home
                </Button>
              </div>

              <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-3">
                <div className="flex items-center gap-2">
                  <Search className="size-4 text-stone-500" />
                  <Input
                    value={directorySearchQuery}
                    onChange={(event) => setDirectorySearchQuery(event.target.value)}
                    placeholder="この場所の下でフォルダ検索"
                  />
                </div>
              </div>

              <div className="max-h-[52vh] overflow-y-auto rounded-2xl border border-white/8 bg-white/[0.03]">
                {directorySearchQuery.trim().length >= 2 ? (
                  directorySearchBusy ? (
                    <div className="flex items-center gap-3 p-5 text-sm text-stone-500">
                      <LoaderCircle className="size-4 animate-spin" />
                      フォルダを検索中です。
                    </div>
                  ) : (
                    <div className="divide-y divide-white/8">
                      {directorySearchResults.length > 0 ? (
                        directorySearchResults.map((entry) => (
                          <button
                            key={entry.path}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.04]"
                            onClick={() => {
                              setDirectorySearchQuery("");
                              void loadDirectory(entry.path);
                            }}
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-stone-100">
                                {entry.name}
                              </p>
                              <p className="mt-1 truncate text-xs text-stone-500">
                                {entry.path}
                              </p>
                            </div>
                            <Badge variant="secondary">フォルダ</Badge>
                          </button>
                        ))
                      ) : (
                        <div className="p-5 text-sm text-stone-500">
                          該当するフォルダは見つかりませんでした。
                        </div>
                      )}
                    </div>
                  )
                ) : loadingDirectory ? (
                  <div className="flex items-center gap-3 p-5 text-sm text-stone-500">
                    <LoaderCircle className="size-4 animate-spin" />
                    フォルダ一覧を読み込み中です。
                  </div>
                ) : (
                  <div className="divide-y divide-white/8">
                    {directoryListing.entries.map((entry) => (
                      <button
                        key={entry.path}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.04]"
                        onClick={() =>
                          entry.isDirectory
                            ? void loadDirectory(entry.path)
                            : undefined
                        }
                        disabled={!entry.isDirectory}
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-stone-100">
                            {entry.name}
                          </p>
                          <p className="mt-1 text-xs text-stone-500">
                            {entry.updatedAt
                              ? new Date(entry.updatedAt).toLocaleString("ja-JP")
                              : "更新日時なし"}
                          </p>
                        </div>
                        <Badge variant={entry.isDirectory ? "secondary" : "default"}>
                          {entry.isDirectory ? "フォルダ" : "ファイル"}
                        </Badge>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs leading-5 text-stone-500">
                  `.codex` と `.ssh` は安全のため一覧から除外しています。
                </p>
                <Button onClick={applyDirectorySelection} disabled={loadingDirectory}>
                  このフォルダを選択
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
