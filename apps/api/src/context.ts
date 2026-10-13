import { PrismaClient } from "./generated/prisma/index.js";
import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === "production" ? "info" : "debug"),
  redact: {
    paths: [
      "req.headers.cookie",
      "password",
      "*.password",
      "*.privateKey",
      "*.passphrase",
      "*.token",
      "*.tokenHash",
    ],
    censor: "[REDACTED]",
  },
});

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ["error", "warn"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
