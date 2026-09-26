import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { get } from "node:http";
import { randomBytes } from "node:crypto";

const cwd = fileURLToPath(new URL("../", import.meta.url));
const image =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";

test(
  "Roomify persistent workflows and access boundaries",
  { timeout: 60000 },
  async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "roomify-test-"));
    const secret = randomBytes(20).toString("hex");
    const env = {
      ...process.env,
      ROOMIFY_DB: join(dir, "test.sqlite"),
      PORT: "0",
      HOST: "127.0.0.1",
      PUBLIC_ORIGIN: "",
      COOKIE_SECURE: "0",
    };
    execFileSync(process.execPath, ["manage.js", "admin"], {
      cwd,
      env: {
        ...env,
        ROOMIFY_ADMIN_NAME: "Test admin",
        ROOMIFY_ADMIN_EMAIL: "admin@example.test",
        ROOMIFY_ADMIN_PASSWORD: secret,
      },
      stdio: "pipe",
    });
    let server, origin;
    async function start() {
      server = spawn(process.execPath, ["server.js"], {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      origin = await new Promise((resolve, reject) => {
        let output = "";
        const timeout = setTimeout(
          () => reject(new Error("Server did not start")),
          10000,
        );
        server.stdout.on("data", (data) => {
          output += data;
          const match = /http:\/\/localhost:(\d+)/.exec(output);
          if (match) {
            clearTimeout(timeout);
            resolve(`http://localhost:${match[1]}`);
          }
        });
        server.once("error", (error) => {
          clearTimeout(timeout);
          reject(error);
        });
        server.once("exit", (code) => {
          clearTimeout(timeout);
          reject(new Error("Server exited: " + code));
        });
      });
    }
    async function stop() {
      const done = once(server, "exit");
      server.kill("SIGTERM");
      await done;
    }
    t.after(async () => {
      if (server?.exitCode === null) await stop();
      rmSync(dir, { recursive: true, force: true });
    });
    await start();
    const clients = {};
    async function request(
      path,
      { as, method = "GET", body, status = 200, headers = {} } = {},
    ) {
      const response = await fetch(origin + path, {
        method,
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          ...(clients[as] ? { Cookie: clients[as] } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      assert.equal(
        response.status,
        status,
        `${method} ${path}: ${JSON.stringify(data)}`,
      );
      if (as && response.headers.get("set-cookie"))
        clients[as] = response.headers.get("set-cookie").split(";")[0];
      return { data, response };
    }
    let id, photoId, inquiryId;
    const payload = {
      title: "Test <script> home",
      type: "Apartment",
      city: "Calamba, Laguna",
      address: "Synthetic neighborhood",
      price: 7500,
      beds: "1 bedroom",
      bath: "1 bath",
      description: "A synthetic rental used to verify the entire workflow.",
      contact: "owner@example.test",
      amenities: ["Wi-Fi", "Kitchen"],
      photos: [image],
    };
    await t.test(
      "registration, session cookies, role checks and origin protection",
      async () => {
        await request("/api/register", {
          method: "POST",
          body: {
            name: "Bad",
            email: "bad@example.test",
            password: secret,
            role: "admin",
          },
          status: 400,
        });
        await request("/api/register", {
          method: "POST",
          body: {
            name: "Bad",
            email: "invalid",
            password: secret,
            role: "owner",
          },
          status: 400,
        });
        for (const [as, role] of [
          ["owner", "owner"],
          ["other", "owner"],
          ["renter", "renter"],
          ["stranger", "renter"],
        ]) {
          const { response } = await request("/api/register", {
            as,
            method: "POST",
            body: {
              name: as,
              email: as + "@example.test",
              password: secret,
              role,
            },
          });
          assert.match(
            response.headers.get("set-cookie"),
            /HttpOnly; SameSite=Strict/,
          );
        }
        await request("/api/register", {
          method: "POST",
          body: {
            name: "Duplicate",
            email: "OWNER@example.test",
            password: secret,
            role: "owner",
          },
          status: 409,
        });
        await request("/api/login", {
          method: "POST",
          body: { email: "owner@example.test", password: "incorrect-password" },
          status: 401,
        });
        await request("/api/login", {
          as: "admin",
          method: "POST",
          body: { email: "admin@example.test", password: secret },
        });
        await request("/api/listings?scope=admin", {
          as: "owner",
          status: 403,
        });
        await request("/api/listings", {
          method: "POST",
          body: payload,
          status: 401,
        });
        await request("/api/listings", {
          as: "renter",
          method: "POST",
          body: payload,
          status: 403,
        });
        await request("/api/listings", {
          as: "owner",
          method: "POST",
          body: payload,
          headers: { Origin: "https://untrusted.example" },
          status: 403,
        });
        const hostStatus = await new Promise((resolve, reject) => {
          get(
            origin + "/api/health",
            { headers: { Host: "untrusted.example" } },
            (response) => {
              response.resume();
              resolve(response.statusCode);
            },
          ).on("error", reject);
        });
        assert.equal(hostStatus, 403);
        for (const path of [
          "/data/roomify.sqlite",
          "/server.js",
          "/lib/database.js",
          "/package.json",
        ])
          await request(path, { status: 404 });
      },
    );
    await t.test(
      "photo validation, pending visibility and owner isolation",
      async () => {
        await request("/api/listings", {
          as: "owner",
          method: "POST",
          body: { ...payload, photos: ["data:image/svg+xml;base64,PHN2Zy8+"] },
          status: 400,
        });
        await request("/api/listings", {
          as: "owner",
          method: "POST",
          body: {
            ...payload,
            photos: [
              "data:image/png;base64," +
                Buffer.from("this is not a png image").toString("base64"),
            ],
          },
          status: 400,
        });
        await request("/api/listings", {
          as: "owner",
          method: "POST",
          body: { ...payload, price: -1 },
          status: 400,
        });
        await request("/api/listings", {
          as: "owner",
          method: "POST",
          body: { ...payload, photos: [] },
          status: 400,
        });
        const { data } = await request("/api/listings", {
          as: "owner",
          method: "POST",
          body: payload,
          status: 201,
        });
        id = data.listing.id;
        photoId = Number(data.listing.photos[0].split("/").pop());
        assert.equal(data.listing.status, "pending");
        assert.equal((await request("/api/listings")).data.listings.length, 0);
        await request("/api/listings/" + id, { status: 404 });
        await request("/api/photos/" + photoId, { status: 404 });
        await request("/api/listings/" + id, {
          as: "other",
          method: "PUT",
          body: { ...payload, version: 1 },
          status: 403,
        });
        await request("/api/listings/" + id, {
          as: "other",
          method: "DELETE",
          status: 403,
        });
        await request(`/api/listings/${id}/review`, {
          as: "owner",
          method: "PATCH",
          body: { status: "approved", version: 1 },
          status: 403,
        });
        assert.equal(
          (await request("/api/listings?scope=other", { status: 400 })).response
            .status,
          400,
        );
      },
    );
    await t.test(
      "admin feedback, owner resubmission and stale review prevention",
      async () => {
        await request(`/api/listings/${id}/review`, {
          as: "admin",
          method: "PATCH",
          body: { status: "rejected", version: 1, note: "" },
          status: 400,
        });
        await request(`/api/listings/${id}/review`, {
          as: "admin",
          method: "PATCH",
          body: {
            status: "rejected",
            version: 1,
            note: "Please confirm the address.",
          },
        });
        let p = (await request("/api/listings/" + id, { as: "owner" })).data
          .listing;
        assert.equal(p.status, "rejected");
        const updated = {
          ...payload,
          photos: [],
          keepPhotos: [photoId],
          available: true,
          version: p.version,
        };
        await request("/api/listings/" + id, {
          as: "owner",
          method: "PUT",
          body: { ...updated, keepPhotos: [99999] },
          status: 400,
        });
        p = (
          await request("/api/listings/" + id, {
            as: "owner",
            method: "PUT",
            body: updated,
          })
        ).data.listing;
        assert.equal(p.status, "pending");
        await request("/api/listings/" + id, {
          as: "owner",
          method: "PUT",
          body: updated,
          status: 409,
        });
        await request(`/api/listings/${id}/review`, {
          as: "admin",
          method: "PATCH",
          body: { status: "approved", version: 1 },
          status: 409,
        });
        await request(`/api/listings/${id}/review`, {
          as: "admin",
          method: "PATCH",
          body: { status: "approved", version: p.version },
        });
        assert.equal((await request("/api/listings")).data.listings.length, 1);
        const imageResponse = await fetch(origin + "/api/photos/" + photoId);
        assert.equal(imageResponse.status, 200);
        assert.equal(imageResponse.headers.get("content-type"), "image/png");
      },
    );
    await t.test("favorites and private inquiry / reply delivery", async () => {
      await request("/api/favorites/" + id, { as: "renter", method: "PUT" });
      assert.deepEqual(
        (await request("/api/favorites", { as: "renter" })).data.ids,
        [id],
      );
      assert.deepEqual(
        (await request("/api/favorites", { as: "stranger" })).data.ids,
        [],
      );
      inquiryId = (
        await request("/api/inquiries", {
          as: "renter",
          method: "POST",
          body: { listingId: id, message: "Is this available for next month?" },
          status: 201,
        })
      ).data.id;
      assert.equal(
        (await request("/api/inquiries", { as: "owner" })).data.inquiries
          .length,
        1,
      );
      assert.equal(
        (await request("/api/inquiries", { as: "other" })).data.inquiries
          .length,
        0,
      );
      assert.equal(
        (await request("/api/inquiries", { as: "stranger" })).data.inquiries
          .length,
        0,
      );
      await request(`/api/inquiries/${inquiryId}/reply`, {
        as: "other",
        method: "PATCH",
        body: { reply: "Forbidden reply" },
        status: 404,
      });
      await request(`/api/inquiries/${inquiryId}/reply`, {
        as: "owner",
        method: "PATCH",
        body: { reply: "Yes, the space is available next month." },
      });
      assert.equal(
        (await request("/api/inquiries", { as: "renter" })).data.inquiries[0]
          .reply,
        "Yes, the space is available next month.",
      );
    });
    await t.test("SQLite persistence and session invalidation", async () => {
      await stop();
      await start();
      assert.deepEqual(
        (await request("/api/favorites", { as: "renter" })).data.ids,
        [id],
      );
      assert.equal(
        (await request("/api/inquiries", { as: "renter" })).data.inquiries
          .length,
        1,
      );
      assert.equal(
        (await request("/api/me", { as: "renter" })).data.user.role,
        "renter",
      );
      const old = clients.stranger;
      await request("/api/logout", { as: "stranger", method: "POST" });
      clients.stranger = old;
      assert.equal(
        (await request("/api/me", { as: "stranger" })).data.user,
        null,
      );
    });
    await t.test(
      "availability, edits requiring approval, and cascade deletion",
      async () => {
        await request(`/api/listings/${id}/availability`, {
          as: "owner",
          method: "PATCH",
          body: { available: false },
        });
        assert.equal((await request("/api/listings")).data.listings.length, 0);
        await request("/api/inquiries", {
          as: "renter",
          method: "POST",
          body: { listingId: id, message: "Unavailable request" },
          status: 400,
        });
        await request(`/api/listings/${id}/availability`, {
          as: "owner",
          method: "PATCH",
          body: { available: true },
        });
        let p = (await request("/api/listings/" + id, { as: "owner" })).data
          .listing;
        await request("/api/listings/" + id, {
          as: "owner",
          method: "PUT",
          body: {
            ...payload,
            photos: [],
            keepPhotos: [photoId],
            available: true,
            version: p.version,
          },
        });
        await request("/api/listings/" + id, { status: 404 });
        assert.equal((await request("/api/listings")).data.listings.length, 0);
        await request("/api/listings/" + id, { as: "owner", method: "DELETE" });
        assert.deepEqual(
          (await request("/api/favorites", { as: "renter" })).data.ids,
          [],
        );
        assert.deepEqual(
          (await request("/api/inquiries", { as: "renter" })).data.inquiries,
          [],
        );
        await request("/api/photos/" + photoId, { as: "owner", status: 404 });
      },
    );
    await t.test(
      "optional demo listings are marked and cannot receive inquiries",
      async () => {
        execFileSync(process.execPath, ["manage.js", "seed"], {
          cwd,
          env,
          stdio: "pipe",
        });
        const items = (await request("/api/listings")).data.listings;
        assert.equal(items.length, 6);
        assert.ok(items.every((p) => p.sample));
        await request("/api/inquiries", {
          as: "renter",
          method: "POST",
          body: {
            listingId: items[0].id,
            message: "No messages to demo owners",
          },
          status: 400,
        });
      },
    );
  },
);
