import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod/v4";
import { ZodError as ZodErrorV3 } from "zod";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  // Generated @workspace/api-zod schemas use zod v3; other code uses zod/v4.
  if (err instanceof ZodError || err instanceof ZodErrorV3) {
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
