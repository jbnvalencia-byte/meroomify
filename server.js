import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, root, listing, listingQuery } from "./lib/database.js";
import {
  fail,
  text,
  email,
  password,
  hashPassword,
  verifyPassword,
  createSession,
  logout,
  userFor,
  requireUser,
  limit,
} from "./lib/security.js";
import { getListing, canView, saveListing } from "./lib/listings.js";

const port = Number(process.env.PORT || 3001);
const publicOrigin = process.env.PUBLIC_ORIGIN
  ? new URL(process.env.PUBLIC_ORIGIN).origin
  : null;
const dummyHash = await hashPassword("timing-placeholder-not-an-account");

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}
async function body(req) {
  if (req.headers["content-type"]?.split(";")[0] !== "application/json")
    fail(415, "Send application/json.");
  const max = 17 * 1024 * 1024;
  if (Number(req.headers["content-length"]) > max)
    fail(413, "Upload is too large. Maximum: four 3 MB photos.");
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > max) fail(413, "Upload is too large.");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    fail(400, "Invalid JSON request.");
  }
}
function ownListing(req, id) {
  const user = requireUser(req, "owner"),
    row = getListing(id);
  if (row.owner_id !== user.id || row.sample)
    fail(403, "You cannot manage this property.");
  return row;
}
const staticFiles = new Map([
  ["/", ["index.html", "text/html"]],
  ["/roomify/", ["index.html", "text/html"]],
  ["/style.css", ["style.css", "text/css"]],
  ["/script.js", ["script.js", "text/javascript"]],
  ["/roomify/style.css", ["style.css", "text/css"]],
  ["/roomify/script.js", ["script.js", "text/javascript"]],
]);

if (process.env.ROOMIFY_DB_DIAGNOSTIC === "1") {
  const userCount = db.prepare("SELECT COUNT(*) AS count FROM users").get();
  console.log(`ROOMIFY DATABASE USERS: ${userCount.count}`);
}

