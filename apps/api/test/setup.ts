/**
 * Vitest setup file (runs before each test file's imports are evaluated).
 *
 * Installs the in-memory prisma mock BEFORE the app modules load — the app
 * captures `prisma` from the global at module-load time, so this must be the
 * very first thing that happens in the test process.
 */

process.env.NODE_ENV = "test";
process.env.ENCRYPTION_KEY ??= "a".repeat(64); // test vault key (hex, 32 bytes)
process.env.SESSION_SECRET ??= "b".repeat(48);
process.env.EMAIL_VERIFICATION_REQUIRED ??= "false";
process.env.LOG_LEVEL ??= "silent";
// Never touch a real database from tests.
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:1/test";

import { createMockPrisma } from "./mock-prisma";

(globalThis as Record<string, unknown>).prisma ??= createMockPrisma();
