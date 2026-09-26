import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { db, transaction } from "./lib/database.js";
import { email, text, password, hashPassword } from "./lib/security.js";

async function prompt(label, secret = false) {
  // Suppress echo for passwords on terminals. Environment input is available for automation.
  let muted = false;
  const output = new Writable({
    write(chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });
  const rl = createInterface({
    input: process.stdin,
    output,
    terminal: !!process.stdin.isTTY,
  });
  process.stdout.write(label);
  muted = secret;
  try {
    return await rl.question("");
  } finally {
    rl.close();
    if (secret) process.stdout.write("\n");
  }
}
try {
  if (process.argv[2] === "admin") {
    const name = text(
      process.env.ROOMIFY_ADMIN_NAME || (await prompt("Admin name: ")),
      "Name",
      100,
    );
    const address = email(
      process.env.ROOMIFY_ADMIN_EMAIL || (await prompt("Admin email: ")),
    );
    const secret = password(
      process.env.ROOMIFY_ADMIN_PASSWORD ||
        (await prompt("Admin password (10+ characters): ", true)),
    );
    if (db.prepare("SELECT id FROM users WHERE email=?").get(address))
      throw new Error(
        "Email already exists. Use a new email; existing accounts are not elevated.",
      );
    const hash = await hashPassword(secret);
    db.prepare(
      "INSERT INTO users (name,email,password,role) VALUES (?,?,?,'admin')",
    ).run(name, address, hash);
    console.log("Admin account created. Log in through the website.");
  } else if (process.argv[2] === "seed") {
    if (db.prepare("SELECT id FROM listings WHERE sample=1").get())
      throw new Error("Sample listings already exist.");
    const demo = JSON.parse(
      readFileSync(new URL("./lib/demo.json", import.meta.url), "utf8"),
    );
    const hash = await hashPassword(randomBytes(48).toString("hex"));
    transaction(() => {
      const result = db
        .prepare(
          "INSERT INTO users (name,email,password,role) VALUES ('Roomify examples',? ,?,'owner')",
        )
        .run(`sample-${randomBytes(8).toString("hex")}@example.invalid`, hash);
      for (const p of demo)
        db.prepare(
          `INSERT INTO listings (owner_id,title,type,city,address,price,beds,bath,description,amenities,contact,status,sample,sample_photo)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'approved',1,?)`,
        ).run(
          Number(result.lastInsertRowid),
          p.title,
          p.type,
          p.city,
          "Illustrative location",
          p.price,
          p.beds,
          p.bath,
          "Fictional sample listing with an illustrative photo. Create an owner account to publish your own property after admin approval.",
          JSON.stringify(p.amenities),
          "No live contact — sample listing",
          `https://images.unsplash.com/${p.photo}?auto=format&fit=crop&w=1000&q=85`,
        );
    });
    console.log("Six sample listings added. These cannot receive inquiries.");
  } else throw new Error("Use npm run admin or npm run seed.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  db.close();
}
