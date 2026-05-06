#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

const baseUrl = process.env.CODEX_REMOTE_BASE_URL ?? "http://127.0.0.1:3001";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot =
  process.env.CODEX_REMOTE_TEST_WORKDIR ?? path.resolve(scriptDirectory, "..");

let cookies = "";

function updateCookies(response) {
  const rawCookies = response.headers.getSetCookie?.() ?? [];

  if (rawCookies.length === 0) {
    return;
  }

  const current = new Map(
    cookies
      .split(/;\s*/)
      .filter(Boolean)
      .map((entry) => {
        const [key, ...value] = entry.split("=");
        return [key, value.join("=")];
      })
  );

  for (const entry of rawCookies) {
    const [cookie] = entry.split(";");
    const [key, ...value] = cookie.split("=");
    current.set(key, value.join("="));
  }

  cookies = [...current.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function request(path, options = {}) {
  let response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: {
        ...(options.headers ?? {}),
        cookie: cookies
      }
    });
  } catch (error) {
    throw new Error(
      `Cannot reach ${baseUrl}. Start the app first with npm run dev.\n${error.message}`
    );
  }

  updateCookies(response);

  const text = await response.text();
  const data = text.length > 0 ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed with ${response.status}: ${text}`
    );
  }

  return data;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  let createdSessionId = null;
  let csrfToken = null;

  try {
    const bootstrap = await request("/api/bootstrap");
    csrfToken = bootstrap.csrfToken;

    const created = await request("/api/sessions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        title: `api-smoke-${Date.now()}`
      })
    });

    createdSessionId = created.session.id;
    assert(createdSessionId, "session creation did not return an id");

    await request(`/api/sessions/${createdSessionId}`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": csrfToken
      },
      body: JSON.stringify({
        title: "api smoke settings",
        workingDirectory: projectRoot,
        model: "gpt-5.4-mini",
        intelligence: "high",
        sandboxMode: "read-only",
        approvalPolicy: "on-request",
        fullAccessEnabled: false
      })
    });

    const sessionsAfterPatch = await request("/api/sessions");
    const patched = sessionsAfterPatch.sessions.find(
      (session) => session.id === createdSessionId
    );

    assert(patched, "patched session was not returned by /api/sessions");
    assert(patched.title === "api smoke settings", "session title was not saved");
    assert(patched.workingDirectory === projectRoot, "working directory was not saved");
    assert(patched.model === "gpt-5.4-mini", "model was not saved");
    assert(patched.intelligence === "high", "intelligence was not saved");
    assert(patched.sandboxMode === "read-only", "sandbox mode was not saved");
    assert(
      patched.approvalPolicy === "on-request",
      "approval policy was not saved as on-request"
    );
    assert(patched.fullAccessEnabled === false, "full access flag was not saved");

    await request(`/api/sessions/${createdSessionId}`, {
      method: "DELETE",
      headers: {
        "x-csrf-token": csrfToken
      }
    });

    const trash = await request("/api/trash");
    assert(
      trash.sessions.some((session) => session.id === createdSessionId),
      "archived session did not appear in trash"
    );

    await request(`/api/trash/${createdSessionId}`, {
      method: "DELETE",
      headers: {
        "x-csrf-token": csrfToken
      }
    });

    const [sessionsAfterDelete, trashAfterDelete] = await Promise.all([
      request("/api/sessions"),
      request("/api/trash")
    ]);

    assert(
      !sessionsAfterDelete.sessions.some((session) => session.id === createdSessionId),
      "deleted session still appears in active sessions"
    );
    assert(
      !trashAfterDelete.sessions.some((session) => session.id === createdSessionId),
      "deleted session still appears in trash"
    );

    console.log("API smoke test passed: create, settings save, trash, and hard delete.");
  } finally {
    if (createdSessionId && csrfToken) {
      await request(`/api/sessions/${createdSessionId}`, {
        method: "DELETE",
        headers: {
          "x-csrf-token": csrfToken
        }
      }).catch(() => {});

      await request(`/api/trash/${createdSessionId}`, {
        method: "DELETE",
        headers: {
          "x-csrf-token": csrfToken
        }
      }).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
