import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod/v4";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof ZodError) {
    req.log.warn({ err }, "Request validation failed");
    res.status(400).json({
      error: "Invalid request",
      details: err.issues,
    });
    return;
  }

  req.log.error({ err }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
};
