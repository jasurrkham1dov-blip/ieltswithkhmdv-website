// POST { action: "open",   test_id, mock_id }            → starts a mock section's timer
// POST { action: "submit", test_id, mock_id?, answers }  → scores on the server
//   practice: returns score + per-question breakdown
//   mock:     saves silently; when every section is done, posts the result to Telegram
import { admin, cors, currentUser, esc, json, sendTelegram } from "../_shared/common.ts";
import { score } from "../_shared/scoring.js";

const GRACE_MS = 3 * 60 * 1000; // allowance for slow connections

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

    // ---------------- PRACTICE ----------------
    if (!mock_id) {
      if (action !== "submit") return json({ ok: true });
      if (test.visibility !== "practice" && !profile?.is_admin) return json({ error: "Not available." }, 403);
      const { data: k } = await db.from("test_keys").select("answers").eq("test_id", test_id).single();
      const r = score(test.content, k?.answers || {}, answers, test.kind);
      await db.from("attempts").insert({
        user_id: user.id, test_id, status: "submitted", answers, test_title: test.title, test_kind: test.kind,
        correct: r.correct, total: r.total, band: r.band, detail: r.detail,
        opened_at: body.opened_at || null, submitted_at: new Date().toISOString(),
      });
      return json({ ok: true, released: true, ...r, transcripts: (test.content?.parts || []).map((p: any) => p.transcript || "") });
    }

    // ---------------- MOCK ----------------
    const { data: mock } = await db.from("mocks").select("*").eq("id", mock_id).single();
    if (!mock || !(mock.test_ids || []).includes(test_id)) return json({ error: "Mock not found." }, 404);
    const { data: attempt } = await db.from("attempts").select("*")
      .eq("mock_id", mock_id).eq("user_id", user.id).eq("test_id", test_id).single();
    if (!attempt) return json({ error: "Enter the mock password first." }, 403);
    if (attempt.status === "submitted") return json({ error: "This section was already submitted." }, 409);

    const now = Date.now();
    if (action === "open") {
      if (now > Date.parse(mock.ends_at)) return json({ error: "This mock test is closed." }, 403);
      if (!attempt.opened_at) {
        const opened = new Date().toISOString();
        await db.from("attempts").update({ opened_at: opened }).eq("id", attempt.id);
        return json({ ok: true, opened_at: opened, server_now: opened });
      }
      return json({ ok: true, opened_at: attempt.opened_at, server_now: new Date().toISOString() });
    }

    // submit
    const opened = attempt.opened_at ? Date.parse(attempt.opened_at) : now;
    const deadline = Math.min(opened + test.duration_min * 60000, Date.parse(mock.ends_at)) + GRACE_MS;
    const late = now > deadline;

    const { data: k } = await db.from("test_keys").select("answers").eq("test_id", test_id).single();
    const r = score(test.content, k?.answers || {}, answers, test.kind);
    await db.from("attempts").update({
      status: "submitted", answers, test_title: test.title, test_kind: test.kind, correct: r.correct, total: r.total, band: r.band,
      detail: { ...r.detail, _late: late }, submitted_at: new Date().toISOString(),
    }).eq("id", attempt.id);

    // all sections finished? → one Telegram message
    const { data: all } = await db.from("attempts").select("test_id,status,correct,total,band,opened_at,submitted_at")
      .eq("mock_id", mock_id).eq("user_id", user.id);
    const finished = (mock.test_ids || []).every((id: string) => all?.find((a) => a.test_id === id && a.status === "submitted"));
    if (finished) {
      const { data: tests } = await db.from("tests").select("id,title,kind").in("id", mock.test_ids);
      const lines = (mock.test_ids as string[]).map((id) => {
        const t = tests?.find((x) => x.id === id);
        const a = all?.find((x) => x.test_id === id);
        const icon = t?.kind === "listening" ? "🎧" : "📖";
        return `${icon} <b>${esc(t?.title || "")}</b>: ${a?.correct}/${a?.total} — Band <b>${Number(a?.band).toFixed(1)}</b>`;
      });
      const tg = profile?.telegram ? ` (${esc(profile.telegram.startsWith("@") ? profile.telegram : "@" + profile.telegram)})` : "";
      const when = new Date().toLocaleString("en-GB", { timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short" });
      const msg = [
        `🧾 <b>${esc(mock.title)}</b>`,
        `👤 ${esc(profile?.full_name || user.email || "Student")}${tg}`,
        ...lines,
        late ? "⚠️ Submitted after the time limit" : "",
        `🕒 ${when}`,
      ].filter(Boolean).join("\n");
      await sendTelegram(msg);
    }

    if (mock.results_released) return json({ ok: true, released: true, ...r });
    return json({ ok: true, released: false, finished });
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
