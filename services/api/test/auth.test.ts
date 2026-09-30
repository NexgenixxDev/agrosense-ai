import { test } from "node:test";
import assert from "node:assert/strict";
import { Store, now } from "../src/db";
import { AppService } from "../src/service";
import { hashPassword, normalizePhone, verifyPassword } from "../src/auth";

const setup = () => {
  const db = new Store(":memory:");
  return { db, s: new AppService(db) };
};
const signUp = {
  name: "Anna",
  phone: "081 234 5678",
  password: "green-leaf-42",
};

test("phone numbers have one spelling per number", () => {
  for (const raw of [
    "081 234 5678",
    "+264 81 234 5678",
    "264812345678",
    "00264812345678",
  ])
    assert.equal(normalizePhone(raw), "+264812345678");
  assert.equal(normalizePhone("+27 82 123 4567"), "+27821234567");
  for (const bad of ["", "12345", "abc", "+0123456789"])
    assert.equal(normalizePhone(bad), null);
});

test("passwords are salted scrypt hashes that verify only the right password", async () => {
  const a = await hashPassword("green-leaf-42");
  const b = await hashPassword("green-leaf-42");
  assert.notEqual(a, b);
  assert.match(a, /^scrypt:16384:8:1:/);
  assert.ok(!a.includes("green-leaf-42"));
  assert.equal(await verifyPassword("green-leaf-42", a), true);
  assert.equal(await verifyPassword("green-leaf-43", a), false);
  assert.equal(await verifyPassword("anything", null), false);
});

test("a farmer signs up, signs in by any spelling of the number, and never sees a hash", async () => {
  const { s, db } = setup();
  const reg = await s.register(signUp, "1.1.1.1");
  assert.deepEqual(reg.user.roles, ["farmer"]);
  assert.equal(reg.user.phone, "+264812345678");
  assert.equal(reg.expires_in, 30 * 24 * 3600);
  const login = await s.passwordLogin({
    phone: "+264812345678",
    password: "green-leaf-42",
  });
  const me = s.actor(`Bearer ${login.token}`);
  assert.equal(me.name, "Anna");
  assert.ok(!JSON.stringify(me).includes("scrypt"));
  await assert.rejects(
    s.register({ ...signUp, name: "Other" }),
    /already exists/,
  );
  await assert.rejects(
    s.register({ ...signUp, phone: "+264 81 999 0000", password: "short" }),
  );
  await assert.rejects(
    s.register({ ...signUp, phone: "12" }),
    /phone number like/,
  );
  db.db.close();
});

test("wrong passwords get one message and lock the number after five tries", async () => {
  const { s, db } = setup();
  await s.register(signUp, "1.1.1.1");
  await assert.rejects(
    s.passwordLogin({ phone: "0811112222", password: "x" }),
    /incorrect/,
  );
  for (let i = 0; i < 5; i++)
    await assert.rejects(
      s.passwordLogin(
        { phone: "0812345678", password: "wrong-password" },
        "2.2.2.2",
      ),
      /Phone number or password is incorrect/,
    );
  // Locked: even the right password is refused until the window passes.
  await assert.rejects(
    s.passwordLogin(
      { phone: "0812345678", password: "green-leaf-42" },
      "2.2.2.2",
    ),
    (e: any) => e.getStatus() === 429,
  );
  db.run(
    "UPDATE auth_attempts SET window_start=? WHERE key=?",
    Date.now() - 16 * 60000,
    "login:+264812345678",
  );
  assert.ok(
    (await s.passwordLogin({ phone: "0812345678", password: "green-leaf-42" }))
      .token,
  );
  db.db.close();
});

test("admins get short sessions, and the people list hides password hashes", async () => {
  const { s, db } = setup();
  db.run(
    "INSERT INTO users (id,name,roles,created_at,phone,password_hash) VALUES (?,?,?,?,?,?)",
    "admin-1",
    "Admin",
    JSON.stringify(["admin"]),
    now(),
    "+264811111111",
    await hashPassword("admin-pass-1"),
  );
  const login = await s.passwordLogin({
    phone: "081 111 1111",
    password: "admin-pass-1",
  });
  assert.equal(login.expires_in, 8 * 3600);
  await s.register(signUp);
  const people = s.users(s.actor(`Bearer ${login.token}`));
  assert.equal(people.length, 2);
  assert.ok(!JSON.stringify(people).includes("scrypt"));
  db.db.close();
});

test("sign-ups from one address are limited to ten an hour", async () => {
  const { s, db } = setup();
  for (let i = 0; i < 10; i++)
    await s.register({ ...signUp, phone: `+26481000000${i}` }, "3.3.3.3");
  await assert.rejects(
    s.register({ ...signUp, phone: "+264810000099" }, "3.3.3.3"),
    (e: any) => e.getStatus() === 429,
  );
  db.db.close();
});
