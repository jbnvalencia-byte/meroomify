import { db, listing, listingQuery, transaction } from "./database.js";
import { fail, text } from "./security.js";
export const types = [
  "Apartment",
  "Bed spacer",
  "Boarding house",
  "Room for rent",
  "Other spaces",
];
export const amenities = [
  "Wi-Fi",
  "Air conditioning",
  "Parking",
  "Kitchen",
  "Laundry",
  "Pet friendly",
];
export function getListing(id) {
  const row = db.prepare(`${listingQuery} WHERE l.id = ?`).get(id);
  if (!row) fail(404, "Property not found.");
  return row;
}
export function canView(row, user) {
  return (
    (row.status === "approved" && row.available) ||
    user?.id === row.owner_id ||
    user?.role === "admin"
  );
}
function photo(value) {
  if (typeof value !== "string" || value.length > 4.1 * 1024 * 1024)
    fail(400, "Each photo must be a JPEG or PNG up to 3 MB.");
  const match = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    value,
  );
  if (!match) fail(400, "Only JPEG and PNG images are supported.");
  const bytes = Buffer.from(match[2], "base64");
  const valid =
    match[1] === "png"
      ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid || bytes.length > 3 * 1024 * 1024 || bytes.length < 20)
    fail(400, "Invalid image or photo exceeds 3 MB.");
  return { mime: `image/${match[1]}`, bytes };
}
export function saveListing(user, body, id) {
  const existing = id ? getListing(id) : null;
  if (existing && (existing.owner_id !== user.id || existing.sample))
    fail(403, "You cannot edit this property.");
  if (existing && body.version !== existing.version)
    fail(409, "This property changed. Reopen it before saving.");
  const values = {
    title: text(body.title, "Property name", 100),
    type: body.type,
    city: text(body.city, "City", 100),
    address: text(body.address, "Address", 200),
    price: body.price,
    beds: text(body.beds, "Bedrooms or bed spaces", 60),
    bath: text(body.bath, "Bathrooms", 60),
    description: text(body.description, "Description", 4000, 20),
    contact: text(body.contact, "Public contact information", 200),
  };
  if (!types.includes(values.type)) fail(400, "Choose a valid property type.");
  if (
    !Number.isSafeInteger(values.price) ||
    values.price < 1 ||
    values.price > 1000000
  )
    fail(400, "Rent must be a whole peso amount from 1 to 1,000,000.");
  if (
    !Array.isArray(body.amenities) ||
    body.amenities.length > amenities.length ||
    !body.amenities.every((a) => amenities.includes(a))
  )
    fail(400, "Choose valid amenities.");
  const kept = body.keepPhotos ?? [];
  if (
    !Array.isArray(kept) ||
    kept.length > 4 ||
    !kept.every(Number.isSafeInteger) ||
    new Set(kept).size !== kept.length
  )
    fail(400, "Invalid existing photos.");
  const existingIds = existing
    ? db
        .prepare("SELECT id FROM photos WHERE listing_id = ?")
        .all(id)
        .map((p) => p.id)
    : [];
  if (!kept.every((p) => existingIds.includes(p)))
    fail(400, "Photo does not belong to this listing.");
  if (
    !Array.isArray(body.photos) ||
    body.photos.length + kept.length < 1 ||
    body.photos.length + kept.length > 4
  )
    fail(400, "Add 1–4 property photos.");
  const photos = body.photos.map(photo);
  if (existing && typeof body.available !== "boolean")
    fail(400, "Choose an availability status.");
  return transaction(() => {
    const params = [
      values.title,
      values.type,
      values.city,
      values.address,
      values.price,
      values.beds,
      values.bath,
      values.description,
      JSON.stringify([...new Set(body.amenities)]),
      values.contact,
    ];
    if (existing) {
      db.prepare(
        `UPDATE listings SET title=?, type=?, city=?, address=?, price=?, beds=?, bath=?, description=?, amenities=?, contact=?,
        status='pending', review_note='', available=?, version=version+1 WHERE id=?`,
      ).run(...params, body.available ? 1 : 0, id);
      for (const photoId of existingIds)
        if (!kept.includes(photoId))
          db.prepare("DELETE FROM photos WHERE id=?").run(photoId);
    } else {
      id = Number(
        db
          .prepare(
            `INSERT INTO listings (title,type,city,address,price,beds,bath,description,amenities,contact,owner_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .run(...params, user.id).lastInsertRowid,
      );
    }
    for (const p of photos)
      db.prepare(
        "INSERT INTO photos (listing_id,mime,bytes) VALUES (?,?,?)",
      ).run(id, p.mime, p.bytes);
    return listing(getListing(id));
  });
}
