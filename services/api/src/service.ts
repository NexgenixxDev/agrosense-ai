import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { Store, id, now } from "./db";
import { development } from "./config";
import { fieldInput, caseInput } from "./schemas";
export type Actor = { id: string; name: string; roles: string[] };
export class AppService {
  constructor(public db: Store) {}
  login(input: unknown) {
    if (!development())
      throw new ServiceUnavailableException(
        "Production identity provider is not configured. Development login is disabled.",
      );
    const { user_id } = z
      .object({
        user_id: z.enum([
          "farmer-demo",
          "farmer-other",
          "advisor-demo",
          "admin-demo",
          "reviewer-demo",
        ]),
      })
      .parse(input);
    const user = this.db.one("SELECT * FROM users WHERE id=?", user_id);
    if (!user) throw new NotFoundException("Run the development seed first");
    const token = randomBytes(32).toString("hex");
    this.db.run(
      "INSERT INTO sessions VALUES (?,?,?)",
      this.hash(token),
      user.id,
      new Date(Date.now() + 8 * 3600000).toISOString(),
    );
    return {
      token,
      expires_in: 28800,
      development_only: true,
      user: { ...user, roles: JSON.parse(user.roles) },
    };
  }
  hash(s: string) {
    return createHash("sha256").update(s).digest("hex");
  }
  actor(authorization?: string): Actor {
    if (!authorization?.startsWith("Bearer "))
      throw new UnauthorizedException();
    const user = this.db.one(
      "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
      this.hash(authorization.slice(7)),
      now(),
    );
    if (!user) throw new UnauthorizedException("Session expired");
    return { ...user, roles: JSON.parse(user.roles) };
  }
  role(actor: Actor, role: string) {
    if (!actor.roles.includes(role)) throw new ForbiddenException();
  }
  logout(authorization: string) {
    this.db.run(
      "DELETE FROM sessions WHERE token_hash=?",
      this.hash(authorization.slice(7)),
    );
    return { ok: true };
  }
  fields(a: Actor) {
    return this.db.all(
      "SELECT * FROM fields WHERE owner_id=? ORDER BY created_at DESC",
      a.id,
    );
  }
  createField(a: Actor, input: unknown) {
    this.role(a, "farmer");
    const v = fieldInput.parse(input);
    const key = id();
    this.db.run(
      "INSERT INTO fields VALUES (?,?,?,?,?,?,?,?)",
      key,
      a.id,
      v.name,
      v.crop,
      v.region,
      v.production_type,
      v.planting_date ?? null,
      now(),
    );
    return this.db.one("SELECT * FROM fields WHERE id=?", key);
  }
  createCase(a: Actor, input: unknown) {
    this.role(a, "farmer");
    const v = caseInput.parse(input);
    return this.db.tx(() => {
      if (
        v.field_id &&
        !this.db.one(
          "SELECT id FROM fields WHERE id=? AND owner_id=? AND crop=?",
          v.field_id,
          a.id,
          v.crop,
        )
      )
        throw new BadRequestException(
          "Field must belong to you and match the crop",
        );
      const existing = this.db.one(
        "SELECT * FROM cases WHERE owner_id=? AND client_submission_id=?",
        a.id,
        v.client_submission_id,
      );
      if (existing) {
        if (
          existing.crop !== v.crop ||
          existing.field_id !== (v.field_id ?? null) ||
          existing.symptoms !== JSON.stringify(v.symptoms) ||
          existing.training_consent !== Number(v.training_consent)
        )
          throw new ConflictException(
            "Submission ID already used for different content",
          );
        return this.detail(a, existing.id);
      }
      const key = id();
      this.db.run(
        "INSERT INTO cases (id,owner_id,client_submission_id,field_id,crop,symptoms,consent_version,training_consent,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        key,
        a.id,
        v.client_submission_id,
        v.field_id ?? null,
        v.crop,
        JSON.stringify(v.symptoms),
        v.consent_version,
        Number(v.training_consent),
        now(),
        now(),
      );
      this.db.audit(a.id, "case.created", key, {
        consent_version: v.consent_version,
        training_consent: v.training_consent,
      });
      return this.detail(a, key);
    });
  }
  case(a: Actor, key: string, ownerOnly = false) {
    const row = this.db.one("SELECT * FROM cases WHERE id=?", key);
    if (
      !row ||
      !(
        row.owner_id === a.id ||
        (!ownerOnly &&
          (a.roles.includes("admin") ||
            (a.roles.includes("advisor") && row.advisor_id === a.id)))
      )
    )
      throw new NotFoundException("Case not found");
    return row;
  }
  detail(a: Actor, key: string) {
    const row = this.case(a, key);
    return {
      ...row,
      symptoms: JSON.parse(row.symptoms),
      analysis: row.analysis ? JSON.parse(row.analysis) : null,
      advice: row.advice_id
        ? this.adviceRow(
            this.db.one("SELECT * FROM advice WHERE id=?", row.advice_id),
          )
        : null,
      images: this.db.all(
        "SELECT id,mime,created_at FROM images WHERE case_id=?",
        key,
      ),
      reviews: this.db.all(
        "SELECT * FROM reviews WHERE case_id=? ORDER BY created_at",
        key,
      ),
      followups: this.db.all(
        "SELECT * FROM followups WHERE case_id=? ORDER BY created_at",
        key,
      ),
    };
  }
  listCases(a: Actor, scope = "own") {
    if (scope === "advisor") {
      this.role(a, "advisor");
      return this.db.all(
        "SELECT * FROM cases WHERE advisor_id=? ORDER BY created_at DESC",
        a.id,
      );
    }
    if (scope === "admin") {
      this.role(a, "admin");
      return this.db.all("SELECT * FROM cases ORDER BY created_at DESC");
    }
    return this.db.all(
      "SELECT * FROM cases WHERE owner_id=? ORDER BY created_at DESC",
      a.id,
    );
  }
  async image(a: Actor, key: string, body: Buffer) {
    const row = this.case(a, key, true);
    if (
      !Buffer.isBuffer(body) ||
      body.length === 0 ||
      body.length > 8 * 1024 * 1024
    )
      throw new BadRequestException("Upload JPEG or PNG, at most 8 MB");
    let image: Buffer;
    try {
      const decoder = sharp(body, { limitInputPixels: 24000000 });
      const meta = await decoder.metadata();
      if (
        !["jpeg", "png"].includes(meta.format || "") ||
        !meta.width ||
        !meta.height ||
        Math.min(meta.width, meta.height) < 224
      )
        throw new Error();
      image = await decoder
        .rotate()
        .resize({
          width: 1600,
          height: 1600,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85 })
        .toBuffer();
    } catch {
      throw new BadRequestException(
        "Use a valid JPEG or PNG, at least 224 pixels on each side, under 24 megapixels",
      );
    }
    const checksum = this.hash(image.toString("base64"));
    return this.db.tx(() => {
      this.case(a, key, true);
      const previous = this.db.one(
        "SELECT id FROM images WHERE case_id=? AND checksum=?",
        key,
        checksum,
      );
      if (previous) return previous;
      const current = this.db.one(
        "SELECT processing_state FROM cases WHERE id=?",
        key,
      );
      if (!["draft", "uploading"].includes(current.processing_state))
        throw new ConflictException(
          "Create a follow-up case for new photos after processing",
        );
      if (
        this.db.one("SELECT COUNT(*) AS n FROM images WHERE case_id=?", key)
          .n >= 2
      )
        throw new BadRequestException("Maximum two photographs per case");
      const imageId = id();
      const directory = resolve(process.env.IMAGE_PATH || "../../data/images");
      mkdirSync(directory, { recursive: true });
      writeFileSync(resolve(directory, imageId + ".jpg"), image, {
        mode: 0o600,
      });
      this.db.run(
        "INSERT INTO images VALUES (?,?,?,?,?,?)",
        imageId,
        key,
        imageId + ".jpg",
        checksum,
        "image/jpeg",
        now(),
      );
      this.db.run(
        "UPDATE cases SET processing_state='uploading',updated_at=? WHERE id=?",
        now(),
        key,
      );
      return { id: imageId };
    });
  }
  readImage(a: Actor, key: string, imageId: string) {
    this.case(a, key);
    const row = this.db.one(
      "SELECT * FROM images WHERE id=? AND case_id=?",
      imageId,
      key,
    );
    if (!row) throw new NotFoundException();
    return readFileSync(
      resolve(process.env.IMAGE_PATH || "../../data/images", row.object_key),
    );
  }
  queue(a: Actor, key: string) {
    this.case(a, key, true);
    return this.db.tx(() => {
      const job = this.db.one("SELECT * FROM jobs WHERE case_id=?", key);
      if (job) return { state: job.state, job_id: job.id };
      if (!this.db.one("SELECT id FROM images WHERE case_id=?", key))
        throw new BadRequestException("Add a photograph first");
      if (
        this.db.one(
          "SELECT COUNT(*) AS n FROM jobs j JOIN cases c ON c.id=j.case_id WHERE c.owner_id=? AND c.created_at>?",
          a.id,
          new Date(Date.now() - 3600000).toISOString(),
        ).n >= 20
      )
        throw new BadRequestException("Hourly analysis limit reached");
      const jobId = id();
      this.db.run(
        "INSERT INTO jobs (id,case_id,available_at) VALUES (?,?,?)",
        jobId,
        key,
        Date.now(),
      );
      this.db.run(
        "UPDATE cases SET processing_state='queued',updated_at=? WHERE id=?",
        now(),
        key,
      );
      return { state: "queued", job_id: jobId };
    });
  }
  retry(a: Actor, key: string) {
    this.case(a, key, true);
    return this.db.tx(() => {
      const job = this.db.one("SELECT * FROM jobs WHERE case_id=?", key);
      if (!job || job.state !== "failed")
        throw new ConflictException("Only failed processing can be retried");
      this.db.run(
        "UPDATE jobs SET state='queued',attempts=0,available_at=?,last_error=NULL WHERE id=?",
        Date.now(),
        job.id,
      );
      this.db.run(
        "UPDATE cases SET processing_state='queued',updated_at=? WHERE id=?",
        now(),
        key,
      );
      return { state: "queued" };
    });
  }
  requestReview(a: Actor, key: string) {
    this.case(a, key, true);
    this.db.run(
      "UPDATE cases SET review_state=CASE WHEN review_state='not_requested' THEN 'requested' ELSE review_state END,updated_at=? WHERE id=?",
      now(),
      key,
    );
    return this.detail(a, key);
  }
  assign(a: Actor, key: string, input: unknown) {
    this.role(a, "admin");
    this.case(a, key);
    const v = z.object({ advisor_id: z.string() }).parse(input);
    const advisor = this.db.one("SELECT * FROM users WHERE id=?", v.advisor_id);
    if (!advisor || !JSON.parse(advisor.roles).includes("advisor"))
      throw new BadRequestException("Select an advisor");
    this.db.tx(() => {
      this.db.run(
        "UPDATE cases SET advisor_id=?,review_state='assigned',updated_at=? WHERE id=?",
        advisor.id,
        now(),
        key,
      );
      this.db.audit(a.id, "case.assigned", key, { advisor_id: advisor.id });
    });
    return this.detail(a, key);
  }
  respond(a: Actor, key: string, input: unknown) {
    this.role(a, "advisor");
    const row = this.case(a, key);
    if (row.advisor_id !== a.id) throw new ForbiddenException();
    const v = z
      .object({
        response: z.string().trim().min(5).max(4000),
        correction: z.string().trim().max(1000).optional(),
      })
      .strict()
      .parse(input);
    this.db.tx(() => {
      this.db.run(
        "INSERT INTO reviews VALUES (?,?,?,?,?,?)",
        id(),
        key,
        a.id,
        v.response,
        v.correction ?? null,
        now(),
      );
      this.db.run(
        "UPDATE cases SET review_state='responded',updated_at=? WHERE id=?",
        now(),
        key,
      );
      this.db.audit(a.id, "review.responded", key);
    });
    return this.detail(a, key);
  }
  followup(a: Actor, key: string, input: unknown) {
    this.case(a, key, true);
    const v = z
      .object({
        client_id: z.string().uuid(),
        outcome: z.enum(["improved", "same", "worsened"]),
        notes: z.string().max(2000),
      })
      .parse(input);
    this.db.run(
      "INSERT OR IGNORE INTO followups VALUES (?,?,?,?,?,?)",
      id(),
      key,
      v.client_id,
      v.outcome,
      v.notes,
      now(),
    );
    return this.detail(a, key);
  }
  reminders(a: Actor) {
    return this.db.all(
      "SELECT * FROM reminders WHERE owner_id=? ORDER BY due_at",
      a.id,
    );
  }
  reminder(a: Actor, input: unknown) {
    const v = z
      .object({
        client_id: z.string().uuid(),
        title: z.string().trim().min(1).max(160),
        due_at: z.string().datetime(),
        completed: z.boolean().default(false),
      })
      .parse(input);
    this.db.run(
      "INSERT INTO reminders VALUES (?,?,?,?,?,?,?) ON CONFLICT(owner_id,client_id) DO UPDATE SET title=excluded.title,due_at=excluded.due_at,completed=excluded.completed",
      id(),
      a.id,
      v.client_id,
      v.title,
      v.due_at,
      Number(v.completed),
      now(),
    );
    return this.reminders(a);
  }
  adviceRow(row: any) {
    return row ? { ...row, sources: JSON.parse(row.sources) } : null;
  }
  advice(a?: Actor) {
    if (a && (a.roles.includes("admin") || a.roles.includes("reviewer")))
      return this.db
        .all("SELECT * FROM advice ORDER BY created_at DESC")
        .map((r) => this.adviceRow(r));
    return this.db
      .all(
        "SELECT * FROM advice WHERE state='published' AND (development_only=0 OR ?=1)",
        development() ? 1 : 0,
      )
      .map((r) => this.adviceRow(r));
  }
  createAdvice(a: Actor, input: unknown) {
    if (!a.roles.some((r) => ["admin", "reviewer"].includes(r)))
      throw new ForbiddenException();
    const v = z
      .object({
        crop: z.enum(["tomato", "maize", "mahangu", "sorghum"]),
        condition: z.string().min(1).max(150),
        title: z.string().min(1).max(200),
        body: z.string().min(10).max(5000),
        sources: z.array(z.string().url()).min(1).max(10),
        development_only: z.boolean().default(true),
      })
      .strict()
      .parse(input);
    return this.db.tx(() => {
      const key = id();
      const version = this.db.one(
        "SELECT COALESCE(MAX(version),0)+1 AS v FROM advice WHERE crop=? AND condition=?",
        v.crop,
        v.condition,
      ).v;
      this.db.run(
        "INSERT INTO advice (id,crop,condition,version,title,body,sources,development_only,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
        key,
        v.crop,
        v.condition,
        version,
        v.title,
        v.body,
        JSON.stringify(v.sources),
        Number(v.development_only),
        now(),
      );
      this.db.audit(a.id, "advice.drafted", key);
      return this.adviceRow(
        this.db.one("SELECT * FROM advice WHERE id=?", key),
      );
    });
  }
  publish(a: Actor, key: string) {
    this.role(a, "reviewer");
    return this.db.tx(() => {
      const row = this.db.one("SELECT * FROM advice WHERE id=?", key);
      if (!row) throw new NotFoundException();
      if (row.state !== "draft")
        throw new ConflictException("Only drafts can be published");
      if (!row.development_only && development())
        throw new BadRequestException(
          "Development identities cannot approve production content",
        );
      this.db.run(
        "UPDATE advice SET state='retired' WHERE crop=? AND condition=? AND language=? AND state='published' AND development_only=?",
        row.crop,
        row.condition,
        row.language,
        row.development_only,
      );
      this.db.run(
        "UPDATE advice SET state='published',reviewer_id=?,reviewed_at=? WHERE id=?",
        a.id,
        now(),
        key,
      );
      this.db.audit(a.id, "advice.published", key);
      return this.adviceRow(
        this.db.one("SELECT * FROM advice WHERE id=?", key),
      );
    });
  }
  users(a: Actor) {
    this.role(a, "admin");
    return this.db
      .all("SELECT * FROM users")
      .map((u) => ({ ...u, roles: JSON.parse(u.roles) }));
  }
  audit(a: Actor) {
    this.role(a, "admin");
    return this.db.all(
      "SELECT * FROM audit ORDER BY created_at DESC LIMIT 200",
    );
  }
}
