# Environnement de TEST — procédure exacte (jamais la production)

> Objectif : transformer les portes `NOT_RUN` de `release/gates.json` en `PASS` ou `FAIL` **sans toucher à la production**.
> Règle absolue : **aucune commande de ce document ne vise `LEX_REF` / `REV_REF` (production)**. Les scripts d'écriture
> (`supabase-smoke.mjs`, `rehearsal.mjs`) **refusent** une cible de production ou distante ; `service_role` ne va **jamais** dans le frontend.

## 0. Quel environnement de test ? (état du 2026-10-16)

La création de **branches Supabase** (Branching) est refusée sur l'organisation `EmLyon-revision` (plan **Free** ; Branching = plan **Pro**) — aucun coût engagé. Trois voies, de la moins chère à la plus complète :

| Voie | Coût | Débloque | Limite |
|---|---|---|---|
| **B. Supabase LOCAL** (`supabase start`, Docker, sur votre Mac) | gratuit | `migrations-on-test`, `supabase-smoke`, kill switch IA réel (`SMOKE_EXPECT_DISABLED`), une partie de `rollback-rehearsed` | une seule pile locale : pas la liaison entre **deux** projets |
| **A. Nouveau(x) projet(s) Supabase de test** dans une **autre organisation** Free (ou en supprimant/pausant un projet inutilisé) | gratuit si la limite de projets gratuits actifs de votre compte le permet (à vérifier dans *Billing* ; la limite était de 2 au moment de la rédaction) | tout, y compris `integration-diagnostic` et `real-e2e` (2 projets) | quota de projets Free |
| **C. Passage de l'organisation en Pro** | payant | Branching (« deux branches TEST ») ou plus de projets | coût mensuel + horaire des branches |

**Recommandation** : commencer par **B** (gratuit, immédiat, vraie pile Supabase : Postgres + GoTrue + PostgREST), puis **A** uniquement pour `integration-diagnostic` / `real-e2e` / AL-*.

### Voie B — Supabase local (les migrations du dépôt s'appliquent toutes seules au démarrage)
```bash
cd lexnote                      # branche claude/production-readiness-observability, Docker lancé
supabase start                  # applique supabase/migrations/*.sql dans l'ordre sur une base locale neuve
eval "$(supabase status -o env | sed 's/^/export /')"      # API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL (clés de DÉMONSTRATION locales)
node scripts/prod/migration-status.mjs --db-url "$DB_URL"   # attendu : 12 × « DÉJÀ APPLIQUÉE »   → porte migrations-on-test
SMOKE_CONFIRM=1 SMOKE_LOCAL=1 SMOKE_SUPABASE_URL=$API_URL SMOKE_ANON_KEY=$ANON_KEY SMOKE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
  node scripts/prod/supabase-smoke.mjs                       # auth, RLS, sessions, suppression douce, nettoyage   → porte supabase-smoke
```
* `SMOKE_LOCAL=1` n'accepte **que** `http://127.0.0.1:<port>` / `http://localhost:<port>` (refus testé) ; les clés locales ne valent rien hors de votre machine.
* Si `supabase start` se plaint de `config.toml` : `supabase init` dans un dossier temporaire et recopier les sections `[api]`/`[db]` générées (les sections `[functions.*]` du dépôt doivent rester).
* Fonctions Edge en local (pour `health`, `study-ai` et le kill switch, **sans clé payante** si `STUDY_AI_ENABLED=false`) :
  `printf 'STUDY_AI_ENABLED=false\nAPP_ORIGINS=http://localhost:5173\n' > /tmp/lexnote-fn.env && supabase functions serve --env-file /tmp/lexnote-fn.env --no-verify-jwt`
  puis `SMOKE_CONFIRM=1 SMOKE_EXPECT_DISABLED=1 LEXNOTE_SUPABASE_URL=$API_URL LEXNOTE_ANON_KEY=$ANON_KEY LEXNOTE_A_EMAIL=… LEXNOTE_A_PASSWORD=… node scripts/prod/study-ai-smoke.mjs` (compte créé par `supabase-smoke` ou via Studio `http://127.0.0.1:54323`). Cela prouve l'interrupteur sur la vraie fonction, mais **ne remplace pas** `ai-real-smoke` (fournisseur réel).
