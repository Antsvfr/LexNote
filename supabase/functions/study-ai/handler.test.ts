// Tests Deno de l'Edge Function « study-ai » — sans réseau : `fetch` est remplacé par un double qui joue Supabase Auth et
// l'API du modèle (flux SSE). Lancer : deno test --allow-env --allow-net=127.0.0.1 supabase/functions/study-ai/handler.test.ts
import { handler } from './handler.ts';

const ORIGIN = 'https://lex-note-svfr.vercel.app';
Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
Deno.env.set('SUPABASE_ANON_KEY', 'anon-test');
Deno.env.set('APP_ORIGINS', ORIGIN);
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test');

function eq(a: unknown, b: unknown, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${label} : attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
}
function ok(c: unknown, label: string) { if (!c) throw new Error(label); }

type Mode = { stop?: string; status?: number; text?: string; gate?: Record<string, unknown> | 'error'; hang?: boolean };
let rpcCalls: { fn: string; body: any; auth: string | null }[] = [];
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
  seen = []; rpcCalls = [];
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
    if (url.includes('/rest/v1/rpc/')) {
      const fn = url.split('/rest/v1/rpc/')[1]!.split('?')[0]!;
      rpcCalls.push({ fn, body: body ? JSON.parse(body) : null, auth: req.headers.get('Authorization') });
      if (fn === 'study_ai_acquire') {
        if (mode.gate === 'error') return new Response(JSON.stringify({ message: 'function does not exist' }), { status: 404, headers: { 'content-type': 'application/json' } });
        return new Response(JSON.stringify(mode.gate ?? { ok: true, id: 42 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('', { status: 204 });
    }
    if (url.startsWith('https://api.anthropic.com/')) {
      if (mode.hang) return await new Promise<Response>((_, rej) => req.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))));
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
  eq((await post({ task: 'summarize', input: 'a'.repeat(80_001) })).status, 413, 'texte trop long');
});

Deno.test('moteur non configuré → 503 not_configured (jamais de réponse simulée)', async () => {
  Deno.env.delete('ANTHROPIC_API_KEY');
  try {
    install({});
    const r = await post({ task: 'summarize', input: 'Un cours.' });
    eq(r.status, 503, 'statut'); eq(await r.json(), { error: 'not_configured', code: 'AI-CONFIG' }, 'corps (avec identifiant diagnostic)');
  } finally { Deno.env.set('ANTHROPIC_API_KEY', 'sk-test-secret'); }
});

