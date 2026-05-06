import os from "node:os";
import path from "node:path";

const rootDir = process.cwd();
const homeDir = os.homedir();
const downloadsDir = path.join(homeDir, "Downloads");

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? "3001"),
  rootDir,
  homeDir,
  downloadsDir,
  dataDir: path.join(rootDir, "data"),
  sessionsDir: path.join(rootDir, "data", "sessions"),
  databasePath: path.join(rootDir, "data", "app.db"),
  csrfCookieName: "codex_remote_csrf"
};
