# Intégration REV-EM ⇄ LexNote — contrat `lexnote-revem/v1`

> **Statut : fondation + première connexion réelle (§11).** Ce document et `src/integration/` définissent *comment* les deux applications se
> parleront. Planning, assistant, synchronisation visible, écrans de liaison : **non construits** — ce sont les étapes suivantes, qui
> s'appuieront sur ce contrat sans le modifier.
>
> Audit réalisé en lecture seule : REV-EM au commit `92fa4a5` (`Antsvfr/REV-EM`, aucune modification), LexNote à la branche
> `claude/revem-integration-contract`.

## 0. Principes non négociables

1. **Deux applications, deux bases, deux comptes.** Aucune fusion de code, de projet Supabase, de tables, d'utilisateurs, de clés, d'URLs ni d'authentification.
2. **On échange des contrats publics, jamais des structures internes.** Aucun nom de table, de colonne ou de type interne ne traverse la frontière.
3. **Aucun secret ne circule entre frontends** : ni `service_role`, ni refresh token, ni access token complet, ni clé d'API (§5).
4. **Minimisation** : on échange des *références* (titres, compteurs, liens, évènements), jamais le contenu des cours (notes, transcription, texte de document).
5. **Chacune reste utilisable seule** : l'absence de l'autre application (ou de réseau) dégrade une fonction, jamais l'application (§9).
6. **L'étudiant décide** : une liaison est explicite, limitée par des droits (*scopes*) et révocable à tout moment.

---

## 1. Audit

### 1.1 Vue d'ensemble

| | **REV-EM** | **LexNote** |
|---|---|---|
| Nature | PWA en **JavaScript classique** (scripts sans bundler, `index.html` ≈ 24 000 lignes + modules `*.js`) | PWA **React 19 / Vite / TypeScript / TipTap** |
| Données locales | `localStorage` + IndexedDB (PDF originaux) | IndexedDB **par compte** (`lexnote-u-<id>`, `lexnote-capture-u-<id>`) ; audio et fichiers originaux **uniquement locaux** |
| Backend | Supabase (projet **propre**) : Auth + Postgres + RLS + Edge Functions `brightspace-*` | Supabase (projet **propre**) : Auth + Postgres + **RLS forcée** + Edge Functions `course-engine`, `delete-account` |
| Frontend → backend | `supabase-config.js` (URL + clé *anon*, publiques par conception) | variables `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` |
| Synchronisation | `sync-engine.js` (adaptateurs de sources, upsert idempotent, journal `sync_runs`) + `user-data.js` | `SyncEngine` local-first (verrou optimiste `version`, tombstones, parents → enfants) |
| Routage | **pas de routeur d'URL** : écrans pilotés par `state.screen` ; `manifest` : `scope "."` | React Router (`/session/:id/{course,review}`, `/supports/:id`, …) |
| Domaine / déploiement | à définir par l'étudiant (non codé en dur) | à définir (non codé en dur) |

> Les deux domaines de déploiement **ne sont pas connus du code** : toute URL de lien profond vient de la *configuration locale* de l'application qui la construit (§4.6).

### 1.2 Authentification et utilisateurs

| | REV-EM | LexNote |
|---|---|---|
| Fournisseur | Supabase Auth (`auth.js`, `window.LyonAuth`) : e-mail + mot de passe, liens e-mail (confirmation, réinitialisation) | Supabase Auth : e-mail + mot de passe, réinitialisation |
| Identifiant utilisateur | `auth.users.id` (UUID) = `profiles.id` | `auth.users.id` (UUID) = `profiles.id` |
| Profil | `profiles` (pseudo, prénom, nom, téléphone, avatar) | `profiles` (prénom, préférences) |
| Isolation | RLS « `auth.uid() = user_id` » sur toutes les tables | RLS **forcée** + clés composites `(user_id, id)` |
| Suppression de compte | — | Edge Function `delete-account` uniquement |

**Conséquence** : un même étudiant a **deux UUID sans rapport**. Aucun UUID de compte, aucun e-mail ne servira d'identifiant d'intégration (§4.2).

### 1.3 Modèle métier — correspondances

