// Logique de l'Edge Function « study-ai » (séparée de `index.ts` pour être testée sans serveur : voir handler.test.ts).
// Edge Function « study-ai » — actions IA sur une TRANSCRIPTION (résumé, traduction, structuration, points clés…).
//
// ⚠ Non déployée et non testée contre un vrai modèle depuis l'environnement de développement (aucune clé) : à valider après
//   déploiement (voir docs/TRANSCRIPT_ACTIONS.md).
//
// Sécurité :
//  - l'appelant est identifié par SON jeton (JWT vérifié par Supabase + getUser) ; anonyme → 401 ;
//  - la clé du modèle est un SECRET du serveur (ANTHROPIC_API_KEY) ; elle n'est jamais renvoyée ni journalisée ;
//  - seul du TEXTE est reçu (jamais d'audio) ; rien n'est stocké ici ; la réponse est revalidée par le client (zod) ;
//  - CORS limité aux origines de l'application (APP_ORIGINS), jamais « * ».
//
// Déploiement :
//   supabase secrets set ANTHROPIC_API_KEY=... APP_ORIGINS=https://lex-note-svfr.vercel.app [STUDY_AI_MODEL=claude-opus-5-5]
//   (facultatif : STUDY_AI_MAX_CONCURRENT, STUDY_AI_MAX_PER_MINUTE, STUDY_AI_MAX_PER_DAY, STUDY_AI_MAX_CHARS_PER_DAY, STUDY_AI_TIMEOUT_MS,
//    STUDY_AI_GLOBAL_MAX_REQUESTS_DAY, STUDY_AI_GLOBAL_MAX_CHARS_DAY, STUDY_AI_MAX_OUTPUT_TOKENS)
//   INTERRUPTEUR D'URGENCE : STUDY_AI_ENABLED=false → aucun appel au fournisseur payant, réponse 503 `ai_disabled` immédiate.
//   Prérequis : migrations 20261016 (limitation de débit) puis 20261018 (budget global, métadonnées, rétention). Appliquer la migration AVANT
//   de redéployer : la fonction refuse tout appel (fermé) si le contrôle de débit est indisponible.
//   Journalisation : métadonnées uniquement (tâche, tailles, jetons, modèle, durée, code) — jamais le texte, le prompt ni la réponse.
//   supabase functions deploy study-ai
// Côté application : VITE_AI_URL=https://<ref>.supabase.co/functions/v1/study-ai
//
// Fournisseur interchangeable : seule `callModel` dépend du fournisseur (aujourd'hui Anthropic, SDK officiel).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOC_SCHEMA, SYSTEM, TASKS, taskInstruction, type Task } from './prompts.ts';
import { AI_ERROR_CODES, globalLimits, isAiEnabled, LOW_EFFORT, maxTokensFor, modelTimeoutMs, outputCeiling, userLimits } from './budgets.ts';

const DEFAULT_MODEL = 'claude-opus-5-5';
/**
 * Taille maximale du texte reçu. Le client découpe à ~60 000 caractères (16 000 pour traduction/nettoyage) ; au-delà, 413.
 * ~80 000 caractères ≈ 20 000 jetons d'entrée : borne le coût d'un appel.
 */
export const MAX_INPUT = 80_000;
// Budgets de sortie par action, limites utilisateur / globales et interrupteur : voir budgets.ts (testé sans réseau).
export { maxTokensFor };
const env = (name: string) => Deno.env.get(name);

/** Journal technique : métadonnées SEULEMENT (jamais le texte, les notes, le prompt ni la réponse du modèle). */
function log(event: string, meta: Record<string, string | number | boolean | null | undefined>) {
  console.log(`[study-ai] ${event} ${JSON.stringify(meta)}`);
}

const origins = () => (Deno.env.get('APP_ORIGINS') ?? 'https://lex-note-svfr.vercel.app').split(',').map((s) => s.trim()).filter(Boolean);
function cors(req: Request): Record<string, string> {
  const o = req.headers.get('Origin') ?? '';
  return {
    ...(origins().includes(o) ? { 'Access-Control-Allow-Origin': o } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
/** Erreur au format commun : `error` (machine) + `code` (identifiant diagnostic que l'étudiant peut transmettre, ex. « AI-503 »). */
const err = (req: Request, error: string, status: number, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ error, code: AI_ERROR_CODES[error] ?? 'AI-500', ...extra }), { status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers } });

class HttpError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }

const LANG_RE = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/;
function readOptions(raw: unknown): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z]{1,32}$/.test(k)) continue;
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[k] = v;
    else if (typeof v === 'string' && v.length <= 200) out[k] = v;
  }
  for (const k of ['outputLanguage', 'targetLanguage', 'sourceLanguage']) if (k in out && !LANG_RE.test(String(out[k]))) delete out[k];
  if ('mode' in out && !['express', 'standard', 'detailed'].includes(String(out.mode))) delete out.mode;
  return out;
}

