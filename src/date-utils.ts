import type { Attendance } from "./types";

export const SEOUL_TZ = "Asia/Seoul";
export const REQUIRED_DAY_MINUTES = 480;

export function localDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

export function minutesOf(time: string) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

export function workedMinutes(record: Attendance, nowTime?: string) {
  if (record.work_type === "annual" || record.work_type === "holiday") return REQUIRED_DAY_MINUTES;
  if (!record.check_in_time) return record.work_type === "half" ? 240 : 0;
  const end = record.check_out_time ?? nowTime;
  if (!end) return record.work_type === "half" ? 240 : 0;
  const elapsed = Math.max(0, minutesOf(end) - minutesOf(record.check_in_time));
  const progressiveBreak = record.check_out_time
    ? record.break_minutes
    : Math.min(record.break_minutes, Math.max(0, elapsed - 240));
  const actual = Math.max(0, elapsed - progressiveBreak);
  return actual + (record.work_type === "half" ? 240 : 0);
}

export function overtimeMinutes(record: Attendance, nowTime?: string) {
  return workedMinutes(record, nowTime) - REQUIRED_DAY_MINUTES;
}

export function formatDuration(total: number, signed = false) {
  const sign = total < 0 ? "-" : signed && total > 0 ? "+" : "";
  const absolute = Math.abs(Math.round(total));
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  if (!hours) return `${sign}${minutes}분`;
  if (!minutes) return `${sign}${hours}시간`;
  return `${sign}${hours}시간 ${minutes}분`;
}

export function dateRangeForMonth(month: string) {
  const [year, value] = month.split("-").map(Number);
  const start = new Date(Date.UTC(year, value - 1, 1));
  const end = new Date(Date.UTC(year, value, 0));
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  end.setUTCDate(end.getUTCDate() + (6 - ((end.getUTCDay() + 6) % 7)));
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
}

export function weekStart(dateString: string) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}
