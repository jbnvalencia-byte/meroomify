import { scrypt, randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { db } from "./database.js";
const derive = promisify(scrypt);
export function fail(status, message) {
  const e = new Error(message);
  e.status = status;
  throw e;
}
export function text(value, name, max, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.trim().length > max
  )
    fail(400, `${name} must contain ${min}–${max} characters.`);
  return value.trim();
}
export function email(value) {
  const result = text(value, "Email", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    fail(400, "Enter a valid email address.");
  return result;
}
export function password(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 128)
    fail(400, "Use a password between 10 and 128 characters.");
  return value;
}
export async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const key = await derive(value, salt, 64);
  return `${salt}:${key.toString("hex")}`;
}
export async function verifyPassword(value, encoded) {
  const [salt, hash] = encoded.split(":");
  const key = await derive(value, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === key.length && timingSafeEqual(key, expected);
}
const digest = (value) => createHash("sha256").update(value).digest("hex");
const cookie = (value, age) =>
  `roomify_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${process.env.COOKIE_SECURE === "1" ? "; Secure" : ""}`;
export function createSession(res, userId) {
  const token = randomBytes(32).toString("hex");
  db.prepare("DELETE FROM sessions WHERE expires < ?").run(Date.now());
  db.prepare("INSERT INTO sessions VALUES (?, ?, ?)").run(
    digest(token),
    userId,
    Date.now() + 7 * 86400000,
  );
  res.setHeader("Set-Cookie", cookie(token, 7 * 86400));
}
export function sessionToken(req) {
  return (req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("roomify_session="))
    ?.slice(16);
}
export function userFor(req) {
  const token = sessionToken(req);
  if (!token) return null;
  return (
    db
      .prepare(
        `SELECT u.id, u.name, u.email, u.role FROM users u
    JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires > ?`,
      )
      .get(digest(token), Date.now()) || null
  );
}
export function logout(req, res) {
  const token = sessionToken(req);
  if (token)
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(digest(token));
  res.setHeader("Set-Cookie", cookie("", 0));
}
export function requireUser(req, role) {
  const user = userFor(req);
  if (!user) fail(401, "Please log in to continue.");
  if (role && user.role !== role)
    fail(403, `This action requires an ${role} account.`);
  return user;
}
// Bound both per-address activity and total work. Do not trust forwarded IP headers.
const attempts = new Map();
export function limit(key, max, windowMs = 15 * 60000) {
  const now = Date.now();
  for (const [k, value] of attempts) if (value.reset < now) attempts.delete(k);
  let entry = attempts.get(key);
  if (!entry) {
    if (attempts.size > 10000)
      fail(429, "Server is busy. Please try again later.");
    entry = { count: 0, reset: now + windowMs };
    attempts.set(key, entry);
  }
  if (++entry.count > max)
    fail(429, "Too many requests. Please try again later.");
}
