#!/usr/bin/env node
// Préflight de mise en production — PASS / WARN / FAIL, code de sortie ≠ 0 au moindre FAIL. N'affiche JAMAIS un secret. Ne déploie rien.
//   node scripts/prod/preflight.mjs [--target production] [--with-typecheck] [--with-build] [--with-schema]
//   --target production : les variables manquantes (frontend et serveur) deviennent des FAIL au lieu de WARN.
//   --with-typecheck / --with-build / --with-schema : contrôles lents (tsc, vite build, validation des migrations dans PGlite).
// Les variables sont lues dans l'environnement du processus (et .env.production / .env.local s'ils existent, sans les afficher).
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as C from './lib/preflight-checks.mjs';
import { loadAndEvaluate } from './lib/gates.mjs';

function dotenv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').map((l) => /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]));
}
const slow = (name, cmd, args) => { const r = spawnSync(cmd, args, { stdio: 'ignore', shell: false }); return r.status === 0 ? { level: 'PASS', name, msg: `${cmd} ${args.join(' ')}` } : { level: 'FAIL', name, msg: `${cmd} ${args.join(' ')} a échoué (code ${r.status})` }; };

export function runPreflight(argv, baseEnv = process.env) {
  const production = argv.includes('--target') && argv[argv.indexOf('--target') + 1] === 'production';
  const env = { ...dotenv('.env.local'), ...dotenv('.env.production'), ...baseEnv };
  const results = [
    C.checkMigrations(), C.checkEdgeFunctions(), C.checkConfigToml(), C.checkBundle(), C.checkClientArchitecture(),
    ...C.checkFrontendEnv(env, production), ...C.checkServerEnv(env, production), C.checkCommittedSecrets(),
  ];
  results.push(argv.includes('--with-typecheck') ? slow('typecheck', 'npm', ['run', 'typecheck']) : { level: 'WARN', name: 'typecheck', msg: 'non exécuté ici (--with-typecheck)' });
  results.push(argv.includes('--with-build') ? slow('production-build', 'npm', ['run', 'build']) : { level: 'WARN', name: 'production-build', msg: 'non exécuté ici (--with-build)' });
  results.push(argv.includes('--with-schema') ? slow('expected-schema', 'npx', ['vitest', 'run', 'tests/prod/migration-status.test.ts']) : { level: 'WARN', name: 'expected-schema', msg: 'non exécuté ici (--with-schema) ; la base réelle se contrôle avec migration-status.mjs' });
  // Les vérifications RÉELLES (Supabase de test, IA, navigateurs…) ne sont pas faisables ici : on les rappelle depuis les portes de déploiement.
  const gates = loadAndEvaluate();
  for (const g of gates.results.filter((x) => x.kind === 'manual' && x.status !== 'PASS')) results.push({ level: 'WARN', name: g.id, msg: `${g.title} — ${g.status}` });
  return results;
}

export function main(argv, out = console.log) {
  const results = runPreflight(argv);
  for (const r of results) out(`[${r.level}] ${r.name} — ${r.msg}`);
  const n = (l) => results.filter((r) => r.level === l).length;
  out(`\n${n('PASS')} PASS, ${n('WARN')} WARN, ${n('FAIL')} FAIL`);
  return n('FAIL') ? 1 : 0;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
