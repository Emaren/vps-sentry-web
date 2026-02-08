import { afterEach, describe, expect, it } from "vitest";
import {
  isAdminEmail,
  readAdminAllowlist,
  readOwnerAllowlist,
  resolveBootstrapRoleForEmail,
} from "@/lib/rbac";

const originalOwnerEmails = process.env.VPS_OWNER_EMAILS;
const originalAdminEmails = process.env.VPS_ADMIN_EMAILS;
const originalAdminEmail = process.env.VPS_ADMIN_EMAIL;
const originalOpsEmails = process.env.VPS_OPS_EMAILS;
const originalViewerEmails = process.env.VPS_VIEWER_EMAILS;

afterEach(() => {
  if (originalOwnerEmails === undefined) delete process.env.VPS_OWNER_EMAILS;
  else process.env.VPS_OWNER_EMAILS = originalOwnerEmails;

  if (originalAdminEmails === undefined) delete process.env.VPS_ADMIN_EMAILS;
  else process.env.VPS_ADMIN_EMAILS = originalAdminEmails;

  if (originalAdminEmail === undefined) delete process.env.VPS_ADMIN_EMAIL;
  else process.env.VPS_ADMIN_EMAIL = originalAdminEmail;

  if (originalOpsEmails === undefined) delete process.env.VPS_OPS_EMAILS;
  else process.env.VPS_OPS_EMAILS = originalOpsEmails;

  if (originalViewerEmails === undefined) delete process.env.VPS_VIEWER_EMAILS;
  else process.env.VPS_VIEWER_EMAILS = originalViewerEmails;
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

  it("falls back to default owner when owner env is missing", () => {
    delete process.env.VPS_OWNER_EMAILS;
    const out = readOwnerAllowlist();
    expect(out.includes("tonyblumdev@gmail.com")).toBe(true);
  });

  it("resolves the highest bootstrap role by env precedence", () => {
    process.env.VPS_OWNER_EMAILS = "owner@example.com";
    process.env.VPS_ADMIN_EMAILS = "admin@example.com";
    process.env.VPS_OPS_EMAILS = "ops@example.com";
    process.env.VPS_VIEWER_EMAILS = "viewer@example.com";

    expect(resolveBootstrapRoleForEmail("owner@example.com")).toBe("owner");
    expect(resolveBootstrapRoleForEmail("admin@example.com")).toBe("admin");
    expect(resolveBootstrapRoleForEmail("ops@example.com")).toBe("ops");
    expect(resolveBootstrapRoleForEmail("viewer@example.com")).toBe("viewer");
    expect(resolveBootstrapRoleForEmail("none@example.com")).toBeNull();
  });

  it("treats owner allowlist as admin-or-higher access", () => {
    process.env.VPS_OWNER_EMAILS = "owner@example.com";
    delete process.env.VPS_ADMIN_EMAILS;
    delete process.env.VPS_ADMIN_EMAIL;
    expect(isAdminEmail("owner@example.com")).toBe(true);
  });

  it("matches admin emails case-insensitively", () => {
    process.env.VPS_ADMIN_EMAILS = "admin@example.com";
    expect(isAdminEmail("ADMIN@example.com")).toBe(true);
    expect(isAdminEmail("other@example.com")).toBe(false);
  });
});
