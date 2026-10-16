#!/usr/bin/env node
// Verdict de mise en production : READY / NOT READY, lisible par une machine (--json). Code de sortie 0 = READY, 1 = NOT READY.
//   node scripts/prod/release-gates.mjs [--json]
// Ne lance rien : lit release/gates.json et release/evidence.json (voir scripts/prod/evidence.mjs).
import { fileURLToPath } from 'node:url';
import { loadAndEvaluate } from './lib/gates.mjs';

export function run(argv, out = console.log) {
  const r = loadAndEvaluate();
  if (argv.includes('--json')) out(JSON.stringify(r, null, 2));
  else {
    for (const g of r.results) out(`[${g.status.padEnd(7)}] ${g.id.padEnd(24)} ${g.title}${g.status === 'PASS' ? '' : `  — ${g.reason}`}`);
    out(`\nVERDICT : ${r.verdict}  (commit ${r.sha.slice(0, 7)}, ${r.blockers.length} porte(s) bloquante(s))`);
  }
  return r.verdict === 'READY' ? 0 : 1;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) process.exit(run(process.argv.slice(2)));
