# LexNote — mise en place de Supabase (comptes + synchronisation)

> LexNote utilise **son propre projet Supabase, neuf et dédié**.
> Il ne partage **rien** avec REV-EM : ni projet, ni base, ni utilisateurs, ni clés, ni tables, ni URLs.
> La liaison LexNote ↔ REV-EM passe uniquement par des contrats publics signés (voir §2 quater et `docs/REVEM_LEXNOTE_INTEGRATION.md`) : aucun partage de base ni de session.
>
> **Une seule architecture officielle** : la chaîne de PR #3 → #8 ; le schéma est défini par les migrations ci-dessous (`docs/SCHEMA_RECONCILIATION.md`). **Projet existant avec un ancien schéma expérimental ? Ne lancez pas la migration par-dessus : suivez `docs/SCHEMA_RECONCILIATION.md` §3.**

## 1. Ce que fait chaque partie

| Élément | Où | Rôle |
|---|---|---|
| Migration SQL | `supabase/migrations/20261007000000_lexnote_init.sql` | Tables, triggers, **RLS forcée**, droits |
| Clé publique « anon » | variable `VITE_SUPABASE_ANON_KEY` | Identifie le projet côté navigateur. **Publique par conception** : la sécurité vient de la RLS, pas du secret de cette clé |
| Clé `service_role` | **Jamais** dans LexNote, ni dans Vercel, ni dans le dépôt | Utilisée uniquement par l'Edge Function `delete-account` (fournie automatiquement par Supabase) |
| Edge Function | `supabase/functions/delete-account` | Suppression définitive du compte (impossible depuis le navigateur) |

## 2. Étapes manuelles (dans cet ordre)

1. **Créer un NOUVEAU projet Supabase** (supabase.com → *New project*), par exemple « lexnote ». Ne réutilisez pas le projet de REV-EM.
2. **Exécuter la migration** : *SQL Editor → New query*, coller le contenu de `supabase/migrations/20261007000000_lexnote_init.sql`, *Run*. (Ou : `supabase link --project-ref <ref>` puis `supabase db push`.)
3. **Récupérer les deux valeurs publiques** : *Project Settings → API* → **Project URL** et **anon public key**. Ne copiez **pas** la clé `service_role`.
4. **Activer l'authentification e-mail** : *Authentication → Providers → Email* → activé. Recommandé : *Confirm email* activé (LexNote affiche alors « un lien de confirmation a été envoyé »).
5. **Configurer les URLs** : *Authentication → URL Configuration* :
   - **Site URL** : l'adresse de production (ex. `https://lexnote.vercel.app`).
   - **Redirect URLs** : `https://<votre-domaine>/**`, `https://<votre-domaine>/reset-password` et, pour le développement, `http://localhost:5173/**`, `http://localhost:4173/**`.
6. **Déployer la fonction de suppression de compte** :
   ```bash
   supabase login
   supabase link --project-ref <ref>
   supabase functions deploy delete-account
   ```
   Tant qu'elle n'est pas déployée, « Supprimer mon compte » affiche une erreur claire et **ne supprime rien**.
7. **Configurer Vercel** : *Project → Settings → Environment Variables* (environnements *Production* **et** *Preview*) :
   - `VITE_SUPABASE_URL` = Project URL
   - `VITE_SUPABASE_ANON_KEY` = anon public key
   puis **redéployer** (les variables `VITE_*` sont figées au moment du build).
8. **En local** : `cp .env.example .env.local`, renseigner les deux valeurs, `npm run dev`. Le fichier `.env.local` est ignoré par Git.
9. *(Recommandé)* *Authentication → Rate limits / Attack protection* : laisser les protections par défaut activées.

### Sans ces variables
L'application démarre mais l'écran de connexion affiche « LexNote n'est pas encore relié à un projet Supabase » et **aucune donnée n'est accessible** (pas de mode anonyme qui mélangerait des données).

### 2 bis. Migrations supplémentaires (à exécuter dans l'ordre, après la première)

Ordre complet et exclusif : `20261007…lexnote_init` → `20261008…study_artifacts` → `20261009…course_engine` → `20261010…study_artifacts_from_course` → `20261011…integration_links` → `20261012…fk_indexes` → `20261013…security_hardening`. Vérification : `supabase/reconciliation/verify-official-schema.sql` (13 PASS).

1. `supabase/migrations/20261008000000_study_artifacts.sql` — supports d'étude (fiches, cartes mentales…).
2. `supabase/migrations/20261009000000_course_engine.sql` — documents importés (texte analysé uniquement, **jamais le fichier**) et cours reconstruits versionnés.
3. `supabase/migrations/20261010000000_study_artifacts_from_course.sql` — supports de révision dérivés du cours reconstruit (version du cours, instantané des sources, provenance, réglages, type MÉTHODE).

4. `supabase/migrations/20261011000000_integration_links.sql` — liaison avec un compte REV-EM (tables `integration_*`, RLS forcée, fonctions réservées à `service_role`).
5. `supabase/migrations/20261012000000_fk_indexes.sql` — index sur les clés étrangères (Performance Advisor).
6. `supabase/migrations/20261013000000_security_hardening.sql` — `search_path` figé pour les helpers de trigger et révocation de l’exécution directe de `lx_handle_new_user` (Security Advisor).

### 2 quater. Connexion avec REV-EM (facultatif — sans elle, LexNote fonctionne seule)

