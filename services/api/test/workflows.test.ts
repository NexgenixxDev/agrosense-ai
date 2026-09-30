import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Store, id, now } from "../src/db";
import { AppService, Actor } from "../src/service";
import { claim, processOne } from "../src/jobs";
import { analysisSchema } from "../src/schemas";
const farmer: Actor = { id: "farmer", name: "Farmer", roles: ["farmer"] };
const other: Actor = { id: "other", name: "Other", roles: ["farmer"] };
const advisor: Actor = { id: "advisor", name: "Advisor", roles: ["advisor"] };
const admin: Actor = { id: "admin", name: "Admin", roles: ["admin"] };
const reviewer: Actor = {
  id: "reviewer",
  name: "Reviewer",
  roles: ["reviewer"],
};
function setup() {
  const db = new Store(":memory:");
  for (const a of [farmer, other, advisor, admin, reviewer])
    db.run(
      "INSERT INTO users VALUES (?,?,?,?)",
      a.id,
      a.name,
      JSON.stringify(a.roles),
      now(),
    );
  return { db, s: new AppService(db) };
}
const submission = () => ({
  client_submission_id: id(),
  crop: "tomato",
  symptoms: {
    parts: "leaves",
    duration: "3 days",
    insects: "none seen",
    spread: "one plant",
    water: "rain-fed",
  },
  consent_version: "2026-09-29",
  training_consent: false,
});
const adviceInput = () => ({
  crop: "tomato",
  condition: "fixture_leaf_condition",
  title: "Example only",
  body: "Development content for the interface test.",
  sources: ["https://example.org/review"],
  development_only: true,
});
test("fields and idempotent case submissions enforce ownership and payload identity", () => {
  const { s, db } = setup();
  const f = s.createField(farmer, {
    name: "North field",
    crop: "tomato",
    region: "Oshana",
    production_type: "rain_fed",
  });
  const payload = { ...submission(), field_id: f.id };
  const c = s.createCase(farmer, payload);
  assert.equal(s.createCase(farmer, payload).id, c.id);
  assert.equal(s.listCases(farmer).length, 1);
  assert.throws(() => s.createCase(farmer, { ...payload, crop: "maize" }));
  assert.throws(() => s.createCase(other, payload));
  assert.throws(() => s.detail(other, c.id));
  assert.throws(() => s.detail(advisor, c.id));
  db.db.close();
});
test("farmer review request, admin assignment, advisor response and follow-up", () => {
  const { s, db } = setup();
  const c = s.createCase(farmer, submission());
  s.requestReview(farmer, c.id);
  assert.throws(() => s.assign(farmer, c.id, { advisor_id: advisor.id }));
  s.assign(admin, c.id, { advisor_id: advisor.id });
  assert.equal(s.listCases(advisor, "advisor").length, 1);
  assert.throws(() => s.respond(other, c.id, { response: "Unauthorized" }));
  s.respond(advisor, c.id, {
    response: "Please supply a whole-plant photograph.",
  });
  const result = s.detail(farmer, c.id);
  assert.equal(result.review_state, "responded");
  assert.equal(result.reviews.length, 1);
  const f = {
    client_id: id(),
    outcome: "same",
    notes: "Will take another photo",
  };
  s.followup(farmer, c.id, f);
  s.followup(farmer, c.id, f);
  assert.equal(s.detail(farmer, c.id).followups.length, 1);
  assert.throws(() => s.readImage(other, c.id, id()));
  db.db.close();
});
test("publishing is reviewer-only, versioned, and retires earlier guidance", () => {
  const { s, db } = setup();
  const first = s.createAdvice(admin, adviceInput());
  assert.throws(() => s.publish(admin, first.id));
  s.publish(reviewer, first.id);
  const second = s.createAdvice(admin, adviceInput());
  assert.equal(second.version, 2);
  s.publish(reviewer, second.id);
  assert.equal(
    db.one("SELECT state FROM advice WHERE id=?", first.id).state,
    "retired",
  );
  assert.equal(
    db.one("SELECT reviewer_id FROM advice WHERE id=?", second.id).reviewer_id,
    reviewer.id,
  );
  assert.throws(() => s.publish(reviewer, second.id));
  db.db.close();
});
test("private image upload, duplicate processing, lease recovery and immutable advice snapshot", async () => {
  const { s, db } = setup();
  const directory = mkdtempSync(join(tmpdir(), "agrosense-test-"));
  process.env.IMAGE_PATH = directory;
  try {
    const c = s.createCase(farmer, submission());
    assert.throws(() => s.queue(farmer, c.id));
    await assert.rejects(s.image(farmer, c.id, Buffer.from("fake")));
    const image = await sharp({
      create: { width: 250, height: 250, channels: 3, background: "#459348" },
    })
      .png()
      .toBuffer();
    const photo = await s.image(farmer, c.id, image);
    assert.equal((await s.image(farmer, c.id, image)).id, photo.id);
    const j = s.queue(farmer, c.id);
    assert.equal(s.queue(farmer, c.id).job_id, j.job_id);
    assert.equal(db.one("SELECT COUNT(*) AS n FROM jobs").n, 1);
    const a = s.createAdvice(admin, adviceInput());
    s.publish(reviewer, a.id);
    const response = {
      status: "accepted",
      mode: "fixture",
      model_version: "fixture-v1",
      candidates: [{ condition: "fixture_leaf_condition" }],
      reason: "Development fixture",
      quality_flags: ["development_only"],
    };
    await processOne(
      db,
      (async () => new Response(JSON.stringify(response))) as typeof fetch,
    );
    const result = s.detail(farmer, c.id);
    assert.equal(result.processing_state, "completed");
    assert.equal(result.advice.id, a.id);
    const newer = s.createAdvice(admin, adviceInput());
    s.publish(reviewer, newer.id);
    assert.equal(s.detail(farmer, c.id).advice.id, a.id);
    assert.equal(claim(db), null);
    assert.equal(s.queue(farmer, c.id).state, "completed");
  } finally {
    db.db.close();
    rmSync(directory, { recursive: true, force: true });
    delete process.env.IMAGE_PATH;
  }
});
test("expired jobs receive a new lease; active jobs cannot be double claimed", () => {
  const { s, db } = setup();
  const c = s.createCase(farmer, submission());
  db.run(
    "INSERT INTO jobs(id,case_id,available_at) VALUES (?,?,?)",
    id(),
    c.id,
    Date.now(),
  );
  const first = claim(db);
  assert.ok(first);
  assert.equal(claim(db), null);
  db.run("UPDATE jobs SET lease_until=?", Date.now() - 1);
  const second = claim(db);
  assert.notEqual(second.lease_token, first.lease_token);
  assert.equal(second.attempts, 2);
  db.db.close();
});
test("invalid provider contracts cannot produce accepted results", () => {
  assert.equal(
    analysisSchema.safeParse({
      status: "accepted",
      mode: "real",
      model_version: "v1",
      candidates: [],
      reason: "Bad",
      quality_flags: [],
    }).success,
    false,
  );
  assert.equal(
    analysisSchema.safeParse({
      status: "accepted",
      mode: "real",
      model_version: "v1",
      candidates: [{ condition: "x", confidence: 99 }],
      reason: "Bad",
      quality_flags: [],
    }).success,
    false,
  );
});
test("reminder synchronization is idempotent and isolated by owner", () => {
  const { s, db } = setup();
  const r = {
    client_id: id(),
    title: "Inspect leaves",
    due_at: new Date(Date.now() + 86400000).toISOString(),
  };
  s.reminder(farmer, r);
  s.reminder(farmer, { ...r, completed: true });
  assert.equal(s.reminders(farmer).length, 1);
  assert.equal(s.reminders(farmer)[0].completed, 1);
  assert.equal(s.reminders(other).length, 0);
  db.db.close();
});
test("hourly analysis limit counts queued jobs, not case age", () => {
  const { s, db } = setup();
  const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
  const cases = Array.from({ length: 21 }, (_, n) => {
    const c = s.createCase(farmer, submission());
    db.run("UPDATE cases SET created_at=? WHERE id=?", twoHoursAgo, c.id);
    db.run(
      "INSERT INTO images VALUES (?,?,?,?,?,?)",
      id(),
      c.id,
      "unused.jpg",
      "checksum-" + n,
      "image/jpeg",
      now(),
    );
    return c;
  });
  for (const c of cases.slice(0, 20)) s.queue(farmer, c.id);
  assert.throws(() => s.queue(farmer, cases[20].id), /Hourly analysis limit/);
  db.run("UPDATE jobs SET created_at=?", Date.now() - 2 * 3600000);
  assert.equal(s.queue(farmer, cases[20].id).state, "queued");
});
test("assignment requires a farmer's review request and never reopens a response", () => {
  const { s, db } = setup();
  const c = s.createCase(farmer, submission());
  assert.throws(
    () => s.assign(admin, c.id, { advisor_id: advisor.id }),
    /not requested a review/,
  );
  assert.equal(s.listCases(advisor, "advisor").length, 0);
  s.requestReview(farmer, c.id);
  s.assign(admin, c.id, { advisor_id: advisor.id });
  s.assign(admin, c.id, { advisor_id: advisor.id });
  s.respond(advisor, c.id, { response: "Please add a whole-plant photo." });
  assert.throws(
    () => s.assign(admin, c.id, { advisor_id: advisor.id }),
    /already been answered/,
  );
  assert.equal(s.detail(farmer, c.id).review_state, "responded");
  db.db.close();
});
test("Claude and Gemini results carry confidence and next steps through the contract", () => {
  const claude = {
    status: "accepted",
    model_version: "claude-opus-5-5",
    mode: "claude",
    candidates: [{ condition: "Early blight" }],
    reason: "Brown rings on the lower leaves.",
    quality_flags: ["ai_suggestion"],
    confidence: "medium",
    next_steps: ["Remove affected leaves"],
    plant: "Tomato",
  };
  assert.deepEqual(analysisSchema.parse(claude), claude);
  const gemini = {
    ...claude,
    mode: "gemini",
    model_version: "gemini-2.5-flash",
  };
  assert.deepEqual(analysisSchema.parse(gemini), gemini);
  assert.throws(() =>
    analysisSchema.parse({ ...claude, confidence: "certain" }),
  );
  assert.throws(() =>
    analysisSchema.parse({ ...claude, next_steps: Array(6).fill("step") }),
  );
});
test("a crop check can leave the crop for the AI to identify", () => {
  const { s, db } = setup();
  const c = s.createCase(farmer, { ...submission(), crop: "unknown" });
  assert.equal(c.crop, "unknown");
  assert.throws(() =>
    s.createCase(farmer, { ...submission(), crop: "cabbage" }),
  );
  assert.throws(() =>
    s.createField(farmer, {
      name: "North",
      crop: "unknown",
      region: "Oshana",
      production_type: "rain_fed",
    }),
  );
  db.db.close();
});
