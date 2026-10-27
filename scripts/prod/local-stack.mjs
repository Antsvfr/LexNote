#!/usr/bin/env node
// DEUX piles Supabase LOCALES et indépendantes (LexNote + REV-EM) pour tester l'intégration à 0 € — jamais de projet distant, jamais de clé de production.
//
//   node scripts/prod/local-stack.mjs prepare --revem-repo ../rev-em     génère les dossiers de travail (config isolée, migrations, fonctions, secrets de TEST)
//   node scripts/prod/local-stack.mjs up      --revem-repo ../rev-em     prepare + démarre les deux piles + sert les fonctions + crée les comptes de test
//   node scripts/prod/local-stack.mjs verify  [--record]                 migrations, smoke, diagnostic, real-e2e, interrupteur IA ; --record enregistre les preuves
//   node scripts/prod/local-stack.mjs down                                arrête les deux piles (ne touche à aucune autre pile locale)
//
// Isolation : chaque pile a son dossier (~/.lexnote-local-stacks/<lexnote|revem>), son project_id (lexnote-local / revem-local) et ses propres ports
// (LexNote 544xx, REV-EM 545xx) ; le Supabase CLI est piloté avec --workdir. Les config.toml du dépôt (production) ne sont JAMAIS modifiés :
// la config générée en reprend les sections [functions.*] (verify_jwt) et ne change que project_id et les ports.
// Secrets : clé d'intégration de TEST aléatoire et mots de passe aléatoires, écrits dans <home>/secrets.env (0600, hors dépôt) ; jamais affichés.
// Exige le runtime Supabase LOCAL « natif » (les fonctions de chaque pile appellent http://127.0.0.1:<port de l'autre pile>).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const STACKS = {
  lexnote: { projectId: 'lexnote-local', api: 54421, db: 54422, shadow: 54420, pooler: 54429, studio: 54423, smtp: 54424, analytics: 54427, inspector: 8183, app: 'http://localhost:5173' },
  revem: { projectId: 'revem-local', api: 54521, db: 54522, shadow: 54520, pooler: 54529, studio: 54523, smtp: 54524, analytics: 54527, inspector: 8283, app: 'http://localhost:8080' },
};
export const apiUrl = (s) => `http://127.0.0.1:${STACKS[s].api}`;
export const defaultHome = () => join(homedir(), '.lexnote-local-stacks');

/** config.toml d'une pile : celui du dépôt (verify_jwt par fonction) avec project_id remplacé, puis les sections de ports isolées. */
export function buildConfig(repoConfig, stack) {
  const s = STACKS[stack];
  const base = repoConfig.replace(/^project_id\s*=.*$/m, `project_id = "${s.projectId}"`);
  if (!/^project_id\s*=/m.test(base)) throw new Error('config.toml du dépôt sans project_id');
  // Les sections ci-dessous ne doivent pas déjà exister dans le fichier du dépôt (sinon doublon TOML) : on refuse plutôt que de deviner.
  for (const sec of ['api', 'db', 'db.pooler', 'studio', 'local_smtp', 'analytics', 'edge_runtime', 'auth']) if (new RegExp(`^\\[${sec.replace('.', '\\.')}\\]`, 'm').test(base)) throw new Error(`config.toml du dépôt contient déjà [${sec}] : génération refusée`);
  return `${base.trimEnd()}

# --- PILE LOCALE « ${stack} » (générée par scripts/prod/local-stack.mjs ; ne pas committer) ---
[api]
port = ${s.api}

[db]
port = ${s.db}
shadow_port = ${s.shadow}

[db.pooler]
enabled = false
port = ${s.pooler}

[studio]
enabled = false
port = ${s.studio}

[local_smtp]
port = ${s.smtp}

[analytics]
enabled = false
port = ${s.analytics}

[edge_runtime]
enabled = true
inspector_port = ${s.inspector}

[auth]
site_url = "${s.app}"
additional_redirect_urls = ["${s.app}"]
`;
}

/** Variables des fonctions Edge d'une pile : développement local explicite, clé de TEST commune, IA coupée. */
export function buildFunctionsEnv(stack, key, release = 'local') {
  const me = STACKS[stack]; const peer = STACKS[stack === 'lexnote' ? 'revem' : 'lexnote'];
  const appUrl = (st) => (st === 'revem' ? `${STACKS.revem.app}/REV-EM/` : `${STACKS.lexnote.app}/`);
  return [
    'INTEGRATION_ENV=development', 'INTEGRATION_KEY_ID=k1', `INTEGRATION_KEY=${key}`,
    `INTEGRATION_SELF_APP_URL=${appUrl(stack)}`, `INTEGRATION_PEER_APP_URL=${appUrl(stack === 'lexnote' ? 'revem' : 'lexnote')}`,
    `INTEGRATION_PEER_GATEWAY_URL=http://127.0.0.1:${peer.api}/functions/v1/integration-gateway`,
    `APP_ORIGINS=${me.app}`, 'STUDY_AI_ENABLED=false', `RELEASE_VERSION=${release}`,
  ].join('\n') + '\n';
}

