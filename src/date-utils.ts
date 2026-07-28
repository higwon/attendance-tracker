import { holidaysOn, isHoliday } from "@hangukit/holidays-core";
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

export function timeOf(totalMinutes: number) {
  const normalized = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(normalized % 60).padStart(2, "0")}`;
}

export function isWeekendDate(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

export function holidayName(date: string) {
  return holidaysOn(date).map((holiday) => holiday.name).join(" · ");
}

export function isNonWorkingDate(date: string) {
  return isWeekendDate(date) || isHoliday(date);
}

export function requiredMinutesForDate(date: string, record?: Attendance) {
  if (isNonWorkingDate(date) || record?.work_type === "annual" || record?.work_type === "holiday") return 0;
  if (record?.work_type === "half") return 240;
  return REQUIRED_DAY_MINUTES;
}

export function workedMinutes(record: Attendance, nowTime?: string) {
  if (record.work_type === "annual" || record.work_type === "holiday") return 0;
  if (record.work_type === "half") return 240;
  if (!record.check_in_time) return 0;
  const end = record.check_out_time ?? nowTime;
  if (!end) return 0;
  const elapsed = Math.max(0, minutesOf(end) - minutesOf(record.check_in_time));
  const progressiveBreak = record.check_out_time
    ? record.break_minutes
    : Math.min(record.break_minutes, Math.max(0, elapsed - 240));
  return Math.max(0, elapsed - progressiveBreak);
}

export function overtimeMinutes(record: Attendance, nowTime?: string) {
  return workedMinutes(record, nowTime) - requiredMinutesForDate(record.work_date, record);
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

export function addDays(dateString: string, amount: number) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

export function weekDates(dateString: string) {
  const start = weekStart(dateString);
  return Array.from({ length: 5 }, (_, index) => addDays(start, index));
}

export function weeklySummary(records: Attendance[], dateString: string, nowTime?: string) {
  const dates = weekDates(dateString);
  const byDate = new Map(records.map((record) => [record.work_date, record]));
  const required = dates.reduce((sum, date) => sum + requiredMinutesForDate(date, byDate.get(date)), 0);
  const worked = dates.reduce((sum, date) => {
    const record = byDate.get(date);
    return sum + (record ? workedMinutes(record, record.work_date === dateString ? nowTime : undefined) : 0);
  }, 0);
  const overtime = dates.reduce((sum, date) => {
    const record = byDate.get(date);
    return sum + (record ? overtimeMinutes(record, record.work_date === dateString ? nowTime : undefined) : 0);
  }, 0);
  return { dates, required, worked, overtime };
}

export function checkoutTime(record: Attendance, records: Attendance[]) {
  if (record.work_type !== "work" || !record.check_in_time) return null;
  const dates = weekDates(record.work_date);
  const byDate = new Map(records.map((item) => [item.work_date, item]));
  const workingDates = dates.filter((date) => requiredMinutesForDate(date, byDate.get(date)) > 0);
  const lastWorkingDate = workingDates.at(-1);
  let targetWork = requiredMinutesForDate(record.work_date, record);
  if (record.work_date === lastWorkingDate) {
    const required = dates.reduce((sum, date) => sum + requiredMinutesForDate(date, byDate.get(date)), 0);
    const previousWorked = records
      .filter((item) => dates.includes(item.work_date) && item.work_date < record.work_date)
      .reduce((sum, item) => sum + workedMinutes(item), 0);
    targetWork = Math.max(0, required - previousWorked);
  }
  return timeOf(minutesOf(record.check_in_time) + targetWork + record.break_minutes);
}
