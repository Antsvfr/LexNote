import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const allowedOrigins = new Set([
  "https://lex-note-svfr.vercel.app",
  "http://localhost:5173",
  "http://localhost:4173",
]);

function cors(origin: string | null) {
  const value = origin && allowedOrigins.has(origin)
    ? origin
    : "https://lex-note-svfr.vercel.app";
  return {
    "Access-Control-Allow-Origin": value,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function userIdFromJwt(auth: string | null): string | null {
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const token = auth.slice(7);
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const json = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return typeof json.sub === "string" ? json.sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  const headers = { ...cors(req.headers.get("origin")), "Content-Type": "application/json" };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers });
  }

  // Supabase verifies the JWT before invoking this function (verify_jwt=true).
  const auth = req.headers.get("authorization");
  const userId = userIdFromJwt(auth);
  if (!userId) return new Response(JSON.stringify({ error: "invalid_session" }), { status: 401, headers });

  let body: { confirmation?: string } = {};
  try { body = await req.json(); } catch { /* handled below */ }
  if (body.confirmation !== "SUPPRIMER") {
    return new Response(JSON.stringify({ error: "confirmation_required" }), { status: 400, headers });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) {
    return new Response(JSON.stringify({ error: "server_not_configured" }), { status: 500, headers });
  }

  const res = await fetch(`${url}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${service}`,
      "apikey": service,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    console.error("delete-account failed", res.status, await res.text());
    return new Response(JSON.stringify({ error: "delete_failed" }), { status: 500, headers });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
});
