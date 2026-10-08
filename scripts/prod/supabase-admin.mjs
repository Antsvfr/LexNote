#!/usr/bin/env node
// Outil d'exploitation de l'intégration REV-EM ⇄ LexNote via l'API de gestion Supabase (https://api.supabase.com).
// ⚠ À lancer depuis VOTRE machine (jeton personnel SUPABASE_ACCESS_TOKEN). Aucune valeur secrète n'est jamais affichée ni écrite sur disque.
// Par défaut : SIMULATION (dry-run). Ajouter --apply pour exécuter. Sous-commandes :
//   apply-sql  --project <ref> --file <sql>                 applique une migration (une transaction côté API)
//   verify-db  --project <ref>                              exécute scripts/prod/verify-db.sql (PASS/FAIL) — lecture seule
//   set-secrets --app lexnote|revem --project <ref> --peer-ref <réf. de l'autre projet>   (INTEGRATION_KEY lue dans l'environnement)
//   auth-urls  --app lexnote|revem --project <ref> [--dev]  fusionne les URLs de redirection Auth (n'en supprime aucune)
//   advisors   --project <ref>                              Security + Performance Advisor, filtrés sur les objets d'intégration
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const API = 'https://api.supabase.com';
const here = dirname(fileURLToPath(import.meta.url));
export const OFFICIAL = {
  lexnote: { appUrl: 'https://lex-note-svfr.vercel.app/', redirects: ['https://lex-note-svfr.vercel.app/**', 'https://lex-note-svfr.vercel.app/integrations/revem/**'], dev: ['http://localhost:5173/**', 'http://localhost:4173/**'] },
  revem: { appUrl: 'https://antsvfr.github.io/REV-EM/', redirects: ['https://antsvfr.github.io/REV-EM/**'], dev: ['http://localhost:8080/**', 'http://localhost:3000/**'] },
};
const gatewayUrl = (ref) => `https://${ref}.supabase.co/functions/v1/integration-gateway`;
const REF = /^[a-z0-9]{20}$/;

