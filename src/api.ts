import type { Attendance, User } from "./types";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${url}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: unknown } | null;
    const fallback = response.status >= 500
      ? "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."
      : "입력 내용을 확인해 주세요.";
    throw new Error(typeof body?.message === "string" ? body.message : fallback);
  }
  return response.json();
}

export const api = {
  me: () => request<User>("/me"),
  login: (username: string, password: string) =>
    request("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  register: (username: string, displayName: string, password: string) =>
    request("/auth/register", { method: "POST", body: JSON.stringify({ username, displayName, password }) }),
  logout: () => request("/auth/logout", { method: "POST" }),
  records: (from: string, to: string) => request<Attendance[]>(`/attendance?from=${from}&to=${to}`),
  saveRecord: (record: Attendance, originalWorkDate?: string) => request(`/attendance/${record.work_date}`, {
    method: "PUT",
    body: JSON.stringify({
      workDate: record.work_date,
      originalWorkDate,
      checkInTime: record.check_in_time,
      checkOutTime: record.check_out_time,
      breakMinutes: record.break_minutes,
      workType: record.work_type,
      memo: record.memo,
    }),
  }),
  deleteRecord: (date: string) => request(`/attendance/${date}`, { method: "DELETE" }),
  updateMe: (displayName: string, profilePhoto: string | null) =>
    request("/me", { method: "PATCH", body: JSON.stringify({ displayName, profilePhoto }) }),
  changePassword: (currentPassword: string, newPassword: string) =>
    request("/me/password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) }),
  directory: () => request<Array<Pick<User, "id" | "username" | "display_name" | "profile_photo">>>("/users"),
  adminUsers: () => request<Array<User & { created_at: string; last_login_at: string | null; last_active_at: string | null }>>("/admin/users"),
  updateUser: (id: string, value: { role?: "user" | "admin"; isActive?: boolean }) =>
    request(`/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(value) }),
};
