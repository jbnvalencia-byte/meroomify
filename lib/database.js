import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const dbPath = resolve(
  process.env.ROOMIFY_DB || resolve(root, "data/roomify.sqlite"),
);
mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
export const db = new DatabaseSync(dbPath);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('renter', 'owner', 'admin')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS listings (
    id INTEGER PRIMARY KEY,
    owner_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    city TEXT NOT NULL,
    address TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price > 0),
    beds TEXT NOT NULL,
    bath TEXT NOT NULL,
    description TEXT NOT NULL,
    amenities TEXT NOT NULL,
    contact TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0,1)),
    review_note TEXT NOT NULL DEFAULT '',
    sample INTEGER NOT NULL DEFAULT 0,
    sample_photo TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS photos (
    id INTEGER PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    mime TEXT NOT NULL,
    bytes BLOB NOT NULL
  );
  CREATE TABLE IF NOT EXISTS favorites (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, listing_id)
  );
  CREATE TABLE IF NOT EXISTS inquiries (
    id INTEGER PRIMARY KEY,
    listing_id INTEGER NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    renter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    reply TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    replied_at TEXT
  );
  CREATE INDEX IF NOT EXISTS listing_owner ON listings(owner_id);
  CREATE INDEX IF NOT EXISTS inquiry_renter ON inquiries(renter_id);
  CREATE INDEX IF NOT EXISTS photo_listing ON photos(listing_id);
`);

export function transaction(fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function listing(row) {
  const result = {
    ...row,
    amenities: JSON.parse(row.amenities),
    available: !!row.available,
    sample: !!row.sample,
  };
  result.photos = db
    .prepare("SELECT id FROM photos WHERE listing_id = ? ORDER BY id")
    .all(row.id)
    .map((p) => `/api/photos/${p.id}`);
  if (row.sample_photo) result.photos = [row.sample_photo];
  delete result.sample_photo;
  return result;
}
export const listingQuery =
  "SELECT l.*, u.name AS owner FROM listings l JOIN users u ON u.id = l.owner_id";
