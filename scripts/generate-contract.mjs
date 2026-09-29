import { writeFileSync } from "node:fs";
const ref = (n) => ({ $ref: `#/components/schemas/${n}` });
const str = { type: "string" };
const uuid = { type: "string", format: "uuid" };
const obj = (properties, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const crop = {
  type: "string",
  enum: ["tomato", "maize", "mahangu", "sorghum"],
};
const schemas = {
  Error: obj({ statusCode: { type: "integer" }, message: str }),
  FieldInput: obj(
    {
      name: { type: "string", minLength: 1, maxLength: 100 },
      crop,
      region: { type: "string", minLength: 1, maxLength: 100 },
      production_type: { enum: ["rain_fed", "irrigated"] },
      planting_date: { type: ["string", "null"], format: "date" },
    },
    ["name", "crop", "region", "production_type"],
  ),
  Field: obj({
    id: uuid,
    owner_id: str,
    name: str,
    crop,
    region: str,
    production_type: { enum: ["rain_fed", "irrigated"] },
    planting_date: { type: ["string", "null"] },
    created_at: { type: "string", format: "date-time" },
  }),
  Symptoms: obj({
    parts: { type: "string", maxLength: 200 },
    duration: { type: "string", maxLength: 100 },
    insects: { type: "string", maxLength: 100 },
    spread: { type: "string", maxLength: 200 },
    water: { type: "string", maxLength: 200 },
  }),
  CaseInput: obj(
    {
      client_submission_id: uuid,
      field_id: { type: ["string", "null"], format: "uuid" },
      crop,
      symptoms: ref("Symptoms"),
      consent_version: { const: "2026-09-29" },
      training_consent: { type: "boolean", default: false },
    },
    ["client_submission_id", "crop", "symptoms", "consent_version"],
  ),
  Analysis: obj({
    status: {
      enum: ["accepted", "uncertain", "unsupported", "retake", "unavailable"],
    },
    model_version: str,
    mode: { enum: ["real", "fixture", "unavailable"] },
    candidates: { type: "array", maxItems: 3, items: obj({ condition: str }) },
    reason: str,
    quality_flags: { type: "array", items: str },
  }),
  Review: obj({
    id: uuid,
    case_id: uuid,
    advisor_id: str,
    response: str,
    correction: { type: ["string", "null"] },
    created_at: { type: "string", format: "date-time" },
  }),
  ResponseInput: obj(
    {
      response: { type: "string", minLength: 5, maxLength: 4000 },
      correction: { type: "string", maxLength: 1000 },
    },
    ["response"],
  ),
  FollowUpInput: obj({
    client_id: uuid,
    outcome: { enum: ["improved", "same", "worsened"] },
    notes: { type: "string", maxLength: 2000 },
  }),
  ReminderInput: obj(
    {
      client_id: uuid,
      title: { type: "string", minLength: 1, maxLength: 160 },
      due_at: { type: "string", format: "date-time" },
      completed: { type: "boolean", default: false },
    },
    ["client_id", "title", "due_at"],
  ),
  AdviceInput: obj(
    {
      crop,
      condition: { type: "string", minLength: 1, maxLength: 150 },
      title: { type: "string", minLength: 1, maxLength: 200 },
      body: { type: "string", minLength: 10, maxLength: 5000 },
      sources: {
        type: "array",
        minItems: 1,
        maxItems: 10,
        items: { type: "string", format: "uri" },
      },
      development_only: { type: "boolean", default: true },
    },
    ["crop", "condition", "title", "body", "sources"],
  ),
  Advice: obj({
    id: uuid,
    crop,
    condition: str,
    version: { type: "integer" },
    language: str,
    title: str,
    body: str,
    sources: { type: "array", items: str },
    state: { enum: ["draft", "published", "retired"] },
    development_only: { enum: [0, 1] },
    reviewer_id: { type: ["string", "null"] },
    reviewed_at: { type: ["string", "null"] },
    created_at: str,
  }),
  Case: {
    type: "object",
    required: ["id", "owner_id", "crop", "processing_state", "review_state"],
    properties: {
      id: uuid,
      owner_id: str,
      client_submission_id: uuid,
      field_id: { type: ["string", "null"] },
      crop,
      symptoms: ref("Symptoms"),
      processing_state: {
        enum: [
          "draft",
          "uploading",
          "queued",
          "processing",
          "completed",
          "failed",
        ],
      },
      review_state: {
        enum: ["not_requested", "requested", "assigned", "responded", "closed"],
      },
      advisor_id: { type: ["string", "null"] },
      analysis: { anyOf: [ref("Analysis"), { type: "null" }] },
      advice: { anyOf: [ref("Advice"), { type: "null" }] },
      images: {
        type: "array",
        items: obj({ id: uuid, mime: str, created_at: str }),
      },
      reviews: { type: "array", items: ref("Review") },
      followups: { type: "array", items: { type: "object" } },
      created_at: str,
      updated_at: str,
    },
  },
  User: obj({
    id: str,
    name: str,
    roles: {
      type: "array",
      items: { enum: ["farmer", "advisor", "admin", "reviewer"] },
    },
    created_at: str,
  }),
  Job: obj({
    state: { enum: ["queued", "processing", "completed", "failed"] },
    job_id: uuid,
  }),
};
const paths = {};
function route(
  path,
  method,
  summary,
  {
    input,
    output = { type: "object" },
    publicRoute = false,
    binary = false,
  } = {},
) {
  const op = {
    summary,
    operationId: method + path.replace(/[^a-zA-Z]/g, "_"),
    security: publicRoute ? [] : [{ bearerAuth: [] }],
    responses: {
      [method === "post" ? "201" : "200"]: {
        description: "Success",
        content: {
          [binary ? "image/jpeg" : "application/json"]: {
            schema: binary ? { type: "string", format: "binary" } : output,
          },
        },
      },
      400: {
        description: "Invalid input",
        content: { "application/json": { schema: ref("Error") } },
      },
      401: { description: "Session required" },
      403: { description: "Insufficient role" },
      404: { description: "Missing or unauthorized resource" },
      409: { description: "Invalid transition or conflicting idempotency key" },
    },
  };
  const params = [...path.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1],
    in: "path",
    required: true,
    schema: uuid,
  }));
  if (params.length) op.parameters = params;
  if (input)
    op.requestBody = {
      required: true,
      content: { "application/json": { schema: input } },
    };
  paths[path] ??= {};
  paths[path][method] = op;
  return op;
}
const array = (name) => ({ type: "array", items: ref(name) });
route("/health", "get", "Service health", { publicRoute: true });
route("/crops", "get", "Catalogue and explicit live inference coverage", {
  publicRoute: true,
  output: { type: "array", items: { type: "object" } },
});
route(
  "/auth/dev",
  "post",
  "Development-only session; never phone verification",
  {
    publicRoute: true,
    input: obj({
      user_id: {
        enum: [
          "farmer-demo",
          "farmer-other",
          "advisor-demo",
          "admin-demo",
          "reviewer-demo",
        ],
      },
    }),
  },
);
route("/auth/logout", "post", "Revoke current session");
route("/me", "get", "Current account", { output: ref("User") });
route("/fields", "get", "List own fields", { output: array("Field") });
route("/fields", "post", "Create owned field", {
  input: ref("FieldInput"),
  output: ref("Field"),
});
route(
  "/cases",
  "get",
  "List own cases (symptoms and analysis are serialized JSON in list rows)",
  { output: { type: "array", items: { type: "object" } } },
);
route(
  "/cases",
  "post",
  "Idempotent case creation; ownership and crop validated",
  { input: ref("CaseInput"), output: ref("Case") },
);
route("/cases/{id}", "get", "Authorized full case", { output: ref("Case") });
const upload = route(
  "/cases/{id}/images",
  "post",
  "Upload private JPEG/PNG, 8 MB limit; re-encoded and deduplicated by checksum",
  { output: obj({ id: uuid }) },
);
upload.requestBody = {
  required: true,
  content: {
    "image/jpeg": { schema: { type: "string", format: "binary" } },
    "image/png": { schema: { type: "string", format: "binary" } },
  },
};
route("/cases/{id}/images/{image}", "get", "Read authorized private photo", {
  binary: true,
});
route(
  "/cases/{id}/analysis",
  "post",
  "Queue exactly one analysis job per case",
  { output: ref("Job") },
);
route("/cases/{id}/retry", "post", "Retry failed analysis only");
route("/cases/{id}/review", "post", "Request advisor review", {
  output: ref("Case"),
});
route(
  "/cases/{id}/follow-ups",
  "post",
  "Record idempotent outcome observation",
  { input: ref("FollowUpInput"), output: ref("Case") },
);
route("/reminders", "get", "List own reminders", {
  output: { type: "array", items: { type: "object" } },
});
route("/reminders", "post", "Upsert own reminder by client ID", {
  input: ref("ReminderInput"),
  output: { type: "array", items: { type: "object" } },
});
route(
  "/advice",
  "get",
  "Published guidance; development content only in development mode",
  { publicRoute: true, output: array("Advice") },
);
route("/advisor/cases", "get", "Assigned cases only", {
  output: { type: "array", items: { type: "object" } },
});
route(
  "/advisor/cases/{id}/response",
  "post",
  "Assigned advisor response and optional correction with reason",
  { input: ref("ResponseInput"), output: ref("Case") },
);
route("/admin/cases", "get", "Administrator case queue", {
  output: { type: "array", items: { type: "object" } },
});
route("/admin/cases/{id}/assignment", "post", "Assign an advisor", {
  input: obj({ advisor_id: str }),
  output: ref("Case"),
});
route("/admin/users", "get", "Admin account directory", {
  output: array("User"),
});
route("/admin/audit", "get", "Latest 200 audit events", {
  output: { type: "array", items: { type: "object" } },
});
route("/admin/advice", "get", "Admin/reviewer guidance versions", {
  output: array("Advice"),
});
route("/admin/advice", "post", "Create immutable guidance draft", {
  input: ref("AdviceInput"),
  output: ref("Advice"),
});
route(
  "/admin/advice/{id}/publish",
  "post",
  "Reviewer-only publication; retire prior matching published version",
  { output: ref("Advice") },
);
writeFileSync(
  "packages/contracts/openapi.json",
  JSON.stringify(
    {
      openapi: "3.1.0",
      info: {
        title: "AgroSense API",
        version: "0.1.0",
        description:
          "Implemented development API. Production OTP, export/deletion and storage authorization endpoints are not yet implemented.",
      },
      servers: [{ url: "http://localhost:4100" }],
      paths,
      components: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
        schemas,
      },
    },
    null,
    2,
  ) + "\n",
);
console.log("Wrote the implemented OpenAPI surface.");
