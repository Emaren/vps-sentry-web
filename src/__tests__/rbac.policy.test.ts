import { describe, expect, it } from "vitest";
import {
  hasRequiredRole,
  maxRole,
  normalizeAppRole,
  roleCan,
} from "@/lib/rbac-policy";

describe("rbac policy matrix", () => {
  it("normalizes supported role strings", () => {
    expect(normalizeAppRole("OWNER")).toBe("owner");
    expect(normalizeAppRole("admin")).toBe("admin");
    expect(normalizeAppRole(" ops ")).toBe("ops");
    expect(normalizeAppRole("viewer")).toBe("viewer");
    expect(normalizeAppRole("unknown")).toBeNull();
  });

  it("enforces rank ordering", () => {
    expect(hasRequiredRole("owner", "admin")).toBe(true);
    expect(hasRequiredRole("admin", "ops")).toBe(true);
    expect(hasRequiredRole("ops", "viewer")).toBe(true);
    expect(hasRequiredRole("viewer", "ops")).toBe(false);
    expect(hasRequiredRole(null, "viewer")).toBe(false);
  });

  it("computes max role between two values", () => {
    expect(maxRole("viewer", "ops")).toBe("ops");
    expect(maxRole("admin", "ops")).toBe("admin");
    expect(maxRole("owner", "viewer")).toBe("owner");
  });

  it("maps capabilities to minimum role", () => {
    expect(roleCan("viewer", "read")).toBe(true);
    expect(roleCan("viewer", "mutate")).toBe(false);
    expect(roleCan("ops", "ops")).toBe(true);
    expect(roleCan("ops", "admin")).toBe(false);
    expect(roleCan("admin", "mutate")).toBe(true);
    expect(roleCan("owner", "owner")).toBe(true);
  });
});
