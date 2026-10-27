// Contrôles du préflight. Chaque contrôle renvoie { level: 'PASS'|'WARN'|'FAIL', name, msg } — le msg ne contient JAMAIS la valeur d'un secret.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { checkChain, listMigrations } from './migrations.mjs';

export const EDGE_FUNCTIONS = ['course-engine', 'delete-account', 'health', 'integration-gateway', 'integration-link', 'study-ai'];
/** verify_jwt attendu (config.toml) : passerelles/sondes publiques = false ; fonctions utilisateur = défaut (true). */
export const PUBLIC_FUNCTIONS = ['integration-gateway', 'integration-link', 'health'];
const BUNDLE = 'supabase/functions/_shared/integration/lexnote-revem-v1.mjs';
const pass = (name, msg) => ({ level: 'PASS', name, msg });
const warn = (name, msg) => ({ level: 'WARN', name, msg });
const fail = (name, msg) => ({ level: 'FAIL', name, msg });

export function checkMigrations(dir = 'supabase/migrations') {
  const issues = checkChain(listMigrations(dir));
  return issues.length ? fail('migrations', issues.join(' ; ')) : pass('migrations', `${listMigrations(dir).length} migrations ordonnées, sans doublon d'horodatage`);
}

export function checkEdgeFunctions(root = 'supabase/functions') {
  const missing = EDGE_FUNCTIONS.filter((f) => !existsSync(`${root}/${f}/index.ts`));
  return missing.length ? fail('edge-functions', `index.ts manquant : ${missing.join(', ')}`) : pass('edge-functions', EDGE_FUNCTIONS.join(', '));
}

/** Lit `[functions.x] verify_jwt = false` dans config.toml. */
export function parseVerifyJwt(toml) {
  const out = {}; let cur = null;
  for (const line of toml.split('\n')) {
    const h = /^\s*\[functions\.([a-z0-9-]+)\]/.exec(line); if (h) { cur = h[1]; continue; }
    if (/^\s*\[/.test(line)) cur = null;
    const v = cur && /^\s*verify_jwt\s*=\s*(true|false)/.exec(line); if (v) out[cur] = v[1] === 'true';
  }
  return out;
}
export function checkConfigToml(file = 'supabase/config.toml') {
  if (!existsSync(file)) return fail('config.toml', `${file} absent`);
  const jwt = parseVerifyJwt(readFileSync(file, 'utf8'));
  const bad = [
    ...PUBLIC_FUNCTIONS.filter((f) => jwt[f] !== false).map((f) => `${f} doit avoir verify_jwt = false`),
    ...EDGE_FUNCTIONS.filter((f) => !PUBLIC_FUNCTIONS.includes(f) && jwt[f] === false).map((f) => `${f} ne doit PAS désactiver verify_jwt`),
  ];
  return bad.length ? fail('config.toml', bad.join(' ; ')) : pass('config.toml', `verify_jwt=false : ${PUBLIC_FUNCTIONS.join(', ')} ; autres fonctions protégées`);
}

/** Paquet lexnote-revem/v1 : empreinte de l'en-tête = empreinte du code, copie REV-EM identique (si le dépôt est disponible). */
export function checkBundle(revemRepo = process.env.REVEM_REPO) {
  if (!existsSync(BUNDLE)) return fail('integration-bundle', `${BUNDLE} absent`);
  const text = readFileSync(BUNDLE, 'utf8').replace(/\r\n/g, '\n');
  const m = /^\/\/ sha256 du code : ([0-9a-f]{64})\n/m.exec(text);
  if (!m) return fail('integration-bundle', 'en-tête sha256 introuvable');
  const nl = text.indexOf('\n', text.indexOf('// sha256'));
  const code = text.slice(nl + 1);
  if (createHash('sha256').update(code).digest('hex') !== m[1]) return fail('integration-bundle', 'empreinte de l\'en-tête ≠ empreinte du code (fichier modifié à la main ?)');
  if (revemRepo && existsSync(`${revemRepo}/${BUNDLE}`)) {
    return readFileSync(`${revemRepo}/${BUNDLE}`, 'utf8').replace(/\r\n/g, '\n') === text ? pass('integration-bundle', 'identique côté REV-EM') : fail('integration-bundle', 'copie REV-EM DIFFÉRENTE (node scripts/build-integration-bundle.mjs)');
  }
  return pass('integration-bundle', `cohérent (${m[1].slice(0, 12)}…) ; copie REV-EM non vérifiée (REVEM_REPO absent)`);
}

const CLIENT_FORBIDDEN = [/SUPABASE_SERVICE_ROLE_KEY/, /\bINTEGRATION_KEYS?\b/, /ANTHROPIC_API_KEY/];
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => d.isDirectory() ? walk(`${dir}/${d.name}`) : [`${dir}/${d.name}`]);
/** Ancienne architecture / fuites côté navigateur : aucun secret serveur dans src/, aucun jeton dans une URL de lancement. */
export function checkClientArchitecture(src = 'src') {
  const problems = [];
  // src/integration/ est le CONTRAT partagé avec les Edge Functions (Deno) : il cite les noms de secrets dans ses messages, sans jamais les contenir.
  for (const f of walk(src).filter((x) => /\.(ts|tsx)$/.test(x) && !/\.test\./.test(x) && !x.startsWith(`${src}/integration/`))) {
    const t = readFileSync(f, 'utf8');
    for (const re of CLIENT_FORBIDDEN) if (re.test(t)) problems.push(`${f} : référence à un secret serveur`);
    if (/[?&#](access_token|refresh_token)=/.test(t) && !/analytics|sanitize|strip|remove/i.test(t)) problems.push(`${f} : jeton dans une URL`);
  }
  return problems.length ? fail('client-architecture', problems.join(' ; ')) : pass('client-architecture', 'aucun secret serveur ni jeton d\'URL dans src/');
}

/** Rôle porté par un JWT Supabase (anon / service_role) SANS afficher le jeton. */
export function jwtRole(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role ?? null; } catch { return null; }
}
export function checkFrontendEnv(env, production) {
  const out = []; const bad = production ? fail : warn;
  const url = env.VITE_SUPABASE_URL; const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url) out.push(bad('frontend-env', 'VITE_SUPABASE_URL manquante'));
  else if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co\/?$/.test(url)) out.push(bad('frontend-env', 'VITE_SUPABASE_URL n\'est pas une URL https://<réf>.supabase.co'));
  if (!key) out.push(bad('frontend-env', 'VITE_SUPABASE_ANON_KEY manquante'));
  else { const role = jwtRole(key); if (role === 'service_role') out.push(fail('frontend-env', 'VITE_SUPABASE_ANON_KEY contient une clé service_role (SECRÈTE) — à retirer immédiatement')); else if (key.startsWith('eyJ') && role !== 'anon') out.push(bad('frontend-env', 'VITE_SUPABASE_ANON_KEY : rôle inattendu')); }
  if (env.VITE_BACKEND === 'mock') out.push(fail('frontend-env', 'VITE_BACKEND=mock : un build de production ne doit pas utiliser le backend de test'));
  if (!env.VITE_AI_URL) out.push(warn('frontend-env', 'VITE_AI_URL absente : les actions IA seront indisponibles'));
  else if (!/^https:\/\//.test(env.VITE_AI_URL)) out.push(bad('frontend-env', 'VITE_AI_URL doit être en https'));
  return out.length ? out : [pass('frontend-env', 'VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (rôle anon), VITE_AI_URL')];
}

