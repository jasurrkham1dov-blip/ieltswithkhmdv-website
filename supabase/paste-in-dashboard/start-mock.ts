// start-mock — paste this whole file into Supabase → Edge Functions → Deploy a new function → Via Editor
// Function name must be exactly: start-mock
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

// supabase/functions/start-mock/index.ts
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const user = await currentUser(req);
    if (!user) return json({ error: "Please log in again." }, 401);
    const { mock_id, password } = await req.json();
    const db = admin();
    const { data: mock } = await db.from("mocks").select("*").eq("id", mock_id).single();
    if (!mock) return json({ error: "Mock test not found." }, 404);
    const now = Date.now();
    if (now < Date.parse(mock.starts_at)) return json({ error: "This mock test hasn't opened yet." }, 403);
    if (now > Date.parse(mock.ends_at)) return json({ error: "This mock test is closed." }, 403);
    const { data: secret } = await db.from("mock_secrets").select("password").eq("mock_id", mock_id).single();
    const expected = (secret?.password || "").trim();
    if (expected && String(password || "").trim() !== expected) {
      return json({ error: "Wrong password." }, 403);
    }
    const ids = mock.test_ids || [];
    const { data: tests } = await db.from("tests").select("id,title,kind,duration_min,audio_url,strict_audio,content,question_count").in("id", ids);
    const ordered = ids.map((id) => tests?.find((t) => t.id === id)).filter(Boolean);
    const { data: existing } = await db.from("attempts").select("test_id,status,started_at,submitted_at").eq("mock_id", mock_id).eq("user_id", user.id);
    const have = new Set((existing || []).map((a) => a.test_id));
    const toOpen = ids.filter((id) => !have.has(id)).map((id) => ({
      user_id: user.id,
      test_id: id,
      mock_id,
      status: "started"
    }));
    if (toOpen.length) await db.from("attempts").insert(toOpen);
    const { data: progress } = await db.from("attempts").select("test_id,status,opened_at,submitted_at").eq("mock_id", mock_id).eq("user_id", user.id);
    return json({
      server_now: (/* @__PURE__ */ new Date()).toISOString(),
      mock: { id: mock.id, title: mock.title, ends_at: mock.ends_at },
      tests: ordered,
      progress: progress || []
    });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
