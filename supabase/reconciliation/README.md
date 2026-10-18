# Réconciliation PR #5 → schéma officiel — HISTORIQUE / MAINTENANCE

> ⚠ **Déjà effectuée sur le projet Supabase LexNote de production.** Ces scripts ne font PAS partie de la chaîne de
> migrations (`supabase/migrations/`) : ni la CLI Supabase ni l'application ne les exécutent. Ne les relancez pas.

Ils sont conservés :

- comme trace de ce qui a été fait (voir [docs/SCHEMA_RECONCILIATION.md](../../docs/SCHEMA_RECONCILIATION.md)) ;
- comme outil de maintenance si un **autre** projet portait encore l'ancien schéma expérimental de la PR #5 (SUPERSEDED) ;
- `verify-official-schema.sql` est en **lecture seule** et peut servir à tout moment de contrôle :
  `node scripts/prod/supabase-admin.mjs verify-schema --project <ref>`.

Garde-fous (testés dans `tests/db/schema-reconciliation.test.ts`) : l'étape 1 refuse un schéma inconnu et ne fait rien sur
un projet déjà officiel ; chaque étape est atomique et idempotente.
