import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
const base = process.env.API_URL || "http://127.0.0.1:4100";
async function api(path, token, body, expected = 200) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  assert.ok(
    r.status === expected || (expected === 200 && r.status === 201),
    `${path}: ${r.status} ${JSON.stringify(value)}`,
  );
  return value;
}
const farmer = (await api("/auth/dev", null, { user_id: "farmer-demo" })).token;
const other = (await api("/auth/dev", null, { user_id: "farmer-other" })).token;
const admin = (await api("/auth/dev", null, { user_id: "admin-demo" })).token;
const advisor = (await api("/auth/dev", null, { user_id: "advisor-demo" }))
  .token;
const field = await api("/fields", farmer, {
  name: "E2E demo field",
  crop: "tomato",
  region: "Oshana",
  production_type: "rain_fed",
});
const body = {
  client_submission_id: randomUUID(),
  crop: "tomato",
  field_id: field.id,
  symptoms: {
    parts: "Leaves (development test)",
    duration: "3 days",
    insects: "None reported",
    spread: "One test plant",
    water: "Rain-fed",
  },
  consent_version: "2026-09-29",
  training_consent: false,
};
const c = await api("/cases", farmer, body);
assert.equal((await api("/cases", farmer, body)).id, c.id);
await api("/cases/" + c.id, other, undefined, 404);
// Synthetic test image, explicitly not a plant diagnosis.
const svg = Buffer.from(
  '<svg width="320" height="320"><rect width="320" height="320" fill="#edf2df"/><path d="M50 250 Q25 30 270 50 Q300 260 50 250" fill="#46834b"/><path d="M50 250 L250 70" stroke="#cad499" stroke-width="8"/></svg>',
);
const image = await sharp(svg).jpeg().toBuffer();
for (let i = 0; i < 2; i++) {
  const r = await fetch(`${base}/cases/${c.id}/images`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${farmer}`,
      "Content-Type": "image/jpeg",
    },
    body: image,
  });
  assert.equal(r.status, 201);
}
const job = await api(`/cases/${c.id}/analysis`, farmer, {});
assert.equal(
  (await api(`/cases/${c.id}/analysis`, farmer, {})).job_id,
  job.job_id,
);
let detail;
for (let i = 0; i < 60; i++) {
  detail = await api("/cases/" + c.id, farmer);
  if (detail.processing_state === "completed") break;
  await new Promise((r) => setTimeout(r, 1000));
}
assert.equal(detail.processing_state, "completed");
assert.ok(
  ["unavailable", "retake", "accepted"].includes(detail.analysis.status),
);
assert.notEqual(detail.analysis.mode, "real");
assert.equal(detail.images.length, 1);
if (detail.analysis.mode === "fixture") {
  assert.equal(detail.advice.development_only, 1);
  assert.equal(detail.advice.id, "fixture-advice");
}
await api(`/cases/${c.id}/review`, farmer, {});
await api(`/admin/cases/${c.id}/assignment`, admin, {
  advisor_id: "advisor-demo",
});
await api(`/advisor/cases/${c.id}/response`, advisor, {
  response:
    "Development test response: please add a whole-plant photo. This sample is not agronomic advice.",
});
const f = {
  client_id: randomUUID(),
  outcome: "same",
  notes: "Development follow-up test",
};
await api(`/cases/${c.id}/follow-ups`, farmer, f);
await api(`/cases/${c.id}/follow-ups`, farmer, f);
detail = await api("/cases/" + c.id, farmer);
assert.equal(detail.reviews.length, 1);
assert.equal(detail.followups.length, 1);
assert.equal(detail.review_state, "responded");
console.log(
  JSON.stringify(
    {
      passed: true,
      case_id: c.id,
      analysis_mode: detail.analysis.mode,
      analysis_status: detail.analysis.status,
      checks: [
        "real HTTP upload",
        "duplicate-safe submission/image/job/follow-up",
        "cross-farmer access denial",
        "worker persistence",
        "advisor assignment and response",
        "farmer response retrieval",
      ],
    },
    null,
    2,
  ),
);
