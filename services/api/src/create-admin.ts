// Creates an admin account, or gives an existing account admin rights and a new
// password. Admins can only be made here, never from the app or the portal.
//   npm run create-admin -- --phone "081 234 5678" --name "Martin"
//   add --generate-to FILE to have a random password written to FILE instead
import "./config";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { Store, id, now } from "./db";
import { hashPassword, normalizePhone } from "./auth";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

// Reads a line without echoing it, so the password never appears on screen.
function secret(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    (rl as any)._writeToOutput = (s: string) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const phone = normalizePhone(arg("phone") ?? "");
  const name = (arg("name") ?? "").trim();
  if (!phone || !name) {
    console.error(
      'Usage: npm run create-admin -- --phone "081 234 5678" --name "Your name"',
    );
    process.exit(1);
  }
  // --generate-to FILE: make a random password and write it only to FILE
  // (owner-readable), so it is never typed, shown or kept in shell history.
  const target = arg("generate-to");
  let password: string;
  if (target) {
    password = randomBytes(12).toString("base64url");
    try {
      writeFileSync(
        target,
        `AgroSense admin\nPhone: ${phone}\nPassword: ${password}\n`,
        {
          mode: 0o600,
          flag: "wx",
        },
      );
    } catch {
      console.error(`Could not create ${target} (it may already exist).`);
      process.exit(1);
    }
  } else {
    password = await secret("New admin password (min 8 characters): ");
    if (password.length < 8) {
      console.error("Password must be at least 8 characters.");
      process.exit(1);
    }
    if ((await secret("Type it again: ")) !== password) {
      console.error("The passwords did not match.");
      process.exit(1);
    }
  }
  const db = new Store();
  const hash = await hashPassword(password);
  const existing = db.one("SELECT * FROM users WHERE phone=?", phone);
  if (existing) {
    const roles = [...new Set([...JSON.parse(existing.roles), "admin"])];
    db.run(
      "UPDATE users SET roles=?,password_hash=? WHERE id=?",
      JSON.stringify(roles),
      hash,
      existing.id,
    );
    // Sign out everywhere, so the old password's sessions stop working.
    db.run("DELETE FROM sessions WHERE user_id=?", existing.id);
    db.audit(null, "account.admin_granted", existing.id);
    console.log(`Updated ${phone}: admin rights and a new password.`);
  } else {
    const key = id();
    db.run(
      "INSERT INTO users (id,name,roles,created_at,phone,password_hash) VALUES (?,?,?,?,?,?)",
      key,
      name,
      JSON.stringify(["admin"]),
      now(),
      phone,
      hash,
    );
    db.audit(null, "account.admin_created", key);
    console.log(
      `Created admin ${name} (${phone}). Sign in to the portal with it.`,
    );
  }
  db.db.close();
}
void main();
