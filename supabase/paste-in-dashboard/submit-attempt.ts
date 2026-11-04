// submit-attempt — paste this whole file into Supabase → Edge Functions → Deploy a new function → Via Editor
// Function name must be exactly: submit-attempt
// supabase/functions/_shared/common.ts
import { createClient } from "jsr:@supabase/supabase-js@2";
var cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });
}
function admin() {
  return createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false }
  });
}
async function currentUser(req) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
async function sendTelegram(html) {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chat = Deno.env.get("TELEGRAM_CHAT_ID");
  if (!token || !chat) return { ok: false, reason: "telegram not configured" };
  const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text: html, parse_mode: "HTML", disable_web_page_preview: true })
  });
  return { ok: r.ok, reason: r.ok ? "" : await r.text() };
}

// supabase/functions/_shared/scoring.js
function nm(s) {
  return String(s ?? "").toLowerCase().replace(/[’‘`]/g, "'").replace(/[“”"]/g, "").replace(/\s+/g, " ").trim().replace(/[.,;:!?]+$/g, "").trim();
}
var SHORT = { t: "true", f: "false", ng: "not given", y: "yes", n: "no" };
function multiGroups(content) {
  const out = [];
  for (const p of content?.parts || []) for (const g of p.groups || []) {
    if (g.type === "multi") {
      const picks = Math.max(1, +g.picks || 2);
      const from = +g.from || 1;
      out.push(Array.from({ length: picks }, (_, i) => from + i));
    }
  }
  return out;
}
var LISTENING = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1], [0, 0]];
var READING = [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [1, 1], [0, 0]];
function bandFor(kind, correct, total) {
  if (!total) return 0;
  const scaled = Math.round(correct / total * 40);
  const table = kind === "listening" ? LISTENING : READING;
  for (const [min, band] of table) if (scaled >= min) return band;
  return 0;
}
function score(content, key, answers, kind) {
  const detail = {};
  let correct = 0;
  const nums = Object.keys(key || {}).map(Number).sort((a, b) => a - b);
  const done = /* @__PURE__ */ new Set();
  for (const grp of multiGroups(content)) {
    if (!grp.some((n) => key[n])) continue;
    const pool = new Set(grp.flatMap((n) => (key[n] || []).map(nm)));
    const given = grp.map((n) => nm(answers?.[n])).filter(Boolean);
    const used = /* @__PURE__ */ new Set();
    const expected = [...pool].map((s) => s.toUpperCase()).join(", ");
    grp.forEach((n, i) => {
      const g = given[i];
      const ok = !!g && pool.has(g) && !used.has(g);
      if (ok) {
        used.add(g);
        correct++;
      }
      detail[n] = { given: g ? g.toUpperCase() : "", ok, expected };
      done.add(n);
    });
  }
  for (const n of nums) {
    if (done.has(n)) continue;
    const accepted = (key[n] || []).map(nm);
    const raw = answers?.[n];
    const g = nm(raw);
    const gNorm = SHORT[g] && accepted.includes(SHORT[g]) ? SHORT[g] : g;
    const ok = !!g && accepted.includes(gNorm);
    if (ok) correct++;
    detail[n] = { given: String(raw ?? "").trim(), ok, expected: (key[n] || []).join(" / ") };
  }
  const total = nums.length;
  return { correct, total, band: bandFor(kind, correct, total), detail };
}

// supabase/functions/submit-attempt/index.ts
var GRACE_MS = 3 * 60 * 1e3;
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await currentUser(req);
    if (!user) return json({ error: "Please log in again." }, 401);
    const body = await req.json();
    const { action = "submit", test_id, mock_id = null } = body;
    const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
    const db = admin();
    const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).single();
    const { data: test } = await db.from("tests").select("*").eq("id", test_id).single();
    if (!test) return json({ error: "Test not found." }, 404);
    if (!mock_id) {
      if (action !== "submit") return json({ ok: true });
      if (test.visibility !== "practice" && !profile?.is_admin) return json({ error: "Not available." }, 403);
      const { data: k2 } = await db.from("test_keys").select("answers").eq("test_id", test_id).single();
      const r2 = score(test.content, k2?.answers || {}, answers, test.kind);
      await db.from("attempts").insert({
        user_id: user.id,
        test_id,
        status: "submitted",
        answers,
        test_title: test.title,
        test_kind: test.kind,
        correct: r2.correct,
        total: r2.total,
        band: r2.band,
        detail: r2.detail,
        opened_at: body.opened_at || null,
        submitted_at: (/* @__PURE__ */ new Date()).toISOString()
      });
      return json({ ok: true, released: true, ...r2, transcripts: (test.content?.parts || []).map((p) => p.transcript || "") });
    }
    const { data: mock } = await db.from("mocks").select("*").eq("id", mock_id).single();
    if (!mock || !(mock.test_ids || []).includes(test_id)) return json({ error: "Mock not found." }, 404);
    const { data: attempt } = await db.from("attempts").select("*").eq("mock_id", mock_id).eq("user_id", user.id).eq("test_id", test_id).single();
    if (!attempt) return json({ error: "Enter the mock password first." }, 403);
    if (attempt.status === "submitted") return json({ error: "This section was already submitted." }, 409);
    const now = Date.now();
    if (action === "open") {
      if (now > Date.parse(mock.ends_at)) return json({ error: "This mock test is closed." }, 403);
      if (!attempt.opened_at) {
        const opened2 = (/* @__PURE__ */ new Date()).toISOString();
        await db.from("attempts").update({ opened_at: opened2 }).eq("id", attempt.id);
        return json({ ok: true, opened_at: opened2, server_now: opened2 });
      }
      return json({ ok: true, opened_at: attempt.opened_at, server_now: (/* @__PURE__ */ new Date()).toISOString() });
    }
    const opened = attempt.opened_at ? Date.parse(attempt.opened_at) : now;
    const deadline = Math.min(opened + test.duration_min * 6e4, Date.parse(mock.ends_at)) + GRACE_MS;
    const late = now > deadline;
    const { data: k } = await db.from("test_keys").select("answers").eq("test_id", test_id).single();
    const r = score(test.content, k?.answers || {}, answers, test.kind);
    await db.from("attempts").update({
      status: "submitted",
      answers,
      test_title: test.title,
      test_kind: test.kind,
      correct: r.correct,
      total: r.total,
      band: r.band,
      detail: { ...r.detail, _late: late },
      submitted_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", attempt.id);
    const { data: all } = await db.from("attempts").select("test_id,status,correct,total,band,opened_at,submitted_at").eq("mock_id", mock_id).eq("user_id", user.id);
    const finished = (mock.test_ids || []).every((id) => all?.find((a) => a.test_id === id && a.status === "submitted"));
    if (finished) {
      const { data: tests } = await db.from("tests").select("id,title,kind").in("id", mock.test_ids);
      const lines = mock.test_ids.map((id) => {
        const t = tests?.find((x) => x.id === id);
        const a = all?.find((x) => x.test_id === id);
        const icon = t?.kind === "listening" ? "\u{1F3A7}" : "\u{1F4D6}";
        return `${icon} <b>${esc(t?.title || "")}</b>: ${a?.correct}/${a?.total} \u2014 Band <b>${Number(a?.band).toFixed(1)}</b>`;
      });
      const tg = profile?.telegram ? ` (${esc(profile.telegram.startsWith("@") ? profile.telegram : "@" + profile.telegram)})` : "";
      const when = (/* @__PURE__ */ new Date()).toLocaleString("en-GB", { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" });
      const msg = [
        `\u{1F9FE} <b>${esc(mock.title)}</b>`,
        `\u{1F464} ${esc(profile?.full_name || user.email || "Student")}${tg}`,
        ...lines,
        late ? "\u26A0\uFE0F Submitted after the time limit" : "",
        `\u{1F552} ${when}`
      ].filter(Boolean).join("\n");
      await sendTelegram(msg);
    }
    if (mock.results_released) return json({ ok: true, released: true, ...r });
    return json({ ok: true, released: false, finished });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
