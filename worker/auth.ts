import type { Context, Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppUser, Bindings, Variables } from "./types";

const encoder = new TextEncoder();
const ITERATIONS = 210_000;

function toHex(bytes: ArrayBuffer | Uint8Array) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function randomHex(size = 32) {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function hashPassword(password: string, salt = randomHex(16)) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const result = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(salt), iterations: ITERATIONS },
    key,
    256,
  );
  return { hash: toHex(result), salt };
}

export async function verifyPassword(password: string, salt: string, expected: string) {
  const { hash } = await hashPassword(password, salt);
  if (hash.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < hash.length; index += 1) {
    mismatch |= hash.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

export async function sha256(value: string) {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function createSession(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  userId: string,
) {
  const token = randomHex();
  const now = new Date();
  const expires = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 14);
  await c.env.DB.prepare(
    "INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), userId, await sha256(token), expires.toISOString(), now.toISOString()).run();
  setCookie(c, "attendance_session", token, {
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    path: "/",
    expires,
  });
}

export async function clearSession(c: Context<{ Bindings: Bindings; Variables: Variables }>) {
  const token = getCookie(c, "attendance_session");
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  }
  deleteCookie(c, "attendance_session", { path: "/" });
}

export async function requireAuth(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  const token = getCookie(c, "attendance_session");
  if (!token) return c.json({ message: "로그인이 필요합니다." }, 401);

  const user = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.display_name, u.role, u.is_active
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`,
  ).bind(await sha256(token), new Date().toISOString()).first<AppUser>();

  if (!user || !user.is_active) {
    deleteCookie(c, "attendance_session", { path: "/" });
    return c.json({ message: "세션이 만료되었거나 비활성화된 계정입니다." }, 401);
  }

  c.set("user", user);
  return next();
}

export async function requireAdmin(
  c: Context<{ Bindings: Bindings; Variables: Variables }>,
  next: Next,
) {
  if (c.get("user").role !== "admin") return c.json({ message: "관리자 권한이 필요합니다." }, 403);
  return next();
}
