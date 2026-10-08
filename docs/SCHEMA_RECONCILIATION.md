# Schéma officiel de LexNote et réconciliation d'un projet existant

> **Décision d'architecture (validée).** LexNote n'a qu'**une seule architecture** : la chaîne de PR
> `main ← #3 auth-user-workspaces ← #4 smart-learning-outputs ← #6 intelligent-course-engine ← #7 study-artifacts-from-course ← #8 revem-integration-contract`
> (+ cette PR de réconciliation). La **PR #5 (`chatgpt/lexnote-multiuser`) est SUPERSEDED : elle ne doit jamais être fusionnée**, ni avant ni après #3.
> Tout développement futur part de la chaîne ci-dessus.

## 1. Audit du fork : #3 (chaîne officielle) vs #5 (supersédée)

Les deux branches partent de `main` (`cc56ee7`) et résolvent le même besoin (comptes + espaces personnels + synchronisation + CM/TD/TP) par **deux architectures incompatibles**.

| Domaine | Chaîne officielle (#3 → #8) | PR #5 (supersédée) |
|---|---|---|
| Client Supabase | `@supabase/supabase-js` (`services/backend`, `supabaseRemote`) | client HTTP maison (`services/supabase/client.ts`) + types générés |
| Moteur de sync | `SyncEngine` local-first : verrou optimiste `version`, tombstones, parents → enfants, curseur `server_updated_at`, résolution de conflits (deux versions conservées) | `sync/cloud.ts` + `captureCloud.ts` : export/import par blocs, pas de verrou optimiste |
| Schéma SQL | `20261007…lexnote_init.sql` : `id` fourni par le client (hors ligne), clés composites `(id, user_id)` partout, `server_updated_at`, `version`, `deleted_at`, `FORCE ROW LEVEL SECURITY`, policies par opération en `(select auth.uid())`, droits `anon` retirés | `001_multiuser_core.sql` : `gen_random_uuid()` serveur, deux FK par table, RLS non forcée, policy unique `for all` |
| Nommage | `type`, `date`, `number`, `notes_content`, `session_id`, `at_ms`, `term` | `session_type`, `session_date`, `session_number`, `notes`, `course_session_id`, `timestamp_ms`, `semester` |
| Tables | 10 de base + `external_accounts`, `study_artifacts`, `source_documents`, `generated_courses`, `integration_*` | 10 de base seulement |
| Auth / profil | trigger `lx_handle_new_user`, `lx_profiles_touch`, onboarding, récupération hors ligne, `delete-account` durci | trigger `handle_new_user`, `set_updated_at`, `quote` |
| Fonctionnalités au-dessus | StudyArtifacts, Course Engine, intégration REV-EM, accès hors ligne, import des données locales d'avant les comptes (`services/legacy`) | aucune |
| Tests | Vitest + PGlite (RLS), Playwright 80 tests | Vitest + 1 spec multi-utilisateur |

### Ce qui, dans #5, n'était PAS déjà dans la chaîne officielle — décision pour chacun

| Élément de #5 | Décision | Pourquoi |
|---|---|---|
| Workflow CI (`.github/workflows/ci.yml`) | **Repris** (commit isolé `ci: …`) | absent de la chaîne ; adapté : toute PR (chaîne empilée), typecheck + Vitest/PGlite + build + paquet d'intégration + Playwright |
| Migration « performance hardening » (index sur clés étrangères ; policies en `(select auth.uid())`) | **Idée reprise, réécrite** pour le schéma officiel (`20261012000000_fk_indexes.sql`, commit isolé) | les policies officielles sont déjà en `(select auth.uid())` ; en revanche **17 clés étrangères n'étaient pas indexées** (alerte `unindexed_foreign_keys`) |
| Schéma `001_multiuser_core.sql` | **Non repris** | incompatible (noms, clés, FK, RLS) ; c'est précisément ce qu'on réconcilie |
| Client HTTP Supabase, `database.types.ts`, `sync/cloud.ts`, `captureCloud.ts` | **Non repris** | second moteur de sync / second client : interdit de les mélanger |
| `services/migration/legacy.ts` (import des données locales d'avant les comptes) | **Non repris** | la chaîne officielle a déjà son import (`services/legacy/legacyImport.ts` + bannière) |
| `sync_metadata` par appareil | **Non repris** | déjà présente dans le schéma officiel (`user_id, device_id`) |
| Accès hors ligne de l'espace authentifié, création matière+module+séance en un flux, suppression des données de démo | **Non repris** | déjà couverts (E2E `accounts.spec`), vérifiés |
| `userIsolation.test.ts`, `multiuser.spec.ts` | **Non repris** | l'isolation est testée plus fortement (PGlite RLS, `accounts.spec`, tests A/B de l'intégration) |

**Conclusion : fermer la PR #5 ne fait perdre aucune fonction nécessaire.** (Aucune donnée utilisateur importante n'existe sur le projet qui porte son schéma.)

## 2. Schéma officiel et ordre EXACT des migrations

À appliquer **dans cet ordre, sur une base vide** (le CLI Supabase applique par ordre alphabétique) ; toute migration future suppose ce schéma :

| # | Fichier | Contenu |
|---|---|---|
| 1 | `20261007000000_lexnote_init.sql` | `profiles`, `subjects`, `modules`, `course_sessions`, `transcript_sessions`, `transcript_segments`, `timeline_markers`, `note_anchors`, `capture_interruptions`, `sync_metadata`, `external_accounts` ; fonctions `lx_touch`, `lx_profiles_touch`, `lx_handle_new_user` ; trigger d'inscription ; RLS forcée |
| 2 | `20261008000000_study_artifacts.sql` | `study_artifacts` (forme initiale) |
| 3 | `20261009000000_course_engine.sql` | `source_documents`, `generated_courses` (cours reconstruit versionné) |
| 4 | `20261010000000_study_artifacts_from_course.sql` | `study_artifacts` v2 (version du cours, instantané, provenance, réglages, type MÉTHODE) — renommages/ajouts sans perte |
| 5 | `20261011000000_integration_links.sql` | `integration_links`, `integration_link_intents`, `integration_nonces` + fonctions `integration_*` (liaison REV-EM) |
| 6 | `20261012000000_fk_indexes.sql` | index sur les 17 clés étrangères non indexées |
| 7 | `20261013000000_security_hardening.sql` | fixe le `search_path` des helpers de trigger et retire l’exécution navigateur de `lx_handle_new_user` après audit Security Advisor réel |

Schéma final attendu après les 7 migrations : **17 tables** dans `public` (liste ci-dessus), RLS **activée** partout (forcée sur les tables de données), aucune politique appelant `auth.uid()` hors sous-requête, aucun droit pour `anon`, toutes les clés étrangères indexées, trigger `on_auth_user_created` → `lx_handle_new_user`, aucune fonction `set_updated_at` / `handle_new_user` (anciennes). Ce contrat est **vérifié par SQL** : `supabase/reconciliation/verify-official-schema.sql` (13 contrôles) et `scripts/prod/verify-db.sql` (24 contrôles sur l'intégration).

## 3. Projet Supabase existant avec l'ancien schéma #5 : réconciliation

> ❌ Ne **pas** exécuter `20261007000000_lexnote_init.sql` sur ce projet : les tables existent déjà avec une autre structure, l'exécution échoue (démontré par `tests/db/schema-reconciliation.test.ts`).
> ℹ Ce SQL n'a été exécuté contre **aucun** vrai projet : il est testé sur Postgres (PGlite) et se lance à la main (SQL Editor) ou via `scripts/prod/supabase-admin.mjs apply-sql` (commandes au §3.2).

### 3.1 Ce qui est remplacé

**Tables (les 10 sont déplacées vers un schéma `legacy_pr5`, données conservées, puis recréées par les migrations officielles)** :
`profiles`, `subjects`, `modules`, `course_sessions`, `transcript_sessions`, `transcript_segments`, `timeline_markers`, `note_anchors`, `capture_interruptions`, `sync_metadata`.

**Colonnes incompatibles (ancien → officiel)** :

| Table | Ancien schéma #5 | Schéma officiel |
|---|---|---|
| `subjects` | `semester`, `color` nullable, `id` généré par le serveur | `term`, `color not null default 'indigo'`, `id` fourni par le client, `server_updated_at` |
| `modules` | `description`, `position` | (retirés), `server_updated_at` |
| `course_sessions` | `session_type`, `session_date`, `session_number`, `notes`, `status` ∈ DRAFT/IN_PROGRESS/COMPLETED/ARCHIVED | `type`, `date`, `number`, `notes_content`, `capture_summary`, `status` ∈ in_progress/completed |
| `transcript_sessions` | `course_session_id`, `provider`, `started_at`, `ended_at`, `audio_metadata` | `session_id`, `provider_id`, `origin_at`, `mime_type`, `keep_audio`, `runs` |
| `transcript_segments` | `transcript_session_id`, `course_session_id`, `sequence`, `start_ms/end_ms` nullables | `session_id`, `source`, `verification`, `start_ms/end_ms` NOT NULL |
| `timeline_markers` | `course_session_id`, `marker_type`, `timestamp_ms`, `label`, `reasons jsonb` | `session_id`, `at_ms`, `reasons text[]` |
| `note_anchors` | `course_session_id`, `nearby_transcript_segment_ids`, `note_position jsonb` | `session_id`, `nearby_segment_ids`, `text_snippet`, `note_position integer` |
| `capture_interruptions` | `course_session_id` | `session_id`, `version`, `deleted_at` |
| `sync_metadata` | clé `id`, `device_id text`, `last_error` | clé `(user_id, device_id uuid)`, `client_info` |
| `profiles` | `quote` | `usage_type` |
| (toutes) | `user_id` sans défaut ; deux FK par table ; RLS non forcée | `user_id default auth.uid()` ; clés composites `(id, user_id)` ; `FORCE RLS` |

**Fonctions / triggers remplacés** : `public.set_updated_at()` et `public.handle_new_user()` supprimées ; triggers `set_<table>_updated_at` supprimés avec les tables déplacées ; trigger `on_auth_user_created` (sur `auth.users`) supprimé puis recréé par l'init officielle (→ `lx_handle_new_user`).
**Policies remplacées** : toutes les policies des 10 tables (`profiles_*_own`, `<table>_own_all`) sont supprimées ; les policies officielles (par opération, rôle `authenticated`, `(select auth.uid())`) sont créées par les migrations.
**Edge Function** : redéployer `delete-account` (version officielle, CORS en liste blanche).

### 3.2 Ordre exact

| Étape | Action | Fichier |
|---|---|---|
| 0 | Pré-vérifications (§3.3) | — |
| 1 | **Mise en quarantaine** de l'ancien schéma (atomique, rien n'est supprimé) | `supabase/reconciliation/001_quarantine_pr5_schema.sql` |
| 2 | Migrations officielles, dans l'ordre du §2 (6 fichiers) | `supabase/migrations/*.sql` |
| 3 | Reprise des profils (+ profil minimal pour les comptes qui n'en ont pas) | `supabase/reconciliation/002_restore_profiles_from_pr5.sql` |
| 4 | Vérifications (§3.4) | `verify-official-schema.sql`, `scripts/prod/verify-db.sql` |
| 5 | Redéployer `delete-account` + fonctions d'intégration (runbook de production) | — |
| 6 | *(facultatif, destructif, après validation)* suppression de `legacy_pr5` | `supabase/reconciliation/003_drop_legacy_pr5.sql` |

Commandes (depuis votre machine, `SUPABASE_ACCESS_TOKEN` et `LEX_REF` définis ; sans `--apply` = simulation) :

```bash
R=scripts/prod/supabase-admin.mjs
node $R apply-sql --project $LEX_REF --file supabase/reconciliation/001_quarantine_pr5_schema.sql --apply
for f in supabase/migrations/2026100*.sql supabase/migrations/2026101*.sql; do node $R apply-sql --project $LEX_REF --file $f --apply || break; done   # ordre alphabétique = ordre du §2
node $R apply-sql --project $LEX_REF --file supabase/reconciliation/002_restore_profiles_from_pr5.sql --apply
node $R verify-schema --project $LEX_REF                                                                     # 13 PASS attendus (ou coller verify-official-schema.sql dans le SQL Editor)
node $R verify-db --project $LEX_REF                                                                         # 24 PASS attendus
```

Propriétés de l'étape 1 (testées) : **refuse** un schéma inconnu (rien n'est modifié) ; **ne fait rien** sur un projet déjà officiel ou vierge ; **idempotente** ; **atomique** (une erreur annule tout) ; la quarantaine est **inaccessible** aux navigateurs (aucun droit, RLS forcée, schéma non exposé par l'API).
L'étape 3 ne copie que les **profils** : les autres tables sont incompatibles et le projet ne contient pas de données importantes ; elles restent consultables dans `legacy_pr5` (côté serveur) jusqu'à l'étape 6.

### 3.3 Pré-vérifications (étape 0)

```sql
-- 1. quelles tables LexNote existent ? (attendu : les 10 tables du §3.1 et rien d'autre dans public)
select tablename from pg_tables where schemaname = 'public' order by 1;
-- 2. confirmer la signature de l'ancien schéma (attendu : les trois colonnes existent)
select table_name, column_name from information_schema.columns where table_schema = 'public' and (table_name, column_name) in (('subjects','semester'), ('course_sessions','session_type'), ('transcript_segments','transcript_session_id'));
-- 3. volume de données qui sera CONSERVÉ dans legacy_pr5
select (select count(*) from public.profiles) profils, (select count(*) from public.subjects) matieres, (select count(*) from public.course_sessions) seances;
```
Si `public` contient d'autres tables aux noms officiels (`study_artifacts`, `integration_links`…), l'étape 2 échouera : les examiner d'abord. Sauvegarder (*Database → Backups*) avant de commencer, par prudence.

### 3.4 Vérifications post-migration

1. `supabase/reconciliation/verify-official-schema.sql` → **13 PASS / 0 FAIL** ; 2. `scripts/prod/verify-db.sql` → **24 PASS / 0 FAIL** ;
3. test fonctionnel : créer un compte, une matière et une séance depuis l'application ; vérifier la synchronisation sur un second appareil ;
4. Advisors Supabase (Security + Performance) : aucune alerte sur ces objets ; 5. `legacy_pr5` illisible avec un jeton utilisateur (PostgREST ne l'expose pas).

### 3.5 Retour arrière

Avant l'étape 6, les données de l'ancien schéma sont intactes dans `legacy_pr5` : on peut les rapatrier à la main. L'étape 1 étant atomique, un échec laisse le projet inchangé. Après l'étape 6, restaurer depuis la sauvegarde.

## 4. Tests (aucune donnée réelle nécessaire)

- `tests/db/migrations-chain.test.ts` — chaîne complète **depuis une base vide** (init → StudyArtifacts → Course Engine → StudyArtifacts v2 → intégration → index → hardening → hardening), ordre exact des fichiers, mise à niveau **avec données existantes** à chaque étape, isolation A/B.
- `tests/db/schema-reconciliation.test.ts` — **ancien schéma #5 → réconciliation → schéma officiel** : l'init « par-dessus » échoue ; la quarantaine conserve les données et les protège ; profils repris ; **le schéma `public` obtenu est strictement identique à celui d'un projet neuf** (colonnes, contraintes, index, policies, triggers, fonctions, RLS, droits) ; l'application fonctionne ensuite ; idempotence ; garde-fous (projet officiel, vierge, inconnu) ; atomicité. Les deux variantes de l'ancien schéma (001 seule, 001 + 002) sont testées. La fixture `tests/db/fixtures/pr5-experimental-schema.sql` est une copie verbatim des migrations de la PR #5.
- `tests/db/no-legacy-architecture.test.ts` — plus aucun fichier livré ne dépend des colonnes, tables, client, moteur de sync ou migrations de #5.
