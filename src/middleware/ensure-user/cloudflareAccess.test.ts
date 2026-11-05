import { describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({
  env: { TEAM_DOMAIN: "https://team.cloudflareaccess.com", POLICY_AUD: "aud" },
}));
const verified: { payload: Record<string, unknown> } = { payload: {} };
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(),
  jwtVerify: vi.fn(async () => verified),
}));
vi.mock("./delegated", () => ({
  resolveSharedWorkspaceContext: vi.fn(async (userId: string) => ({ userId })),
}));

const { resolveSharedWorkspaceContext } = await import("./delegated");
const { getServiceTokenIdentity, resolveCloudflareAccessContext } =
  await import("./cloudflareAccess");

const withToken = new Headers({ "cf-access-jwt-assertion": "signed" });

describe("getServiceTokenIdentity", () => {
  it("maps a service token JWT to its own user", () => {
    expect(getServiceTokenIdentity({ sub: "", common_name: "abc123.access" })).toEqual({
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

describe("resolveCloudflareAccessContext", () => {
  it("resolves a verified service token as its own user", async () => {
    verified.payload = { sub: "", common_name: "abc123.access" };
    await resolveCloudflareAccessContext(withToken);
    expect(resolveSharedWorkspaceContext).toHaveBeenLastCalledWith(
      "access-service:abc123.access",
      "abc123.access@service-token.invalid",
    );
  });

  it("still rejects a verified token with no email and no common_name", async () => {
    verified.payload = { sub: "" };
    await expect(resolveCloudflareAccessContext(withToken)).rejects.toThrow();
  });

  it("rejects a name longer than 128 characters", () => {
    expect(getServiceTokenIdentity({ common_name: "a".repeat(129) })).toBeNull();
  });
});
