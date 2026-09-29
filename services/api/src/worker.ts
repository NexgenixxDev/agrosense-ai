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
  while (!stopping) {
    if (!(await processOne(db))) await new Promise((r) => setTimeout(r, 1000));
  }
  db.db.close();
}
void run();
