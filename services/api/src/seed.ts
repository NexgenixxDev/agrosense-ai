import "./config";
import { development } from "./config";
import { Store, now } from "./db";
if (!development())
  throw new Error("Seed requires DEV_AUTH=true outside production");
const db = new Store();
for (const [id, name, roles] of [
  ["farmer-demo", "Maria • demo farmer", ["farmer"]],
  ["farmer-other", "Other demo farmer", ["farmer"]],
  ["advisor-demo", "Daniel • demo advisor", ["advisor"]],
  ["admin-demo", "Demo administrator", ["admin"]],
  ["reviewer-demo", "Demo content reviewer", ["reviewer"]],
] as const)
  db.run(
    "INSERT OR IGNORE INTO users VALUES (?,?,?,?)",
    id,
    name,
    JSON.stringify(roles),
    now(),
  );
db.run(
  "INSERT OR IGNORE INTO advice (id,crop,condition,version,title,body,sources,state,development_only,reviewer_id,reviewed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  "fixture-advice",
  "tomato",
  "fixture_leaf_condition",
  1,
  "Development example — inspect and request review",
  "This is sample interface content, not agronomic treatment advice. Photograph the whole plant and request an advisor review. No disease has been diagnosed.",
  JSON.stringify(["Development fixture; not approved for field use"]),
  "published",
  1,
  "reviewer-demo",
  now(),
  now(),
);
console.log(
  "Development accounts and clearly marked sample content seeded. No crop cases or diagnostic claims were fabricated.",
);