export async function main(argv, env, fetchImpl = fetch, out = console.log) {
  const [cmd, ...rest] = argv;
  const flag = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
  const has = (n) => rest.includes(n);
  const apply = has('--apply');
  const token = env.SUPABASE_ACCESS_TOKEN;
  const project = flag('--project');
  const need = (v, name) => { if (!v) throw new Error(`argument manquant : ${name}`); return v; };
  if (!cmd) throw new Error('sous-commande manquante (apply-sql | verify-db | set-secrets | auth-urls | advisors)');
  need(project, '--project'); if (!REF.test(project)) throw new Error('--project doit être la référence du projet (20 caractères a-z0-9)');
  const call = async (method, path, body) => {
    if (!token) throw new Error('SUPABASE_ACCESS_TOKEN absent de l’environnement');
    const r = await fetchImpl(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text(); let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (r.status < 200 || r.status >= 300) throw new Error(`API Supabase ${method} ${path} → HTTP ${r.status}${r.status === 404 ? ' (point d’entrée indisponible : utiliser le tableau de bord)' : ''}`);
    return data;
  };
  const query = (sql) => call('POST', `/v1/projects/${project}/database/query`, { query: sql });

  if (cmd === 'apply-sql') {
    const file = need(flag('--file'), '--file'); const sql = readFileSync(file, 'utf8');
    out(`${apply ? 'APPLIQUE' : 'SIMULATION'} : ${file} (${sql.length} octets) → projet ${project}`);
    if (apply) { await query(sql); out('migration appliquée.'); }
    return 0;
  }
  if (cmd === 'verify-db') {
    const rows = await query(readFileSync(join(here, 'verify-db.sql'), 'utf8'));
    let fails = 0;
    for (const r of rows) { out(`${String(r.statut).padEnd(6)} ${r.n} ${r.controle}${r.detail && r.statut === 'FAIL' ? ` — ${r.detail}` : ''}`); if (r.statut === 'FAIL') fails++; }
    return fails ? 1 : 0;
  }
  if (cmd === 'set-secrets') {
    const app = need(flag('--app'), '--app'); if (!OFFICIAL[app]) throw new Error('--app doit valoir lexnote ou revem');
    const peerRef = need(flag('--peer-ref'), '--peer-ref'); if (!REF.test(peerRef)) throw new Error('--peer-ref invalide');
    const peer = app === 'lexnote' ? 'revem' : 'lexnote';
    const key = env.INTEGRATION_KEY;
    if (!key || key.length < 32) throw new Error('INTEGRATION_KEY absente ou trop courte (≥ 32 caractères) dans l’environnement — ex. export INTEGRATION_KEY="$(openssl rand -base64 48)"');
    const secrets = [
      ['INTEGRATION_ENV', env.INTEGRATION_ENV === 'development' ? 'development' : 'production'], ['INTEGRATION_KEY_ID', env.INTEGRATION_KEY_ID || 'k1'], ['INTEGRATION_KEY', key],
      ['INTEGRATION_SELF_APP_URL', OFFICIAL[app].appUrl], ['INTEGRATION_PEER_APP_URL', OFFICIAL[peer].appUrl], ['INTEGRATION_PEER_GATEWAY_URL', gatewayUrl(peerRef)],
    ];
    if (env.INTEGRATION_KEY_PREVIOUS) { secrets.push(['INTEGRATION_KEY_PREVIOUS', env.INTEGRATION_KEY_PREVIOUS], ['INTEGRATION_KEY_PREVIOUS_ID', need(env.INTEGRATION_KEY_PREVIOUS_ID, 'INTEGRATION_KEY_PREVIOUS_ID')]); }
    if (env.INTEGRATION_ALLOWED_ORIGINS) secrets.push(['INTEGRATION_ALLOWED_ORIGINS', env.INTEGRATION_ALLOWED_ORIGINS]);
    if (secrets.some(([, v]) => v.includes('*'))) throw new Error('valeur avec joker « * » refusée');
    for (const [n, v] of secrets) out(`  ${n} = ${/KEY$|KEY_PREVIOUS$/.test(n) ? `‹masquée, ${v.length} caractères›` : v}`);
    out(`${apply ? 'APPLIQUE' : 'SIMULATION'} : ${secrets.length} secrets → projet ${project} (${app})`);
    if (apply) { await call('POST', `/v1/projects/${project}/secrets`, secrets.map(([name, value]) => ({ name, value }))); out('secrets enregistrés.'); }
    return 0;
  }
  if (cmd === 'auth-urls') {
    const app = need(flag('--app'), '--app'); if (!OFFICIAL[app]) throw new Error('--app doit valoir lexnote ou revem');
    const wanted = [...OFFICIAL[app].redirects, ...(has('--dev') ? OFFICIAL[app].dev : [])];
    if (wanted.some((u) => u === '*' || u === '**' || /^https?:\/\/\*/.test(u))) throw new Error('joker global refusé');
    const cur = await call('GET', `/v1/projects/${project}/config/auth`);
    const existing = String(cur?.uri_allow_list ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const merged = [...new Set([...existing, ...wanted])];
    const added = merged.filter((u) => !existing.includes(u));
    out(`URLs de redirection existantes : ${existing.length} ; à ajouter : ${added.length ? added.join(', ') : '(aucune, déjà en place)'}`);
    if (existing.some((u) => u === '*' || u === '**')) out('⚠ une URL de redirection globale existe déjà : à retirer manuellement.');
    if (!cur?.site_url) out('⚠ site_url est vide : à renseigner dans le tableau de bord.');
    out(`${apply ? 'APPLIQUE' : 'SIMULATION'} (aucune URL existante n'est supprimée)`);
    if (apply && added.length) { await call('PATCH', `/v1/projects/${project}/config/auth`, { uri_allow_list: merged.join(',') }); out('URLs enregistrées.'); }
    return 0;
  }
  if (cmd === 'advisors') {
    let bad = 0;
    for (const kind of ['security', 'performance']) {
      let res; try { res = await call('GET', `/v1/projects/${project}/advisors/${kind}`); } catch (e) { out(`${kind} : ${e.message}`); bad++; continue; }
      const lints = res?.lints ?? res ?? [];
      const mine = lints.filter((l) => /integration_/i.test(JSON.stringify(l.metadata ?? l)));
      out(`${kind} : ${lints.length} alerte(s) au total, ${mine.length} concernant integration_*`);
      for (const l of lints) { const m = /integration_/i.test(JSON.stringify(l.metadata ?? l)); out(`  ${m ? '►' : ' '} [${l.level}] ${l.name} — ${l.title ?? l.detail ?? ''}`); if (m && (l.level === 'ERROR' || l.level === 'WARN')) bad++; }
    }
    return bad ? 1 : 0;
  }
  throw new Error(`sous-commande inconnue : ${cmd}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2), process.env).then((c) => process.exit(c)).catch((e) => { console.error(`ERREUR : ${e.message}`); process.exit(2); });
}
