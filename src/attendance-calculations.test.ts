import { describe, expect, it } from "vitest";
import { getMonthlyStats, getWeeklySummary, workDuration, type RecordItem, type WorkType } from "./App";

const record = (workDate: string, values: Partial<RecordItem> = {}): RecordItem => ({
  Id: workDate,
  WorkDate: workDate,
  CheckInTime: "09:00",
  CheckOutTime: "18:00",
  BreakMinutes: 60,
  WorkType: "출근" as WorkType,
  Memo: "",
  IsSample: 0,
  ...values,
});

describe("deployed attendance calculations", () => {
  it("deducts completed and progressive breaks", () => {
    expect(workDuration(record("2026-07-06"))).toBe(480);
    expect(workDuration(record("2026-07-06", { CheckOutTime: null }), "12:00")).toBe(180);
    expect(workDuration(record("2026-07-06", { CheckOutTime: null }), "14:00")).toBe(240);
  });

  it("credits half days and excludes leave or holidays from worked time", () => {
    expect(workDuration(record("2026-07-06", { WorkType: "반차", CheckOutTime: "22:00" }))).toBe(240);
    expect(workDuration(record("2026-07-06", { WorkType: "연차" }))).toBe(0);
    expect(workDuration(record("2026-07-06", { WorkType: "공휴일" }))).toBe(0);
  });

  it("counts weekdays without records in weekly required time", () => {
    const summary = getWeeklySummary([
      record("2026-07-06"),
      record("2026-07-07"),
    ], "2026-07-07", "18:00");
    expect(summary.targetMinutes).toBe(2400);
    expect(summary.weeklyWorkMinutes).toBe(960);
    expect(summary.weeklyOvertimeMinutes).toBe(0);
  });

  it("automatically excludes Korean holidays from weekly required time", () => {
    expect(getWeeklySummary([], "2026-07-13", "09:00").targetMinutes).toBe(1920);
  });

  it("makes up a shortage on the last working day", () => {
    const records = [
      record("2026-07-06"),
      record("2026-07-07"),
      record("2026-07-08"),
      record("2026-07-09", { CheckOutTime: "17:00" }),
      record("2026-07-10", { CheckOutTime: null }),
    ];
    expect(getWeeklySummary(records, "2026-07-10", "09:00").availableCheckOutTime).toBe("19:00");
  });

  it("keeps adjacent-month records out of monthly totals", () => {
    const stats = getMonthlyStats([
      record("2026-06-29"),
      record("2026-07-01"),
      record("2026-07-02", { WorkType: "반차", CheckInTime: null, CheckOutTime: null }),
      record("2026-07-03", { WorkType: "연차", CheckInTime: null, CheckOutTime: null }),
    ], "2026-07", "2026-08-01");
    expect(stats.total).toBe(720);
    expect(stats.days).toBe(1.5);
    expect(stats.counts.연차).toBe(1);
  });
});
