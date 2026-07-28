import { describe, expect, it } from "vitest";
import {
  checkoutTime, dateRangeForMonth, holidayName, overtimeMinutes,
  requiredMinutesForDate, weeklySummary, workedMinutes,
} from "./date-utils";
import type { Attendance } from "./types";

const record = (values: Partial<Attendance>): Attendance => ({
  work_date: "2026-07-01",
  check_in_time: "09:00",
  check_out_time: "18:00",
  break_minutes: 60,
  work_type: "work",
  memo: "",
  ...values,
});

describe("attendance calculations", () => {
  it("excludes the configured break from completed work", () => {
    expect(workedMinutes(record({}))).toBe(480);
  });

  it("keeps completed shortages as negative overtime", () => {
    expect(overtimeMinutes(record({ check_out_time: "17:30" }))).toBe(-30);
  });

  it("applies an in-progress break only after four elapsed hours", () => {
    expect(workedMinutes(record({ check_out_time: null }), "12:00")).toBe(180);
    expect(workedMinutes(record({ check_out_time: null }), "14:00")).toBe(240);
  });

  it("counts half-day leave as four credited hours", () => {
    expect(workedMinutes(record({ work_type: "half", check_out_time: "20:00", break_minutes: 0 }))).toBe(240);
    expect(overtimeMinutes(record({ work_type: "half" }))).toBe(0);
  });

  it("recognizes Korean holidays and removes their required hours", () => {
    expect(holidayName("2026-07-17")).toContain("제헌절");
    expect(requiredMinutesForDate("2026-07-17")).toBe(0);
  });

  it("counts every business day even when no record exists", () => {
    const summary = weeklySummary([
      record({ work_date: "2026-07-06", check_out_time: "18:00" }),
      record({ work_date: "2026-07-07", check_out_time: "18:00" }),
    ], "2026-07-06");
    expect(summary.required).toBe(2400);
    expect(summary.worked).toBe(960);
  });

  it("uses the last working day to make up a weekly shortage", () => {
    const records = [
      record({ work_date: "2026-07-06" }),
      record({ work_date: "2026-07-07" }),
      record({ work_date: "2026-07-08" }),
      record({ work_date: "2026-07-09", check_out_time: "17:00" }),
    ];
    const friday = record({ work_date: "2026-07-10", check_out_time: null });
    expect(checkoutTime(friday, [...records, friday])).toBe("19:00");
  });

  it("includes full boundary weeks when loading a month", () => {
    expect(dateRangeForMonth("2026-07")).toEqual({ from: "2026-06-29", to: "2026-08-02" });
  });
});
