import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Store, id, now } from "./db";
import { analysisSchema } from "./schemas";
export function claim(db: Store) {
  return db.tx(() => {
    const job = db.one(
      "SELECT * FROM jobs WHERE (state='queued' AND available_at<=?) OR (state='processing' AND lease_until<?) ORDER BY available_at LIMIT 1",
      Date.now(),
      Date.now(),
    );
    if (!job) return null;
    if (job.attempts >= 3) {
      db.run(
        "UPDATE jobs SET state='failed',last_error='Retry limit reached' WHERE id=?",
        job.id,
      );
      db.run(
        "UPDATE cases SET processing_state='failed',updated_at=? WHERE id=?",
        now(),
        job.case_id,
      );
      return null;
    }
    const token = id();
    db.run(
      "UPDATE jobs SET state='processing',attempts=attempts+1,lease_until=?,lease_token=? WHERE id=?",
      Date.now() + 90000,
      token,
      job.id,
    );
    db.run(
      "UPDATE cases SET processing_state='processing',updated_at=? WHERE id=?",
      now(),
      job.case_id,
    );
    return { ...job, attempts: job.attempts + 1, lease_token: token };
  });
}
export async function processOne(db: Store, request: typeof fetch = fetch) {
  const job = claim(db);
  if (!job) return false;
  try {
    const row = db.one("SELECT * FROM cases WHERE id=?", job.case_id);
    const image = db.one(
      "SELECT * FROM images WHERE case_id=? ORDER BY created_at LIMIT 1",
      row.id,
    );
    if (!image) throw new Error("Missing photo");
    const response = await request(
      `${process.env.AI_URL || "http://127.0.0.1:8100"}/analyze`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Token":
            process.env.AI_SERVICE_TOKEN || "local-development-only",
          "Idempotency-Key": job.id,
        },
        body: JSON.stringify({
          case_id: row.id,
          crop: row.crop,
          image_base64: readFileSync(
            resolve(
              process.env.IMAGE_PATH || "../../data/images",
              image.object_key,
            ),
          ).toString("base64"),
        }),
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!response.ok) throw new Error("Inference service failed");
    const result = analysisSchema.parse(await response.json());
    if (process.env.NODE_ENV === "production" && result.mode === "fixture")
      throw new Error("Fixture result rejected");
    db.tx(() => {
      if (
        !db.one(
          "SELECT id FROM jobs WHERE id=? AND state='processing' AND lease_token=?",
          job.id,
          job.lease_token,
        )
      )
        return;
      let advice: any = null;
      if (result.status === "accepted")
        advice = db.one(
          "SELECT * FROM advice WHERE crop=? AND condition=? AND state='published' AND development_only=? ORDER BY version DESC LIMIT 1",
          row.crop,
          result.candidates[0].condition,
          result.mode === "fixture" ? 1 : 0,
        );
      db.run(
        "UPDATE cases SET processing_state='completed',analysis=?,advice_id=?,updated_at=? WHERE id=?",
        JSON.stringify(result),
        advice?.id ?? null,
        now(),
        row.id,
      );
      db.run(
        "UPDATE jobs SET state='completed',lease_until=NULL WHERE id=?",
        job.id,
      );
      db.audit(null, "analysis.completed", row.id, {
        mode: result.mode,
        status: result.status,
        model_version: result.model_version,
        advice_id: advice?.id ?? null,
      });
    });
  } catch {
    db.tx(() => {
      if (
        !db.one(
          "SELECT id FROM jobs WHERE id=? AND state='processing' AND lease_token=?",
          job.id,
          job.lease_token,
        )
      )
        return;
      const failed = job.attempts >= 3;
      db.run(
        "UPDATE jobs SET state=?,available_at=?,lease_until=NULL,last_error=? WHERE id=?",
        failed ? "failed" : "queued",
        Date.now() + 2 ** job.attempts * 5000,
        "Inference unavailable or invalid response",
        job.id,
      );
      db.run(
        "UPDATE cases SET processing_state=?,updated_at=? WHERE id=?",
        failed ? "failed" : "queued",
        now(),
        job.case_id,
      );
    });
  }
  return true;
}
