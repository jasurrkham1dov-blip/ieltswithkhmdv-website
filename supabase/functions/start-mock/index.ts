// POST { mock_id, password }
// Checks the time window + password, opens (or resumes) the student's attempts,
// and returns the mock's test content (never the answers).
import { admin, cors, currentUser, json } from "../_shared/common.ts";

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

    const ids: string[] = mock.test_ids || [];
    const { data: tests } = await db
      .from("tests")
      .select("id,title,kind,duration_min,audio_url,strict_audio,content,question_count")
      .in("id", ids);
    const ordered = ids.map((id) => tests?.find((t) => t.id === id)).filter(Boolean);

    // open attempts that don't exist yet
    const { data: existing } = await db
      .from("attempts")
      .select("test_id,status,started_at,submitted_at")
      .eq("mock_id", mock_id)
      .eq("user_id", user.id);
    const have = new Set((existing || []).map((a) => a.test_id));
    const toOpen = ids.filter((id) => !have.has(id)).map((id) => ({
      user_id: user.id, test_id: id, mock_id, status: "started",
    }));
    // A section's timer starts when the student actually opens it (see submit-attempt "open").
    if (toOpen.length) await db.from("attempts").insert(toOpen);

    const { data: progress } = await db
      .from("attempts")
      .select("test_id,status,opened_at,submitted_at")
      .eq("mock_id", mock_id)
      .eq("user_id", user.id);

    return json({
      server_now: new Date().toISOString(),
      mock: { id: mock.id, title: mock.title, ends_at: mock.ends_at },
      tests: ordered,
      progress: progress || [],
    });
  } catch (e) {
    return json({ error: String(e?.message || e) }, 500);
  }
});
