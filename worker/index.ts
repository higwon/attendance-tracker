import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { clearSession, createSession, hashPassword, requireAdmin, requireAuth, verifyPassword } from "./auth";
import type { Bindings, Variables } from "./types";
import { getBlockedWorkDateReason } from "../shared/work-date-policy";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const api = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.onError((error, c) => {
  console.error("Unhandled request error", error);
  return c.json({ message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, 500);
});

const credentials = z.object({
  username: z.string().trim().min(4).max(40).regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(1).max(72),
});

api.post("/auth/register", zValidator("json", credentials.extend({
  displayName: z.string().trim().min(1).max(30),
})), async (c) => {
  const input = c.req.valid("json");
  const count = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM users").first<{ count: number }>();
  const { hash, salt } = await hashPassword(input.password);
  const id = crypto.randomUUID();
  try {
    await c.env.DB.prepare(
      `INSERT INTO users
       (id, username, display_name, password_hash, password_salt, role, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    ).bind(
      id,
      input.username,
      input.displayName,
      hash,
      salt,
      count?.count === 0 ? "admin" : "user",
      new Date().toISOString(),
    ).run();
  } catch {
    return c.json({ message: "이미 사용 중인 아이디입니다." }, 409);
  }
  await createSession(c, id);
  return c.json({ ok: true }, 201);
});

api.post("/auth/login", zValidator("json", credentials), async (c) => {
  const input = c.req.valid("json");
  const user = await c.env.DB.prepare(
    "SELECT id, password_hash, password_salt, is_active FROM users WHERE username = ? COLLATE NOCASE",
  ).bind(input.username).first<{
    id: string; password_hash: string; password_salt: string; is_active: number;
  }>();
  if (!user || !await verifyPassword(input.password, user.password_salt, user.password_hash)) {
    return c.json({ message: "아이디 또는 비밀번호가 올바르지 않습니다." }, 401);
  }
  if (!user.is_active) return c.json({ message: "비활성화된 계정입니다." }, 403);
  const loginAt = new Date().toISOString();
  await c.env.DB.prepare("UPDATE users SET last_login_at = ?, last_active_at = ? WHERE id = ?")
    .bind(loginAt, loginAt, user.id).run();
  await createSession(c, user.id);
  return c.json({ ok: true });
});

api.post("/auth/logout", requireAuth, async (c) => {
  await clearSession(c);
  return c.json({ ok: true });
});

api.get("/me", requireAuth, (c) => c.json(c.get("user")));
api.patch("/me", requireAuth, zValidator("json", z.object({
  displayName: z.string().trim().min(1).max(30),
  profilePhoto: z.string().max(250_000).regex(/^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/).nullable(),
})), async (c) => {
  const input = c.req.valid("json");
  await c.env.DB.prepare("UPDATE users SET display_name = ?, profile_photo = ? WHERE id = ?")
    .bind(input.displayName, input.profilePhoto, c.get("user").id).run();
  return c.json({ ok: true });
});

api.patch("/me/password", requireAuth, zValidator("json", z.object({
  currentPassword: z.string().min(1).max(72),
  newPassword: z.string().min(1).max(72),
})), async (c) => {
  const input = c.req.valid("json");
  const userId = c.get("user").id;
  const user = await c.env.DB.prepare(
    "SELECT password_hash, password_salt FROM users WHERE id = ?",
  ).bind(userId).first<{ password_hash: string; password_salt: string }>();
  if (!user || !await verifyPassword(input.currentPassword, user.password_salt, user.password_hash)) {
    return c.json({ message: "현재 비밀번호가 올바르지 않습니다." }, 400);
  }
  const { hash, salt } = await hashPassword(input.newPassword);
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?")
      .bind(hash, salt, userId),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
  ]);
  await createSession(c, userId);
  return c.json({ ok: true });
});

api.get("/attendance", requireAuth, async (c) => {
  const from = c.req.query("from") ?? "0000-01-01";
  const to = c.req.query("to") ?? "9999-12-31";
  const result = await c.env.DB.prepare(
    `SELECT id, work_date, check_in_time, check_out_time, break_minutes, work_type, memo
     FROM attendance WHERE user_id = ? AND work_date BETWEEN ? AND ? ORDER BY work_date`,
  ).bind(c.get("user").id, from, to).all();
  return c.json(result.results);
});

const attendanceInput = z.object({
  originalWorkDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  checkInTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  checkOutTime: z.string().regex(/^\d{2}:\d{2}$/).nullable(),
  breakMinutes: z.number().int().min(0).max(240),
  workType: z.enum(["work", "annual", "half", "holiday"]),
  memo: z.string().max(300),
});

api.put("/attendance/:date", requireAuth, zValidator("json", attendanceInput), async (c) => {
  const input = c.req.valid("json");
  if (input.workDate !== c.req.param("date")) return c.json({ message: "날짜가 일치하지 않습니다." }, 400);
  const blockedReason = getBlockedWorkDateReason(input.workDate);
  if (blockedReason) return c.json({ message: blockedReason }, 400);
  const now = new Date().toISOString();
  const upsert = c.env.DB.prepare(
    `INSERT INTO attendance
      (id, user_id, work_date, check_in_time, check_out_time, break_minutes, work_type, memo, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, work_date) DO UPDATE SET
      check_in_time = excluded.check_in_time,
      check_out_time = excluded.check_out_time,
      break_minutes = excluded.break_minutes,
      work_type = excluded.work_type,
      memo = excluded.memo,
      updated_at = excluded.updated_at`,
  ).bind(
    crypto.randomUUID(), c.get("user").id, input.workDate, input.checkInTime, input.checkOutTime,
    input.breakMinutes, input.workType, input.memo, now, now,
  );
  if (input.originalWorkDate && input.originalWorkDate !== input.workDate) {
    const occupied = await c.env.DB.prepare(
      "SELECT 1 FROM attendance WHERE user_id = ? AND work_date = ?",
    ).bind(c.get("user").id, input.workDate).first();
    if (occupied) return c.json({ message: "변경하려는 날짜에 이미 기록이 있습니다." }, 409);
    await c.env.DB.batch([
      upsert,
      c.env.DB.prepare("DELETE FROM attendance WHERE user_id = ? AND work_date = ?")
        .bind(c.get("user").id, input.originalWorkDate),
    ]);
  } else {
    await upsert.run();
  }
  return c.json({ ok: true });
});

api.delete("/attendance/:date", requireAuth, async (c) => {
  await c.env.DB.prepare("DELETE FROM attendance WHERE user_id = ? AND work_date = ?")
    .bind(c.get("user").id, c.req.param("date")).run();
  return c.json({ ok: true });
});

api.get("/users", requireAuth, async (c) => {
  const users = await c.env.DB.prepare(
    "SELECT id, username, display_name, profile_photo FROM users WHERE is_active = 1 ORDER BY display_name",
  ).all();
  return c.json(users.results);
});

api.get("/admin/users", requireAuth, requireAdmin, async (c) => {
  const users = await c.env.DB.prepare(
    `SELECT id, username, display_name, profile_photo, role, is_active, created_at, last_login_at, last_active_at
     FROM users ORDER BY created_at`,
  ).all();
  return c.json(users.results);
});

api.patch("/admin/users/:id", requireAuth, requireAdmin, zValidator("json", z.object({
  role: z.enum(["user", "admin"]).optional(),
  isActive: z.boolean().optional(),
})), async (c) => {
  const input = c.req.valid("json");
  const targetId = c.req.param("id");
  if (targetId === c.get("user").id && input.isActive === false) {
    return c.json({ message: "자기 계정은 비활성화할 수 없습니다." }, 400);
  }
  await c.env.DB.prepare(
    "UPDATE users SET role = COALESCE(?, role), is_active = COALESCE(?, is_active) WHERE id = ?",
  ).bind(input.role ?? null, input.isActive === undefined ? null : Number(input.isActive), targetId).run();
  return c.json({ ok: true });
});

app.route("/api", api);
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
