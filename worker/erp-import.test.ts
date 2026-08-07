import { describe, expect, it } from "vitest";
import { erpPayloadSchema, formatImportValidationIssue, hasSameUserMeaning } from "./erp-import";

const record = {
  workDate: "2026-08-07", checkInTime: "08:57", checkOutTime: "18:12",
  workType: "work" as const, paidWorkHours: 0, workItemName: "정상근무",
  statusName: "승인", dayTypeName: "평일", isHoliday: false,
};

const payload = (records: unknown[]) => ({
  version: 1, source: "park-erp", exportedAt: "2026-08-07T00:00:00.000Z", records,
});

describe("ERP import contract", () => {
  it("accepts normalized work and hourly leave", () => {
    expect(erpPayloadSchema.safeParse(payload([{ ...record, paidWorkHours: 2 }])).success).toBe(true);
  });

  it("rejects duplicate dates and holiday mismatches", () => {
    expect(erpPayloadSchema.safeParse(payload([record, record])).success).toBe(false);
    expect(erpPayloadSchema.safeParse(payload([{
      ...record, workType: "holiday", checkInTime: null, checkOutTime: null,
      paidWorkHours: 8, isHoliday: false,
    }])).success).toBe(false);
  });

  it("accepts practical annual and half-day paid-hour values", () => {
    expect(erpPayloadSchema.safeParse(payload([
      { ...record, workDate: "2026-08-06", workType: "annual", checkInTime: null, checkOutTime: null, paidWorkHours: 7.5 },
      { ...record, workType: "half", checkInTime: "09:00", checkOutTime: "13:00", paidWorkHours: 4 },
    ])).success).toBe(true);
  });

  it("turns generic schema errors into actionable Korean field messages", () => {
    const parsed = erpPayloadSchema.safeParse(payload([{ ...record, workType: "normal" }]));
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(formatImportValidationIssue(parsed.error.issues[0])).toBe(
        "1번째 기록의 근무 유형(workType): work, annual, half, holiday 중 하나여야 합니다.",
      );
    }
  });

  it("treats manual leave defaults as the same user-visible record", () => {
    const existing = {
      id: "attendance-1", work_date: "2026-08-07", check_in_time: null, check_out_time: null,
      work_type: "annual" as const, source: "manual" as const, paid_work_hours: 0, external_record_hash: null,
    };
    const incoming = {
      ...record, checkInTime: null, checkOutTime: null, workType: "annual" as const, paidWorkHours: 8,
    };

    expect(hasSameUserMeaning(existing, incoming)).toBe(true);
    expect(hasSameUserMeaning(
      { ...existing, work_type: "work", check_in_time: "09:00", check_out_time: "18:00" },
      { ...record, checkInTime: "09:00", checkOutTime: "18:00", paidWorkHours: 2 },
    )).toBe(false);
  });
});
