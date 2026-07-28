import { describe, expect, it } from "vitest";
import { dateRangeForMonth, overtimeMinutes, workedMinutes } from "./date-utils";
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
    expect(workedMinutes(record({ work_type: "half", check_out_time: "13:00", break_minutes: 0 }))).toBe(480);
  });

  it("includes full boundary weeks when loading a month", () => {
    expect(dateRangeForMonth("2026-07")).toEqual({ from: "2026-06-29", to: "2026-08-02" });
  });
});