interface ModelResult { text: string; model: string; inputTokens: number; outputTokens: number }
async function callModel(task: Task, input: string, options: Record<string, string | number | boolean>): Promise<ModelResult> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new HttpError(503, 'not_configured');
  // Nouvelles tentatives du SDK : UNIQUEMENT les indisponibilités techniques (429 / 5xx / réseau), jamais un refus.
  const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: modelTimeoutMs(env) });
  const model = configuredModel();
  const structured = task !== 'digest';
  try {
    // Pas de repli automatique après un refus de sécurité : un refus est renvoyé tel quel (422), sans contournement.
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokensFor(task, input.length, options, outputCeiling(env)),
      output_config: { effort: LOW_EFFORT.includes(task) ? 'low' : 'medium', ...(structured ? { format: { type: 'json_schema', schema: DOC_SCHEMA } } : {}) },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{
        role: 'user',
        content: [
          // Le texte source d'abord, mis en cache : les actions suivantes sur la même transcription réutilisent ce préfixe.
          { type: 'text', text: `<source>\n${input}\n</source>`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: taskInstruction(task, options) },
        ],
      }],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === 'refusal') throw new HttpError(422, 'refused');
    if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'truncated');
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    if (!text.trim()) throw new HttpError(502, 'empty');
    return { text, model: msg.model, inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0 };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new HttpError(504, 'timeout');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(503, 'provider_busy');
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new HttpError(503, 'not_configured');
    if (e instanceof Anthropic.BadRequestError) throw new HttpError(502, 'bad_request');
    if (e instanceof Anthropic.APIError) throw new HttpError(503, 'unavailable');
    throw new HttpError(503, 'unavailable');
  }
}
/** Modèle configurable côté serveur (jamais côté navigateur). */
const configuredModel = () => Deno.env.get('STUDY_AI_MODEL') || DEFAULT_MODEL;

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return err(req, 'method_not_allowed', 405);
  // INTERRUPTEUR D'URGENCE — avant toute lecture, authentification ou base de données : aucun appel payant, réponse immédiate.
  if (!isAiEnabled(env)) return err(req, 'ai_disabled', 503, {}, { 'Retry-After': '300' });
  const auth = req.headers.get('Authorization');
  if (!auth) return err(req, 'unauthorized', 401);
  // L'appelant est identifié avec SON jeton ; aucune donnée d'un autre utilisateur n'est lue ici (rien n'est lu en base).
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await supa.auth.getUser();
  if (error || !data.user) return err(req, 'unauthorized', 401);
  try {
    const body = await req.json().catch(() => null) as { task?: unknown; input?: unknown; options?: unknown } | null;
    const task = String(body?.task ?? '') as Task;
    if (!TASKS.includes(task) || typeof body?.input !== 'string' || !body.input.trim()) return err(req, 'bad_request', 400);
    if (body.input.length > MAX_INPUT) return err(req, 'payload_too_large', 413, { limit: MAX_INPUT });
    if (!Deno.env.get('ANTHROPIC_API_KEY')) return err(req, 'not_configured', 503);

    // Limitation par utilisateur ET budget global, AVANT tout appel payant. Contrôle indisponible : refus (jamais d'appel non compté).
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const l = userLimits(env); const g0 = globalLimits(env);
    const gate = await admin.rpc('study_ai_acquire', {
      p_user: data.user.id, p_task: task, p_chars: body.input.length,
      p_max_concurrent: l.maxConcurrent, p_per_minute: l.perMinute, p_per_day: l.perDay, p_chars_per_day: l.charsPerDay,
      p_global_per_day: g0.requestsPerDay, p_global_chars_per_day: g0.charsPerDay,
    });
    if (gate.error || !gate.data) { log('gate_unavailable', { task }); return err(req, 'rate_limit_unavailable', 503); }
    const g = gate.data as { ok: boolean; id?: number; reason?: string; limit?: number; retry_after?: number };
    if (!g.ok) {
      const retry = Math.max(1, Number(g.retry_after ?? 60));
      log('refused_by_limit', { task, reason: g.reason ?? null });
      // Budget global atteint : ce n'est pas la faute de l'utilisateur → 503 « capacité », pas 429.
      if (g.reason?.startsWith('global_')) return err(req, 'ai_capacity', 503, { reason: g.reason, retry_after: retry }, { 'Retry-After': String(retry) });
      return err(req, 'rate_limited', 429, { reason: g.reason, limit: g.limit, retry_after: retry }, { 'Retry-After': String(retry) });
    }
    let status: 'ok' | 'error' | 'refused' = 'error';
    let usage: { inputTokens: number | null; outputTokens: number | null; model: string; errorCode: string | null } = { inputTokens: null, outputTokens: null, model: configuredModel(), errorCode: null };
    const t0 = Date.now();
    try {
      const res = await callModel(task, body.input, readOptions(body.options));
      status = 'ok'; usage = { inputTokens: res.inputTokens, outputTokens: res.outputTokens, model: res.model, errorCode: null };
      return json(req, { text: res.text, model: res.model, provider: 'anthropic' });
    } catch (e) {
      if (e instanceof HttpError) { usage.errorCode = e.code; if (e.code === 'refused') status = 'refused'; } else usage.errorCode = 'internal';
      throw e;
    } finally {
      const ms = Date.now() - t0;
      log(status, { task, in_chars: body.input.length, in_tokens: usage.inputTokens, out_tokens: usage.outputTokens, model: usage.model, ms, code: usage.errorCode });
      await admin.rpc('study_ai_release', {
        p_id: g.id, p_status: status, p_output_tokens: usage.outputTokens, p_input_tokens: usage.inputTokens, p_model: usage.model, p_duration_ms: ms, p_error_code: usage.errorCode,
      });
    }
  } catch (e) {
    if (e instanceof HttpError) return err(req, e.code, e.status);
    return err(req, 'internal', 500); // jamais de détail interne ni de secret dans la réponse
  }
}
