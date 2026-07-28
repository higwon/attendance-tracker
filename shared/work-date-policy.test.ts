import { describe, expect, it } from "vitest";
import { getBlockedWorkDateReason } from "./work-date-policy";

describe("work date policy", () => {
  it("allows an ordinary weekday", () => {
    expect(getBlockedWorkDateReason("2026-07-16")).toBeNull();
  });

  it("blocks Saturdays and Sundays", () => {
    expect(getBlockedWorkDateReason("2026-07-18")).toContain("주말");
    expect(getBlockedWorkDateReason("2026-07-19")).toContain("주말");
  });

  it("blocks Korean public holidays", () => {
    expect(getBlockedWorkDateReason("2026-07-17")).toContain("제헌절");
  });

  it("rejects impossible dates", () => {
    expect(getBlockedWorkDateReason("2026-02-30")).toContain("올바른");
  });
});
