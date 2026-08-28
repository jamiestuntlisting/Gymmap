// StuntListing API — Cloudflare Worker + D1.
// Static pages are served from ./public via the assets binding; every /api/*
// request is routed here first (run_worker_first in wrangler.jsonc).
//
// Public endpoints:
//   GET  /api/schools            → published schools (map + list view)
//   POST /api/track              → analytics event {type, school?, session_id?}
//   POST /api/submissions        → "Add a school" form (pending admin review)
//   POST /api/claims             → "This is my school" form (pending admin review)
//   GET  /api/analytics-summary  → aggregate counts only (no raw rows)
//   GET  /api/migrations         → which embedded migrations have been applied
//
// Admin endpoints (all POST, body must include the admin password):
//   /api/admin/data, /api/admin/save-school, /api/admin/delete-school,
//   /api/admin/approve-submission, /api/admin/set-submission,
//   /api/admin/set-claim, /api/admin/change-password

import { MIGRATIONS } from "./migrations.js";

const JSON_HEADERS = { "Content-Type": "application/json" };
const ok = (data) => new Response(JSON.stringify(data), { headers: JSON_HEADERS });
const err = (message, status = 400) =>
  new Response(JSON.stringify({ error: message }), { status, headers: JSON_HEADERS });

const S = (v) => (v == null ? "" : String(v)).slice(0, 2000);        // sanitized short string
const ARR = (v) => JSON.stringify(Array.isArray(v) ? v.map((x) => S(x)).slice(0, 64) : []);
const NUM = (v) => (v === "" || v == null || isNaN(Number(v)) ? null : Number(v));
// Every facility is exactly one type; anything unrecognized falls back.
const FACILITY_TYPES = ["Stunt School", "Stunt Training Facility", "Open Gym"];
const FTYPE = (v) => (FACILITY_TYPES.includes(v) ? v : "Stunt Training Facility");

function parseSchoolRow(r) {
  return {
    id: r.id, name: r.name, type: r.type || "",
    categories: JSON.parse(r.categories || "[]"),
    specialties: JSON.parse(r.specialties || "[]"),
    location: r.location || "", region: r.region || "", address: r.address || "",
    website: r.website || "", instagram: r.instagram || "",
    lat: r.lat, lon: r.lon, online: !!r.online,
    facility_type: r.facility_type || "Stunt Training Facility",
    status: r.status, notes: r.notes || "",
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

// ── password check (PBKDF2-SHA256, hash stored in app_config) ────────────────
async function isAdmin(env, password) {
  if (!password) return false;
  const row = await env.DB.prepare("SELECT value FROM app_config WHERE key='admin_password_hash'").first();
  if (!row) return false;
  const [scheme, iterStr, saltHex, hashHex] = row.value.split("$");
  if (scheme !== "pbkdf2") return false;
  const derived = await pbkdf2(password, hexToBytes(saltHex), parseInt(iterStr, 10));
  return timingSafeEqualHex(bytesToHex(derived), hashHex);
}
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}
const hexToBytes = (h) => new Uint8Array((h.match(/.{2}/g) || []).map((b) => parseInt(b, 16)));
const bytesToHex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ── school insert/update shared by admin save + approve ──────────────────────
async function saveSchool(env, s) {
  const id = S(s.id);
  if (id) {
    await env.DB.prepare(
      `UPDATE schools SET name=?,type=?,categories=?,location=?,region=?,address=?,website=?,instagram=?,
       specialties=?,lat=?,lon=?,online=?,status=?,notes=?,facility_type=?,updated_at=datetime('now') WHERE id=?`
    ).bind(
      S(s.name), S(s.type), ARR(s.categories), S(s.location), S(s.region), S(s.address),
      S(s.website), S(s.instagram), ARR(s.specialties), NUM(s.lat), NUM(s.lon),
      s.online ? 1 : 0, s.status === "hidden" ? "hidden" : "published", S(s.notes),
      FTYPE(s.facility_type), id
    ).run();
    return id;
  }
  const newId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO schools (id,name,type,categories,location,region,address,website,instagram,specialties,lat,lon,online,status,notes,facility_type)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    newId, S(s.name), S(s.type), ARR(s.categories), S(s.location), S(s.region), S(s.address),
    S(s.website), S(s.instagram), ARR(s.specialties), NUM(s.lat), NUM(s.lon),
    s.online ? 1 : 0, s.status === "hidden" ? "hidden" : "published", S(s.notes),
    FTYPE(s.facility_type)
  ).run();
  return newId;
}

