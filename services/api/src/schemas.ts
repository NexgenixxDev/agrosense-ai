import { z } from "zod";
export const crop = z.enum(["tomato", "maize", "mahangu", "sorghum"]);
// A crop check may leave the crop to the AI, which then names the plant in its result.
export const caseCrop = z.union([crop, z.literal("unknown")]);
export const fieldInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    crop,
    region: z.string().trim().min(1).max(100),
    production_type: z.enum(["rain_fed", "irrigated"]),
    planting_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
  })
  .strict();
export const caseInput = z
  .object({
    client_submission_id: z.string().uuid(),
    field_id: z.string().uuid().nullable().optional(),
    crop: caseCrop,
    symptoms: z
      .object({
        parts: z.string().max(200),
        duration: z.string().max(100),
        insects: z.string().max(100),
        spread: z.string().max(200),
        water: z.string().max(200),
      })
      .strict(),
    consent_version: z.literal("2026-09-29"),
    training_consent: z.boolean().default(false),
  })
  .strict();
export const analysisSchema = z
  .object({
    status: z.enum([
      "accepted",
      "uncertain",
      "unsupported",
      "retake",
      "unavailable",
    ]),
    model_version: z.string().min(1).max(150),
    mode: z.enum(["real", "fixture", "unavailable", "claude", "gemini"]),
    candidates: z
      .array(z.object({ condition: z.string().min(1).max(150) }).strict())
      .max(3),
    reason: z.string().min(1).max(1000),
    quality_flags: z.array(z.string()).max(10),
    confidence: z.enum(["low", "medium", "high"]).nullable().optional(),
    next_steps: z.array(z.string().max(300)).max(5).optional(),
    plant: z.string().min(1).max(100).nullable().optional(),
  })
  .strict()
  .superRefine((v, c) => {
    if (
      v.status === "accepted" &&
      (!v.candidates.length || v.mode === "unavailable")
    )
      c.addIssue({
        code: "custom",
        message: "Accepted result requires a real or fixture candidate",
      });
  });
