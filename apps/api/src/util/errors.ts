import { FastifyReply } from "fastify";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = "BAD_REQUEST") =>
  new ApiError(400, code, message);
export const unauthorized = (message = "Authentication required", code = "UNAUTHORIZED") =>
  new ApiError(401, code, message);
export const forbidden = (message = "Forbidden", code = "FORBIDDEN") =>
  new ApiError(403, code, message);
export const notFound = (message = "Not found", code = "NOT_FOUND") =>
  new ApiError(404, code, message);
export const conflict = (message: string, code = "CONFLICT") =>
  new ApiError(409, code, message);
export const tooMany = (message: string, code = "LIMIT_REACHED") =>
  new ApiError(429, code, message);

export function sendError(reply: FastifyReply, err: unknown): void {
  if (err instanceof ApiError) {
    void reply.status(err.statusCode).send({
      error: err.code,
      message: err.message,
    });
    return;
  }
  // Zod validation errors thrown by schema.parse() inside route handlers
  // (Fastify's own schema-validation errors carry `.validation`).
  if (err instanceof Error && err.name === "ZodError") {
    void reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: err.message,
    });
    return;
  }
  const anyErr = err as { validation?: unknown; message?: string };
  if (anyErr?.validation) {
    void reply.status(400).send({
      error: "VALIDATION_ERROR",
      message: err instanceof Error ? err.message : "Invalid request",
    });
    return;
  }
  throw err; // let the global error handler log it
}
