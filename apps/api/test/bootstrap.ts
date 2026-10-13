/**
 * Shared test helpers. The in-memory prisma mock itself is installed by
 * test/setup.ts (a vitest setupFile) so it is in place before app modules
 * are imported. Individual tests call {@link resetDb} to get a clean slate.
 */

import { mockTables } from "./mock-prisma";

export type MockPrisma = ReturnType<typeof import("./mock-prisma").createMockPrisma>;

/** The mock prisma instance the app is bound to. */
export const prismaMock: MockPrisma = (globalThis as Record<string, unknown>).prisma as MockPrisma;

/** Wipe every table between tests (same mock instance, fresh rows). */
export function resetDb(): MockPrisma {
  for (const table of Object.values(mockTables)) {
    table.rows = [];
  }
  return prismaMock;
}

/**
 * Seed a user + a valid browser session directly in the mock database.
 * Returns the cookie value to use for authenticated requests.
 */
export async function seedUser(
  prisma: MockPrisma = prismaMock,
  opts: { email?: string; passwordHash?: string } = {},
): Promise<{ userId: string; cookie: string; token: string; email: string }> {
  const { hash } = await import("argon2");
  const { randomToken, sha256Hex } = await import("@xterminal/crypto");
  const email = opts.email ?? `user-${Math.random().toString(36).slice(2)}@example.com`;
  const user = prisma.user.create({
    data: {
      email,
      name: "Test User",
      passwordHash:
        opts.passwordHash ??
        (await hash("correct horse battery staple", { type: 2, memoryCost: 8192, timeCost: 2, parallelism: 1 })),
      emailVerified: true,
    },
  });
  const token = randomToken(32);
  prisma.authSession.create({
    data: {
      userId: user.id as string,
      tokenHash: sha256Hex(token),
      userAgent: "vitest",
      ip: "127.0.0.1",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
  return { userId: user.id as string, email, token, cookie: `xt_session=${token}` };
}
