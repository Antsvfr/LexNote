# Mise en production — LexNote (+ liaison REV-EM ⇄ LexNote)

> **Ce document décrit la procédure ; il ne déploie rien.** Aucune commande ci-dessous n'a été exécutée contre la production par cette PR.
> Partie I : mise en production complète (ordre, sauvegarde, retour arrière, exploitation). Partie II (§0 à §8, plus bas) : détail de la liaison REV-EM ⇄ LexNote.
> Verdict de préparation : `node scripts/prod/release-gates.mjs` (READY / NOT READY, voir §I.3). **Tant qu'une porte est NOT_RUN ou FAIL, on ne déploie pas.**

## I.0 Variables et noms réels

| Élément | Valeur |
|---|---|
| Dépôt LexNote / REV-EM | `Antsvfr/LexNote` / `Antsvfr/REV-EM` (GitHub Pages : `https://antsvfr.github.io/REV-EM/`) |
| Application LexNote | Vercel — `https://lex-note-svfr.vercel.app` (build : `npm run build`, sortie `dist/`) |
| Projets Supabase | `LEX_REF` (LexNote), `REV_REF` (REV-EM) — **deux projets distincts** ; un 3ᵉ projet **de TEST** `TEST_REF` pour les smoke tests |
| Migrations LexNote | `20261007000000_lexnote_init` … `20261018000000_study_ai_budget_health` (12 fichiers, `supabase/migrations/`) |
| Migrations REV-EM | `006_integration_links`, `007_math_practice`, `008_integration_launch`, `009_integration_launch_identify` (`supabase/migrations/`) |
| Edge Functions LexNote | `health`, `study-ai`, `integration-link`, `integration-gateway`, `course-engine`, `delete-account` |
| Edge Functions REV-EM | `integration-link`, `integration-gateway` (+ `brightspace-*`, inchangées) |
| Secrets LexNote | `ANTHROPIC_API_KEY`, `APP_ORIGINS`, `STUDY_AI_ENABLED`, `STUDY_AI_GLOBAL_MAX_REQUESTS_DAY`, `STUDY_AI_GLOBAL_MAX_CHARS_DAY`, `STUDY_AI_MODEL` (opt.), `RELEASE_VERSION`, `INTEGRATION_ENV`, `INTEGRATION_KEY`, `INTEGRATION_KEY_ID`, `INTEGRATION_SELF_APP_URL`, `INTEGRATION_PEER_APP_URL`, `INTEGRATION_PEER_GATEWAY_URL` |
| Variables Vercel (publiques) | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AI_URL` (`https://<LEX_REF>.supabase.co/functions/v1/study-ai`), `VITE_ENGINE_URL` (opt.). **Jamais** `VITE_BACKEND=mock`, jamais une clé `service_role` |

```bash
export SUPABASE_ACCESS_TOKEN=…      # jeton personnel — jamais dans Git
export LEX_REF=…  REV_REF=…  TEST_REF=…
```

## I.1 Ordre exact de fusion GitHub (étape A)