* Après usage : `supabase stop` (ajouter `--no-backup` pour effacer les données de test).
* La pile locale ne prouve **pas** : le comportement de l'hébergement Supabase (limites, régions, `verify_jwt` de la plateforme), la liaison à deux projets, Vercel. Ces points restent `integration-diagnostic`, `real-e2e`, AL-*, `rollback-rehearsed`.

### Voie A — projets de test hébergés
Les sections 1 à 11 ci-dessous s'appliquent telles quelles (créer `lexnote-test` et `revem-test` dans une organisation qui peut les héberger).

## 1. Deux projets de test, séparés de la production

Dans le tableau de bord Supabase (même organisation, **nouveaux projets**, mot de passe de base généré et rangé dans votre gestionnaire de secrets) :

| Projet | Nom conseillé | Référence (20 caractères) | Rôle |
|---|---|---|---|
| LexNote TEST | `lexnote-test` | `LEX_TEST_REF` | application LexNote |
| REV-EM TEST | `revem-test` | `REV_TEST_REF` | uniquement pour la liaison / connexion automatique (porte `integration-diagnostic`, `real-e2e`, scénarios AL-*) |

```bash
# Une seule fois, dans un shell dédié (rien de tout cela n'est écrit dans un fichier du dépôt)
export SUPABASE_ACCESS_TOKEN=…                 # jeton personnel
export LEX_REF=…  REV_REF=…                    # PRODUCTION — ne servent QU'À être refusées par les scripts de test
export LEX_TEST_REF=…  REV_TEST_REF=…
export TEST_ORIGIN_LEX=http://localhost:5173   # LexNote de test servi sur votre machine (npm run dev) — voir §4
export TEST_ORIGIN_REV=http://localhost:8080   # REV-EM de test servi sur votre machine (dépôt REV-EM)
```

## 2. LexNote TEST — migrations, fonctions, secrets, URLs

Projet **vierge** : on applique les 12 migrations officielles dans l'ordre (jamais `supabase/reconciliation/*`, réservé à l'ancien schéma de production).
```bash
cd lexnote   # branche claude/production-readiness-observability
for f in $(ls supabase/migrations/*.sql | sort); do
  node scripts/prod/supabase-admin.mjs apply-sql --project $LEX_TEST_REF --file $f --apply || break
done
node scripts/prod/migration-status.mjs --project $LEX_TEST_REF          # attendu : 12 × « DÉJÀ APPLIQUÉE »  → porte migrations-on-test
node scripts/prod/supabase-admin.mjs verify-db     --project $LEX_TEST_REF   # 24 PASS
node scripts/prod/supabase-admin.mjs verify-schema --project $LEX_TEST_REF   # 13 PASS
```
Fonctions (la configuration `verify_jwt` vient de `supabase/config.toml`) :
```bash
supabase functions deploy health              --project-ref $LEX_TEST_REF --no-verify-jwt
supabase functions deploy integration-link    --project-ref $LEX_TEST_REF --no-verify-jwt
supabase functions deploy integration-gateway --project-ref $LEX_TEST_REF --no-verify-jwt
supabase functions deploy study-ai            --project-ref $LEX_TEST_REF
supabase functions deploy course-engine       --project-ref $LEX_TEST_REF
supabase functions deploy delete-account      --project-ref $LEX_TEST_REF
```

