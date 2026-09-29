import "./config";
import { assertConfig } from "./config";
import { Store } from "./db";
import { processOne } from "./jobs";
assertConfig();
const db = new Store();
let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function run() {
  console.log("SQLite analysis worker ready");
  let failures = 0;
  while (!stopping) {
    let delay = 0;
    try {
      if (!(await processOne(db))) delay = 1000;
      failures = 0;
    } catch (e) {
      // e.g. SQLITE_BUSY past busy_timeout; the job's lease expires and it is reclaimed.
      failures++;
      delay = Math.min(30000, 1000 * 2 ** failures);
      console.error(
        "Worker iteration failed:",
        e instanceof Error ? e.message : "unknown",
      );
    }
    if (delay) await new Promise((r) => setTimeout(r, delay));
  }
  db.db.close();
}
void run();