**Rien n'est fusionné par cette PR.** Les PR LexNote sont empilées ; chacune a `main` pour base et contient les précédentes :
`#12 → #10 → #11 → #13 → PR « production readiness » (celle-ci)`. Fusionner **dans cet ordre**, en **fusion simple (merge commit)**, jamais de réécriture d'historique.
Après chaque fusion, attendre que la CI de la PR suivante repasse au vert (le diff se réduit à son propre contenu).
REV-EM : `#24 → #25` (puis une éventuelle PR REV-EM de cette phase : **aucune n'est nécessaire**, voir « REV-EM » dans la PR).
Ne pas fusionner avant que les portes `typecheck`, `unit-tests`, `build`, `bundle-check`, `preflight`, `e2e-critical` soient PASS **sur le commit à fusionner** (`node scripts/prod/evidence.mjs run-auto`).

## I.2 Sauvegarde AVANT déploiement (obligatoire)

> Une migration n'a pas de retour arrière automatique. La **seule** protection contre une erreur d'exploitation est une sauvegarde **vérifiée**.

1. **Sauvegarde native Supabase** (tableau de bord → *Database → Backups*) : plan Pro et plus = sauvegardes quotidiennes + **Point-in-Time Recovery** (noter l'heure UTC exacte avant de commencer ; la restauration PITR se demande à cette heure). Plan gratuit : **pas de sauvegarde automatique → la sauvegarde logique ci-dessous est obligatoire**.
2. **Sauvegarde logique** (depuis votre machine, Supabase CLI ≥ 2 ; chaîne de connexion dans *Project Settings → Database → Connection string*, mot de passe dans l'environnement, jamais dans l'historique du shell) :
   ```bash
   export LEX_DB_URL='postgresql://postgres:…@db.'$LEX_REF'.supabase.co:5432/postgres'
   mkdir -p ~/backups/lexnote-$(date -u +%Y%m%dT%H%M%SZ) && cd $_
   supabase db dump --db-url "$LEX_DB_URL" -f schema.sql                         # structure (public)
   supabase db dump --db-url "$LEX_DB_URL" --data-only --use-copy -f data-public.sql
   supabase db dump --db-url "$LEX_DB_URL" --data-only --use-copy --schema auth -f data-auth.sql   # comptes (hachés), identités, sessions
   supabase db dump --db-url "$LEX_DB_URL" --role-only -f roles.sql
   sha256sum *.sql > SHA256SUMS && ls -l
   ```
   Même chose pour `REV_REF` (`REV_DB_URL`). Stocker hors de l'ordinateur (chiffré), conserver ≥ 30 jours.
3. **Vérifier la sauvegarde** (une sauvegarde non testée n'existe pas) : restaurer `schema.sql` + `data-public.sql` dans le projet de **TEST** (`TEST_REF`) ou une base locale (`supabase start`), puis compter : `select count(*) from public.subjects, public.course_sessions;` doit correspondre à la production.
4. **État de la production avant migration** : `node scripts/prod/migration-status.mjs --project $LEX_REF` — enregistrer la sortie (elle prouve l'état de départ).
5. Noter les **versions déployées** pour le retour arrière : Vercel (URL du déploiement de production actuel), `git rev-parse HEAD` des deux dépôts, `supabase functions list --project-ref $LEX_REF` (versions), `supabase secrets list --project-ref $LEX_REF` (noms seulement).
6. Enregistrer : `node scripts/prod/evidence.mjs record backup PASS --note "dump 2026-…, restauré sur TEST_REF, comptes OK"`.

## I.3 Portes de déploiement (READY / NOT READY)

`release/gates.json` définit 16 portes ; `release/evidence.json` (local, non versionné) porte les preuves (statut, **commit**, date, note). Une preuve ne compte que si elle est **PASS**, **récente** (7 jours) et — pour les portes liées au code — **sur le commit courant**. Sans preuve = `NOT_RUN` = bloquant.
```bash
node scripts/prod/evidence.mjs run-auto        # typecheck, unit-tests, build, bundle-check, preflight, e2e-critical
node scripts/prod/evidence.mjs record deno-tests PASS --note "deno test study-ai + health : N passed"   # Deno n'est pas lancé par run-auto
node scripts/prod/evidence.mjs record <porte> PASS --note "…"      # portes réelles : voir §I.4
node scripts/prod/release-gates.mjs            # lisible ; --json pour une machine ; code de sortie 0 = READY
node scripts/prod/preflight.mjs --target production --with-typecheck --with-build --with-schema    # PASS/WARN/FAIL ; FAIL = arrêt
```

## I.4 Vérifications RÉELLES préalables (sur le projet de TEST, jamais la production)

```bash
# 1. Migrations sur le projet de test, dans l'ordre (voir I.5-B pour la commande)  → record migrations-on-test
# 2. Smoke Supabase de test : authentification, RLS, version serveur, fonctions réservées, déconnexion globale, nettoyage
SMOKE_CONFIRM=1 SMOKE_SUPABASE_URL=https://$TEST_REF.supabase.co SMOKE_EXPECTED_REF=$TEST_REF SMOKE_PRODUCTION_REFS=$LEX_REF,$REV_REF \
  SMOKE_ANON_KEY=… SMOKE_SERVICE_ROLE_KEY=… node scripts/prod/supabase-smoke.mjs        # → record supabase-smoke
# 3. Diagnostic d'intégration entre les deux projets de test (HMAC, kid, horloge, CORS)
INTEGRATION_KEY=… LEXNOTE_SUPABASE_URL=https://$TEST_REF.supabase.co REVEM_SUPABASE_URL=… node scripts/prod/integration-diagnostic.mjs   # → record integration-diagnostic
# 4. Liaison complète + attaques : scripts/prod/real-e2e.mjs (Partie II §6) sur les projets de test
# 5. IA réelle (payant) : SMOKE_CONFIRM=1 … node scripts/prod/study-ai-smoke.mjs (docs/TRANSCRIPT_ACTIONS.md §7) ; puis kill switch : STUDY_AI_ENABLED=false → 503 ai_disabled  → record ai-real-smoke
# 6. Firefox + WebKit : ALL_BROWSERS=1 npx playwright install firefox webkit && npm run test:e2e:browsers   → record browsers-firefox-webkit
# 7. PWA à la main (§I.9)  → record pwa-manual ;  répétition du retour arrière sur TEST (§I.7) → record rollback-rehearsed
```
`supabase-smoke.mjs` **refuse de tourner** sans `SMOKE_CONFIRM=1`, si `SMOKE_EXPECTED_REF` ≠ projet de l'URL, si le projet est dans `SMOKE_PRODUCTION_REFS`, si une clé n'appartient pas au projet (claim `ref`), ou s'il contient plus de `SMOKE_MAX_USERS` (10) comptes non jetables.

## I.5 Procédure de déploiement, dans l'ordre

### A. Fusion GitHub — voir §I.1.

### B. Migrations Supabase (production LexNote `LEX_REF`)
La production a déjà `20261007` … `20261013` (réconciliation + durcissement). **Ne jamais rejouer** `supabase/reconciliation/*` ni une migration déjà appliquée.

| # | Migration (`supabase/migrations/`) | Production (état connu) |
|---|---|---|
| 07 | `20261007000000_lexnote_init` | appliquée |
| 08 | `20261008000000_study_artifacts` | appliquée |
| 09 | `20261009000000_course_engine` | appliquée |
| 10 | `20261010000000_study_artifacts_from_course` | appliquée |
| 11 | `20261011000000_integration_links` | appliquée |
| 12 | `20261012000000_fk_indexes` | appliquée |
| 13 | `20261013000000_security_hardening` | appliquée |
| 14 | `20261014000000_revem_course_refs` | **à appliquer** (#10) |
| 15 | `20261015000000_transcript_derived_artifacts` | **à appliquer** (#11) |
| 16 | `20261016000000_study_ai_usage` | **à appliquer** (#11) |
| 17 | `20261017000000_auth_devices_auto_login` | **à appliquer** (#13) |
| 18 | `20261018000000_study_ai_budget_health` | **à appliquer** (cette PR) |

*« État connu » = d'après la documentation du 2026-10-13 ; l'état réel se lit avec `migration-status.mjs`, jamais avec cette table.*
```bash
node scripts/prod/migration-status.mjs --project $LEX_REF      # attendu : 07…13 « DÉJÀ APPLIQUÉE », 14…18 « ABSENTE » ; toute ligne DIFFÉRENTE ou « ordre rompu » = STOP
for f in 20261014000000_revem_course_refs 20261015000000_transcript_derived_artifacts 20261016000000_study_ai_usage \
         20261017000000_auth_devices_auto_login 20261018000000_study_ai_budget_health; do
  node scripts/prod/supabase-admin.mjs apply-sql --project $LEX_REF --file supabase/migrations/$f.sql            # simulation
  node scripts/prod/supabase-admin.mjs apply-sql --project $LEX_REF --file supabase/migrations/$f.sql --apply    # une à la fois ; s'arrêter à la première erreur
done
node scripts/prod/migration-status.mjs --project $LEX_REF      # attendu : 12 « DÉJÀ APPLIQUÉE », « Aucune migration à appliquer »
node scripts/prod/supabase-admin.mjs verify-schema --project $LEX_REF     # 13 PASS
node scripts/prod/supabase-admin.mjs verify-db     --project $LEX_REF     # 24 PASS
```
REV-EM (`REV_REF`), depuis le dépôt REV-EM : après avoir confirmé l'état de `006`/`007` (procédure de readiness en lecture seule du dépôt REV-EM), appliquer `008_integration_launch.sql` puis `009_integration_launch_identify.sql` avec le même outil, puis `verify-db`.
**Les migrations 17 et 18 sont additives et rétro-compatibles** (nouveaux paramètres avec valeurs par défaut) : l'ancienne version des fonctions Edge continue de fonctionner tant qu'elle n'est pas redéployée.

### C. Edge Functions LexNote (après B, avant D)
```bash
supabase functions deploy health              --project-ref $LEX_REF --no-verify-jwt
supabase functions deploy study-ai            --project-ref $LEX_REF
supabase functions deploy integration-gateway --project-ref $LEX_REF --no-verify-jwt
supabase functions deploy integration-link    --project-ref $LEX_REF --no-verify-jwt
curl -s https://$LEX_REF.supabase.co/functions/v1/health        # {"status":"ok",…,"services":{"database":"ok","schema":"ok",…}}  (aucune donnée sensible)
```
`course-engine` et `delete-account` ne changent pas. REV-EM : `supabase functions deploy integration-gateway --no-verify-jwt` et `integration-link` (`--project-ref $REV_REF`).
**Déployer `study-ai` avec l'IA coupée** : poser `STUDY_AI_ENABLED=false` (étape D) avant d'ouvrir le trafic ; l'activer seulement après les smoke tests (étape G).

### D. Secrets (Supabase → *Edge Functions → Secrets* ou CLI)
```bash
supabase secrets set --project-ref $LEX_REF \
  STUDY_AI_ENABLED=false STUDY_AI_GLOBAL_MAX_REQUESTS_DAY=2000 STUDY_AI_GLOBAL_MAX_CHARS_DAY=20000000 \
  APP_ORIGINS=https://lex-note-svfr.vercel.app RELEASE_VERSION=$(node -p "require('./package.json').version")
# ANTHROPIC_API_KEY (déjà posée si study-ai a été déployé avant) : supabase secrets set ANTHROPIC_API_KEY=…  (saisie masquée, jamais dans un fichier)
# Clés d'intégration : Partie II §3 (INTEGRATION_KEY identique des deux côtés)
supabase secrets list --project-ref $LEX_REF      # NOMS uniquement : contrôler que rien ne manque
```
Valeurs par défaut du code si une variable est absente : `STUDY_AI_GLOBAL_MAX_REQUESTS_DAY=2000`, `STUDY_AI_GLOBAL_MAX_CHARS_DAY=20 000 000`, `STUDY_AI_MAX_PER_DAY=200`/utilisateur, `STUDY_AI_MAX_CHARS_PER_DAY=3 000 000`/utilisateur, sortie ≤ 15 000 jetons (jamais 64 000). `0` désactive explicitement un plafond global — à éviter.

### E. Vercel (LexNote)
Variables d'environnement *Production* : `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_AI_URL`. La fusion sur `main` déclenche le déploiement (ou *Deployments → Redeploy* **sans** cache de build si seules les variables ont changé). `VERCEL_GIT_COMMIT_SHA` alimente le SHA affiché.
Contrôle : ouvrir `https://lex-note-svfr.vercel.app/settings/system-status` (connecté) : la version et le SHA sont ceux du commit fusionné ; `Serveur LexNote (health)` = ok.

### F. REV-EM — GitHub Pages
Fusion de REV-EM `#24 → #25` sur `main` : le workflow Pages publie `https://antsvfr.github.io/REV-EM/`. Contrôle : la page s'ouvre, *Réglages → Applications connectées* affiche LexNote.

### G. Smoke tests post-déploiement (production, lecture seule ou comptes de test dédiés)
```bash
node scripts/prod/preflight.mjs --target production                              # variables lues dans l'environnement de l'opérateur
node scripts/prod/migration-status.mjs --project $LEX_REF                        # 12 « DÉJÀ APPLIQUÉE »
curl -s https://$LEX_REF.supabase.co/functions/v1/health
INTEGRATION_KEY=… LEXNOTE_SUPABASE_URL=https://$LEX_REF.supabase.co REVEM_SUPABASE_URL=https://$REV_REF.supabase.co node scripts/prod/integration-diagnostic.mjs
node scripts/prod/real-e2e.mjs                                                   # Partie II §6, comptes de test dédiés
supabase secrets set STUDY_AI_ENABLED=true --project-ref $LEX_REF                # PUIS, et seulement si tout est vert :
SMOKE_CONFIRM=1 node scripts/prod/study-ai-smoke.mjs                             # compte de test ; vérifier ensuite le journal agrégé (§I.6)
```
`supabase-smoke.mjs` **ne se lance jamais sur la production** (il crée des comptes). Test manuel navigateur : Partie II §6 (« Complément manuel »).

## I.6 Exploitation et observabilité

* **Santé publique** : `GET https://<LEX_REF>.supabase.co/functions/v1/health` → `{status: ok|degraded|down, version, time, services:{database, schema, integration, ai}, missing?}`. `503` si la base est injoignable. Aucune clé, URL interne, identifiant ni message d'erreur brut. `missing` liste les éléments de schéma absents (= migration à appliquer).
* **Diagnostic côté étudiant** : *Réglages → Diagnostic* (`/settings/system-status`) : compte, synchronisation, REV-EM, transcription, IA, stockage local, PWA, version + SHA, derniers événements ; bouton « Copier le diagnostic » (expurgé, sans contenu).
* **Journaux** (*Edge Functions → Logs*) : préfixes `[study-ai]`, `[integration]`, `[integration-gateway]`, `[integration-link]` — **métadonnées uniquement** (tâche, tailles, jetons, modèle, durée, code). Jamais de transcription, note, prompt, document ni réponse du modèle. Côté navigateur : `[auth] [sync] [integration] [study-ai] [transcription]` (+ `[storage] [pwa] [ui]`), expurgés (jetons, e-mails).
* **Coût IA** — requête SQL de lecture seule (service_role, éditeur SQL) : `select public.study_ai_usage_summary(7);` → totaux par jour/tâche/état (requêtes, caractères, jetons d'entrée/sortie, durée moyenne). Rétention : 30 jours.
* **INTERRUPTEUR D'URGENCE IA** : `supabase secrets set STUDY_AI_ENABLED=false --project-ref $LEX_REF` — effet aux prochains démarrages de la fonction (en pratique quelques secondes), **sans redéploiement** ; à vérifier lors du test réel (porte `ai-real-smoke`) ; `study-ai` répond `503 ai_disabled` avant tout appel payant ; l'application affiche « Les fonctions IA sont temporairement indisponibles. (AI-DISABLED) ». Réactiver : `STUDY_AI_ENABLED=true`.
* **Budget global** atteint → `503 ai_capacity` (« … (AI-CAPACITY) »), retour automatique quand la fenêtre glissante de 24 h se libère.

### Budgets de sortie par action (jamais 64 000 jetons)
Plafond absolu `HARD_MAX_OUTPUT_TOKENS = 15 000` (réglable à la baisse par `STUDY_AI_MAX_OUTPUT_TOKENS`). Valeurs mesurées (rédaction + marge de réflexion) : résumé express 4 500, standard 7 000, détaillé 11 000 ; points clés / à retenir / explication / fiches 5 500 ; glossaire / définitions 6 000 ; concepts / plan de cours 7 000 ; questions d'examen / à l'enseignant / ambiguïtés / passages importants 6 500 ; synthèse intermédiaire 1 800–4 000 ; structuration 6 000–15 000 ; traduction / nettoyage 2 000–13 000 (proportionnels à la partie traitée). Test de garde-fou : `tests/prod/study-ai-budgets.test.ts`.

### Codes d'erreur (affichés à l'étudiant, cités par le support)
`AUTH-SESSION-01` `AUTH-REVOKED-02` · `SYNC-OFFLINE-01` `SYNC-CONFLICT-02` `SYNC-AUTH-03` `SYNC-REMOTE-04` · `INT-PEER-401` `INT-HMAC-401` `INT-KID-401` `INT-CLOCK-401` `INT-GW-404` `INT-GW-JWT` `INT-URL` · `AI-DISABLED` `AI-CAPACITY` `AI-429` `AI-503` `AI-504` `AI-502` `AI-422` `AI-CONFIG` · `STORE-IDB-01` `STORE-WRITE-02` · `TRANS-MIC-01` `TRANS-ENGINE-02` · `PWA-UPDATE-01` · `UI-CRASH-01` (suivi de 4 caractères hexadécimaux : `UI-CRASH-01/a3f9`).
Catalogue complet (titre, conseil) : `src/lib/errorCodes.ts` ; un test vérifie que ce paragraphe les liste tous.
Diagnostic d'intégration : `INT-KID-401` = identifiant de clé différent ; `INT-HMAC-401` = clé différente ; `INT-CLOCK-401` = horloge décalée ; `INT-PEER-401` = expéditeur/destinataire inversé ; `INT-GW-JWT` = passerelle redéployée sans `verify_jwt = false`.

## I.7 PLAN DE RETOUR ARRIÈRE

Principe : **revenir en arrière dans l'ordre inverse du déploiement**, et préférer « désactiver » à « défaire ».

| Problème | Action immédiate | Détail |
|---|---|---|
| IA coûteuse / abusive / en panne | `supabase secrets set STUDY_AI_ENABLED=false --project-ref $LEX_REF` | Sans redéploiement ; l'application reste utilisable (notes, synchronisation) |
| Régression de l'application | **Vercel** → *Deployments* → déploiement de production précédent (noté en §I.2-5) → *Instant Rollback* / *Promote to Production* (ou `vercel rollback`) | Le service worker propose la version précédente comme une mise à jour ; aucune donnée locale n'est touchée |
| Régression d'une Edge Function | `git checkout <sha_précédent> -- supabase/functions && supabase functions deploy <nom> --project-ref $LEX_REF` puis `git checkout -- .` | Les migrations 17/18 sont rétro-compatibles avec l'**ancien** code : le retour arrière du code ne nécessite **pas** de retour arrière de la base |
| `integration-gateway` répond « Missing authorization header » | Redéployer avec `--no-verify-jwt` | `supabase/config.toml` + `preflight.mjs` (contrôle `config.toml`) |
| Liaison REV-EM en échec (`INT-*`) | `integration-diagnostic.mjs` ; rotation : poser `INTEGRATION_KEY_PREVIOUS[_ID]` (Partie II §3) | Rollback de clé : remettre l'ancienne clé comme `INTEGRATION_KEY`, la nouvelle en `…_PREVIOUS` |
| REV-EM (Pages) | Revert du commit de fusion sur `main` de REV-EM → le workflow republie | |
| Migration appliquée mais défectueuse | **Ne pas écrire de « migration inverse » dans l'urgence.** 1) `STUDY_AI_ENABLED=false` si concerné ; 2) corriger en avant par une nouvelle migration `2026…` testée sur `TEST_REF` ; 3) en dernier recours, **restaurer la sauvegarde** (ci-dessous) | Les migrations 17 et 18 n'ajoutent que des colonnes/fonctions/tables : les laisser en place est sans danger pour l'ancien code |
| Perte ou corruption de données | **Restauration** : PITR Supabase à l'heure notée en §I.2 (*Database → Backups → Point in time*), ou depuis le dump logique : `psql "$LEX_DB_URL" -f schema.sql -f data-public.sql` sur une base **vide** (projet de restauration), puis comparer ; ne jamais restaurer par-dessus la production sans avoir sauvegardé son état courant | Suppressions « douces » : `select count(*) from course_sessions where deleted_at is not null;` — restauration ciblée possible par SQL |

Retour arrière applicatif sûr des **migrations 17 et 18** (uniquement si la sauvegarde ne peut pas servir et après accord) : elles ne suppriment aucune donnée ; les fonctions `study_ai_acquire` (9 paramètres) et `study_ai_release` (7 paramètres) acceptent les anciens appels à 7 et 3 arguments (valeurs par défaut) — aucun SQL de retour arrière n'est nécessaire pour que l'ancien code fonctionne.
**Répétition obligatoire** (porte `rollback-rehearsed`) : sur `TEST_REF`, appliquer 14→18, déployer, puis exécuter chaque ligne du tableau (kill switch, déploiement précédent, restauration du dump) et noter le résultat.

## I.8 Navigateurs

Chromium : suite complète (e2e + mobile + PWA). Firefox et WebKit : `ALL_BROWSERS=1 npm run test:e2e:browsers` (parcours critiques + mobile + accessibilité ; le PWA hors ligne et le micro simulé restent Chromium).
Classer un échec : **limitation du navigateur / du pilote** (ex. WebKit n'expose pas `SpeechRecognition` ; Firefox ne propose pas de micro simulé par drapeau Chromium ; l'installation PWA n'existe pas sur Firefox bureau) → test marqué `skip` avec la raison ; **bogue LexNote** (rendu, stockage, synchronisation, navigation) → à corriger. Safari/iOS : IndexedDB peut être purgé après 7 jours sans visite hors PWA installée → demander l'installation (avertissement « stockage non durable » dans Réglages / Diagnostic).

## I.9 PWA — ce qui est automatisé et ce qui ne l'est pas

Automatisé (Chromium, `tests/e2e/pwa.spec.ts`) : manifeste (nom, `standalone`, icônes 192/512/maskable), service worker actif, coque servie **hors ligne** sur une route profonde, session conservée, écriture hors ligne puis retour en ligne, aucune mise à jour imposée.
**À vérifier à la main** (porte `pwa-manual`) : (1) invite d'installation (Chrome/Edge) et installation réelle sur Android/iOS ; (2) application installée : ouverture hors ligne, connexion conservée ; (3) **mise à jour réelle** : déployer une v2, ouvrir la v1 : le message « Une nouvelle version de LexNote est disponible » apparaît, *Mettre à jour* est **refusé** pendant une transcription (« La mise à jour sera possible quand vous l'aurez terminée »), accepté ensuite ; (4) fermeture d'onglet pendant une transcription : avertissement du navigateur.

## I.10 Accessibilité (audit rapide)
`tests/e2e/mobile-a11y.spec.ts` contrôle sur 9 pages + l'éditeur : langue du document, titre, repère `main`, un `h1`, noms accessibles des boutons/liens, étiquettes des champs, `alt` des images, pas de `tabindex` positif, boîtes de dialogue nommées, `id` uniques, cibles ≥ 24 px, absence de défilement horizontal à 390 px. Corrigé par l'audit : l'éditeur n'avait ni `main` ni `h1`. **Non couvert** (à faire avec un lecteur d'écran et axe-core) : contrastes, ordre de tabulation complexe, annonces `aria-live`.

---

# Partie II — Liaison REV-EM ⇄ LexNote (détail)

> **État production partiel.** La réconciliation LexNote a été appliquée sur le vrai projet Supabase, les migrations officielles ont été appliquées, `verify-schema` = 13/13 et `verify-db` = 24/24. Les fonctions `delete-account`, `integration-link` et `integration-gateway` ont été déployées sur LexNote ; `integration-link` et `integration-gateway` ont aussi été déployées sur REV-EM. Les secrets `INTEGRATION_*`, les Redirect URLs Auth et le test réel A/B restent à finaliser. L'environnement Claude d'origine n'avait pas accès à
> `*.supabase.co` / `api.supabase.com` / `vercel.app`, ni jeton Supabase, ni références de projet. Ce document est la procédure exacte pour le faire (≈ 30 min)
> et pour prouver que « un vrai compte REV-EM peut être connecté à un vrai compte LexNote en production ».

## 0. Prérequis (sur votre machine)

- Node ≥ 20 et Supabase CLI (`supabase --version`) ; un **jeton d'accès personnel** Supabase (`SUPABASE_ACCESS_TOKEN`, tableau de bord → Account → Access Tokens).
- Les **références** (20 caractères) des deux projets : `LEX_REF`, `REV_REF`. Ils doivent rester **deux projets distincts**.
- 4 comptes de test **confirmés** (deux dans chaque projet) : REV-EM A/B, LexNote A/B. Ne pas utiliser de comptes réels.
- Dépôt LexNote sur `claude/revem-integration-contract`, dépôt REV-EM sur `claude/lexnote-link` (ou `main` après fusion, voir §1).

```bash
export SUPABASE_ACCESS_TOKEN=…        # jamais dans Git, ni dans un script versionné
export LEX_REF=…  REV_REF=…
```

## 1. Ordre de fusion (voir aussi les PR)

LexNote est une **chaîne de PR empilées** (chacune a pour base la précédente) :
`main ← #3 comptes/sync ← #4 supports d'étude ← #6 moteur de cours ← #7 StudyArtifacts ← PR intégration`.
**L'intégration dépend de #3 (Supabase/Auth/RLS) et de #7 (types `StudyArtifact` utilisés par les références)** : elle ne peut être fusionnée **qu'après** #3 → #4 → #6 → #7,
dans cet ordre (GitHub reciblera chaque PR sur `main` quand sa base sera fusionnée et sa branche supprimée). La PR #5 (`chatgpt/lexnote-multiuser`) est **SUPERSEDED** (décision validée) : elle ne sera jamais fusionnée ; elle peut être fermée sans perte (voir `docs/SCHEMA_RECONCILIATION.md` §1).
La PR REV-EM est **indépendante** (base `main`) ; la déployer avant ou après LexNote est indifférent, les deux côtés restent fonctionnels seuls.

## 2. Migrations (une fois par projet)

> **Le projet LexNote existant porte l'ancien schéma expérimental (PR #5, SUPERSEDED).** Ne lancez PAS `20261007…lexnote_init.sql` dessus : suivez d'abord
> [`docs/SCHEMA_RECONCILIATION.md`](SCHEMA_RECONCILIATION.md) §3 (quarantaine `001` → les 7 migrations officielles ci-dessous → `002` profils → `verify-official-schema.sql`).
> Pour un projet vierge, appliquer directement les 7 migrations. Il n'existe qu'**une** architecture : la chaîne #3 → #8.

```bash
# LexNote — dépôt lexnote
node scripts/prod/supabase-admin.mjs apply-sql --project $LEX_REF --file supabase/migrations/20261011000000_integration_links.sql           # simulation
node scripts/prod/supabase-admin.mjs apply-sql --project $LEX_REF --file supabase/migrations/20261011000000_integration_links.sql --apply
node scripts/prod/supabase-admin.mjs verify-db --project $LEX_REF            # 24 contrôles PASS attendus
# REV-EM — même outil, fichier du dépôt REV-EM
node scripts/prod/supabase-admin.mjs apply-sql --project $REV_REF --file ../rev-em/supabase/migrations/006_integration_links.sql --apply
node scripts/prod/supabase-admin.mjs verify-db --project $REV_REF
```
Prérequis : les migrations précédentes de chaque projet sont déjà appliquées (LexNote `…20261007` à `…20261010…` — ou la réconciliation —, REV-EM `000`–`005`). Appliquer ensuite `20261012000000_fk_indexes.sql` puis `20261013000000_security_hardening.sql` sur LexNote. Contrôle global du schéma LexNote : `node scripts/prod/supabase-admin.mjs verify-schema --project $LEX_REF` (13 PASS). Alternative sans l'outil : coller le SQL dans *SQL Editor*,
puis coller `scripts/prod/verify-db.sql`. `verify-db.sql` contrôle : 3 tables, RLS **et FORCE RLS**, grants (anon/PUBLIC/authenticated), colonnes de références illisibles, policies (`(select auth.uid())`),
fonctions `SECURITY DEFINER` + `search_path` figé + droits d'exécution, contraintes d'unicité, index (dont clés étrangères), `ON DELETE CASCADE`, absence de colonne e-mail/jeton.
Il est lui-même testé : vert sur les deux migrations, rouge quand on dégrade la sécurité (`tests/db/verify-db.test.ts`).

> **Projet LexNote de production (état au 2026-10-13)** : `…20261007` à `…20261013` (dont `fk_indexes` et `security_hardening`) y sont
> **déjà appliquées** — ne jamais les rejouer, ni rejouer `supabase/reconciliation/*`. Chaîne complète, dans l'ordre strict :
> `20261007 init` · `08 study_artifacts` · `09 course_engine` · `10 study_artifacts_from_course` · `11 integration_links` ·
> `12 fk_indexes` · `13 security_hardening` · `14 revem_course_refs` (#10) · `15 transcript_derived_artifacts` (#11) ·
> `16 study_ai_usage` (#11). Seules **14, 15, 16** restent à appliquer, dans cet ordre, après fusion de #12 → #10 → #11, puis
> `verify-schema` (13 PASS). `study-ai` : voir `docs/TRANSCRIPT_ACTIONS.md` §7 (secrets, déploiement, smoke test réel).

> **Authentification durable (PR `claude/persistent-revem-auth`)** : appliquer `20261017000000_auth_devices_auto_login.sql` (LexNote) et
> `009_integration_launch_identify.sql` (REV-EM) ; redéployer `integration-link` et `integration-gateway` des deux projets — `supabase/config.toml`
> fixe `verify_jwt = false` pour les passerelles (et `integration-link` côté LexNote). Contrôle : un POST vide sur `…/integration-gateway`
> doit renvoyer un JSON `integration-error`, pas `Missing authorization header`. Détails : `docs/REVEM_LEXNOTE_INTEGRATION.md` §14.

## 3. Secrets (identiques à la clé près, un jeu par projet)

```bash
export INTEGRATION_KEY="$(openssl rand -base64 48)"      # NE PAS l'afficher ni la copier ailleurs ; elle reste dans cet environnement shell
node scripts/prod/supabase-admin.mjs set-secrets --app lexnote --project $LEX_REF --peer-ref $REV_REF            # simulation : valeurs masquées
node scripts/prod/supabase-admin.mjs set-secrets --app lexnote --project $LEX_REF --peer-ref $REV_REF --apply
node scripts/prod/supabase-admin.mjs set-secrets --app revem   --project $REV_REF --peer-ref $LEX_REF --apply
```
Posés : `INTEGRATION_ENV=production`, `INTEGRATION_KEY_ID=k1`, `INTEGRATION_KEY`, `INTEGRATION_SELF_APP_URL`, `INTEGRATION_PEER_APP_URL`, `INTEGRATION_PEER_GATEWAY_URL`
(LexNote : self `https://lex-note-svfr.vercel.app/`, peer `https://antsvfr.github.io/REV-EM/` ; REV-EM : l'inverse ; passerelle = `https://<réf. de l'autre projet>.supabase.co/functions/v1/integration-gateway`).
Optionnels : `INTEGRATION_ALLOWED_ORIGINS` (https uniquement, jamais `*`), `INTEGRATION_KEY_PREVIOUS[_ID]` (rotation : poser la nouvelle clé `k2` + garder `k1` en vérification des deux côtés, puis retirer `k1`).
La clé n'est ni dans Git, ni dans `VITE_*`, ni dans le navigateur, ni dans une sortie de l'outil (testé). `SUPABASE_URL / ANON_KEY / SERVICE_ROLE_KEY` sont fournis automatiquement aux fonctions.
`unset INTEGRATION_KEY` quand c'est fini (la conserver dans un gestionnaire de secrets pour le test du §6 et une éventuelle rotation).

## 4. Fonctions Edge

```bash
# LexNote (depuis le dépôt lexnote)
supabase functions deploy integration-link    --project-ref $LEX_REF
supabase functions deploy integration-gateway --project-ref $LEX_REF --no-verify-jwt     # protégée par la signature HMAC, pas par un JWT
supabase functions deploy delete-account      --project-ref $LEX_REF                      # CORS désormais en liste blanche (voir §5)
# REV-EM (depuis le dépôt rev-em)
supabase functions deploy integration-link    --project-ref $REV_REF
supabase functions deploy integration-gateway --project-ref $REV_REF --no-verify-jwt
```
`--no-verify-jwt` uniquement pour `integration-gateway`. Vérifier ensuite dans les journaux (*Edge Functions → Logs*) qu'aucune fonction ne signale « configuration invalide ».

## 5. Auth LexNote et CORS

```bash
node scripts/prod/supabase-admin.mjs auth-urls --app lexnote --project $LEX_REF            # simulation : liste ce qui serait ajouté
node scripts/prod/supabase-admin.mjs auth-urls --app lexnote --project $LEX_REF --apply    # + --dev pour ajouter localhost (projet de développement UNIQUEMENT)
node scripts/prod/supabase-admin.mjs auth-urls --app revem   --project $REV_REF --apply
```
Ajoute (sans rien supprimer) `https://lex-note-svfr.vercel.app/**`, `https://lex-note-svfr.vercel.app/integrations/revem/**` (LexNote) et `https://antsvfr.github.io/REV-EM/**` (REV-EM). Vérifier à la main dans
*Authentication → URL Configuration* que **Site URL** = `https://lex-note-svfr.vercel.app` (LexNote) / `https://antsvfr.github.io/REV-EM/` (REV-EM) et qu'aucune redirection globale (`*`, `**`) n'existe.
`delete-account` : la liste blanche vient de la même configuration (`readBrowserOrigins`) → production = `https://lex-note-svfr.vercel.app` ; pour un projet de développement, `INTEGRATION_ENV=development` autorise `localhost` explicitement.
Sa logique de suppression est inchangée (testé).

## 6. Test réel de bout en bout + attaques

```bash
export LEXNOTE_SUPABASE_URL=https://$LEX_REF.supabase.co  LEXNOTE_ANON_KEY=…   REVEM_SUPABASE_URL=https://$REV_REF.supabase.co  REVEM_ANON_KEY=…   # clés « anon » (publiques)
export REVEM_A_EMAIL=… REVEM_A_PASSWORD=… REVEM_B_EMAIL=… REVEM_B_PASSWORD=… LEXNOTE_A_EMAIL=… LEXNOTE_A_PASSWORD=… LEXNOTE_B_EMAIL=… LEXNOTE_B_PASSWORD=…
export CHECK_DELETE_ACCOUNT=1        # CORS de delete-account (OPTIONS uniquement, rien n'est supprimé) ; WAIT_EXPIRY=1 pour tester une vraie expiration (attend 5 min)
node scripts/prod/real-e2e.mjs
```
Ce script exécute le scénario A (REV-EM A ↔ LexNote A : intention → inspection → autorisation → CONNECTED vérifié des deux côtés → « Vérifier » → LexNote voit REV-EM → révocation), le scénario B en parallèle,
l'isolation A/B (y compris par l'API de données PostgREST et les fonctions SQL), et les attaques sur **les passerelles déployées** : nonce rejoué, signature modifiée, payload modifié, timestamp ancien/futur,
mauvais expéditeur, mauvais destinataire, mauvais `kid`, mauvaise clé, appel « navigateur », requête non signée, corps géant, intention consommée / expirée / d'un autre utilisateur / nonce deviné.
Les messages sont forgés avec la vraie clé pour prouver que **même signés**, les cas invalides échouent. Il n'affiche jamais ni jeton, ni mot de passe, ni clé. Code de sortie ≠ 0 au moindre FAIL.
Son propre fonctionnement est validé avant le jour J : `tests/prod/real-e2e.selftest.test.ts` le fait tourner contre deux projets simulés fidèles (vraies fonctions, vraies bases Postgres avec rôles et droits) — plus de 70 contrôles, et il **échoue** si la clé diffère entre les projets.

**Complément manuel (navigateur, 5 min)** : REV-EM › Réglages › Applications connectées › LexNote › *Connecter* → LexNote (connexion) → *Autoriser* → *Retourner dans REV-EM* → « LexNote ✓ Connecté » → *Vérifier* ;
LexNote › Réglages › Applications connectées : « Connecté » ; *Déconnecter* ; recharger les deux : « Déconnecté ». Refaire avec le compte B dans un second profil de navigateur.

## 7. Advisors

```bash
node scripts/prod/supabase-admin.mjs advisors --project $LEX_REF
node scripts/prod/supabase-admin.mjs advisors --project $REV_REF
```
(Appelle `GET /v1/projects/{ref}/advisors/{security,performance}`. Si le point d'entrée n'est pas disponible pour votre plan, l'outil le dit : ouvrir *Advisors* dans le tableau de bord.)
Attendu pour les objets `integration_*` : **aucune alerte**. Alertes plausibles qui ne concernent PAS ces objets : « Leaked password protection disabled » (Auth), « unused index » sur une table neuve (les index d'intégration
servent à des chemins rares mais nécessaires : unicité, purge des nonces — à conserver).
Déjà traités dans les migrations : `auth_rls_initplan` (policy en `(select auth.uid())`), `rls_enabled_no_policy` (refus explicite sur intentions/nonces), `function_search_path_mutable` (figé),
`security_definer_function_executable` (droits retirés à `anon`/`authenticated`/`PUBLIC`), clés étrangères non indexées (toutes indexées).

## 8. Critère de sortie (à cocher avec les sorties réelles)

- [ ] `verify-db` : 24 PASS sur LexNote et sur REV-EM
- [ ] `real-e2e.mjs` : 0 FAIL (A et B), CORS `delete-account` vérifié
- [ ] test navigateur A et B
- [ ] Advisors : aucune alerte sur `integration_*`
- [ ] aucune clé dans Git (`git grep -n "$INTEGRATION_KEY"` vide), aucune clé dans Vercel (`VITE_*`)
