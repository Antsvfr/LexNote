// Construit le paquet AUTONOME `lexnote-revem-v1.mjs` (zod inclus, sans dépendance) à partir de src/integration,
// et le copie à l'identique dans les Edge Functions des deux projets. `--check` échoue si une copie diffère (utilisé en CI / en test).
//   node scripts/build-integration-bundle.mjs [--revem <chemin du dépôt REV-EM>] [--check]
import { build } from 'rolldown';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const check = args.includes('--check');
const revem = resolve(flag('--revem') ?? process.env.REVEM_REPO ?? '/home/user/rev-em');
const out = 'supabase/functions/_shared/integration/lexnote-revem-v1.mjs';

const res = await build({
  input: 'src/integration/bundle-entry.ts', write: false,
  output: { format: 'esm', minify: false, comments: { legal: false } },
  platform: 'neutral', treeshake: true, logLevel: 'silent',
});
const code = res.output[0].code.replace(/\r\n/g, '\n');
const header = `// GÉNÉRÉ par scripts/build-integration-bundle.mjs — NE PAS MODIFIER À LA MAIN. Contrat lexnote-revem/v1 (zod inclus).\n// sha256 du code : ${createHash('sha256').update(code).digest('hex')}\n`;
const content = header + code;

const targets = [resolve(out)];
if (existsSync(revem)) targets.push(join(revem, out));
let bad = 0;
for (const t of targets) {
  if (check) { if (!existsSync(t) || readFileSync(t, 'utf8') !== content) { console.error(`DIFFÈRE : ${t}`); bad++; } else console.log(`ok       : ${t}`); continue; }
  mkdirSync(dirname(t), { recursive: true }); writeFileSync(t, content); console.log(`écrit    : ${t}`);
}
process.exit(bad ? 1 : 0);
