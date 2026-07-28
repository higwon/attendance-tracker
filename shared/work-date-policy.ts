import { isHoliday } from "korean-holidays";

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function getBlockedWorkDateReason(date: string): string | null {
  const match = DATE_PATTERN.exec(date);
  if (!match) return "올바른 근무 날짜가 아닙니다.";

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (parsed.getFullYear() !== year || parsed.getMonth() !== month - 1 || parsed.getDate() !== day) {
    return "올바른 근무 날짜가 아닙니다.";
  }

  const weekday = parsed.getDay();
  if (weekday === 0 || weekday === 6) return "주말에는 근무 기록을 입력할 수 없습니다.";

  const holiday = isHoliday(parsed)?.nameKo;
  return holiday ? `${holiday}에는 근무 기록을 입력할 수 없습니다.` : null;
}
