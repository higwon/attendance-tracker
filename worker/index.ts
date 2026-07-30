import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { clearSession, createSession, hashPassword, requireAdmin, requireAuth, verifyPassword } from "./auth";
import type { Bindings, Variables } from "./types";
import { getBlockedWorkDateReason } from "../shared/work-date-policy";
import { isValidProfilePhoto } from "./profile-photo";

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();
const api = new Hono<{ Bindings: Bindings; Variables: Variables }>();

app.onError((error, c) => {
  console.error("Unhandled request error", error);
  return c.json({ message: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." }, 500);
});

const credentials = z.object({
  username: z.string().trim()
    .min(2, "아이디는 2자 이상 입력해 주세요.")
    .max(40, "아이디는 40자 이하로 입력해 주세요.")
    .regex(/^[a-zA-Z0-9._-]+$/, "아이디는 영문, 숫자, 마침표, 밑줄, 하이픈만 사용할 수 있습니다."),
  password: z.string()
    .min(1, "비밀번호를 입력해 주세요.")
    .max(72, "비밀번호는 72자 이하로 입력해 주세요."),
});

api.post("/auth/register", zValidator("json", credentials.extend({
  displayName: z.string().trim()
    .min(1, "닉네임을 입력해 주세요.")
    .max(30, "닉네임은 30자 이하로 입력해 주세요."),
}), (result, c) => {
  if (!result.success) {
    return c.json({ message: result.error.issues[0]?.message ?? "회원가입 정보를 확인해 주세요." }, 400);
  }
}), async (c) => {
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

api.post("/auth/login", zValidator("json", credentials, (result, c) => {
  if (!result.success) {
    return c.json({ message: result.error.issues[0]?.message ?? "로그인 정보를 확인해 주세요." }, 400);
  }
}), async (c) => {
  const input = c.req.valid("json");
  const user = await c.env.DB.prepare(
    "SELECT id, password_hash, password_salt, is_active FROM users WHERE username = ? COLLATE NOCASE",
  ).bind(input.username).first<{
    id: string; password_hash: string; password_salt: string; is_active: number;
  }>();
  if (!user) return c.json({ message: "존재하지 않는 아이디입니다." }, 401);
  if (!await verifyPassword(input.password, user.password_salt, user.password_hash)) {
    return c.json({ message: "비밀번호가 올바르지 않습니다." }, 401);
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

api.get("/me", requireAuth, async (c) => {
  const profile = await c.env.DB.prepare("SELECT profile_photo, bio FROM users WHERE id = ?")
    .bind(c.get("user").id).first<{ profile_photo: string | null; bio: string }>();
  return c.json({ ...c.get("user"), profile_photo: profile?.profile_photo ?? null, bio: profile?.bio ?? "" });
});

const profileInput = z.object({
  displayName: z.string().trim().min(1).max(30),
  bio: z.string().trim().max(120),
  profilePhoto: z.string().max(300_000).refine(
    isValidProfilePhoto,
    "지원하지 않는 이미지 형식입니다.",
  ).nullable(),
});
api.patch("/me", requireAuth, zValidator("json", profileInput, (result, c) => {
  if (!result.success) {
    return c.json({ message: "프로필 사진은 JPG, PNG, WebP 형식이며 250KB 이하여야 합니다." }, 400);
  }
}), async (c) => {
  const input = c.req.valid("json");
  await c.env.DB.prepare("UPDATE users SET display_name = ?, profile_photo = ?, bio = ? WHERE id = ?")
    .bind(input.displayName, input.profilePhoto, input.bio, c.get("user").id).run();
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

api.delete("/me", requireAuth, zValidator("json", z.object({
  password: z.string().min(1).max(72),
})), async (c) => {
  const userId = c.get("user").id;
  const input = c.req.valid("json");
  const user = await c.env.DB.prepare(
    "SELECT password_hash, password_salt FROM users WHERE id = ?",
  ).bind(userId).first<{ password_hash: string; password_salt: string }>();
  if (!user || !await verifyPassword(input.password, user.password_salt, user.password_hash)) {
    return c.json({ message: "비밀번호가 올바르지 않습니다." }, 400);
  }
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM attendance WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId),
    c.env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);
  await clearSession(c);
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

const postInput = z.object({
  title: z.string().trim().min(1).max(100),
  content: z.string().trim().min(1).max(5_000),
  isNotice: z.boolean().default(false),
  isPrivate: z.boolean().default(false),
});

api.get("/posts", requireAuth, async (c) => {
  const requestedPage = Number.parseInt(c.req.query("page") ?? "1", 10);
  const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
  const pageSize = 20;
  const offset = (page - 1) * pageSize;
  const currentUser = c.get("user");
  const [posts, count] = await Promise.all([
    c.env.DB.prepare(
      `SELECT p.id, p.author_id, p.title, p.content, p.is_notice, p.is_private, p.created_at, p.updated_at,
              u.username AS author_username, u.display_name AS author_display_name,
              u.profile_photo AS author_profile_photo, u.role AS author_role
       FROM posts p JOIN users u ON u.id = p.author_id
       ORDER BY p.is_notice DESC, p.created_at DESC
       LIMIT ? OFFSET ?`,
    ).bind(pageSize, offset).all<{
      id: string; author_id: string; title: string; content: string; is_notice: number; is_private: number;
      created_at: string; updated_at: string; author_username: string; author_display_name: string;
      author_profile_photo: string | null; author_role: "user" | "admin";
    }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS total FROM posts").first<{ total: number }>(),
  ]);
  const items = posts.results.map((post) => {
    const canView = !post.is_private || post.author_id === currentUser.id || currentUser.role === "admin";
    return canView
      ? { ...post, can_view: true }
      : {
        ...post,
        author_id: "",
        title: "비밀글입니다",
        content: "",
        author_username: "",
        author_display_name: "비공개",
        author_profile_photo: null,
        author_role: "user" as const,
        can_view: false,
      };
  });
  return c.json({ items, total: count?.total ?? 0, page, pageSize });
});

api.post("/posts", requireAuth, zValidator("json", postInput), async (c) => {
  const input = c.req.valid("json");
  const user = c.get("user");
  if (input.isNotice && input.isPrivate) {
    return c.json({ message: "공지와 비밀글은 동시에 설정할 수 없습니다." }, 400);
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO posts (id, author_id, title, content, is_notice, is_private, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), user.id, input.title, input.content,
    user.role === "admin" && input.isNotice ? 1 : 0, input.isPrivate ? 1 : 0, now, now,
  ).run();
  return c.json({ ok: true }, 201);
});

api.patch("/posts/:id", requireAuth, zValidator("json", postInput), async (c) => {
  const input = c.req.valid("json");
  const user = c.get("user");
  if (input.isNotice && input.isPrivate) {
    return c.json({ message: "공지와 비밀글은 동시에 설정할 수 없습니다." }, 400);
  }
  const post = await c.env.DB.prepare("SELECT author_id FROM posts WHERE id = ?")
    .bind(c.req.param("id")).first<{ author_id: string }>();
  if (!post) return c.json({ message: "게시글을 찾을 수 없습니다." }, 404);
  if (post.author_id !== user.id && user.role !== "admin") {
    return c.json({ message: "게시글을 수정할 권한이 없습니다." }, 403);
  }
  await c.env.DB.prepare(
    "UPDATE posts SET title = ?, content = ?, is_notice = ?, is_private = ?, updated_at = ? WHERE id = ?",
  ).bind(
    input.title, input.content, user.role === "admin" && input.isNotice ? 1 : 0,
    input.isPrivate ? 1 : 0, new Date().toISOString(), c.req.param("id"),
  ).run();
  return c.json({ ok: true });
});

api.delete("/posts/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const post = await c.env.DB.prepare("SELECT author_id FROM posts WHERE id = ?")
    .bind(c.req.param("id")).first<{ author_id: string }>();
  if (!post) return c.json({ message: "게시글을 찾을 수 없습니다." }, 404);
  if (post.author_id !== user.id && user.role !== "admin") {
    return c.json({ message: "게시글을 삭제할 권한이 없습니다." }, 403);
  }
  await c.env.DB.prepare("DELETE FROM posts WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

api.get("/users", requireAuth, async (c) => {
  const users = await c.env.DB.prepare(
    "SELECT id, username, display_name, profile_photo, bio, role FROM users WHERE is_active = 1 ORDER BY display_name",
  ).all();
  return c.json(users.results);
});

api.get("/admin/users", requireAuth, requireAdmin, async (c) => {
  const users = await c.env.DB.prepare(
    `SELECT id, username, display_name, profile_photo, bio, role, is_active, created_at, last_login_at, last_active_at
     FROM users ORDER BY created_at`,
  ).all();
  return c.json(users.results);
});

api.patch("/admin/users/:id", requireAuth, requireAdmin, zValidator("json", z.object({
  role: z.enum(["user", "admin"]),
})), async (c) => {
  const input = c.req.valid("json");
  const targetId = c.req.param("id");
  await c.env.DB.prepare("UPDATE users SET role = ? WHERE id = ?")
    .bind(input.role, targetId).run();
  return c.json({ ok: true });
});

app.route("/api", api);
app.get("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
