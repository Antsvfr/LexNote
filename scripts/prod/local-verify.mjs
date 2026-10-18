// Vérifications sur les DEUX piles locales démarrées par `local-stack.mjs up` (voir ce fichier). Appelé par `local-stack.mjs verify`.
// Chaque étape lance un script existant avec INTEGRATION_LOCAL=1 / SMOKE_LOCAL=1 : leurs garde-fous (lib/targets.mjs, supabase-smoke.mjs)
// refusent tout hôte distant. Rien n'est affiché des clés ; le rapport (verify-report.json) ne contient ni clé ni mot de passe.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const parseKv = (text) => Object.fromEntries(text.split('\n').filter((l) => /^[A-Z0-9_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const gitSha = (cwd) => { const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : 'unknown'; };
const mask = (text, secrets) => secrets.filter(Boolean).reduce((t, s) => t.split(s).join('‹masqué›'), text);

/** Définition des étapes (pure, testable) : commande, variables, critère de réussite, porte de release concernée. */
export function buildSteps(e) {
  const local = { INTEGRATION_LOCAL: '1', INTEGRATION_ENV: 'development' };
  const pair = { LEXNOTE_SUPABASE_URL: e.LEX_API_URL, REVEM_SUPABASE_URL: e.REV_API_URL, LEXNOTE_ANON_KEY: e.LEX_ANON_KEY, REVEM_ANON_KEY: e.REV_ANON_KEY, INTEGRATION_KEY: e.INTEGRATION_KEY, INTEGRATION_KEY_ID: 'k1', LEXNOTE_ORIGIN: 'http://localhost:5173', REVEM_ORIGIN: 'http://localhost:8080', REVEM_APP_URL: 'http://localhost:8080/REV-EM/' };
  return [
    { id: 'migrations-lexnote', title: 'LexNote local : 12 migrations appliquées', gate: null, cmd: ['node', 'scripts/prod/migration-status.mjs', '--db-url', e.LEX_DB_URL], env: {}, ok: (r) => r.code === 0 && /Aucune migration à appliquer/.test(r.out) && !/ABSENTE|DIFFÉRENTE/.test(r.out) },
    { id: 'smoke-lexnote', title: 'LexNote local : supabase-smoke', gate: null, cmd: ['node', 'scripts/prod/supabase-smoke.mjs'], env: { SMOKE_CONFIRM: '1', SMOKE_LOCAL: '1', SMOKE_SUPABASE_URL: e.LEX_API_URL, SMOKE_ANON_KEY: e.LEX_ANON_KEY, SMOKE_SERVICE_ROLE_KEY: e.LEX_SERVICE_ROLE_KEY }, ok: (r) => r.code === 0 && !/^FAIL/m.test(r.out) },
    { id: 'diagnostic', title: 'Intégration : integration-diagnostic (2 piles locales)', gate: 'integration-diagnostic', cmd: ['node', 'scripts/prod/integration-diagnostic.mjs'], env: { ...local, ...pair }, ok: (r) => r.code === 0 && /\[PASS\] INT-HMAC/.test(r.out) && !/\[FAIL\]/.test(r.out) },
    { id: 'real-e2e', title: 'Intégration : real-e2e (2 piles locales, attaques comprises)', gate: 'integration-real-e2e', cmd: ['node', 'scripts/prod/real-e2e.mjs'], env: { ...local, ...pair, REVEM_A_EMAIL: e.REV_A_EMAIL, REVEM_A_PASSWORD: e.REV_PASSWORD_A, REVEM_B_EMAIL: e.REV_B_EMAIL, REVEM_B_PASSWORD: e.REV_PASSWORD_B, LEXNOTE_A_EMAIL: e.LEX_A_EMAIL, LEXNOTE_A_PASSWORD: e.LEX_PASSWORD_A, LEXNOTE_B_EMAIL: e.LEX_B_EMAIL, LEXNOTE_B_PASSWORD: e.LEX_PASSWORD_B }, ok: (r) => r.code === 0 && !/^FAIL/m.test(r.out) },
    { id: 'killswitch', title: 'IA : interrupteur STUDY_AI_ENABLED=false sur la fonction study-ai locale', gate: 'ai-killswitch-local', cmd: ['node', 'scripts/prod/study-ai-smoke.mjs'], env: { SMOKE_CONFIRM: '1', SMOKE_EXPECT_DISABLED: '1', LEXNOTE_SUPABASE_URL: e.LEX_API_URL, LEXNOTE_ANON_KEY: e.LEX_ANON_KEY, LEXNOTE_A_EMAIL: e.LEX_A_EMAIL, LEXNOTE_A_PASSWORD: e.LEX_PASSWORD_A }, ok: (r) => r.code === 0 && /PASS — INTERRUPTEUR — sans jeton/.test(r.out) && /PASS — INTERRUPTEUR — avec jeton/.test(r.out) },
  ];
}

export function verify({ home, repoRoot, record = false, exec = (cmd, env) => { const r = spawnSync(cmd[0], cmd.slice(1), { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, ...env } }); return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }; }, log = console.log }) {
  const e = { ...parseKv(readFileSync(join(home, 'stacks.env'), 'utf8')), ...parseKv(readFileSync(join(home, 'secrets.env'), 'utf8')) };
  const secrets = Object.entries(e).filter(([k]) => /KEY|PASSWORD/.test(k)).map(([, v]) => v);
  const report = { sha: gitSha(repoRoot), at: new Date().toISOString(), env: 'deux piles Supabase LOCALES (pas de cloud)', steps: [] };
  for (const step of buildSteps(e)) {
    const r = exec(step.cmd, step.env);
    const ok = step.ok(r);
    const tail = mask(r.out, secrets).split('\n').filter(Boolean).slice(-6).join('\n');
    log(`${ok ? 'PASS' : 'FAIL'} — ${step.title}`);
    if (!ok) log(tail.split('\n').map((l) => `    ${l}`).join('\n'));
    report.steps.push({ id: step.id, ok, gate: step.gate });
    if (ok && record && step.gate) {
      const note = `PASS sur deux piles Supabase LOCALES réelles (pas de validation cloud) — ${step.title}`;
      const rr = exec(['node', 'scripts/prod/evidence.mjs', 'record', step.gate, 'PASS', '--note', note], {});
      log(rr.code === 0 ? `    preuve enregistrée : ${step.gate}` : `    enregistrement impossible : ${step.gate}`);
    }
  }
  writeFileSync(join(home, 'verify-report.json'), JSON.stringify(report, null, 2) + '\n');
  const failed = report.steps.filter((s) => !s.ok).length;
  log(`\n${report.steps.length - failed}/${report.steps.length} étapes réussies — rapport : ${join(home, 'verify-report.json')} (sans clé)`);
  return failed ? 1 : 0;
}