Secrets de TEST (clé d'intégration **identique** dans les deux projets de test, **différente** de la production) :
```bash
export INTEGRATION_KEY="$(openssl rand -base64 48)"          # reste dans ce shell
export INTEGRATION_ENV=development                            # autorise explicitement localhost (jamais en production)
export INTEGRATION_SELF_APP_URL=$TEST_ORIGIN_LEX/  INTEGRATION_PEER_APP_URL=$TEST_ORIGIN_REV/REV-EM/
node scripts/prod/supabase-admin.mjs set-secrets --app lexnote --project $LEX_TEST_REF --peer-ref $REV_TEST_REF --apply
supabase secrets set --project-ref $LEX_TEST_REF APP_ORIGINS=$TEST_ORIGIN_LEX RELEASE_VERSION=test-$(git rev-parse --short HEAD) \
  STUDY_AI_ENABLED=false STUDY_AI_MAX_PER_DAY=20 STUDY_AI_MAX_CHARS_PER_DAY=400000 STUDY_AI_GLOBAL_MAX_REQUESTS_DAY=40 STUDY_AI_GLOBAL_MAX_CHARS_DAY=800000
AUTH_REDIRECTS="$TEST_ORIGIN_LEX/**,$TEST_ORIGIN_LEX/integrations/revem/**" node scripts/prod/supabase-admin.mjs auth-urls --app lexnote --project $LEX_TEST_REF --apply
```
À faire à la main dans le tableau de bord du projet de test : *Authentication → Providers → Email → « Confirm email » **désactivé*** (permet l'inscription publique testée par `supabase-smoke.mjs`) ; *URL Configuration → Site URL* = `$TEST_ORIGIN_LEX`.
Clé du fournisseur IA de TEST (clé dédiée avec plafond de dépense bas), saisie masquée :
```bash
read -rs K && supabase secrets set --project-ref $LEX_TEST_REF ANTHROPIC_API_KEY="$K"; unset K
```
Santé : `curl -s https://$LEX_TEST_REF.supabase.co/functions/v1/health` → `status: ok`, `schema: ok`, `ai: disabled`.

## 3. REV-EM TEST (dépôt REV-EM, branche de la PR #25)

```bash
cd ../rev-em
for f in $(ls supabase/migrations/*.sql | sort); do      # 000 … 009 sur un projet vierge
  node ../lexnote/scripts/prod/supabase-admin.mjs apply-sql --project $REV_TEST_REF --file $f --apply || break
done
node ../lexnote/scripts/prod/supabase-admin.mjs verify-db --project $REV_TEST_REF
supabase functions deploy integration-gateway --project-ref $REV_TEST_REF --no-verify-jwt
supabase functions deploy integration-link    --project-ref $REV_TEST_REF --no-verify-jwt
node ../lexnote/scripts/prod/supabase-admin.mjs set-secrets --app revem --project $REV_TEST_REF --peer-ref $LEX_TEST_REF --apply   # mêmes INTEGRATION_* exportés qu'au §2
supabase secrets set --project-ref $REV_TEST_REF APP_ORIGINS=$TEST_ORIGIN_REV
AUTH_REDIRECTS="$TEST_ORIGIN_REV/**" node ../lexnote/scripts/prod/supabase-admin.mjs auth-urls --app revem --project $REV_TEST_REF --apply
```
(Les fonctions `brightspace-*` ne sont pas nécessaires aux tests d'intégration.)

## 4. Données de test et applications de test

* Comptes (création **administrateur**, e-mail confirmé, mots de passe aléatoires rangés dans votre gestionnaire) : 2 comptes LexNote (`lex-a@…`, `lex-b@…`) sur `LEX_TEST_REF`, 2 comptes REV-EM (`rev-a@…`, `rev-b@…`) sur `REV_TEST_REF`. Domaine conseillé : `@smoke.lexnote.invalid` pour LexNote → nettoyés par `supabase-smoke.mjs`.
* Un **évènement de planning** REV-EM pour `rev-a` (créé depuis l'interface REV-EM de test) : indispensable aux scénarios AL-* (« Prendre mes notes dans LexNote »).
* LexNote de test sur votre machine, branché sur le projet de test **avec la seule clé publique `anon`** :
  `VITE_SUPABASE_URL=https://$LEX_TEST_REF.supabase.co VITE_SUPABASE_ANON_KEY=<anon de LEX_TEST_REF> VITE_AI_URL=https://$LEX_TEST_REF.supabase.co/functions/v1/study-ai npm run dev` → `http://localhost:5173`.
* REV-EM de test : démarrage habituel du dépôt REV-EM avec `SUPABASE_URL`/`anon` de `REV_TEST_REF`, sur `http://localhost:8080`.

## 5. Commandes, dans l'ordre, et la preuve à enregistrer

```bash
cd lexnote
# --- 5.1 Smoke Supabase (auth, RLS, sessions, suppression douce, nettoyage) — porte supabase-smoke
SMOKE_CONFIRM=1 SMOKE_SUPABASE_URL=https://$LEX_TEST_REF.supabase.co SMOKE_EXPECTED_REF=$LEX_TEST_REF \
  SMOKE_PRODUCTION_REFS=$LEX_REF,$REV_REF SMOKE_ANON_KEY=<anon LEX_TEST_REF> SMOKE_SERVICE_ROLE_KEY=<service_role LEX_TEST_REF> \
  node scripts/prod/supabase-smoke.mjs && node scripts/prod/evidence.mjs record supabase-smoke PASS --note "projet de test $LEX_TEST_REF, tous contrôles PASS"
# --- 5.2 Diagnostic d'intégration — porte integration-diagnostic
LEXNOTE_SUPABASE_URL=https://$LEX_TEST_REF.supabase.co REVEM_SUPABASE_URL=https://$REV_TEST_REF.supabase.co \
  node scripts/prod/integration-diagnostic.mjs && node scripts/prod/evidence.mjs record integration-diagnostic PASS --note "HMAC, kid, horloge, CORS OK sur les 2 projets de test"
# --- 5.3 Liaison complète + attaques (rejeu, mauvais compte, révocation) — complète integration-diagnostic
LEXNOTE_SUPABASE_URL=https://$LEX_TEST_REF.supabase.co LEXNOTE_ANON_KEY=<anon> REVEM_SUPABASE_URL=https://$REV_TEST_REF.supabase.co REVEM_ANON_KEY=<anon> \
  LEXNOTE_ORIGIN=$TEST_ORIGIN_LEX REVEM_ORIGIN=$TEST_ORIGIN_REV REVEM_A_EMAIL=… REVEM_A_PASSWORD=… REVEM_B_EMAIL=… REVEM_B_PASSWORD=… \
  LEXNOTE_A_EMAIL=… LEXNOTE_A_PASSWORD=… LEXNOTE_B_EMAIL=… LEXNOTE_B_PASSWORD=… node scripts/prod/real-e2e.mjs
```
Lecture des résultats du diagnostic : `PASS INT-GW` (passerelle joignable), `PASS INT-HMAC` (signature + kid acceptés), `PASS INT-CLOCK` (décalage ≤ 30 s), `PASS INT-URL` (CORS) ; sinon le code de la ligne FAIL donne la cause (`INT-KID-401`, `INT-HMAC-401`, `INT-CLOCK-401`, `INT-PEER-401`, `INT-GW-JWT`, `INT-GW-404`).

## 6. Ce que couvre quoi (pour ne rien croire acquis)

| Demande | Automatisé réel (projet de test) | Automatisé simulé (déjà vert) | Manuel |
|---|---|---|---|
| Inscription / connexion | `supabase-smoke` (création admin + connexion ; inscription publique si l'e-mail n'est pas confirmé) | `auth-persistence.spec.ts` | — |
| Rafraîchissement, session persistante | `supabase-smoke` (refresh valide, renouvelé 2×) | `supabaseIntegration.test.ts` | PWA 4 |
| Déconnexion locale / globale | `supabase-smoke` (l'autre appareil survit au local, tout meurt au global) | idem | — |
| Matière / séance / notes / sync / suppression | `supabase-smoke` (RLS, version serveur, suppression douce) | `dataLoss.test.ts`, `engine.test.ts` | rechargement navigateur : AL-* |
| Liaison, rejeu, mauvais compte, révocation | `real-e2e.mjs` | `integration.spec.ts`, `src/integration/*.test.ts` | — |
| Faux « session expirée » (4 scénarios) | gateways : `integration-diagnostic` (INT-GW-JWT, INT-HMAC/KID) ; session : `supabase-smoke` (refresh valide / session morte) | `supabaseIntegration.test.ts` (7 cas), `auth-persistence.spec.ts` | SE-1 à SE-4 ci-dessous |
| Intention de lancement, connexion automatique | — (dépend d'un évènement REV-EM réel) | `autologin.test.ts`, `launch.test.ts`, `revem-launch.spec.ts` | **AL-1 à AL-9** |

### 6.1 « Session expirée » — vérification des 4 scénarios (SE) sur le projet de test
Réponse attendue : seul **SE-3** affiche « Votre session LexNote a expiré ». Les trois autres n'affichent **jamais** ce message.
* **SE-1** passerelle déployée avec le mauvais `verify_jwt` : `supabase functions deploy integration-gateway --project-ref $LEX_TEST_REF` (**sans** `--no-verify-jwt` ET en retirant temporairement `[functions.integration-gateway]` de `supabase/config.toml` en local) → `integration-diagnostic.mjs` doit afficher `FAIL INT-GW-JWT` ; dans l'application : « Les serveurs de LexNote et de REV-EM n'ont pas pu s'authentifier… » + code `gateway-verify-jwt`. Redéployer avec `--no-verify-jwt`.
* **SE-2** mauvaise clé : `INTEGRATION_KEY` différente côté REV-EM → `FAIL INT-HMAC-401` ; mauvais `INTEGRATION_KEY_ID` → `FAIL INT-KID-401` ; application : même message « serveurs… », code `bad-signature` / `unknown-key`. Restaurer les secrets.
* **SE-3** vraie session expirée : dans le navigateur de test, *Réglages → Se déconnecter partout* depuis un autre profil (ou `supabase-smoke` section SESSION), puis cliquer « Connecter LexNote » : message « Votre session LexNote a expiré. Reconnectez-vous : la demande en cours sera reprise. »
* **SE-4** jeton d'accès expiré mais rafraîchissement valide : attendre l'expiration du jeton (1 h par défaut ; ou réduire *Auth → JWT expiry* à 300 s sur le projet de test) puis cliquer « Connecter LexNote » : **aucun** message d'erreur, la connexion aboutit.

### 6.2 Connexion automatique REV-EM → LexNote (AL) — à rejouer à la main sur les projets de test
Réponds-moi uniquement `AL-n PASS` / `AL-n FAIL (ce que tu vois)`.
1. **AL-1** REV-EM (rev-a) → *Réglages → Applications connectées → LexNote → Connecter* → connexion LexNote (lex-a) → *Autoriser* en **cochant** « connexion automatique » → retour REV-EM « Connecté ».
2. **AL-2** Dans LexNote : *Se déconnecter*, fermer l'onglet, fermer le navigateur, rouvrir. REV-EM → évènement du planning → « Prendre mes notes dans LexNote » : **aucun mot de passe demandé**, arrivée directement dans l'éditeur, bonne matière, bonne séance, panneau Transcription visible, micro non démarré.
3. **AL-3** Même évènement recliqué 3 fois (et double clic) : **une seule** séance, une seule matière.
4. **AL-4** Décocher la connexion automatique dans LexNote (*Applications connectées*), se déconnecter, recliquer depuis REV-EM : l'écran de connexion LexNote apparaît, puis le **même** cours s'ouvre.
5. **AL-5** Mauvais compte : connecté à lex-b dans LexNote, cliquer depuis rev-a : explication « Changer de compte », rien créé pour lex-b.
6. **AL-6** Lien rejoué : recopier l'URL de lancement (avant et après usage), l'ouvrir dans un 2ᵉ onglet : refus clair, aucune seconde session.
7. **AL-7** Intention expirée : ouvrir le lien > 5 min après sa création : refus « demande expirée » ; entre 2 et 5 min : pas de connexion automatique mais ouverture possible après connexion normale.
8. **AL-8** Révocation : *Déconnecter* la liaison côté REV-EM puis recliquer « Prendre mes notes » : refus clair, aucune session.
9. **AL-9** L'URL de lancement ne contient ni jeton, ni e-mail, ni identifiant de compte, ni contenu du cours (seulement `intent=` et `#n=`).

## 7. États de la PRODUCTION — lecture seule (aucune migration appliquée)

À lancer par vous (jeton personnel, accès réseau) ; la production n'est **pas** modifiée :
```bash
node scripts/prod/migration-status.mjs --project $LEX_REF
```
Lecture : `20261007…20261013` = **DÉJÀ APPLIQUÉE** ; `20261014…20261018` = **ABSENTE** (ou **DÉJÀ APPLIQUÉE**). Une ligne **DIFFÉRENTE**, ou « ordre rompu », ⇒ **STOP immédiat**, ne rien appliquer. Puis, si la sortie est conforme :
`node scripts/prod/evidence.mjs record migration-status PASS --note "sortie du <date> : 07..13 appliquées, 14..18 absentes, aucune DIFFÉRENTE"`.

## 8. IA réelle (projet de TEST uniquement) — porte `ai-real-smoke`

```bash
# a) limites très basses déjà posées au §2 (40 requêtes/jour globales). Activer l'IA SUR LE PROJET DE TEST :
supabase secrets set --project-ref $LEX_TEST_REF STUDY_AI_ENABLED=true
export LEXNOTE_SUPABASE_URL=https://$LEX_TEST_REF.supabase.co LEXNOTE_ANON_KEY=<anon> LEXNOTE_A_EMAIL=… LEXNOTE_A_PASSWORD=…
SMOKE_CONFIRM=1 SMOKE_RATE_LIMIT=1 node scripts/prod/study-ai-smoke.mjs                         # express, détaillé, traduction, structuration, longue, 429
# b) délai : STUDY_AI_TIMEOUT_MS=1500 puis SMOKE_CONFIRM=1 SMOKE_EXPECT_TIMEOUT=1 …              (ensuite supprimer le secret)
# c) fournisseur indisponible : ANTHROPIC_API_KEY=invalide puis SMOKE_EXPECT_PROVIDER_ERROR=1 …  (ensuite remettre la vraie clé de test)
# d) budget global : STUDY_AI_GLOBAL_MAX_REQUESTS_DAY=1 puis SMOKE_EXPECT_CAPACITY=1 …           (503 ai_capacity)
# e) INTERRUPTEUR : STUDY_AI_ENABLED=false puis SMOKE_EXPECT_DISABLED=1 …                         (503 ai_disabled pour tous)
# f) FIN, dans tous les cas : 
supabase secrets set --project-ref $LEX_TEST_REF STUDY_AI_ENABLED=false
node scripts/prod/evidence.mjs record ai-real-smoke PASS --note "a–e PASS sur $LEX_TEST_REF ; STUDY_AI_ENABLED remis à false"
```
« JSON invalide » du modèle : non provocable sur un vrai modèle ; couvert par `handler.test.ts` (Deno) et `study-ai-smoke.selftest` (un JSON invalide fait échouer le script). La clé du fournisseur n'est jamais affichée (saisie masquée, jamais dans un fichier).

## 9. Répétition de sauvegarde / restauration — portes `backup-restore-rehearsal` et `backup`

* **Déjà exécutée localement** sur un vrai PostgreSQL 16 : `node scripts/prod/rehearsal.mjs backup-restore --url 'postgresql:///postgres?host=<dossier socket>&port=<port>&user=postgres'` (voir `docs/PRODUCTION_RUNBOOK.md` §I.2 pour les trois **corrections de procédure** qu'elle a révélées).
* **Sur le projet de test** (même logique, vrais outils) : exécuter §I.2 du runbook avec `LEX_TEST_REF`, restaurer dans une base PostgreSQL locale jetable (`createdb restore_test`), comparer les comptes (`select count(*) from public.course_sessions`), puis `node scripts/prod/evidence.mjs record backup-restore-rehearsal PASS --note …`.
* **Production** : la porte `backup` n'est PASS que lorsque **vous** avez réalisé et vérifié la sauvegarde de production (jamais par un script de ce dépôt).

## 10. Répétition du retour arrière — porte `rollback-rehearsed`

Déjà répétés **sans Supabase** : base additive (`rehearsal.mjs db-rollback`, PASS) et frontend (`frontend-rollback-drill.mjs`, PASS). Reste à répéter **sur le projet de test + la prévisualisation Vercel** :
1. Noter le SHA fonctionnel `A` (ancienne version) et le SHA `B` (nouvelle). Déployer `B` sur le projet de test (fonctions + migration 18).
2. Simuler le problème : `supabase secrets set STUDY_AI_ENABLED=true`, provoquer un refus (budget global à 1) → constater `ai_capacity` ; **kill switch** → `ai_disabled`.
3. Retour arrière Edge Function : `git checkout A -- supabase/functions && supabase functions deploy study-ai --project-ref $LEX_TEST_REF && git checkout -- .` ; constater que l'IA répond encore (ancienne signature SQL compatible) — **et que le budget global / l'interrupteur n'existent plus** : couper l'IA par `supabase secrets unset ANTHROPIC_API_KEY --project-ref $LEX_TEST_REF`.
4. Retour arrière frontend : Vercel → *Deployments* → déploiement de la prévisualisation `A` → *Promote*/*Instant Rollback* ; le navigateur reçoit « Une nouvelle version… », les notes sont intactes.
5. Base : **aucune migration supprimée** ; `migration-status.mjs --project $LEX_TEST_REF` reste à 12 « DÉJÀ APPLIQUÉE ».
6. `node scripts/prod/evidence.mjs record rollback-rehearsed PASS --note "A→B→A sur $LEX_TEST_REF, données vérifiées"`.

## 11. Firefox et WebKit — porte `browsers-firefox-webkit`

Le téléchargement des navigateurs est **bloqué** dans l'environnement de développement de cette PR. Sur votre Mac :
```bash
cd lexnote && npm ci && ALL_BROWSERS=1 npx playwright install firefox webkit && npm run test:e2e:browsers
```
Si tout passe : `node scripts/prod/evidence.mjs record browsers-firefox-webkit PASS --note "Firefox <v> + WebKit <v>, N passed"`. Un échec : noter le test et la raison (limitation du navigateur / bogue) avant de classer.
