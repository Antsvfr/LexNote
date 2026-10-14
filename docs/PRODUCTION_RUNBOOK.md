# Mise en production — liaison REV-EM ⇄ LexNote

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
