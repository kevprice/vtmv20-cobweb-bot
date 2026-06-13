import { describe, expect, it } from "vitest";
import { containsMention, sanitizeCobwebText, validateCobwebMessage } from "./validation.js";

const config = {
  maxLength: 10,
  blockedTerms: ["Victor"]
};

describe("validateCobwebMessage", () => {
  it("accepts and normalizes short fragments", () => {
    expect(validateCobwebMessage("  river\n remembers  ", config)).toEqual({
      ok: false,
      reason: "Fragments must be 10 characters or fewer."
    });
    expect(sanitizeCobwebText("  river\n  ")).toBe("river");
  });

  it("rejects empty fragments", () => {
    expect(validateCobwebMessage("   ", config)).toEqual({
      ok: false,
      reason: "The Cobweb refuses empty silence. Add a fragment first."
    });
  });

  it("rejects long fragments", () => {
    expect(validateCobwebMessage("this is too long", config)).toEqual({
      ok: false,
      reason: "Fragments must be 10 characters or fewer."
    });
  });

  it("rejects mentions", () => {
    expect(containsMention("<@123456789012345678>")).toBe(true);
    expect(containsMention("@everyone")).toBe(true);
    expect(validateCobwebMessage("hello @here", { ...config, maxLength: 50 })).toEqual({
      ok: false,
      reason: "Fragments cannot contain Discord mentions."
    });
  });

  it("rejects blocked terms case-insensitively", () => {
    expect(validateCobwebMessage("victor waits", { ...config, maxLength: 50 })).toEqual({
      ok: false,
      reason: "That fragment contains a configured blocked term: Victor."
    });
  });

  it("accepts a valid fragment", () => {
    expect(validateCobwebMessage("teeth", config)).toEqual({ ok: true, text: "teeth" });
  });
});