// ── SELF-APPLYING MIGRATIONS ─────────────────────────────────────────────────
// Runs once per isolate: anything in MIGRATIONS that isn't in the _migrations
// ledger gets applied, in order, then recorded. Deploying new code is all it
// takes to move the schema forward.
let migrationRun = null;
async function ensureMigrations(env) {
  if (!migrationRun) {
    migrationRun = applyMigrations(env).catch((e) => {
      migrationRun = null;   // let the next request retry
      throw e;
    });
  }
  return migrationRun;
}
async function applyMigrations(env) {
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))"
  ).run();
  const { results } = await env.DB.prepare("SELECT id FROM _migrations").all();
  const done = new Set(results.map((r) => r.id));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    for (const stmt of m.statements) {
      try {
        await env.DB.prepare(stmt).run();
      } catch (e) {
        // A column/table that already exists means this step was done by hand;
        // anything else is a real failure and should surface.
        if (!/duplicate column|already exists/i.test(e.message)) throw e;
      }
    }
    await env.DB.prepare("INSERT OR IGNORE INTO _migrations (id) VALUES (?)").bind(m.id).run();
    applied.push(m.id);
  }
  return applied;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      await ensureMigrations(env);

      // Migration status (safe to expose: ids and timestamps only)
      if (path === "/api/migrations") {
        const { results } = await env.DB.prepare(
          "SELECT id, applied_at FROM _migrations ORDER BY id"
        ).all();
        return ok({ applied: results, known: MIGRATIONS.map((m) => m.id) });
      }
      // ── public: schools ────────────────────────────────────────────────────
      if (path === "/api/schools" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT * FROM schools WHERE status='published' ORDER BY name COLLATE NOCASE"
        ).all();
        return ok(results.map(parseSchoolRow));
      }

      // ── public: analytics tracking ─────────────────────────────────────────
      if (path === "/api/track" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        if (b.type !== "view" && b.type !== "click") return err("bad type");
        await env.DB.prepare("INSERT INTO analytics_events (type,school,session_id) VALUES (?,?,?)")
          .bind(b.type, b.school ? S(b.school) : null, b.session_id ? S(b.session_id) : null).run();
        return ok({ ok: true });
      }

      // ── public: analytics summary (aggregates only) ────────────────────────
      if (path === "/api/analytics-summary") {
        const totals = await env.DB.prepare(
          `SELECT
             (SELECT count(*) FROM analytics_events WHERE type='view') AS total_views,
             (SELECT count(*) FROM analytics_events WHERE type='click') AS total_clicks,
             (SELECT count(DISTINCT session_id) FROM analytics_events WHERE session_id IS NOT NULL) AS unique_sessions,
             (SELECT min(created_at) FROM analytics_events) AS first_event`
        ).first();
        const top = await env.DB.prepare(
          `SELECT school, count(*) AS clicks FROM analytics_events
           WHERE type='click' AND school IS NOT NULL GROUP BY school ORDER BY clicks DESC LIMIT 25`
        ).all();
        const days = await env.DB.prepare(
          `SELECT date(created_at) AS day, count(*) AS views FROM analytics_events
           WHERE type='view' AND created_at >= datetime('now','-30 days') GROUP BY day ORDER BY day`
        ).all();
        return ok({ ...totals, top_schools: top.results, views_by_day: days.results });
      }

      // ── public: submissions ────────────────────────────────────────────────
      if (path === "/api/submissions" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        if (!S(b.name).trim()) return err("name required");
        await env.DB.prepare(
          `INSERT INTO submissions (id,name,type,categories,location,address,website,instagram,specialties,online,is_my_school,submitter_name,submitter_email,notes)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).bind(
          crypto.randomUUID(), S(b.name), S(b.type), ARR(b.categories), S(b.location), S(b.address),
          S(b.website), S(b.instagram), ARR(b.specialties), b.online ? 1 : 0, b.is_my_school ? 1 : 0,
          S(b.submitter_name), S(b.submitter_email), S(b.notes)
        ).run();
        return ok({ ok: true });
      }

      // ── public: claims ─────────────────────────────────────────────────────
      if (path === "/api/claims" && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        await env.DB.prepare(
          `INSERT INTO claims (id,school_id,school_name,claimant_name,claimant_email,claimant_phone,message)
           VALUES (?,?,?,?,?,?,?)`
        ).bind(
          crypto.randomUUID(), b.school_id ? S(b.school_id) : null, S(b.school_name),
          S(b.claimant_name), S(b.claimant_email), S(b.claimant_phone), S(b.message)
        ).run();
        return ok({ ok: true });
      }

      // ── admin ──────────────────────────────────────────────────────────────
      if (path.startsWith("/api/admin/") && request.method === "POST") {
        const b = await request.json().catch(() => ({}));
        if (!(await isAdmin(env, b.password))) return err("unauthorized", 401);
        const action = path.slice("/api/admin/".length);

        if (action === "data") {
          const schools = await env.DB.prepare("SELECT * FROM schools ORDER BY name COLLATE NOCASE").all();
          const submissions = await env.DB.prepare("SELECT * FROM submissions ORDER BY created_at DESC").all();
          const claims = await env.DB.prepare("SELECT * FROM claims ORDER BY created_at DESC").all();
          return ok({
            schools: schools.results.map(parseSchoolRow),
            submissions: submissions.results.map((r) => ({
              ...r, categories: JSON.parse(r.categories || "[]"), specialties: JSON.parse(r.specialties || "[]"),
              online: !!r.online, is_my_school: !!r.is_my_school,
            })),
            claims: claims.results,
          });
        }
        if (action === "save-school") {
          if (!S(b.school?.name).trim()) return err("name required");
          return ok({ id: await saveSchool(env, b.school) });
        }
        if (action === "delete-school") {
          await env.DB.prepare("DELETE FROM schools WHERE id=?").bind(S(b.id)).run();
          return ok({ ok: true });
        }
        if (action === "approve-submission") {
          if (!S(b.school?.name).trim()) return err("name required");
          const id = await saveSchool(env, { ...b.school, id: "" });
          await env.DB.prepare("UPDATE submissions SET status='approved' WHERE id=?").bind(S(b.id)).run();
          return ok({ id });
        }
        if (action === "set-submission" || action === "set-claim") {
          if (!["pending", "approved", "rejected"].includes(b.status)) return err("bad status");
          const table = action === "set-submission" ? "submissions" : "claims";
          await env.DB.prepare(`UPDATE ${table} SET status=? WHERE id=?`).bind(b.status, S(b.id)).run();
          return ok({ ok: true });
        }
        if (action === "change-password") {
          if (S(b.new_password).length < 6) return err("password too short");
          const salt = crypto.getRandomValues(new Uint8Array(16));
          const iterations = 100000;
          const hash = await pbkdf2(S(b.new_password), salt, iterations);
          await env.DB.prepare("UPDATE app_config SET value=? WHERE key='admin_password_hash'")
            .bind(`pbkdf2$${iterations}$${bytesToHex(salt)}$${bytesToHex(hash)}`).run();
          return ok({ ok: true });
        }
        return err("unknown action", 404);
      }

      return err("not found", 404);
    } catch (e) {
      return err("server error: " + e.message, 500);
    }
  },
};