export function checkServerEnv(env, production) {
  const out = []; const bad = production ? fail : warn;
  const origins = (env.APP_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origins.length) out.push(bad('server-env', 'APP_ORIGINS manquante'));
  else if (origins.some((o) => o === '*' || (!o.startsWith('https://') && !/^http:\/\/localhost(:\d+)?$/.test(o)))) out.push(fail('server-env', 'APP_ORIGINS : "*" ou origine non https interdits'));
  if (!env.ANTHROPIC_API_KEY) out.push(warn('server-env', 'ANTHROPIC_API_KEY absente de cet environnement (secret Supabase : à vérifier avec `supabase secrets list`)'));
  if (!env.INTEGRATION_KEY && !env.INTEGRATION_KEYS) out.push(warn('server-env', 'INTEGRATION_KEY(S) absente de cet environnement (idem)'));
  if (env.STUDY_AI_ENABLED && ['false', '0', 'off', 'no', 'disabled'].includes(env.STUDY_AI_ENABLED.toLowerCase())) out.push(warn('server-env', 'STUDY_AI_ENABLED=false : l\'IA est COUPÉE'));
  for (const v of ['STUDY_AI_GLOBAL_MAX_REQUESTS_DAY', 'STUDY_AI_GLOBAL_MAX_CHARS_DAY']) if (env[v] === '0') out.push(warn('server-env', `${v}=0 : budget global DÉSACTIVÉ (à éviter en production)`));
  return out.length ? out : [pass('server-env', 'APP_ORIGINS (https), clés présentes, budget global actif')];
}

const SECRET_PATTERNS = [
  ['clé API Anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['jeton d\'accès personnel Supabase', /sbp_[a-f0-9]{30,}/],
  ['clé privée', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
/** JWT Supabase portant le rôle service_role dans un fichier versionné. */
export function scanText(text, { fixture = false } = {}) {
  const found = [];
  for (const [kind, re] of SECRET_PATTERNS) if (re.test(text)) found.push(kind);
  if (!fixture) for (const m of text.matchAll(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g)) if (jwtRole(m[0]) === 'service_role') found.push('clé service_role');
  return found;
}
export function checkCommittedSecrets(files = trackedFiles()) {
  const hits = [];
  for (const f of files) {
    if (/(^|\/)\.env(\.|$)/.test(f) && !/\.example$/.test(f)) hits.push(`${f} : fichier d'environnement versionné`);
    if (/\.(png|jpe?g|gif|ico|woff2?|pdf|zip|webp)$/i.test(f) || !existsSync(f)) continue;
    let t; try { t = readFileSync(f, 'utf8'); } catch { continue; }
    // fichiers de test : un JWT service_role FACTICE sert de fixture (détection de fuite) ; les autres motifs restent interdits
    for (const k of scanText(t, { fixture: /\.test\.[tj]sx?$|\/tests?\//.test(f) })) hits.push(`${f} : ${k}`);
  }
  return hits.length ? fail('committed-secrets', hits.join(' ; ')) : pass('committed-secrets', `${files.length} fichiers versionnés analysés, aucun secret détecté`);
}
export function trackedFiles() { try { return execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch { return []; } }
