import { afterEach, describe, expect, it } from "vitest";
import { isAdminEmail, readAdminAllowlist } from "@/lib/rbac";

const originalAdminEmails = process.env.VPS_ADMIN_EMAILS;
const originalAdminEmail = process.env.VPS_ADMIN_EMAIL;

afterEach(() => {
  if (originalAdminEmails === undefined) delete process.env.VPS_ADMIN_EMAILS;
  else process.env.VPS_ADMIN_EMAILS = originalAdminEmails;

  if (originalAdminEmail === undefined) delete process.env.VPS_ADMIN_EMAIL;
  else process.env.VPS_ADMIN_EMAIL = originalAdminEmail;
});

describe("rbac allowlist", () => {
  it("parses VPS_ADMIN_EMAILS allowlist", () => {
    process.env.VPS_ADMIN_EMAILS = "alice@example.com, Bob@example.com\ncarol@example.com";
    const out = readAdminAllowlist();
    expect(out).toEqual([
      "alice@example.com",
      "bob@example.com",
      "carol@example.com",
    ]);
  });

  it("falls back to default admin when env is missing", () => {
    delete process.env.VPS_ADMIN_EMAILS;
    delete process.env.VPS_ADMIN_EMAIL;
    const out = readAdminAllowlist();
    expect(out.includes("tonyblumdev@gmail.com")).toBe(true);
  });

  it("matches admin emails case-insensitively", () => {
    process.env.VPS_ADMIN_EMAILS = "admin@example.com";
    expect(isAdminEmail("ADMIN@example.com")).toBe(true);
    expect(isAdminEmail("other@example.com")).toBe(false);
  });
});
