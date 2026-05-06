import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

export class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function ensureCsrfToken(request: FastifyRequest, reply: FastifyReply) {
  const existing = request.cookies[config.csrfCookieName];

  if (existing) {
    return existing;
  }

  const token = randomUUID();
  reply.setCookie(config.csrfCookieName, token, {
    path: "/",
    sameSite: "lax",
    httpOnly: true
  });
  return token;
}

export function requireCsrf(request: FastifyRequest) {
  const cookieToken = request.cookies[config.csrfCookieName];
  const headerToken = request.headers["x-csrf-token"];

  if (typeof cookieToken !== "string" || typeof headerToken !== "string") {
    throw new HttpError(403, "Missing CSRF token.");
  }

  if (cookieToken !== headerToken) {
    throw new HttpError(403, "Invalid CSRF token.");
  }
}

export function requireAuth(_request: FastifyRequest) {
  return;
}
