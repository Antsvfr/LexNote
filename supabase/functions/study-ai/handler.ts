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
//   (facultatif : STUDY_AI_MAX_CONCURRENT, STUDY_AI_MAX_PER_MINUTE, STUDY_AI_MAX_PER_DAY, STUDY_AI_MAX_CHARS_PER_DAY, STUDY_AI_TIMEOUT_MS)
//   Prérequis : migration 20261016000000_study_ai_usage.sql (limitation de débit).
//   supabase functions deploy study-ai
// Côté application : VITE_AI_URL=https://<ref>.supabase.co/functions/v1/study-ai
//
// Fournisseur interchangeable : seule `callModel` dépend du fournisseur (aujourd'hui Anthropic, SDK officiel).
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DOC_SCHEMA, SYSTEM, TASKS, taskInstruction, type Task } from './prompts.ts';

const DEFAULT_MODEL = 'claude-opus-5-5';
/**
 * Taille maximale du texte reçu. Le client découpe à ~60 000 caractères (16 000 pour traduction/nettoyage) ; au-delà, 413.
 * ~80 000 caractères ≈ 20 000 jetons d'entrée : borne le coût d'un appel.
 */
export const MAX_INPUT = 80_000;
/** Tâches « mécaniques » (partie par partie) : effort réduit ; rédaction : effort moyen. */
const LOW_EFFORT: Task[] = ['translate', 'clean', 'digest'];

/**
 * Plafond de SORTIE par tâche (jetons), réflexion adaptative comprise : assez pour un résultat complet, jamais une génération
 * sans fin. Les tâches « proportionnelles » (traduction, nettoyage, structuration) suivent la taille du texte reçu.
 */
export function maxTokensFor(task: Task, inputChars: number, options: Record<string, string | number | boolean>): number {
  const inTok = Math.ceil(inputChars / 4); // ordre de grandeur : ~4 caractères par jeton
  const thinking = LOW_EFFORT.includes(task) ? 1000 : 3000;
  const base = (() => {
    switch (task) {
      case 'summarize': return options.mode === 'express' ? 1500 : options.mode === 'detailed' ? 8000 : 4000;
      case 'key-points': case 'to-remember': case 'explain': case 'flashcard': return 2500;
      case 'definitions': case 'glossary': case 'concepts': case 'course-plan': return 4000;
      case 'exam-questions': case 'teacher-questions': case 'ambiguities': case 'important-passages': return 3500;
      case 'digest': return Math.min(3000, Math.max(800, Math.ceil(inTok * 0.3)));
      case 'structure': return Math.min(12000, Math.max(3000, Math.ceil(inTok * 1.1)));
      case 'translate': case 'clean': return Math.min(12000, Math.max(1000, Math.ceil(inTok * 1.5)));
    }
  })();
  return base + thinking;
}

/** Limites par utilisateur (surchargées par secrets serveur) : protection contre les coûts et les abus. */
export const limits = () => ({
  maxConcurrent: Number(Deno.env.get('STUDY_AI_MAX_CONCURRENT') ?? 2),
  perMinute: Number(Deno.env.get('STUDY_AI_MAX_PER_MINUTE') ?? 12),
  perDay: Number(Deno.env.get('STUDY_AI_MAX_PER_DAY') ?? 200),
  charsPerDay: Number(Deno.env.get('STUDY_AI_MAX_CHARS_PER_DAY') ?? 3_000_000),
});
/** Délai maximal d'un appel au modèle (la plateforme coupe la fonction au-delà de ~150 s). */
const modelTimeoutMs = () => Number(Deno.env.get('STUDY_AI_TIMEOUT_MS') ?? 120_000);

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
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

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

async function callModel(task: Task, input: string, options: Record<string, string | number | boolean>): Promise<{ text: string; model: string; outputTokens: number }> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new HttpError(503, 'not_configured');
  // Nouvelles tentatives du SDK : UNIQUEMENT les indisponibilités techniques (429 / 5xx / réseau), jamais un refus.
  const client = new Anthropic({ apiKey: key, maxRetries: 2, timeout: modelTimeoutMs() });
  const model = Deno.env.get('STUDY_AI_MODEL') || DEFAULT_MODEL;
  const structured = task !== 'digest';
  try {
    // Pas de repli automatique après un refus de sécurité : un refus est renvoyé tel quel (422), sans contournement.
    const stream = client.messages.stream({
      model,
      max_tokens: maxTokensFor(task, input.length, options),
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
    return { text, model: msg.model, outputTokens: msg.usage?.output_tokens ?? 0 };
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

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'method_not_allowed' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json(req, { error: 'unauthorized' }, 401);
  // L'appelant est identifié avec SON jeton ; aucune donnée d'un autre utilisateur n'est lue ici (rien n'est lu en base).
  const supa = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data, error } = await supa.auth.getUser();
  if (error || !data.user) return json(req, { error: 'unauthorized' }, 401);
  try {
    const body = await req.json().catch(() => null) as { task?: unknown; input?: unknown; options?: unknown } | null;
    const task = String(body?.task ?? '') as Task;
    if (!TASKS.includes(task) || typeof body?.input !== 'string' || !body.input.trim()) return json(req, { error: 'bad_request' }, 400);
    if (body.input.length > MAX_INPUT) return json(req, { error: 'payload_too_large', limit: MAX_INPUT }, 413);
    if (!Deno.env.get('ANTHROPIC_API_KEY')) return json(req, { error: 'not_configured' }, 503);

    // Limitation par utilisateur, AVANT tout appel payant. En cas d'indisponibilité du contrôle : refus (pas d'appel non compté).
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
    const l = limits();
    const gate = await admin.rpc('study_ai_acquire', {
      p_user: data.user.id, p_task: task, p_chars: body.input.length,
      p_max_concurrent: l.maxConcurrent, p_per_minute: l.perMinute, p_per_day: l.perDay, p_chars_per_day: l.charsPerDay,
    });
    if (gate.error || !gate.data) return json(req, { error: 'rate_limit_unavailable' }, 503);
    const g = gate.data as { ok: boolean; id?: number; reason?: string; limit?: number; retry_after?: number };
    if (!g.ok) {
      const retry = Math.max(1, Number(g.retry_after ?? 60));
      return new Response(JSON.stringify({ error: 'rate_limited', reason: g.reason, limit: g.limit, retry_after: retry }), { status: 429, headers: { ...cors(req), 'Content-Type': 'application/json', 'Retry-After': String(retry) } });
    }
    let status: 'ok' | 'error' | 'refused' = 'error'; let outputTokens: number | null = null;
    try {
      const res = await callModel(task, body.input, readOptions(body.options));
      status = 'ok'; outputTokens = res.outputTokens;
      return json(req, { text: res.text, model: res.model, provider: 'anthropic' });
    } catch (e) {
      if (e instanceof HttpError && e.code === 'refused') status = 'refused';
      throw e;
    } finally {
      await admin.rpc('study_ai_release', { p_id: g.id, p_status: status, p_output_tokens: outputTokens });
    }
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.code }, e.status);
    return json(req, { error: 'internal' }, 500); // jamais de détail interne ni de secret dans la réponse
  }
}