if (process.env.ROOMIFY_CREATE_ADMIN === "1") {
  const adminEmail = process.env.ROOMIFY_ADMIN_EMAIL;
  const adminPassword = process.env.ROOMIFY_ADMIN_PASSWORD;
  const adminName = process.env.ROOMIFY_ADMIN_NAME || "Roomify Admin";

  const existing = db
    .prepare("SELECT id FROM users WHERE email=?")
    .get(adminEmail);

  if (!existing) {
    const hash = await hashPassword(adminPassword);

    db.prepare(
      "INSERT INTO users (name,email,password,role) VALUES (?,?,?,'admin')",
    ).run(adminName, adminEmail, hash);

    console.log(`ADMIN CREATED: ${adminEmail}`);
  } else {
    console.log(`ADMIN ALREADY EXISTS: ${adminEmail}`);
  }
}
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https://images.unsplash.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  );
  try {
    // With no configured public origin this is a local-only origin policy.
    // Host validation also prevents DNS-rebinding access to the local API.
    const host = req.headers.host || "";
    const allowedHost = publicOrigin ? new URL(publicOrigin).host : null;
    if (
      allowedHost
        ? host !== allowedHost
        : !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host)
    )
      fail(
        403,
        "Host is not configured. Set PUBLIC_ORIGIN for your deployment.",
      );
    const origin = publicOrigin || `http://${host}`;
    const url = new URL(req.url, origin);
    const path = url.pathname;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.headers.origin !== origin)
        fail(403, "Request origin is not allowed.");
      if (req.headers["sec-fetch-site"] === "cross-site")
        fail(403, "Cross-site requests are not allowed.");
      limit("write:" + req.socket.remoteAddress, 150, 60000);
    }
    if (
      (req.method === "GET" || req.method === "HEAD") &&
      staticFiles.has(path)
    ) {
      const [file, mime] = staticFiles.get(path);
      const content = await readFile(resolve(root, file));
      res.writeHead(200, { "Content-Type": `${mime}; charset=utf-8` });
      return res.end(req.method === "HEAD" ? undefined : content);
    }
    if (req.method === "GET" && path === "/api/health")
      return json(res, 200, { ok: true });
    if (req.method === "GET" && path === "/api/me")
      return json(res, 200, { user: userFor(req) });
    if (
      req.method === "POST" &&
      ["/api/register", "/api/login"].includes(path)
    ) {
      limit("auth:" + req.socket.remoteAddress, 30);
      limit("auth-global", 100, 60000);
      const data = await body(req);
      const address = email(data.email),
        secret = password(data.password);
      let user;
      if (path === "/api/register") {
        if (!["owner", "renter"].includes(data.role))
          fail(400, "Choose renter or property owner.");
        const name = text(data.name, "Name", 100);
        const hash = await hashPassword(secret);
        try {
          const result = db
            .prepare(
              "INSERT INTO users (name,email,password,role) VALUES (?,?,?,?)",
            )
            .run(name, address, hash, data.role);
          user = {
            id: Number(result.lastInsertRowid),
            name,
            email: address,
            role: data.role,
          };
        } catch (error) {
          if (error.message.includes("UNIQUE constraint"))
            fail(409, "An account with this email already exists.");
          throw error;
        }
      } else {
        const found = db
          .prepare("SELECT * FROM users WHERE email=?")
          .get(address);
        const valid = await verifyPassword(
          secret,
          found?.password || dummyHash,
        );
        if (!found || !valid) fail(401, "Email or password is incorrect.");
        user = {
          id: found.id,
          name: found.name,
          email: found.email,
          role: found.role,
        };
      }
      logout(req, res);
      createSession(res, user.id);
      return json(res, 200, { user });
    }
    if (req.method === "POST" && path === "/api/logout") {
      logout(req, res);
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && path === "/api/listings") {
      const scope = url.searchParams.get("scope");
      let where = "WHERE l.status='approved' AND l.available=1",
        params = [];
      if (scope === "owner") {
        const u = requireUser(req, "owner");
        where = "WHERE l.owner_id=?";
        params = [u.id];
      } else if (scope === "admin") {
        requireUser(req, "admin");
        where = "";
      } else if (scope) fail(400, "Unknown listing scope.");
      const items = db
        .prepare(`${listingQuery} ${where} ORDER BY l.id DESC`)
        .all(...params)
        .map(listing);
      return json(res, 200, { listings: items });
    }
    if (req.method === "POST" && path === "/api/listings") {
      const user = requireUser(req, "owner");
      limit("listing:" + user.id, 20, 3600000);
      return json(res, 201, { listing: saveListing(user, await body(req)) });
    }
    let match = /^\/api\/listings\/(\d+)$/.exec(path);
    if (match) {
      const id = Number(match[1]);
      if (req.method === "GET") {
        const row = getListing(id);
        if (!canView(row, userFor(req))) fail(404, "Property not found.");
        return json(res, 200, { listing: listing(row) });
      }
      if (req.method === "PUT") {
        const user = requireUser(req, "owner");
        return json(res, 200, {
          listing: saveListing(user, await body(req), id),
        });
      }
      if (req.method === "DELETE") {
        ownListing(req, id);
        db.prepare("DELETE FROM listings WHERE id=?").run(id);
        return json(res, 200, { ok: true });
      }
    }
    match = /^\/api\/listings\/(\d+)\/availability$/.exec(path);
    if (match && req.method === "PATCH") {
      const row = ownListing(req, Number(match[1])),
        data = await body(req);
      if (typeof data.available !== "boolean")
        fail(400, "Provide an availability status.");
      db.prepare(
        "UPDATE listings SET available=?, version=version+1 WHERE id=?",
      ).run(data.available ? 1 : 0, row.id);
      return json(res, 200, { ok: true });
    }
    match = /^\/api\/listings\/(\d+)\/review$/.exec(path);
    if (match && req.method === "PATCH") {
      requireUser(req, "admin");
      const row = getListing(Number(match[1])),
        data = await body(req);
      if (row.sample) fail(400, "Sample listings cannot be reviewed.");
      if (!["approved", "rejected"].includes(data.status))
        fail(400, "Choose approve or reject.");
      if (row.version !== data.version)
        fail(409, "The owner updated this listing. Reload before reviewing.");
      const note = text(
        data.note ?? "",
        "Review note",
        500,
        data.status === "rejected" ? 5 : 0,
      );
      db.prepare(
        "UPDATE listings SET status=?,review_note=?,version=version+1 WHERE id=?",
      ).run(data.status, note, row.id);
      return json(res, 200, { ok: true });
    }
    match = /^\/api\/photos\/(\d+)$/.exec(path);
    if (match && req.method === "GET") {
      const photo = db
        .prepare("SELECT * FROM photos WHERE id=?")
        .get(Number(match[1]));
      if (!photo || !canView(getListing(photo.listing_id), userFor(req)))
        fail(404, "Photo not found.");
      res.writeHead(200, {
        "Content-Type": photo.mime,
        "Content-Length": photo.bytes.length,
      });
      return res.end(Buffer.from(photo.bytes));
    }
    if (req.method === "GET" && path === "/api/favorites") {
      const user = requireUser(req);
      const ids = db
        .prepare(
          `SELECT f.listing_id FROM favorites f JOIN listings l ON l.id=f.listing_id
        WHERE f.user_id=? AND l.status='approved' AND l.available=1`,
        )
        .all(user.id)
        .map((p) => p.listing_id);
      return json(res, 200, { ids });
    }
    match = /^\/api\/favorites\/(\d+)$/.exec(path);
    if (match && ["PUT", "DELETE"].includes(req.method)) {
      const user = requireUser(req),
        id = Number(match[1]);
      if (req.method === "PUT") {
        const row = getListing(id);
        if (row.status !== "approved" || !row.available)
          fail(404, "Property is unavailable.");
        db.prepare("INSERT OR IGNORE INTO favorites VALUES (?,?)").run(
          user.id,
          id,
        );
      } else
        db.prepare(
          "DELETE FROM favorites WHERE user_id=? AND listing_id=?",
        ).run(user.id, id);
      return json(res, 200, { ok: true });
    }
    if (req.method === "GET" && path === "/api/inquiries") {
      const user = requireUser(req);
      const items = db
        .prepare(
          `SELECT i.*, l.title, l.city, u.name AS renter_name, o.name AS owner_name,
        l.owner_id FROM inquiries i JOIN listings l ON l.id=i.listing_id
        JOIN users u ON u.id=i.renter_id JOIN users o ON o.id=l.owner_id
        WHERE i.renter_id=? OR l.owner_id=? ORDER BY i.id DESC`,
        )
        .all(user.id, user.id);
      return json(res, 200, { inquiries: items });
    }
    if (req.method === "POST" && path === "/api/inquiries") {
      const user = requireUser(req, "renter"),
        data = await body(req);
      if (!Number.isSafeInteger(data.listingId))
        fail(400, "Select a property.");
      const row = getListing(data.listingId);
      if (row.status !== "approved" || !row.available || row.sample)
        fail(400, "This property is not accepting inquiries.");
      const message = text(data.message, "Message", 2000, 5);
      limit("inquiry:" + user.id, 20, 3600000);
      const result = db
        .prepare(
          "INSERT INTO inquiries (listing_id,renter_id,message) VALUES (?,?,?)",
        )
        .run(row.id, user.id, message);
      return json(res, 201, { id: Number(result.lastInsertRowid) });
    }
    match = /^\/api\/inquiries\/(\d+)\/reply$/.exec(path);
    if (match && req.method === "PATCH") {
      const user = requireUser(req, "owner");
      const inquiry = db
        .prepare(
          "SELECT i.id,l.owner_id FROM inquiries i JOIN listings l ON l.id=i.listing_id WHERE i.id=?",
        )
        .get(Number(match[1]));
      if (!inquiry || inquiry.owner_id !== user.id)
        fail(404, "Inquiry not found.");
      const data = await body(req),
        reply = text(data.reply, "Reply", 2000, 5);
      db.prepare(
        "UPDATE inquiries SET reply=?,replied_at=CURRENT_TIMESTAMP WHERE id=?",
      ).run(reply, inquiry.id);
      return json(res, 200, { ok: true });
    }
    fail(404, "Not found.");
  } catch (error) {
    if (!error.status) console.error("Request failed:", error.message);
    if (!res.headersSent)
      json(res, error.status || 500, {
        error: error.status
          ? error.message
          : "Something went wrong. Please try again.",
      });
    else res.end();
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 15000;
server.listen(port, process.env.HOST || "127.0.0.1", () =>
  console.log(
    `Roomify ready at ${publicOrigin || `http://localhost:${server.address().port}`}/roomify/`,
  ),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
