import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("./delegated", () => ({ resolveSharedWorkspaceContext: vi.fn() }));

const { getServiceTokenIdentity } = await import("./cloudflareAccess");

describe("getServiceTokenIdentity", () => {
  it("maps a service token JWT to its own user", () => {
    expect(
      getServiceTokenIdentity({ sub: "", common_name: "abc123.access" }),
    ).toEqual({
      userId: "access-service:abc123.access",
      userEmail: "abc123.access@service-token.invalid",
    });
  });

  it("ignores person logins, which carry an email", () => {
    expect(
      getServiceTokenIdentity({
        sub: "u1",
        email: "a@b.com",
        common_name: "abc123.access",
      }),
    ).toBeNull();
  });

  it("rejects a missing or malformed common_name", () => {
    expect(getServiceTokenIdentity({ sub: "" })).toBeNull();
    expect(getServiceTokenIdentity({ common_name: "a b@c" })).toBeNull();
  });
});