export function parseEnvOutput(text) {
  const out = {};
  for (const line of text.split('\n')) { const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim()); if (m) out[m[1]] = m[2]; }
  return out;
}

const rand = (n) => randomBytes(n).toString('base64url');

export function prepare({ home, repoRoot, revemRepo, fs = { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync }, release = 'local' }) {
  if (!revemRepo || !fs.existsSync(join(revemRepo, 'supabase/migrations'))) throw new Error('--revem-repo : dépôt REV-EM (avec supabase/migrations) introuvable');
  const key = rand(48);   // clé d'intégration de TEST : n'existe que dans secrets.env
  const secrets = { INTEGRATION_KEY: key };
  for (const [stack, repo] of [['lexnote', repoRoot], ['revem', revemRepo]]) {
    const dir = join(home, stack, 'supabase');
    fs.rmSync(join(home, stack), { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(join(repo, 'supabase/migrations'), join(dir, 'migrations'), { recursive: true });
    if (fs.existsSync(join(repo, 'supabase/functions'))) fs.cpSync(join(repo, 'supabase/functions'), join(dir, 'functions'), { recursive: true });
    fs.writeFileSync(join(dir, 'config.toml'), buildConfig(fs.readFileSync(join(repo, 'supabase/config.toml'), 'utf8'), stack));
    const envFile = join(home, stack, 'functions.env');
    fs.writeFileSync(envFile, buildFunctionsEnv(stack, key, release)); fs.chmodSync(envFile, 0o600);
  }
  Object.assign(secrets, { LEX_PASSWORD_A: rand(18), LEX_PASSWORD_B: rand(18), REV_PASSWORD_A: rand(18), REV_PASSWORD_B: rand(18) });
  const f = join(home, 'secrets.env');
  fs.writeFileSync(f, Object.entries(secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); fs.chmodSync(f, 0o600);
  return { key };
}

/** Lit un fichier KEY=valeur (secrets.env / stacks.env). */
export function parseKv(text) {
  const out = {};
  for (const line of text.split('\n')) { const i = line.indexOf('='); if (i > 0 && /^[A-Z0-9_]+$/.test(line.slice(0, i))) out[line.slice(0, i)] = line.slice(i + 1); }
  return out;
}
export const readSecrets = (home) => parseKv(readFileSync(join(home, 'secrets.env'), 'utf8'));

/** Exécute le Supabase CLI sur une pile. `exec` est injectable (tests). */
const cli = (exec, home, stack, args, opts = {}) => exec('supabase', [...args, '--workdir', join(home, stack)], opts);
const realExec = (cmd, args, opts = {}) => { const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: opts.inherit ? 'inherit' : 'pipe', env: { ...process.env, ...(opts.env ?? {}) } }); return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' }; };

export async function up({ home, repoRoot, revemRepo, exec = realExec, log = console.log, fetchImpl = fetch, startServe = defaultServe, wait = (ms) => new Promise((r) => setTimeout(r, ms)), release }) {
  prepare({ home, repoRoot, revemRepo, release });
  const secrets = readSecrets(home); const keys = {};
  for (const stack of ['lexnote', 'revem']) {
    log(`→ démarrage de la pile ${stack} (ports ${STACKS[stack].api}/${STACKS[stack].db})…`);
    const r = cli(exec, home, stack, ['start'], { inherit: true });
    if (r.code !== 0) throw new Error(`supabase start (${stack}) a échoué — voir la sortie ci-dessus`);
    const st = cli(exec, home, stack, ['status', '-o', 'env']);
    const env = parseEnvOutput(st.out);
    const anon = env.ANON_KEY; const svc = env.SERVICE_ROLE_KEY;
    if (!anon || !svc) throw new Error(`supabase status (${stack}) : ANON_KEY / SERVICE_ROLE_KEY introuvables`);
    keys[stack] = { anon, svc, dbUrl: env.DB_URL };
    startServe(home, stack, log);
  }
  for (const stack of ['lexnote', 'revem']) {
    const probe = stack === 'lexnote' ? 'health' : 'integration-gateway';
    let ok = false;
    for (let i = 0; i < 45 && !ok; i++) { try { const res = await fetchImpl(`${apiUrl(stack)}/functions/v1/${probe}`, { headers: { apikey: keys[stack].anon } }); ok = res.status < 500; } catch { /* pas encore prêt */ } if (!ok) await wait(2000); }
    if (!ok) throw new Error(`fonctions de la pile ${stack} injoignables après 90 s — voir ${join(home, 'logs', `${stack}-functions.log`)}`);
    log(`✓ fonctions ${stack} servies (${probe})`);
  }
  // Comptes de test (création administrateur, e-mail confirmé) — local uniquement
  const accounts = {};
  for (const [stack, prefix, label] of [['lexnote', 'LEX', 'lex'], ['revem', 'REV', 'rev']]) {
    for (const who of ['A', 'B']) {
      const email = `${label}-${who.toLowerCase()}@smoke.lexnote.invalid`;
      const res = await fetchImpl(`${apiUrl(stack)}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: keys[stack].svc, authorization: `Bearer ${keys[stack].svc}`, 'content-type': 'application/json' }, body: JSON.stringify({ email, password: secrets[`${prefix}_PASSWORD_${who}`], email_confirm: true }) });
      if (res.status >= 300 && res.status !== 422) throw new Error(`création du compte ${email} impossible (HTTP ${res.status})`);   // 422 = existe déjà
      accounts[`${prefix}_${who}_EMAIL`] = email;
    }
  }
  const envOut = { ...accounts, LEX_API_URL: apiUrl('lexnote'), REV_API_URL: apiUrl('revem'), LEX_ANON_KEY: keys.lexnote.anon, LEX_SERVICE_ROLE_KEY: keys.lexnote.svc, REV_ANON_KEY: keys.revem.anon, REV_SERVICE_ROLE_KEY: keys.revem.svc, LEX_DB_URL: keys.lexnote.dbUrl ?? '', REV_DB_URL: keys.revem.dbUrl ?? '' };
  const f = join(home, 'stacks.env');
  writeFileSync(f, Object.entries(envOut).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'); chmodSync(f, 0o600);
  log(`✓ deux piles prêtes ; paramètres (clés locales) dans ${f} — jamais à committer`);
  return envOut;
}

function defaultServe(home, stack, log) {
  mkdirSync(join(home, 'logs'), { recursive: true });
  const logFile = join(home, 'logs', `${stack}-functions.log`);
  const out = spawn('sh', ['-c', `exec supabase functions serve --workdir "${join(home, stack)}" --env-file "${join(home, stack, 'functions.env')}" >> "${logFile}" 2>&1`], { detached: true, stdio: 'ignore' });
  out.unref();
  writeFileSync(join(home, `${stack}.pid`), String(out.pid));
  log(`  fonctions ${stack} servies en arrière-plan (journal : ${logFile})`);
}

export function down({ home, exec = realExec, log = console.log }) {
  for (const stack of ['lexnote', 'revem']) {
    const pidFile = join(home, `${stack}.pid`);
    if (existsSync(pidFile)) { try { process.kill(-Number(readFileSync(pidFile, 'utf8')), 'SIGTERM'); } catch { /* déjà arrêté */ } rmSync(pidFile, { force: true }); }
    if (existsSync(join(home, stack, 'supabase', 'config.toml'))) {
      const r = cli(exec, home, stack, ['stop', '--no-backup']);
      log(`${r.code === 0 ? '✓' : '✗'} pile ${stack} arrêtée`);
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (n) => (rest.includes(n) ? rest[rest.indexOf(n) + 1] : undefined);
  const home = resolve(flag('--home') ?? defaultHome());
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const revemRepo = flag('--revem-repo') ?? process.env.REVEM_REPO;
  const run = async () => {
    if (cmd === 'prepare') { prepare({ home, repoRoot, revemRepo: revemRepo && resolve(revemRepo) }); console.log(`dossiers générés dans ${home}`); return 0; }
    if (cmd === 'up') { await up({ home, repoRoot, revemRepo: revemRepo && resolve(revemRepo) }); return 0; }
    if (cmd === 'down') { down({ home }); return 0; }
    if (cmd === 'verify') { const { verify } = await import('./local-verify.mjs'); return verify({ home, repoRoot, record: rest.includes('--record') }); }
    console.error('usage : local-stack.mjs <prepare|up|verify|down> [--revem-repo <dépôt REV-EM>] [--home <dossier>] [--record]'); return 2;
  };
  run().then((c) => process.exit(c), (e) => { console.error(`ERREUR : ${String(e.message).slice(0, 300)}`); process.exit(1); });
}
