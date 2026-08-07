import { describe, expect, it } from "vitest";
import { erpPayloadSchema } from "./erp-import";

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
});