Deno.test('succès : modèle, cache du préfixe, sortie structurée, plafond de sortie, aucun repli ; la clé ne sort jamais', async () => {
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
  eq(call.body.fallbacks, undefined, 'AUCUN repli automatique après un refus');
  ok(!(call.headers.get('anthropic-beta') ?? '').includes('fallback'), 'aucune en-tête de repli');
  eq(call.body.max_tokens, 1500 + 3000, 'plafond de sortie du résumé express (réflexion comprise)');
  const acq = rpcCalls.find((r) => r.fn === 'study_ai_acquire')!;
  eq(acq.body.p_user, '00000000-0000-4000-a000-000000000001', 'limitation par utilisateur');
  eq(acq.auth, 'Bearer service-role-test', 'contrôle exécuté côté serveur (service role)');
  const rel = rpcCalls.find((r) => r.fn === 'study_ai_release')!.body;
  eq({ ...rel, p_duration_ms: typeof rel.p_duration_ms }, { p_id: 42, p_status: 'ok', p_output_tokens: 5, p_input_tokens: 10, p_model: 'claude-opus-5-5', p_duration_ms: 'number', p_error_code: null }, 'appel clos : métadonnées d’usage (aucun contenu)');
  eq(acq.body.p_global_per_day, 2000, 'budget global : requêtes/jour par défaut'); eq(acq.body.p_global_chars_per_day, 20_000_000, 'budget global : volume/jour par défaut');
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

Deno.test('refus du modèle → 422 sans nouvelle tentative ; réponse tronquée → 502 ; fournisseur saturé → 503', async () => {
  install({ stop: 'refusal' });
  const r = await post({ task: 'summarize', input: 'x y z' });
  eq(r.status, 422, 'refus'); eq((await r.json()).error, 'refused', 'erreur structurée');
  eq(seen.filter((s) => s.url.includes('anthropic')).length, 1, 'un seul appel : aucune tentative de contournement');
  eq(rpcCalls.find((x) => x.fn === 'study_ai_release')?.body.p_status, 'refused', 'refus journalisé');
  eq(rpcCalls.find((x) => x.fn === 'study_ai_release')?.body.p_error_code, 'refused', 'code d’erreur journalisé (sans contenu)');
  install({ stop: 'max_tokens' });
  eq((await post({ task: 'summarize', input: 'x y z' })).status, 502, 'tronqué');
  install({ status: 429 });
  eq((await post({ task: 'summarize', input: 'x y z' })).status, 503, 'fournisseur saturé (≠ limite utilisateur)');
});

Deno.test('limitation par utilisateur : 429 clair avec Retry-After, AUCUN appel au modèle', async () => {
  install({ gate: { ok: false, reason: 'per_minute', limit: 12, retry_after: 37 } });
  const r = await post({ task: 'summarize', input: 'Un cours.' });
  eq(r.status, 429, 'statut'); eq(r.headers.get('Retry-After'), '37', 'Retry-After');
  eq(await r.json(), { error: 'rate_limited', code: 'AI-429', reason: 'per_minute', limit: 12, retry_after: 37 }, 'corps');
  ok(!seen.some((s) => s.url.includes('anthropic')), 'aucun appel payant');
  install({ gate: { ok: false, reason: 'concurrent', limit: 2, retry_after: 10 } });
  eq((await (await post({ task: 'summarize', input: 'Un cours.' })).json()).reason, 'concurrent', 'appels simultanés');
});

Deno.test('contrôle de débit indisponible → refus (503), jamais d’appel non compté', async () => {
  install({ gate: 'error' });
  const r = await post({ task: 'summarize', input: 'Un cours.' });
  eq(r.status, 503, 'statut'); eq((await r.json()).error, 'rate_limit_unavailable', 'erreur');
  ok(!seen.some((s) => s.url.includes('anthropic')), 'aucun appel au modèle');
});

Deno.test('délai dépassé → 504 timeout, appel clos en erreur', async () => {
  Deno.env.set('STUDY_AI_TIMEOUT_MS', '30');
  try {
    install({ hang: true });
    const r = await post({ task: 'key-points', input: 'Un cours.' });
    eq(r.status, 504, 'statut'); eq((await r.json()).error, 'timeout', 'erreur');
    eq(rpcCalls.find((x) => x.fn === 'study_ai_release')?.body.p_status, 'error', 'appel clos');
  } finally { Deno.env.delete('STUDY_AI_TIMEOUT_MS'); }
});

Deno.test('plafonds de sortie adaptés à la tâche (jamais 64 000 jetons)', async () => {
  const { maxTokensFor } = await import('./handler.ts');
  eq(maxTokensFor('summarize', 40_000, { mode: 'express' }), 4500, 'résumé express');
  eq(maxTokensFor('summarize', 40_000, { mode: 'standard' }), 7000, 'résumé standard');
  eq(maxTokensFor('summarize', 40_000, { mode: 'detailed' }), 11000, 'résumé détaillé');
  eq(maxTokensFor('translate', 16_000, {}), 7000, 'traduction d’une partie (proportionnelle)');
  eq(maxTokensFor('translate', 200, {}), 2000, 'traduction courte : plancher');
  eq(maxTokensFor('structure', 60_000, {}), 15000, 'structuration : plafonnée');
  eq(maxTokensFor('digest', 60_000, {}), 4000, 'synthèse intermédiaire');
  for (const t of ['summarize', 'translate', 'structure', 'clean', 'key-points', 'glossary', 'definitions', 'exam-questions', 'to-remember', 'course-plan', 'concepts', 'important-passages', 'ambiguities', 'teacher-questions', 'explain', 'flashcard', 'digest'] as const) {
    ok(maxTokensFor(t, 80_000, { mode: 'detailed' }) <= 16_000, `${t} ≤ 16 000`);
  }
});

Deno.test('INTERRUPTEUR D’URGENCE STUDY_AI_ENABLED=false : aucun appel payant, aucune base, aucune authentification, message sans détail', async () => {
  for (const v of ['false', 'FALSE', '0', 'off', ' no ']) {
    Deno.env.set('STUDY_AI_ENABLED', v);
    try {
      install({});
      const r = await post({ task: 'summarize', input: 'Un cours confidentiel.' });
      eq(r.status, 503, `statut (${v})`);
      eq(await r.json(), { error: 'ai_disabled', code: 'AI-DISABLED' }, `corps (${v})`);
      eq(r.headers.get('Retry-After'), '300', 'Retry-After');
      eq(seen.length, 0, `aucun appel réseau du tout (${v}) : ni fournisseur, ni Supabase Auth, ni base`);
    } finally { Deno.env.delete('STUDY_AI_ENABLED'); }
  }
  // réactivé : fonctionne ; valeurs inconnues → activé (jamais bloqué par une faute de frappe)
  for (const v of [undefined, 'true', '1', 'yes', 'peut-etre']) {
    if (v !== undefined) Deno.env.set('STUDY_AI_ENABLED', v);
    try { install({}); eq((await post({ task: 'summarize', input: 'Un cours.' })).status, 200, `activé (${v})`); } finally { Deno.env.delete('STUDY_AI_ENABLED'); }
  }
});

Deno.test('BUDGET GLOBAL atteint : 503 « capacité » (pas 429), Retry-After, aucun appel au modèle ; paramètres configurables par secrets', async () => {
  install({ gate: { ok: false, reason: 'global_per_day', limit: 2000, retry_after: 3600 } });
  const r = await post({ task: 'summarize', input: 'Un cours.' });
  eq(r.status, 503, 'statut'); eq(r.headers.get('Retry-After'), '3600', 'Retry-After');
  eq(await r.json(), { error: 'ai_capacity', code: 'AI-CAPACITY', reason: 'global_per_day', retry_after: 3600 }, 'corps (sans chiffre interne du budget)');
  ok(!seen.some((s) => s.url.includes('anthropic')), 'aucun appel payant');
  Deno.env.set('STUDY_AI_GLOBAL_MAX_REQUESTS_DAY', '50'); Deno.env.set('STUDY_AI_GLOBAL_MAX_CHARS_DAY', '1000000'); Deno.env.set('STUDY_AI_MAX_PER_MINUTE', 'abc');
  try {
    install({}); await post({ task: 'summarize', input: 'Un cours.' });
    const acq = rpcCalls.find((x) => x.fn === 'study_ai_acquire')!.body;
    eq([acq.p_global_per_day, acq.p_global_chars_per_day], [50, 1_000_000], 'budget global lu des secrets');
    eq(acq.p_per_minute, 12, 'valeur invalide → valeur par défaut (jamais « illimité » par accident)');
  } finally { for (const k of ['STUDY_AI_GLOBAL_MAX_REQUESTS_DAY', 'STUDY_AI_GLOBAL_MAX_CHARS_DAY', 'STUDY_AI_MAX_PER_MINUTE']) Deno.env.delete(k); }
});

Deno.test('JOURNAUX : métadonnées uniquement — jamais le texte, le prompt ni la réponse du modèle', async () => {
  const lines: string[] = []; const orig = console.log;
  console.log = (...a: unknown[]) => { lines.push(a.map(String).join(' ')); };
  try {
    install({ text: '{"blocks":[{"kind":"paragraph","text":"REPONSE-CONFIDENTIELLE"}]}' });
    await post({ task: 'summarize', input: 'TEXTE-CONFIDENTIEL de la transcription', options: { mode: 'express' } });
    install({ stop: 'refusal' });
    await post({ task: 'translate', input: 'AUTRE-TEXTE-CONFIDENTIEL' });
  } finally { console.log = orig; }
  const all = lines.join('\n');
  ok(lines.length >= 2 && lines.every((l) => l.startsWith('[study-ai]')), 'préfixe [study-ai] sur chaque ligne');
  ok(!/CONFIDENTIEL|sk-test|Bearer|good/.test(all), 'ni texte, ni réponse, ni clé, ni jeton dans les journaux');
  ok(/"task":"summarize"/.test(all) && /"in_chars":/.test(all) && /"out_tokens":5/.test(all) && /"model":"claude-opus-5-5"/.test(all), 'métadonnées présentes');
  ok(/"code":"refused"/.test(all), 'code d’erreur journalisé');
});
