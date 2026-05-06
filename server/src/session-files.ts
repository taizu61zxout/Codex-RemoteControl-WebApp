import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { SessionRecord } from "./store.js";

const FILE_PREVIEW_LIMIT = 12000;
const ATTACHMENT_LIMIT = 8;

export type SessionFileEntry = {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  updatedAt: string | null;
};

export type SessionFileListing = {
  rootPath: string;
  currentPath: string;
  parentPath: string | null;
  entries: SessionFileEntry[];
};

export type SessionFilePreview = {
  path: string;
  content: string;
  truncated: boolean;
};

const hiddenEntryNames = new Set([".codex", ".ssh", ".git"]);

function ensureWorkingDirectory(session: SessionRecord) {
  if (!session.workingDirectory) {
    throw new Error("作業フォルダが未設定です。");
  }

  return session.workingDirectory;
}

function resolveInsideRoot(rootPath: string, requestedPath?: string | null) {
  const resolved = path.resolve(requestedPath ?? rootPath);

  if (resolved !== rootPath && !resolved.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("作業フォルダの外は参照できません。");
  }

  return resolved;
}

function isInsideDirectory(rootPath: string, targetPath: string) {
  return targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);
}

function resolveAttachedFile(session: SessionRecord, requestedPath: string) {
  const resolved = path.resolve(requestedPath);
  const uploadsRoot = path.join(config.dataDir, "uploads");

  if (isInsideDirectory(uploadsRoot, resolved)) {
    return resolved;
  }

  const rootPath = ensureWorkingDirectory(session);
  return resolveInsideRoot(rootPath, requestedPath);
}

function isLikelyTextFile(targetPath: string) {
  const extension = path.extname(targetPath).toLowerCase();
  return ![
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".pdf",
    ".zip",
    ".gz",
    ".mp4",
    ".mov",
    ".mp3",
    ".woff",
    ".woff2"
  ].includes(extension);
}

export function listSessionFiles(
  session: SessionRecord,
  requestedPath?: string | null
): SessionFileListing {
  const rootPath = ensureWorkingDirectory(session);
  const currentPath = resolveInsideRoot(rootPath, requestedPath);
  const stats = fs.statSync(currentPath, {
    throwIfNoEntry: false
  });

  if (!stats?.isDirectory()) {
    throw new Error("フォルダが見つかりません。");
  }

  const entries = fs
    .readdirSync(currentPath, {
      withFileTypes: true
    })
    .filter((entry) => !hiddenEntryNames.has(entry.name))
    .map((entry) => {
      const fullPath = path.join(currentPath, entry.name);
      const childStats = fs.statSync(fullPath, {
        throwIfNoEntry: false
      });

      return {
        name: entry.name,
        path: fullPath,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile(),
        updatedAt: childStats?.mtime.toISOString() ?? null
      };
    })
    .sort((left, right) => {
      if (left.isDirectory !== right.isDirectory) {
        return left.isDirectory ? -1 : 1;
      }

      return left.name.localeCompare(right.name, "ja");
    });

  return {
    rootPath,
    currentPath,
    parentPath: currentPath === rootPath ? null : path.dirname(currentPath),
    entries
  };
}

export function readSessionFilePreview(
  session: SessionRecord,
  requestedPath: string
): SessionFilePreview {
  const rootPath = ensureWorkingDirectory(session);
  const resolved = resolveInsideRoot(rootPath, requestedPath);
  const stats = fs.statSync(resolved, {
    throwIfNoEntry: false
  });

  if (!stats?.isFile()) {
    throw new Error("ファイルが見つかりません。");
  }

  if (!isLikelyTextFile(resolved)) {
    throw new Error("このファイル形式のプレビューには未対応です。");
  }

  const content = fs.readFileSync(resolved, "utf8");
  const truncated = content.length > FILE_PREVIEW_LIMIT;

  return {
    path: resolved,
    content: truncated ? `${content.slice(0, FILE_PREVIEW_LIMIT)}\n\n... preview truncated ...` : content,
    truncated
  };
}

export function buildPromptWithAttachedFiles(
  session: SessionRecord,
  prompt: string,
  attachedFiles?: string[]
) {
  if (!attachedFiles || attachedFiles.length === 0) {
    return prompt;
  }

  const normalizedPaths = attachedFiles
    .slice(0, ATTACHMENT_LIMIT)
    .map((entry) => resolveAttachedFile(session, entry))
    .filter((entry, index, list) => list.indexOf(entry) === index);

  const sections = normalizedPaths.map((targetPath) => {
    const stats = fs.statSync(targetPath, {
      throwIfNoEntry: false
    });

    if (!stats?.isFile()) {
      throw new Error("添付ファイルが見つかりません。");
    }

    if (!isLikelyTextFile(targetPath)) {
      return [
        `<attached_file path="${targetPath}" binary="true">`,
        `アップロード済みのバイナリファイルです。必要に応じてこの絶対パスを参照してください: ${targetPath}`,
        "</attached_file>"
      ].join("\n");
    }

    const content = fs.readFileSync(targetPath, "utf8");
    const truncated = content.length > FILE_PREVIEW_LIMIT;

    return [
      `<attached_file path="${targetPath}">`,
      truncated ? `${content.slice(0, FILE_PREVIEW_LIMIT)}\n\n... attachment truncated ...` : content,
      "</attached_file>"
    ].join("\n");
  });

  return [
    "以下の参照ファイルを先に読み、その内容も踏まえて対応してください。",
    "<attached_files>",
    ...sections,
    "</attached_files>",
    "",
    prompt
  ].join("\n");
}
