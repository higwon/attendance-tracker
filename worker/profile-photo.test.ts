import { describe, expect, it } from "vitest";
import { isValidProfilePhoto } from "./profile-photo";

describe("profile photo validation", () => {
  it("accepts supported image signatures", () => {
    expect(isValidProfilePhoto("data:image/png;base64,iVBORw0KGgo=")).toBe(true);
    expect(isValidProfilePhoto("data:image/jpeg;base64,/9j/AA==")).toBe(true);
    expect(isValidProfilePhoto("data:image/webp;base64,UklGRgAAAABXRUJQ")).toBe(true);
  });

  it("rejects malformed base64 and mismatched signatures", () => {
    expect(isValidProfilePhoto("data:image/png;base64,%%%" )).toBe(false);
    expect(isValidProfilePhoto("data:image/png;base64,bm90LWEtcG5n")).toBe(false);
    expect(isValidProfilePhoto("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
  });

  it("rejects decoded images larger than 200KB", () => {
    const oversized = btoa(String.fromCharCode(137, 80, 78, 71, 13, 10, 26, 10) + "a".repeat(200 * 1024));
    expect(isValidProfilePhoto(`data:image/png;base64,${oversized}`)).toBe(false);
  });
});