Deux Edge Functions : `integration-link` (appelée par le navigateur avec le JWT de l'utilisateur) et `integration-gateway` (serveur ↔ serveur, **sans JWT** mais signée).
```bash
supabase functions deploy integration-link
supabase functions deploy integration-gateway --no-verify-jwt     # la signature HMAC remplace le JWT, uniquement pour cette fonction
supabase secrets set INTEGRATION_ENV=production INTEGRATION_KEY_ID=k1 INTEGRATION_KEY=<MÊME clé que REV-EM, ≥ 32 car., openssl rand -base64 48> \
  INTEGRATION_SELF_APP_URL=https://lex-note-svfr.vercel.app/ \
  INTEGRATION_PEER_APP_URL=https://antsvfr.github.io/REV-EM/ \
  INTEGRATION_PEER_GATEWAY_URL=https://<réf-projet-REV-EM>.supabase.co/functions/v1/integration-gateway
```
Procédure complète, vérifications et tests d'attaque : `docs/PRODUCTION_RUNBOOK.md`. La clé reste dans les secrets Supabase : **jamais** dans Vercel, dans le dépôt ni dans le navigateur. Détails : `docs/REVEM_LEXNOTE_INTEGRATION.md` §11.

### 2 ter. Moteur de cours distant (facultatif — sans lui, le moteur local est utilisé)

```bash
supabase secrets set ANTHROPIC_API_KEY=<clé> COURSE_ENGINE_MODEL=<modèle>   # secrets SERVEUR : jamais dans Vercel/le frontend
supabase functions deploy course-engine
```
Puis, dans Vercel : `VITE_ENGINE_URL=https://<ref>.supabase.co/functions/v1/course-engine`. La fonction n'a pu être testée contre un vrai modèle dans l'environnement de développement : la tester après déploiement.

## 3. Sécurité : ce qui est garanti **au niveau de la base**

* Toutes les tables ont `user_id` (ou `id` pour `profiles`) et **`ENABLE` + `FORCE ROW LEVEL SECURITY`**.
* Quatre politiques par table, **uniquement** pour le rôle `authenticated`, toutes sur `user_id = (select auth.uid())` (lecture, insertion — `with check` —, mise à jour — `using` + `with check` —, suppression).
* Le rôle `anon` n'a **aucun droit** sur les tables (`revoke all`) : un visiteur non connecté ne peut rien lire.
* Clés étrangères **composites** `(id, user_id)` : une séance ne peut pas être rattachée à la matière d'un autre utilisateur, même par une requête forgée.
* Un trigger (`lx_touch`) impose `user_id` inchangé, incrémente `version` et horodate côté serveur (le client ne peut pas tricher sur ces champs).
* Suppression des comptes : `on delete cascade` depuis `auth.users` vers toutes les données.
* **Tests** : `tests/db/rls.test.ts` exécute la migration sur un **vrai Postgres** (PGlite) et vérifie : lecture/écriture/modification/suppression croisées refusées, usurpation de `user_id` refusée, rattachements inter-comptes refusés, `anon` bloqué. Un test de mutation (policy volontairement affaiblie) a confirmé que ces tests détectent une faille.
* Audio : **jamais envoyé** dans Supabase Storage (aucun bucket créé). Il reste dans le navigateur de l'appareil.

## 4. Check-list avant mise en production

- [ ] Projet Supabase **dédié** (pas celui de REV-EM)
- [ ] Migration exécutée sans erreur ; *Table editor* montre le cadenas « RLS enabled » sur toutes les tables
- [ ] `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` définies dans Vercel, **aucune** clé `service_role` côté Vercel
- [ ] Site URL + Redirect URLs (dont `/reset-password`) renseignées
- [ ] Création de deux comptes de test : chacun ne voit que ses données (voir §5)
- [ ] Inscription → e-mail de confirmation reçu → connexion OK
- [ ] « Mot de passe oublié » → e-mail reçu → `/reset-password` fonctionne
- [ ] Edge Function `delete-account` déployée et testée sur un compte jetable
- [ ] Hors ligne : créer une séance, rétablir le réseau → indicateur « Synchronisé »

## 5. Vérification manuelle rapide de l'isolation (2 minutes)

1. Compte A : créer une matière « Test A » + une séance, attendre « Synchronisé ».
2. Se déconnecter. Compte B (autre e-mail) : l'espace est **vide**, la recherche de « Test A » ne renvoie rien.
3. *Supabase → Table editor → subjects* : deux lignes avec deux `user_id` différents.
4. *SQL Editor* : `select count(*) from public.subjects;` exécuté en tant que `postgres` voit tout (normal : c'est l'administrateur) ; depuis l'application, jamais.

## 6. Préparation de la connexion REV-EM (non active)

La table `external_accounts (user_id, provider, external_account_id)` est prête pour rattacher *plus tard* un compte REV-EM à un compte LexNote. Aucun code ne l'utilise, aucune donnée n'est partagée, aucun identifiant REV-EM n'existe dans LexNote. La future connexion devra passer par un échange explicite (OAuth / jeton signé), avec consentement de l'utilisateur.

## 7. Limites connues

* Le *vrai* service Supabase n'a pas pu être testé ici (pas de projet ni de clés dans l'environnement de développement) : l'adaptateur `supabaseRemote.ts` / `supabaseAuth.ts` est vérifié par le typage, par les tests du moteur de synchronisation sur un serveur simulé fidèle (versions, RLS, clés étrangères) et par les tests SQL sur Postgres — **pas** contre l'API PostgREST réelle. Faire le test manuel du §5 après déploiement.
* Les modifications distantes d'une séance **ouverte** dans l'éditeur ne s'affichent pas en direct : en cas de conflit, LexNote conserve les deux versions (copie « en conflit »).
* Les fichiers audio et les interruptions de capture restent propres à l'appareil.
