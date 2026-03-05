// api/groq.ts — Vercel Edge Function proxy para Groq
// Soporta GET /api/groq?path=models  →  lista modelos disponibles
//         POST /api/groq             →  chat completions
export const config = { runtime: "edge" };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Authorization requerido" }), { status: 401, headers: CORS });
  }

  try {
    // GET → listar modelos
    if (req.method === "GET") {
      const r = await fetch("https://api.groq.com/openai/v1/models", {
        headers: { Authorization: auth },
      });
      const data = await r.json();
      return new Response(JSON.stringify(data), { status: r.status, headers: CORS });
    }

    // POST → chat completions
    if (req.method === "POST") {
      const body = await req.json();
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      return new Response(JSON.stringify(data), { status: r.status, headers: CORS });
    }

    return new Response(JSON.stringify({ error: `Method ${req.method} not allowed` }), { status: 405, headers: CORS });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "Proxy error", detail: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: CORS }
    );
  }
}