| Concept | REV-EM | LexNote | Rapport |
|---|---|---|---|
| **Matière** | `subjects` (`local_id`, nom, icône, couleur, `semester_id`) ; matières « intégrées » en dur, jamais stockées | `subjects` (nom, couleur, icône, `term`, enseignant) ; `modules` (chapitres d'une matière) | Même notion, **identifiants sans lien** : appariement explicite par l'étudiant |
| **Cours** | `chapters` = *un cours importé* (titre, texte d'origine, fiche, résumé, quiz, flashcards…) ; `courseRef = {courseId, chapterId, subjectId}` | `course_sessions` = *une séance réelle* (CM/TD/TP…) + `generated_courses` = *cours reconstruit versionné* | **Pas équivalents** : REV-EM « cours » = support de révision importé ; LexNote « cours » = séance vécue |
| **Planning** | `planning_events` (`data` jsonb, `local_id`), flux **ICS** (UID), `study_plans` (planning intelligent), `course_notes` (notes/checklist par `event_id`) | date/heure/salle sur la séance ; **pas de planning** | REV-EM propriétaire |
| **Documents** | `documents` (métadonnées ; contenu local) ; `chapters.original_text` (≤ 20 000 car.) | `source_documents` (texte analysé synchronisé ; **fichier jamais**) | Indépendants |
| **Fiches** | `chapters.content` (JSON ou Markdown) | `study_artifacts` type `COURSE_SHEET` (+ 7 autres types) | Même mot, **formats différents** |
| **Quiz** | `chapters.ai_quiz`, `ai_review_questions`, `question_stats` | `study_artifacts` type `QUIZ` (QCM/VF/court + source) | Idem |
| **Flashcards** | `chapters.ai_flashcards`, `ai_cards`, `progress(kind)` | `study_artifacts` type `FLASHCARDS` | Idem |
| **Progression** | `progress`, `exam_history`, `activities`, `daily_stats`, `user_stats`, `badges`, `chapter_visits` | aucune progression d'apprentissage (seulement durée de prise de notes) | REV-EM propriétaire |
| **Sources externes** | Brightspace (OAuth, `brightspace_connections`) | audio/transcription/notes/documents d'une séance | Indépendants |

### 1.4 Identifiants (IDs)

| | REV-EM | LexNote |
|---|---|---|
| Clé serveur | `uuid` (`gen_random_uuid()`) | `uuid` (`crypto.randomUUID()`, généré côté client) |
| Identifiant client avant sync | `local_id` = `genLibId(prefix)` → `prefix_<temps36>_<aléa6>` | identique à l'ID serveur (créé hors ligne) |
| Évènement de planning | UID ICS (stable) si le flux en fournit, sinon `local_id` | — |
| Idempotence | `unique(user_id, <clé naturelle>)` (`activities(user_id, ts)`, `course_notes(user_id, event_id)`) | `version` + `deleted_at` |

**Règle d'intégration** : un identifiant n'est *jamais* partagé comme clé. Chaque côté garde ses IDs ; l'autre côté ne voit que des `…Ref` **opaques** et conserve sa propre table de correspondance (§4.5).

---

## 2. Source of truth

Une donnée a **un seul propriétaire**. L'autre application n'en détient qu'une *référence* ou une *copie en lecture* qu'elle sait périmée.

| Domaine | Propriétaire (écriture) | L'autre application | Remarque |
|---|---|---|---|
| Comptes, mots de passe, sessions d'authentification | **chacune** pour son compte | rien | jamais partagés |
| **Planning** (évènements, flux ICS, planning intelligent `study_plans`) | **REV-EM** | LexNote reçoit des `ExternalCourseEvent` en lecture | LexNote ne modifie jamais le planning |
| **Révision globale** (plan de révision, répétition espacée, examens blancs) | **REV-EM** | — | |
| **Bibliothèque générale** (chapitres importés, banque de révision) | **REV-EM** | LexNote peut *référencer* un chapitre (`DeepLinkTarget`) | |
| **Progression globale** (stats, séries, badges, `exam_history`) | **REV-EM** | LexNote **émet** des `CourseProgressEvent` ; REV-EM décide s'il les compte | LexNote ne calcule aucune progression globale |
| **Séance réelle** (CM/TD/TP, date, salle, statut) | **LexNote** | REV-EM reçoit une `LexNoteSessionReference` | si liée à un évènement : `linkedExternalId` |
| **Prise de notes, transcription, audio** | **LexNote** | **jamais transmis** | audio : strictement local |
| **Sources** (notes, transcription, documents d'une séance) | **LexNote** | jamais transmises (seulement un *compteur*) | |
| **Cours reconstruit** (versions, provenance, confiance) | **LexNote** | numéro de version et date uniquement | |
| **Artefacts détaillés** (fiche, carte, schéma, tableau, chronologie, méthode, flashcards, quiz dérivés d'une séance) | **LexNote** | `StudyArtifactReference` (titre, type, compteur, lien) | contenu détaillé jamais copié |
| **Matières** | **chacune** pour les siennes | `ExternalSubjectRef` ; appariement **décidé par l'étudiant** | pas de fusion automatique par nom |

**Règles de conflit** : (1) jamais d'écriture croisée ; (2) une copie reçue porte l'`updatedAt` de la source et est remplacée par plus récent (*last-writer-wins par propriétaire*, sans fusion de champs) ; (3) une donnée supprimée chez le propriétaire est retirée de l'autre côté à la prochaine réception (`cancelled` / `GONE`).

---

## 3. Architecture

```
┌──────────── REV-EM ────────────┐                       ┌──────────── LexNote ───────────┐
│ UI  ─ index.html / *.js        │                       │ UI  ─ React                    │
│ Données locales + sync-engine  │                       │ IndexedDB + SyncEngine         │
│ Supabase REV-EM (Auth,RLS)     │                       │ Supabase LexNote (Auth,RLS)    │
│   └ Edge Function « gateway »  │◀──── contrats ───────▶│   └ Edge Function « gateway »  │
│       (futur, côté serveur)    │  enveloppes signées   │       (futur, côté serveur)    │
└────────────────────────────────┘   lexnote-revem/v1    └────────────────────────────────┘
        ▲ le frontend n'appelle QUE son propre backend ; il ne voit jamais de jeton de l'autre
```

- **Couche de contrats** : `src/integration/` (LexNote). `contracts.ts` est **autonome (zod seul)** et destiné à être *copié à l'identique* dans REV-EM (ou publié en paquet) ; une empreinte de fichier sera comparée en CI des deux dépôts.
- **Couche d'adaptation** : `mappers.ts` convertit *explicitement* (liste blanche) les types internes → contrats ; c'est le **seul** fichier qui connaît les types internes. Un nouveau champ interne n'est donc jamais exposé par accident.
- **Transport** (étape suivante, **non construit**) : le contrat est indépendant du transport. Recommandé : *serveur ↔ serveur* via une Edge Function « gateway » par application, qui authentifie l'appelant par **signature de liaison** (§5.3). Le navigateur de l'étudiant ne fait que déclencher et afficher.
- **Pourquoi pas un accès direct à la base de l'autre ?** Cela exigerait de partager des clés, d'exposer le schéma et de contourner la RLS — exactement ce qui est interdit.

---

## 4. Schémas d'échange (`lexnote-revem/v1`)

Tous définis dans `src/integration/contracts.ts` (zod) et exportés par `src/integration/index.ts`. Chaque charge utile porte `integrationVersion` et `kind`.

| Contrat | Sens | Rôle |
|---|---|---|
| `IntegrationIdentity` | les deux | identité **d'une liaison** (pseudonymes, scopes, statut, expiration) |
| `ExternalCourseEvent` | REV-EM → LexNote | un cours du planning (UID stable, horaires avec fuseau, type suggéré CM/TD/TP, matière) |
| `LexNoteSessionReference` | LexNote → REV-EM | une séance : titre, type, date, statut, compteurs, version du cours, liens profonds |
| `StudyArtifactReference` | LexNote → REV-EM | un support : type, titre, version du cours source, génération, `userEdited`, `stale`, nombre d'éléments, lien |
| `CourseProgressEvent` | LexNote → REV-EM | évènement **idempotent** (séance capturée, cours reconstruit, support créé/étudié, flashcards revues, quiz terminé + métriques) |
| `IntegrationError` | les deux | erreur publique typée (code, `retryable`, `retryAfterSeconds`, `correlationId`) |
| `IntegrationEnvelope` | les deux | enveloppe de transport : version, `messageId`, `issuedAt`, `expiresAt?`, `from`, `to`, `linkId`, `payload` |

### 4.1 Enveloppe

```jsonc
{
  "integrationVersion": "lexnote-revem/v1",
  "messageId": "b0f7…",            // unique : sert à dédupliquer et à tracer
  "issuedAt": "2026-10-08T10:00:00Z",
  "expiresAt": "2026-10-08T10:05:00Z",   // optionnel ; un message expiré est refusé (GONE)
  "from": "revem", "to": "lexnote",
  "linkId": "lnk_…",
  "correlationId": "…",
  "payload": { "kind": "external-course-event", "integrationVersion": "lexnote-revem/v1", … }
}
```

`makeEnvelope` (émission) et `parseEnvelope` (réception) sont les **seules** portes : ordre de contrôle à la réception = *secrets → version → forme → expiration*.

### 4.2 Identité : pseudonymes, pas de comptes

- `userRef` / `partnerUserRef` : identifiants **aléatoires propres à la liaison** — jamais l'UUID `auth.users`, jamais l'e-mail. Impossible de retrouver un compte depuis l'autre application.
- `status` : `PENDING → ACTIVE → REVOKED | EXPIRED`.
- `scopes` (par liaison, révocables) : `planning:read-events`, `sessions:read-references`, `artifacts:read-references`, `progress:write-events`, `progress:read-summary`. **Aucun scope ne donne accès au contenu d'un cours.**

### 4.3 Évènements de planning

`externalId` = UID de l'évènement côté REV-EM (UID ICS si présent). LexNote s'en sert **uniquement pour dédupliquer** et pour relier une séance à un évènement (`linkedExternalId`). Horaires en ISO 8601 **avec décalage** (`startsAt`/`endsAt`) ; `allDay`, `cancelled`, `sessionTypeHint` (CM/TD/TP…). Pas de champ `description` : texte libre potentiellement privé, exclu en v1.

### 4.4 Références (minimisation)

Une `LexNoteSessionReference` ne contient **ni extrait, ni texte de recherche, ni enseignant, ni salle, ni UUID de compte, ni compteurs de synchronisation**. Un test (`integration.test.ts`) échoue si l'un de ces éléments apparaît.

### 4.5 Correspondance d'identifiants

Chaque côté stocke sa propre table de liaison (à créer à l'étape suivante, dans **sa** base) : `(linkId, entityKind, localId, remoteRef, updatedAt)`. Une `…Ref` reçue est **opaque** : on ne la parse pas, on ne la suppose pas UUID, on ne l'utilise jamais comme clé étrangère.

### 4.6 Liens profonds

`DeepLinkTarget = {app, kind, ref}` (symbolique) → URL construite **localement** :

- LexNote : `buildLexNoteLink(origin, {kind, ref})` → `/session/:id`, `/session/:id/course`, `/session/:id/review`, `/supports/:id`.
- **L'origine vient de la configuration locale** (liste blanche, `https` obligatoire, `http://localhost` toléré en développement), **jamais d'un message reçu**. `isTrustedLink` refuse tout lien reçu hors de l'origine attendue (anti-redirection ouverte, `javascript:` refusé).
- REV-EM n'a **pas de routeur d'URL** : il devra en définir un (ex. `#/chapter/:ref`) avant de recevoir des liens profonds. Tant qu'il n'existe pas, REV-EM *émet* des cibles symboliques et LexNote ouvre l'accueil de l'application partenaire.

### 4.7 Progression

`CourseProgressEvent.eventId` est **déterministe** (`progressEventId` : type + séance + support + instant) → rejouer un évènement (hors ligne, double clic, nouvelle tentative) ne crée jamais de doublon : le récepteur applique `INSERT … ON CONFLICT (link, eventId) DO NOTHING`. Métriques bornées et cohérentes (`correct ≤ answered`, `scorePct ∈ [0,100]`). REV-EM **décide** de ce qu'il compte dans sa progression globale.

---

## 5. Sécurité et modèle de confiance

### 5.1 Interdits absolus

Aucun de ces éléments ne doit apparaître dans une enveloppe, un lien, un paramètre d'URL, un `postMessage`, un stockage partagé ou un journal :

`service_role` · refresh token · access token (même tronqué) · clé d'API (Anthropic, OpenAI…) · mot de passe · cookie de session · clé *anon* de l'autre projet.

Garde-fous en code (`security.ts`) : à l'émission **et** à la réception, `findSecrets` rejette (`SECRET_DETECTED`) les clés suspectes (`service_role`, `refresh_token`, `access_token`, `api_key`, `authorization`, `password`, `cookie`…) et les valeurs ressemblant à un JWT, une clé `sb_secret_…`/`sk-…`/`sk-ant-…` ou un en-tête `Bearer`. C'est une **défense en profondeur** : la protection principale est qu'**aucun champ des contrats n'est destiné à porter un jeton** (testé).

### 5.2 Modèle de confiance

| Acteur | Confiance |
|---|---|
| Frontend de l'application A | **non fiable** pour l'autorisation : il n'est que l'interface de l'étudiant |
| Backend (Edge Function / RLS) de A | **fait foi** pour les droits de A |
| Message reçu de B | **donnée non fiable** : validé (zod), borné, jamais exécuté, jamais interprété comme une consigne |
| Étudiant | seul à pouvoir **créer, restreindre, révoquer** la liaison |

- Chaque application ne fait confiance qu'à **sa propre** authentification. Un message de B n'élève jamais les droits d'un utilisateur de A.
- La RLS de chaque base reste la barrière : la liaison n'ouvre **aucune** policy supplémentaire sur les tables existantes.

### 5.3 Liaison et authentification des messages (à construire, contraintes fixées ici)

1. **Appairage** : l'étudiant, connecté dans A, génère un **code d'appairage à usage unique, court et expirant** (≈ 10 min) ; connecté dans B, il le saisit. L'échange se fait *entre les deux backends* ; le code ne donne aucun accès par lui-même.
2. **Secret de liaison** : un secret aléatoire propre à la liaison est échangé *serveur ↔ serveur* pendant l'appairage et stocké **uniquement côté serveur** (coffre/secrets de chaque projet). **Il n'est jamais renvoyé au navigateur.**
3. **Requêtes** : chaque appel serveur ↔ serveur est signé (HMAC du corps + horodatage + `linkId`), fenêtre anti-rejeu courte, `messageId` mémorisé pour rejeter les doublons.
4. **Autorisation** : le backend récepteur vérifie (liaison `ACTIVE`, non expirée, **scope** requis) avant tout traitement ; sinon `LINK_REVOKED` / `LINK_EXPIRED` / `SCOPE_MISSING` / `FORBIDDEN`.
5. **Révocation** : par l'étudiant depuis l'une ou l'autre application ; effet immédiat des deux côtés ; les références mises en cache de l'autre application sont purgées. La **suppression d'un compte** révoque ses liaisons (`LINK_REVOKED`) et purge les copies.
6. **Journal** : traces d'audit sans contenu ni secret (`linkId`, `messageId`, type, résultat).

### 5.4 Données personnelles

Minimisation (§4.4), pas d'e-mail ni d'UUID de compte, pas de transcription ni d'audio, pas de texte de cours. Un évènement de planning ne contient pas de description libre. Durée de conservation des copies reçues : tant que la liaison est active ; purge à la révocation.

---

## 6. Erreurs

`IntegrationError {code, message, retryable, retryAfterSeconds?, correlationId?, details?}`. `message` sert au journal (jamais de donnée personnelle ni de secret) ; l'interface affiche son propre texte localisé.

| Code | Sens | Réessayer ? |
|---|---|---|
| `INVALID_PAYLOAD` | forme invalide (zod) | non |
| `UNSUPPORTED_VERSION` | majeur inconnu (`details.supported`) | non |
| `SECRET_DETECTED` | secret suspecté — message rejeté sans traitement | non |
| `UNAUTHENTICATED` / `FORBIDDEN` / `SCOPE_MISSING` | identité absente / droit refusé / scope non accordé | non |
| `LINK_NOT_FOUND` / `LINK_PENDING` / `LINK_REVOKED` / `LINK_EXPIRED` | état de la liaison | non (action de l'étudiant) |
| `NOT_FOUND` / `GONE` / `CONFLICT` | objet inconnu / supprimé ou message expiré / conflit de version | non |
| `RATE_LIMITED` | trop de requêtes | **oui** (`retryAfterSeconds`) |
| `UNAVAILABLE` / `TIMEOUT` / `OFFLINE` / `INTERNAL` | transitoire | **oui** (délai croissant) |

L'ensemble de codes est **ouvert** : un code inconnu est traité comme `INTERNAL` (`normalizeErrorCode`).

---

## 7. Versionnement

- Identifiant : **`lexnote-revem/v1`** (`INTEGRATION_VERSION`), présent dans l'enveloppe **et** dans chaque charge utile.
- **Majeur** (`v1` → `v2`) : tout changement cassant (champ retiré/renommé, sémantique modifiée, enum restreint, scope retiré).
- **Compatible** (sans changer le majeur) : champ **optionnel** ajouté, valeur d'énumération ajoutée *documentée comme ouverte*, nouveau `kind`.
- Lecteur : **ignore les champs inconnus**, refuse (`UNSUPPORTED_VERSION`) un majeur absent de `SUPPORTED_MAJORS`, traite un `kind` inconnu comme `INVALID_PAYLOAD` sans casser le reste d'un lot.
- Migration : pour passer à `v2`, une application déclare `SUPPORTED_MAJORS = [1, 2]` et ajoute un adaptateur ; l'autre continue en `v1`. **Support de N et N-1 pendant au moins 6 mois** ; la dépréciation est annoncée dans ce document (changelog ci-dessous).
- Tests de contrat : le fichier `contracts.ts` est identique dans les deux dépôts (empreinte comparée) ; des *fixtures JSON* par version servent de tests d'acceptation réciproques.

**Changelog**
- `v1` (2026-10) : version initiale.
- `v1` (+ liaison de comptes) : nouveaux `kind` **compatibles** `connection-state`, `link-request`, `link-response` ; aucun champ existant modifié (le majeur reste `v1`).

---

## 8. Responsabilités (synthèse)

| | REV-EM | LexNote |
|---|---|---|
| Planning, ICS, planning intelligent | ✅ propriétaire | lecture d'`ExternalCourseEvent` |
| Révision globale, progression globale, bibliothèque générale | ✅ | émet des `CourseProgressEvent` |
| Séance réelle, notes, transcription, audio, documents | – | ✅ propriétaire |
| Cours reconstruit, provenance, confiance | – | ✅ |
| Artefacts détaillés de séance | références | ✅ propriétaire |
| Comptes / authentification | ✅ les siens | ✅ les siens |
| Contrats `lexnote-revem/v1` | copie identique | **référence** (`src/integration/`) |
| Gateway serveur, appairage, table de liaison | à construire | à construire |

---

## 9. Hors ligne et dégradation

- **Chaque application fonctionne seule.** Sans liaison, sans réseau ou si l'autre est indisponible : aucune fonction locale n'est bloquée ; les surfaces d'intégration sont masquées ou affichent un état explicite (`OFFLINE`, `LINK_REVOKED`…).
- **Émission hors ligne** : file d'attente locale (*outbox*) dans la base locale de l'utilisateur (donc isolée par compte) ; chaque élément porte son `eventId`/`messageId` déterministe → renvoi **idempotent** ; durée de vie bornée (`expiresAt`) ; envoi à la reconnexion avec délai croissant (`retryable`).
- **Lecture hors ligne** : les références/évènements reçus sont des *copies en lecture*, affichées avec leur `updatedAt` ; jamais présentées comme à jour. Aucune action n'est faite « au nom » de l'autre application hors ligne.
- **Les fichiers originaux et l'audio** restent sur l'appareil qui les a produits : aucun contrat ne les transporte.
- **Autre appareil** : la liaison vit côté serveur (par compte), pas dans le navigateur ; un nouvel appareil la retrouve après connexion.

---

## 10. Ce que cette étape livre — et ne livre pas

**Livré** : audit des deux projets ; répartition des responsabilités versionnée ; `src/integration/` (contrats zod, enveloppe, versionnement, erreurs, garde-fou anti-secrets, liens profonds à origine contrôlée, adaptateurs à liste blanche) ; 18 tests de contrat (aller-retour, compatibilité ascendante, version inconnue, secrets, minimisation, frontières d'architecture).

**Non livré (volontairement)** : planning, assistant, écrans de liaison, appairage, gateways, tables de liaison, outbox, quoi que ce soit de visible pour l'étudiant. **REV-EM n'a pas été modifié.**

### Décisions ouvertes pour les étapes suivantes

1. Domaines de déploiement définitifs (alimentent les listes blanches d'origines).
2. Routage d'URL de REV-EM pour les liens profonds entrants.
3. Transport exact : Edge Functions « gateway » signées (recommandé) vs. pont navigateur pour le tout-hors-ligne.
4. Appariement des matières : saisie manuelle par l'étudiant vs. suggestion par nom (jamais automatique).
5. Politique de rétention des copies reçues et du journal d'audit.

---

## 11. Liaison de comptes — architecture réellement implémentée

> Ajoutée après la fondation. Le contrat `lexnote-revem/v1` n'est ni refait ni remplacé : on y ajoute trois `kind` compatibles.

### 11.1 Flux

```
REV-EM (navigateur) ─JWT REV-EM─▶ integration-link {start}            REV-EM crée l'intention (5 min, usage unique) + nonce
        │  location.assign(confirmUrl)  = https://<lexnote>/integrations/revem/connect?intent=<uuid>#n=<nonce>
        ▼
LexNote (navigateur) : met le nonce en sessionStorage, EFFACE le fragment, → connexion LexNote si besoin
        ─JWT LexNote─▶ integration-link {inspect}  ─▶ [serveur LexNote] ─INSPECT (signé)─▶ [serveur REV-EM]   « compte REV-EM « Alice » »
        ─JWT LexNote─▶ integration-link {confirm}  ─▶ REDEEM (signé)   intention PENDING→CONFIRMED, liaison PENDING (REV-EM)
                                                    ─▶ liaison PENDING (LexNote) ─▶ ACTIVATE (signé) ─▶ CONNECTED des deux côtés
        ◀ returnUrl = https://antsvfr.github.io/REV-EM/?lexnote_link=connected     (bouton « Retourner dans REV-EM »)
REV-EM : lit puis retire ?lexnote_link, REVÉRIFIE (status + sonde STATUS signée) → « LexNote ✓ Connecté »
```
Le navigateur n'appelle **que** `integration-link` (avec son propre JWT). Les messages serveur ↔ serveur passent par `integration-gateway` (signés).

### 11.2 Identité et références

- `integrationLinkId` (`lnk_…`) : identifiant public de la liaison, généré par le serveur de l'initiateur, identique des deux côtés.
- `local_reference` / `external_reference` (`ref_…`) : pseudonymes aléatoires générés **côté serveur** ; chaque côté stocke le sien et celui du partenaire, croisés.
  Aucun UUID utilisateur, aucun e-mail ne circule (testé sur le trafic réel entre les deux services).
- L'e-mail ne relie **jamais** deux comptes : seule l'autorisation explicite de l'étudiant, connecté aux DEUX applications, crée la liaison.

### 11.3 Intentions (`integration_link_intents`)

| État | Sens |
|---|---|
| `PENDING` | créée, utilisable (≤ 5 min ; contrainte base ≤ 15 min) |
| `CONFIRMED` | consommée par `REDEEM` (usage unique, atomique) ; en attente d'`ACTIVATE` |
| `USED` | liaison activée |
| `EXPIRED` | délai dépassé (écrit paresseusement) |
| `CANCELLED` | annulée par l'étudiant, remplacée par une nouvelle intention, ou liaison révoquée |

Seule l'**empreinte SHA-256** du nonce est stockée ; un mauvais nonce **ne consomme pas** l'intention. Le nonce voyage dans le **fragment** d'URL
(jamais envoyé à un serveur, absent de `Referer`), est gardé en `sessionStorage` le temps de la connexion LexNote (≤ 10 min), puis effacé.
Ce n'est pas un secret inter-applications : une capacité à usage unique, liée à une intention, inutilisable sans session LexNote authentifiée.

### 11.4 Signature de passerelle (`LNRV1-HMAC-SHA256`)

Chaîne signée : `schéma · méthode · route · timestamp · nonce · SHA-256(corps) · from · to · kid`. Clé dérivée **par direction** (`lnrv1|from->to`).
Contrôles dans l'ordre : en-têtes → expéditeur connu (= partenaire attendu) → destinataire → clé (`kid`) → nonce → horodatage (±5 min) → empreinte du
corps → signature (temps constant) → **nonce jamais vu** (enregistré seulement après signature valide) → contrat (secrets, version, forme, expiration) →
autorisation (liaison, expéditeur = référence enregistrée). Les réponses sont signées elles aussi ; une réponse non signée n'a **aucun effet d'état**.
Un en-tête `Origin` (navigateur) est refusé. Taille de message ≤ 16 Ko. Les requêtes sortantes n'acceptent aucune redirection et ne ciblent que `INTEGRATION_PEER_GATEWAY_URL`.

### 11.5 États de connexion (`ConnectionState`)

`NOT_CONNECTED · PENDING · CONNECTED · REVOKED · ERROR`, avec `localStatus`, `peerStatus` et `verified`. **`CONNECTED` exige `verified` ET `peerStatus = CONNECTED`**
(le schéma l'impose). Sans sonde ou si le partenaire n'a pas confirmé → `PENDING` ; partenaire injoignable → `ERROR/PEER_UNREACHABLE` (rien n'est modifié en base) ;
le partenaire ne connaît plus la liaison → `ERROR/PEER_MISSING` ; le partenaire l'a révoquée → `REVOKED (revokedBy: partner)`.

### 11.6 Révocation

Depuis l'un ou l'autre côté : effet **immédiat** sur le côté qui révoque (la passerelle refuse dès lors tout échange : `assertLinkUsable` → `LINK_REVOKED`), puis
notification du partenaire ; s'il est injoignable, il le constate à son prochain contrôle. **Aucune donnée métier n'est supprimée** (les lignes de liaison passent à `REVOKED`).
Reconnecter crée une nouvelle liaison (nouvel identifiant).

### 11.7 Tables (migration identique dans les deux projets)

LexNote : `supabase/migrations/20261011000000_integration_links.sql` · REV-EM : `supabase/migrations/006_integration_links.sql`.
`integration_links`, `integration_link_intents`, `integration_nonces` — RLS activée **et forcée**, une seule policy (`SELECT` de ses propres liaisons, colonnes non sensibles),
fonctions `integration_*` en `SECURITY DEFINER` à `search_path` figé et réservées à `service_role`.

### 11.8 Domaines

Centralisés dans `src/integration/config.ts` et les variables `INTEGRATION_*` : développement = `localhost` LexNote (5173/4173) et REV-EM (8080/3000) ;
production = `https://antsvfr.github.io` (REV-EM, app `https://antsvfr.github.io/REV-EM/`) et `https://lex-note-svfr.vercel.app` (LexNote), codés comme défauts de `PRODUCTION_ORIGINS` / `OFFICIAL_APP_URLS`. La même liste blanche (`readBrowserOrigins`) protège `delete-account`. Procédure de mise en production : `docs/PRODUCTION_RUNBOOK.md`. Refusés : `*`, `http` hors développement, identifiants dans l'URL, `localhost` en production.

### 11.9 Secrets (par projet Supabase, jamais dans un frontend)

| Secret | Rôle |
|---|---|
| `INTEGRATION_KEY` (+ `INTEGRATION_KEY_ID`) | clé HMAC partagée (≥ 32 car.), **identique** dans les deux projets ; `INTEGRATION_KEY_PREVIOUS[_ID]` pour la rotation |
| `INTEGRATION_ENV` | `production` (défaut) ou `development` |
| `INTEGRATION_SELF_APP_URL` | URL complète de CETTE application |
| `INTEGRATION_PEER_APP_URL` | URL complète de l'autre application (redirections, liens) |
| `INTEGRATION_PEER_GATEWAY_URL` | URL de la fonction `integration-gateway` de l'autre projet |
| `INTEGRATION_ALLOWED_ORIGINS` | (facultatif) origines navigateur supplémentaires, https |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | fournis automatiquement par Supabase aux Edge Functions |

### 11.10 Paquet partagé

`node scripts/build-integration-bundle.mjs [--revem <dépôt REV-EM>] [--check]` génère `supabase/functions/_shared/integration/lexnote-revem-v1.mjs`
(autonome, zod inclus, empreinte en en-tête) dans les **deux** dépôts ; `--check` échoue si une copie diverge. Les Edge Functions ne font que câbler (`runtime.ts`).

## 12. Lancement d'un cours : « Prendre mes notes dans LexNote » (extension de `lexnote-revem/v1`, rétro-compatible)

**But.** Depuis la fiche d'un cours du planning REV-EM, un clic ouvre la bonne séance LexNote (matière + séance créées ou retrouvées automatiquement) sur `/session/{id}?panel=transcript`. Le micro n'est **jamais** démarré : `ConsentDialog` / `captureManager.start()` restent le seul chemin.

### Flux

```
REV-EM (navigateur)  ──JWT──▶ integration-link  action « launch-start » { eventId, tz }          (aucun cours, aucune note)
   integration-link (serveur REV-EM) : relit le cours dans planning_events + subjects DU JETON, vérifie la liaison (CONNECTED, sondée),
                                       crée une intention (integration_launch_intents : nonce haché, ≤ 5 min, usage unique)
   ◀── { launchIntentId, expiresAt, launchUrl }   launchUrl = <LexNote>/integrations/revem/launch?intent=<uuid>#n=<nonce>
LexNote (navigateur) : si non connecté → intention conservée (sessionStorage, 10 min) → /login → reprise automatique ; jamais l'accueil
   ──JWT──▶ integration-link (LexNote) action « launch-open » { launchIntentId, nonce }
   serveur LexNote ──HMAC LNRV1──▶ integration-gateway REV-EM : course-launch-request{ operation:'REDEEM_LAUNCH', launchIntentId, nonce, linkId }
   ◀── course-launch-response{ ok, event: external-course-event }      (l'intention est consommée ATOMIQUEMENT, une seule fois)
   serveur LexNote : integration_course_open(...) → matière + séance (SQL, verrou consultatif, UNIQUE) → { sessionId, subjectId }
LexNote (navigateur) : attend que la séance soit présente localement (reload + syncNow, ≤ 15 s) → /session/{id}?panel=transcript
```

Aucun secret inter-applications dans le navigateur ; aucun identifiant d'utilisateur, e-mail, JWT ou contenu de cours dans une URL. Le nonce est dans le **fragment** (jamais envoyé à un serveur, retiré de l'URL dès la lecture) ; seul son hachage est stocké.

### Structure exacte transmise (REV-EM → LexNote, dans la réponse signée de la passerelle)

```json
{
  "integrationVersion": "lexnote-revem/v1", "kind": "external-course-event", "origin": "revem",
  "externalId": "evt_k3x9a2",                         // id STABLE de l'évènement REV-EM (planning_events.local_id)
  "title": "CM Droit des contrats",
  "startsAt": "2026-10-12T08:00:00+02:00", "endsAt": "2026-10-12T10:00:00+02:00", "allDay": false,
  "location": "Amphi B", "teacher": "Mme Durand",     // omis si absents
  "sessionTypeHint": "CM",                            // CM | TD | TP | SEMINAR | WORKSHOP | REVISION | OTHER (inconnu → OTHER)
  "subject": { "app": "revem", "ref": "subj_dc1", "name": "Droit des contrats" },
  "calendarSource": "ics", "cancelled": false, "updatedAt": "2026-10-09T09:00:00.000Z"
}
```

Jamais transmis : notes, résumé, questions, description du cours, mot de passe, JWT, `service_role`, `INTEGRATION_KEY`.

### Liaison évènement → séance, matière → matière, idempotence

* Table `integration_course_refs` (LexNote, migration `20261012000000_revem_course_refs.sql`) : `UNIQUE (user_id, provider, external_event_ref)` → **une** séance par évènement REV-EM et par utilisateur. Table `integration_subject_refs` : `UNIQUE (user_id, provider, external_subject_ref)` → **une** matière par matière REV-EM.
* Clé de matière : l'identifiant REV-EM de la matière si elle existe en base ; sinon `name:<nom normalisé>` (titre sans préfixe CM/TD/TP ni « groupe N »), de sorte que « CM/TD/TP Droit des contrats » partagent **une** matière. Une matière LexNote créée à la main sous le même nom est adoptée si elle n'est pas déjà liée à une autre matière REV-EM.
* La fonction SQL `integration_course_open` (SECURITY DEFINER, `service_role` seul) prend `pg_advisory_xact_lock` (matière puis évènement : ordre fixe, pas d'interblocage) : double clic, deux onglets, deux appareils, rejeu réseau → **une** matière, **une** séance, garanti par la base et non par le front. Une séance supprimée par l'étudiant est recréée à la réouverture ; une séance existante n'est jamais modifiée.
* Numérotation de la séance : `max(number)+1` par (matière, type).

### Qui possède quoi — mise à jour du planning

Création initiale à partir de REV-EM ; **ensuite LexNote possède la séance** (titre, date, horaires, notes, transcription). Une réouverture, ou une modification du planning REV-EM, **n'écrase jamais** une séance existante : seuls des métadonnées sûres pourraient un jour être rafraîchies (non implémenté, volontairement). Les notes restent dans LexNote ; REV-EM n'en reçoit jamais le contenu.

### Multi-appareils et synchronisation

La séance est créée **côté serveur LexNote** (pas dans l'IndexedDB du navigateur) puis tirée par le `SyncEngine` habituel (`pull` par `server_updated_at`) : elle est identique à une séance créée à la main (RLS, `version`, file « dirty » respectés). Sur un autre appareil, la même référence mène à la même séance.

### États du bouton (REV-EM)

| État de la liaison | Bouton |
|---|---|
| connectée et vérifiée des deux côtés | « Prendre mes notes dans LexNote » (actif) |
| non connectée / en attente / révoquée / non vérifiée / invité | « Connecter LexNote » → Réglages › Applications connectées (rien n'est créé) |
| LexNote injoignable ou non configurée | « LexNote temporairement indisponible » (désactivé) + « Vérifier à nouveau » |
| ouverture en cours | « Ouverture de LexNote… » + spinner, désactivé (aucun double clic) |

### Comportements d'erreur (LexNote)

Non connecté à LexNote → intention gardée (10 min) puis reprise après connexion · connecté mais comptes non liés → rien n'est créé, parcours « Connecter REV-EM » · intention expirée / déjà utilisée / falsifiée / d'un autre utilisateur → message dédié, rien n'est créé · réseau coupé → message + bouton réessayer. L'égalité d'e-mail n'est **jamais** une identité.

### Déploiement ultérieur (rien n'est déployé par cette étape)

1. REV-EM : appliquer `supabase/migrations/008_integration_launch.sql` ; LexNote : appliquer `20261012000000_revem_course_refs.sql` (après toutes les migrations antérieures).
2. Redéployer `integration-link` et `integration-gateway` (`--no-verify-jwt`) des **deux** projets (le paquet `lexnote-revem-v1.mjs` est régénéré : `node scripts/build-integration-bundle.mjs --revem <chemin REV-EM>`) ; secrets inchangés.
3. Publier les deux fronts, puis vérifier avec un compte réel de bout en bout (les tests automatisés sont en simulation : PGlite, double de Supabase, Chromium).
