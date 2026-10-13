// Tests Deno de l'Edge Function « study-ai » — sans réseau : `fetch` est remplacé par un double qui joue Supabase Auth et
// l'API du modèle (flux SSE). Lancer : deno test --allow-env --allow-net=127.0.0.1 supabase/functions/study-ai/handler.test.ts
import { handler } from './handler.ts';

const ORIGIN = 'https://lex-note-svfr.vercel.app';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-test');
Deno.env.set('APP_ORIGINS', ORIGIN);

function eq(a: unknown, b: unknown, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} : attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
}
function ok(c: unknown, label: string) { if (!c) throw new Error(label); }

type Mode = { stop?: string; status?: number; text?: string };
let seen: { url: string; body: any; headers: Headers }[] = [];
function sse(text: string, stop: string) {
  const ev = (type: string, data: unknown) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  return [
    ev('message_start', { type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } }),
    ev('content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
    ev('content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }),
    ev('content_block_stop', { type: 'content_block_stop', index: 0 }),
    ev('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } }),
    ev('message_stop', { type: 'message_stop' }),
  ].join('');
}
function install(mode: Mode) {
  seen = [];
  globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const url = req.url;
    const body = req.method === 'POST' ? await req.clone().text() : '';
    seen.push({ url, body: body ? JSON.parse(body) : null, headers: req.headers });
    if (url.includes('/auth/v1/user')) {
      return req.headers.get('Authorization') === 'Bearer good'
        ? new Response(JSON.stringify({ id: '00000000-0000-4000-a000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'a@x.test' }), { status: 200, headers: { 'content-type': 'application/json' } })
        : new Response(JSON.stringify({ message: 'invalid' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    if (url.startsWith('https://api.anthropic.com/')) {
      if (mode.status) return new Response(JSON.stringify({ type: 'error', error: { type: 'rate_limit_error', message: 'x' } }), { status: mode.status, headers: { 'content-type': 'application/json', 'x-should-retry': 'false' } });
      return new Response(sse(mode.text ?? '{"blocks":[{"kind":"paragraph","text":"ok"}]}', mode.stop ?? 'end_turn'), { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}
const post = (body: unknown, auth = 'Bearer good', origin = ORIGIN) =>
  handler(new Request('https://fn.test/study-ai', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth ? { Authorization: auth } : {}) }, body: JSON.stringify(body) }));

Deno.test('CORS : origine de l’application autorisée, aucune autre (jamais « * »)', async () => {
  install({});
  const a = await handler(new Request('https://fn.test', { method: 'OPTIONS', headers: { Origin: ORIGIN } }));
  eq(a.headers.get('Access-Control-Allow-Origin'), ORIGIN, 'origine autorisée');
  const b = await handler(new Request('https://fn.test', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }));
  eq(b.headers.get('Access-Control-Allow-Origin'), null, 'origine refusée');
});

Deno.test('authentification obligatoire', async () => {
  Deno.env.set('ANTHROPIC_API_KEY', 'sk-test-secret');
  install({});
  eq((await post({ task: 'summarize', input: 'x' }, '')).status, 401, 'sans jeton');
  eq((await post({ task: 'summarize', input: 'x' }, 'Bearer bad')).status, 401, 'jeton invalide');
  ok(!seen.some((s) => s.url.includes('anthropic')), 'aucun appel au modèle sans authentification');
});

Deno.test('validation de la requête', async () => {
  install({});
  eq((await post({ task: 'hack', input: 'x' })).status, 400, 'tâche inconnue');
  eq((await post({ task: 'summarize', input: '   ' })).status, 400, 'texte vide');
  eq((await post({ task: 'summarize', input: 'a'.repeat(200_001) })).status, 413, 'texte trop long');
});

Deno.test('moteur non configuré → 503 not_configured (jamais de réponse simulée)', async () => {
  Deno.env.delete('ANTHROPIC_API_KEY');
  install({});
  const r = await post({ task: 'summarize', input: 'Un cours.' });
  eq(r.status, 503, 'statut'); eq(await r.json(), { error: 'not_configured' }, 'corps');
  Deno.env.set('ANTHROPIC_API_KEY', 'sk-test-secret');
});

Deno.test('succès : modèle, cache du préfixe, sortie structurée, repli ; la clé ne sort jamais', async () => {
  install({});
  const r = await post({ task: 'summarize', input: 'Aujourd’hui on parle de l’offre et la demande.', options: { mode: 'express', outputLanguage: 'fr', evil: { x: 1 }, targetLanguage: 'not a lang' } });
  eq(r.status, 200, 'statut');
  const body = await r.json();
  eq(body, { text: '{"blocks":[{"kind":"paragraph","text":"ok"}]}', model: 'claude-opus-5-5', provider: 'anthropic' }, 'réponse');
  const call = seen.find((s) => s.url.includes('anthropic'))!;
  eq(call.body.model, 'claude-opus-5-5', 'modèle par défaut');
  eq(call.body.system[0].cache_control, { type: 'ephemeral' }, 'système mis en cache');
  eq(call.body.messages[0].content[0].cache_control, { type: 'ephemeral' }, 'texte source mis en cache (préfixe partagé)');
  ok(String(call.body.messages[0].content[1].text).includes('EXPRESS'), 'consigne après le texte source');
  eq(call.body.output_config.format.type, 'json_schema', 'sortie structurée');
  eq(call.body.fallbacks, 'default', 'repli en cas de refus');
  ok((call.headers.get('anthropic-beta') ?? '').includes('server-side-fallback-2026-07-01'), 'en-tête beta du repli');
  eq(call.headers.get('x-api-key'), 'sk-test-secret', 'clé envoyée au fournisseur uniquement');
  ok(!JSON.stringify(body).includes('sk-test'), 'la clé n’apparaît jamais dans la réponse');
  ok(!String(call.body.messages[0].content[1].text).includes('not a lang'), 'option de langue invalide ignorée');
});

Deno.test('synthèse intermédiaire : texte libre (pas de format JSON), effort réduit', async () => {
  install({ text: 'Notes denses.' });
  const r = await post({ task: 'digest', input: 'Une partie du cours.' });
  eq(r.status, 200, 'statut');
  const call = seen.find((s) => s.url.includes('anthropic'))!;
  eq(call.body.output_config.format, undefined, 'pas de schéma pour la synthèse');
  eq(call.body.output_config.effort, 'low', 'effort');
});

Deno.test('refus du modèle → 422 ; réponse tronquée → 502 ; limite de débit → 429', async () => {
  install({ stop: 'refusal' });
  eq((await post({ task: 'summarize', input: 'x y z' })).status, 422, 'refus');
  install({ stop: 'max_tokens' });
  eq((await post({ task: 'summarize', input: 'x y z' })).status, 502, 'tronqué');
  install({ status: 429 });
  eq((await post({ task: 'summarize', input: 'x y z' })).status, 429, 'débit');
});
