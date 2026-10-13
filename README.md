# LexNote

> L'assistant de prise de notes pour les cours magistraux — pensé pour le droit.
> **Local-first** · **PWA installable** · **hors connexion** · comptes personnels · synchronisation chiffrée en transit (Supabase, RLS).

LexNote est une application **totalement indépendante** (aucune dépendance à un autre projet). Cette V1 « Fondation » pose le socle technique, visuel et architectural : un vrai éditeur de CM, un stockage local robuste, et des emplacements propres pour la transcription, l'IA et la synchronisation — **sans simuler** ce qui n'existe pas encore.

## Vision du produit

Ouvrir LexNote au début d'un CM → créer la séance → prendre ses notes très vite → (à terme) transcrire le professeur, importer ses supports, utiliser une IA pendant le cours → terminer la séance → obtenir un cours restructuré, un résumé, une fiche, les articles et arrêts cités, des flashcards et des questions.

Principe cardinal : **LexNote distingue toujours ce que le professeur a dit de ce que l'IA a ajouté, et n'invente jamais silencieusement un article, un arrêt ou une règle** (voir [Fiabilité juridique](#fiabilité-juridique)).

## Stack et choix

| Besoin | Choix | Pourquoi |
|---|---|---|
| UI | **React 19 + TypeScript strict** | Écosystème mûr, typage fort des modèles de données. |
| Build | **Vite** | Démarrage instantané, code-splitting (l'éditeur est chargé à la demande). |
| Éditeur | **TipTap (ProseMirror)** | Vrai éditeur de documents structurés, extensible (blocs juridiques), très performant sur de longs textes. |
| Stockage | **IndexedDB** via `idb`, derrière une interface `StorageAdapter` | Persistant, asynchrone, gros volumes ; l'interface permet d'ajouter un cloud sans réécrire l'app. |
| État | **Zustand** | Minuscule, sélecteurs fins → la frappe ne re-rend rien d'autre que l'éditeur. |
| Routage | React Router | Navigation classique, URL partageables entre fenêtres. |
| PWA | **vite-plugin-pwa** (Workbox) | Manifest, service worker, précache pour le hors-ligne. |
| Style | **CSS natif + variables (tokens)** | Identité propre (papier chaud, encre bleu nuit, laiton), clair/sombre, aucune dépendance de style. Polices **auto-hébergées** (`@fontsource`) : rien n'est chargé depuis Internet. |
| Tests | **Vitest** (unitaires) + **Playwright** (bout en bout) | |

## Installation

```bash
npm install
```

## Développement

```bash
npm run dev          # serveur de dev (http://localhost:5173)
npm run build        # typecheck + build de production
npm run preview      # sert le build (http://localhost:4173) — nécessaire pour tester la PWA
npm run typecheck
npm test             # tests unitaires (Vitest)
npm run test:e2e     # tests bout en bout (Playwright, construit et sert l'app)
```

Pour les tests e2e, Playwright doit trouver un Chromium. Si besoin : `CHROMIUM_PATH=/chemin/vers/chrome npm run test:e2e`.
Variables d'environnement : `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (voir `.env.example` et `SUPABASE_SETUP.md`) ; `VITE_BACKEND=mock` pour un backend simulé (tests e2e, développement hors ligne).
Les tests e2e construisent automatiquement l'application avec `VITE_BACKEND=mock` ; les tests de sécurité de la base (`tests/db`) tournent sur un vrai Postgres (PGlite) dans `npm test`.

## Architecture

Séparation stricte des responsabilités — **l'UI ne parle jamais directement à un fournisseur IA, à la base, ou à un moteur de transcription** :

```
UI (features/, components/)
   │ lit/écrit via
   ▼
Stores (store/)  ── library (matières, modules, CM) · ui · toasts · editorBridge
   │ passent par les interfaces de
   ▼
Services (services/)
   ├─ storage/        StorageAdapter  → IndexedDbAdapter · MemoryAdapter · (futur CloudAdapter)
   ├─ sync/           SyncEngine      → no-op en V1 (aucune donnée ne quitte l'appareil)
   ├─ ai/             AIProvider      → NullProvider (refuse proprement)
   ├─ transcription/  TranscriptionProvider → WebSpeech · Whisper (API compatible OpenAI)
   ├─ capture/        CaptureController · ChunkedRecorder · CaptureStorage (base séparée) · manager
   ├─ course/         buildCourseContext() → CourseContext (entrée du futur moteur IA)
   ├─ documents/      DocumentImporter (PDF / PPT, à venir)
   └─ search/         SearchProvider  → TextSearchProvider (futur SemanticSearchProvider)
   ▲
Domaine (domain/)  types purs : Subject, Module, CourseSession, NoteDocument, LegalItem, Provenance…
```

Chaîne de persistance : **frappe → autosave (debounce 500 ms, max 4 s) → IndexedDB → (futur) file de synchronisation cloud.**

### Structure du projet

```
src/
  domain/          Modèle de données et règles métier pures (legal.ts = fiabilité juridique)
  services/        Interfaces + implémentations (storage, ai, transcription, documents, search, sync)
  store/           Stores Zustand (auth, library, sync, ui, toasts, editorBridge)
  features/
    auth/          Connexion, inscription, onboarding, garde des routes
    dashboard/     Accueil
    library/       Matières, modules, liste des CM, dialogues « Nouvelle séance » et « Matière »
    editor/        Éditeur : extensions TipTap, barre d'actions, autosave, chrono, panneau assistant
    recap/         Page « Terminer le CM »
    search/        Recherche globale
    palette/       Palette de commandes (Cmd/Ctrl+K)
    settings/      Compte, thème, installation, export
  components/      Primitives UI réutilisables (Modal, Toasts, Logo…)
  styles/          Tokens, base, UI, mise en page, pages, éditeur
tests/e2e/         Parcours Playwright (backend simulé)
tests/db/          Tests RLS sur un vrai Postgres (PGlite)
supabase/          Migration SQL + Edge Function delete-account
```

## Comptes, espaces personnels et synchronisation

- **Comptes** : Supabase Auth (e-mail + mot de passe). **Projet Supabase dédié** à LexNote — voir [`SUPABASE_SETUP.md`](./SUPABASE_SETUP.md) (étapes manuelles, sécurité, check-list).
- **Une seule architecture officielle** : la chaîne de PR #3 → #8 (client `supabase-js`, `SyncEngine` local-first, schéma `supabase/migrations/`). L'ancienne PR #5 est *supersédée* (jamais fusionnée) ; un projet qui porte son schéma se remet en conformité avec [`docs/SCHEMA_RECONCILIATION.md`](docs/SCHEMA_RECONCILIATION.md).
- **Espace strictement personnel** : sécurité garantie **par la base** (RLS forcée, politiques par table, clés étrangères composites), testée sur un vrai Postgres (`tests/db`). Côté navigateur, chaque compte a ses propres bases IndexedDB (`lexnote-u-<id>`, `lexnote-capture-u-<id>`) ; la déconnexion ferme et vide tout.
- **Local-first** : toute écriture va d'abord dans IndexedDB (jamais bloquée par le réseau), puis le moteur de synchronisation (`src/services/sync`) envoie les lignes « à synchroniser » (verrou optimiste par `version`, suppressions par pierres tombales, parents avant enfants) et reçoit les changements des autres appareils (curseur `server_updated_at`). Un conflit sur les notes **conserve les deux versions** — jamais d'écrasement silencieux.
- **Aucune donnée de démonstration** : un nouvel utilisateur arrive sur un espace vide (onboarding en 3 étapes, facultatif).
- **Séances génériques** : CM, TD, TP, Cours, Séminaire, Atelier, Révision, Autre partagent **un seul modèle** (`CourseSession.type`) et un seul éditeur — ajouter un type = une ligne dans `src/domain/sessionType.ts`. Une séance peut exister sans module.
- **Audio** : jamais envoyé au cloud ; la transcription, les marqueurs et les ancrages, eux, sont synchronisés.
- **Développement/tests sans Supabase** : `VITE_BACKEND=mock` (build ou dev) remplace Supabase par un serveur simulé dans le navigateur ; **absent des builds de production**.

## Intelligent Course Engine (espace « Cours »)

Dans chaque séance, **Cours** réunit : *Notes · Transcription · Sources · Cours reconstruit*. Le moteur exploite ensemble les notes, la transcription, les marqueurs, les NoteAnchors et les documents importés (PDF, PowerPoint .pptx, Word .docx, texte ; images acceptées mais **sans OCR** pour l'instant) et reconstruit un cours structuré **sans jamais perdre la provenance**.

```
Sources → Extraction → Normalisation → Context Builder → Structure Analyzer → Course Generator → Validation → GeneratedCourse
```

| Étape | Code (`src/services/engine`) |
|---|---|
| Extraction (une interface `DocumentExtractor` par format, remplaçable) | `extractors/` (pdf.js chargé à la demande, fflate pour .docx/.pptx) |
| Normalisation (en-têtes/pieds de page, doublons) | `normalize.ts` |
| Morceaux + emplacements exacts (`SourceChunk`, `SourceLocation` : page, slide, plage temporelle, segments, passage de notes, ancrage, marqueur) | `chunking.ts` |
| Index BM25 (sélection du contexte, corroboration, rattachement) — base d'un futur RAG | `sourceIndex.ts` |
| Connaissances (`CourseKnowledgeUnit` : définitions, articles, arrêts, dates, chiffres, formules, exemples, points d'examen, méthodes, raisonnements, ambiguïtés, passages incomplets, contradictions) | `analyzer.ts` (interface `KnowledgeAnalyzer`) |
| Corroboration, confiance, conflits | `context.ts` (`CourseContextBuilder`) |
| Plan issu des sources (titres des notes, slides, sinon découpage de la transcription) | `structure.ts` |
| Rédaction (reprise de textes sources, aucune prose inventée) | `generator.ts` |
| Validation (schéma strict, citations exactes, garde juridique) | `validator.ts` |
| Moteurs interchangeables (local / distant), repli | `provider.ts`, `pipeline.ts` |

- **Provenance** : chaque bloc porte ses `SourceReference` (extrait exact + emplacement). Composant réutilisable `SourceBadge` (« Notes », « Transcription 00:34:12 », « PDF p. 18 », « Slide 24 », « Notes + transcription »…) ; au clic, popover détaillé et lien **Ouvrir la source** (notes surlignées, transcription au bon instant, document à la bonne page).
- **Fiabilité** : `VERIFIED` (corroboré par ≥ 2 sources indépendantes) · `SUPPORTED` · `UNCERTAIN` (source fragile, ou date/chiffre absent des autres sources qui traitent du sujet, ou référence entendue seulement à l'oral) · `CONFLICTING` (deux sources, deux valeurs : les deux sont montrées, aucune n'est tranchée) · `MISSING_SOURCE` (« Information non vérifiée dans les sources »). **Aucun article, arrêt, date ou citation n'est jamais reconstitué** : ils sont repris littéralement ou absents ; la validation dégrade tout ce qui ne figure pas dans les sources citées, quel que soit le moteur.
- **Sources intactes** : le cours est un artefact **séparé et versionné** (`GeneratedCourse` : `courseVersion`, `generatedAt`, `engineVersion`, `sourceSnapshot`) ; régénérer crée une nouvelle version, les anciennes sont conservées. Le fichier original d'un document reste **sur l'appareil** ; seuls son texte analysé et le cours sont synchronisés (tables `source_documents`, `generated_courses`, RLS).
- **Performance** : morceaux bornés, index, déduplication, analyse mémorisée par empreinte (traitement incrémental : relancer sans changement = 0 analyse), traitement par lots sans geler l'interface ; séance de 3 h de transcription testée.
- **Moteur IA** : abstrait (`CourseEngineProvider`). Livré : moteur **local** déterministe (aucune IA, hors-ligne). Un moteur **distant** s'active avec `VITE_ENGINE_URL` (Edge Function `supabase/functions/course-engine`, **clé du modèle uniquement côté serveur**, prompts hors du frontend). Sa sortie JSON repasse par la même validation. Si le moteur est injoignable : message clair, repli local au choix, **les notes ne sont jamais affectées**.

## Réviser — StudyArtifacts dérivés du cours reconstruit

```
Course Sources → Course Context → Reconstructed Course (GeneratedCourse) → StudyArtifacts
```

Chaque séance a deux espaces : **Cours** (sources + cours reconstruit) et **Réviser** (`/session/:id/review`, bibliothèque de supports). Rien n'est généré automatiquement : « Créer une fiche / carte mentale / schéma / tableau / chronologie / méthode / flashcards / quiz » (ou une phrase dans la palette `Ctrl/⌘ K` : « Compare erreur, dol et violence »).

| Support | Contenu | Réglages |
|---|---|---|
| Fiche | rubriques alimentées par le cours (définitions, articles, jurisprudence, exemples, points examen, chiffres…) | Express / Standard / Complète ; partie du cours |
| Carte mentale | titres du cours + blocs typés ; interactive (zoom, déplacement, repli, clic → sources) | profondeur 1–5, orientation |
| Schéma | processus, raisonnement (« si… alors »), hiérarchie, relations citées | type auto-suggéré ou choisi |
| Tableau comparatif | uniquement des notions **réellement comparables** (sous-parties sœurs) × critères renseignés | notions choisies |
| Chronologie | dates du cours (un numéro d'article n'est pas une date) | partie du cours |
| Méthode | objectif, étapes, questions du cours, erreurs signalées, checklist cochable | partie du cours |
| Flashcards | question · réponse · difficulté · concept · source | 10 / 20 / 30 / personnalisé |
| Quiz | QCM, vrai/faux, question courte ; bonne réponse + explication + source ; score | nombre, niveau, types |

**Architecture** (`src/services/study`, `src/domain/study.ts`, `src/features/study`, `src/features/review`) :
- **Pas de second moteur** : un artefact est une transformation déterministe d'une *version précise* du cours reconstruit (`courseTree.ts` → `generators.ts` → validation zod). Il réutilise les `SourceReference` des blocs du cours : le même `SourceBadge` s'affiche partout (« Pourquoi cette flashcard ? → Notes → PDF p. 14 → Transcription 01:02:32 »).
- `StudyArtifact` : `id`, `type`, `sourceSessionIds` (séance), `courseId` + `courseVersion`, `sourceSnapshot`, `engineVersion`, `settings`, `content` (modifiable), `generatedContent` (jamais modifié), `provenance`, `generation`, `userEdited`, dates. Synchronisé comme le reste (`study_artifacts`, RLS ; migration `20261010000000_study_artifacts_from_course.sql`).
- **Fiabilité** : seules les affirmations `VERIFIED`/`SUPPORTED` avec source servent de réponses (flashcards, quiz) ; les distracteurs de QCM sont de vraies définitions d'autres notions du cours ; aucune relation, aucun critère, aucune date, aucune réponse n'est inventé. Matière insuffisante → message explicatif, pas de support médiocre.
- **Versions** : modifier, dupliquer, supprimer, « revenir à la version générée », **régénérer**. Si un cours plus récent existe, bandeau « Le cours a été mis à jour » ; un support modifié à la main n'est **jamais écrasé** (une copie régénérée est créée ; le remplacement exige une confirmation).

## Intégration avec REV-EM

LexNote et REV-EM restent **indépendantes** (code, bases Supabase, comptes, clés) et ne communiqueront que par des contrats publics versionnés (`lexnote-revem/v1`, `src/integration/`). Architecture, source of truth, sécurité, erreurs, versionnement et hors-ligne : [`docs/REVEM_LEXNOTE_INTEGRATION.md`](docs/REVEM_LEXNOTE_INTEGRATION.md). Aucune fonction visible n'est encore construite.

## Stockage

> (Les bases décrites ci-dessous sont désormais **par compte** : `lexnote-u-<id>`.)

- **IndexedDB** (`lexnote`), 5 stores : `subjects`, `modules`, `sessions`, `notes`, `meta`.
- Le **contenu des notes** (`notes`) est séparé des **métadonnées** (`sessions`, qui contiennent aussi mots, extrait et texte de recherche) : les listes restent légères même avec des centaines de CM.
- `StorageAdapter.commit(ChangeSet)` est **atomique** (une transaction) ; supprimer une séance supprime ses notes.
- Migrations incrémentales par version de schéma (`indexedDbAdapter.ts`).
- Au démarrage, LexNote demande `navigator.storage.persist()` pour éviter l'éviction ; si IndexedDB est indisponible (navigation privée stricte), repli **explicitement signalé** sur un stockage en mémoire.
- Réglages → **Exporter (JSON)** pour sauvegarder toutes les données.
- La frappe n'est jamais ralentie : seule une mise à jour minuscule de l'indicateur « Enregistrement… » a lieu à chaque frappe ; sérialisation et écriture se font après une pause, et sont vidées immédiatement quand l'onglet est masqué/fermé ou qu'on quitte l'éditeur.

## PWA

Manifest (`display: standalone`, icônes 192/512/maskable, `apple-touch-icon`), service worker Workbox avec précache de l'application et des polices latines, `navigateFallback` pour le hors-ligne. Les mises à jour sont **proposées** (toast « Mettre à jour »), jamais imposées en plein cours.
Les icônes sont générées depuis `public/favicon.svg` (`node scripts/make-icons.mjs`). Installation : Chrome/Edge → icône dans la barre d'adresse ; Safari macOS → *Fichier › Ajouter au Dock*. À tester sur le build (`npm run preview`), pas en mode dev.

## Fiabilité juridique

Dans `src/domain/legal.ts` :

- **Types** : `ArticleOfLaw`, `CaseLaw`, `LegalDefinition`, `LegalRule`, `Exception`, `ProfessorExample`, `ImportantPoint`, `QuestionToVerify`.
- **Provenance** : `PROFESSOR`, `USER_NOTE`, `DOCUMENT`, `AI`, `VERIFIED_SOURCE`, `UNKNOWN`.
- **Statut** : `Verified`, `Unverified`, `Potential conflict`, `Needs review`.
- **Règle codée et testée** : une information de provenance `AI` ou `UNKNOWN` **ne peut jamais être créée « Verified »** (`resolveInitialVerification`) ni être considérée fiable seule (`isTrusted`). Les blocs de l'éditeur portent déjà `provenance` et `verification` ; tout futur bloc IA sera rendu en pointillés et étiqueté.
- Toute sortie IA (`AIResult`) est typée `provenance: 'AI'`, `verification: 'UNVERIFIED'`, avec le modèle utilisé.

## Design (refonte premium)

L'interface suit la maquette de référence « LexNote × REV-EM » : thème **sombre** principal (bleu nuit `#050B14`, halos rouge/bleu, rouge vif comme couleur d'action), thème clair conservé.
- **Tokens** centralisés dans `src/styles/tokens.css` (`--background-*`, `--surface*`, `--border-*`, `--text-*`, `--accent-*`, `--radius-*`, `--shadow-card|red|floating`) ; les anciens noms de variables sont des alias.
- **Écrans refaits** : barre latérale (logo, navigation, matières avec « + » réel, carte REV-EM honnête, stockage local, réglages), en-tête (recherche globale, thème, notifications, profil), accueil (hero, 4 statistiques, bouton Nouveau CM, carte « Reprendre votre cours », derniers cours, matières, outils), Mes matières (cartes), Mes CM (onglets + filtres), Recherche (groupes Matières / CM / Notes / Transcriptions), Réglages (profil), éditeur (feuille d'écriture sombre), panneau Transcription (en-tête REC), modales, menus, toasts, palette.
- **Données réelles uniquement** : les statistiques sont calculées (`src/lib/stats.ts`, testé) ; aucune évolution en % n'est inventée ; l'avancement affiché est « CM terminés / CM du module » ; le prénom vient du profil (Réglages) ; la carte REV-EM indique « Connexion bientôt disponible » tant qu'aucune connexion n'existe ; Documents et Assistant sont marqués « Bientôt » et inactifs ; Transcription est active.
- **Images** : illustrations SVG **locales** (`src/assets/art/`, ≈ 13 Ko au total), vignettes déterministes par matière (changeables depuis le menu ⋯ d'un CM). Aucune image distante.
- Responsive : sidebar fixe ≥ 1100 px, tiroir en dessous, barre d'onglets sur mobile ; statistiques 2×2 sur tablette.

## Transcription (V2)

Pendant un CM : **🎙 Transcription** → avertissement (première utilisation) → autorisation du micro → `● REC 01:23:42` avec Pause / Reprendre / Arrêter, ⭐ Marquer, panneau de transcription en direct, timeline, réécoute. **Les notes restent prioritaires** : la capture vit hors de l'éditeur (contrôleur indépendant, base IndexedDB séparée `lexnote-capture`), toute panne y devient un état `ERROR` + une interruption consignée, jamais une exception vers les notes.

États : `INACTIVE · REQUESTING_PERMISSION · STARTING · RECORDING · PAUSED · PROCESSING · ERROR · COMPLETED`.

### Architecture audio
```
CourseSession ─ AudioSession (origine, runs, mime, débit)
                 ├─ RecordingRun[]  (portions continues ; pause/interruption = trou visible)
                 └─ AudioChunk 001…N (id, sessionId, sequence, runId, startMs, endMs, durationMs, mimeType, size, createdAt, status)
TranscriptSegment (id, sessionId, startMs, endMs, text, confidence?, provider, status, createdAt, source=TRANSCRIPTION)
TimelineMarker · Interruption · NoteAnchor
```
- **Segments de 30 s autonomes** : un `MediaRecorder` neuf démarre *avant* l'arrêt du précédent (aucun trou). Un flux `timeslice` n'aurait pas été relisible/transcriptible par morceaux (seul le premier fragment a l'en-tête). 30 s = fenêtre native de Whisper, perte maximale en cas de crash = 1 segment, ≈ 120 Ko/segment (Opus 32 kbit/s ≈ 14 Mo/heure, ≈ 43 Mo pour 3 h).
- Format : `audio/webm;codecs=opus` (Chrome/Firefox), repli `audio/mp4` (Safari).
- **Horloge du CM** : ms depuis le premier démarrage (horloge murale) ; la durée « REC » additionne les runs.
- Micro **coupé réellement** en pause (pistes arrêtées, ré-acquises à la reprise). Verrou d'écran (`wakeLock`) tenté pendant l'enregistrement.

### Notes ↔ transcription (NoteAnchor)
Quand l'étudiant écrit pendant un enregistrement, une **ancre** est enregistrée dans les métadonnées à chaque pause d'écriture (1,5 s) ou au plus toutes les 10 s : `{ timestamp, notePosition, textSnippet, nearbyTranscriptSegmentIds }`. Aucun horodatage n'est écrit dans le texte. Les segments « proches » sont recalculés à l'arrêt (le moteur livre ses phrases avec retard). Limite : `notePosition` peut dériver si le texte *avant* est modifié ensuite ; `textSnippet` permet de relocaliser.

### Marqueurs et timeline
⭐ (`Ctrl/⌘+Alt+S`) crée un marqueur **instantanément** ; « Pourquoi ? » (Examen · Important · À revoir · Exemple · + Note) est facultatif et se ferme seul. La timeline montre runs, pauses (hachuré), interruptions (rouge), marqueurs ; en détail (récap) : densité des notes, clic = réécoute. Raccourcis : `Ctrl/⌘+Alt+R` démarrer/pause/reprise. Ils ont été choisis après examen des conflits connus : `Ctrl/⌘+Maj+R` recharge la page (Chrome/Firefox) ou ouvre le mode Lecture (Safari), `Ctrl/⌘+Maj+M` change de profil (Chrome) / mode responsive (Firefox). Vérification faite de mémoire, pas exhaustive sur tous les navigateurs/OS.

### Transcription Providers
Interface `TranscriptionProvider` : `initialize · start · processAudioChunk · pause · resume · stop · dispose · getStatus` (+ `mode: live|chunk`, `privacyNote()`, `availability()`). L'UI ne connaît aucun moteur.

| Moteur | Mode | État | Confidentialité |
|---|---|---|---|
| **Reconnaissance vocale du navigateur** (Web Speech) | live | ✅ implémenté ; Chrome/Safari, pas Firefox | Chrome : audio envoyé aux serveurs Google (sauf traitement local si le navigateur l'annonce) ; Safari : Apple |
| **Whisper, API compatible OpenAI** | chunk | ✅ implémenté, **aucune clé fournie** | API OpenAI = cloud (votre clé) ; **serveur Whisper local** (whisper.cpp server, faster-whisper-server…) = rien ne quitte le Mac |
| Whisper WASM/WebGPU dans le navigateur | chunk | ❌ prévu (même interface) | 100 % local |

**Choix du moteur par défaut (analyse, non benchmarkée ici)** : Web Speech est le seul moteur réellement utilisable sans clé ni téléchargement, en continu, en français, sur Chrome/Safari ; sa transcription est cependant cloud, non garantie en continuité (le navigateur coupe la session, relancée automatiquement) et absente de Firefox. Whisper local dans le navigateur (transformers.js/WebGPU) est la cible idéale (offline, privé) mais impose un modèle de 40–250 Mo, WebGPU encore inégal sur Safari/Firefox et n'a pas pu être validé ici ; il n'est donc pas livré. Le moteur « API compatible » couvre dès maintenant le besoin *local et privé* via un serveur Whisper sur le Mac. Sans moteur disponible : **audio seul**, rien n'est simulé.
**À connecter pour aller plus loin** : (1) Réglages › Transcription › *API Whisper* : adresse + clé éventuelle (stockée dans le `localStorage` de ce navigateur, jamais dans le code) ; (2) pour l'API OpenAI, le CORS du navigateur doit être autorisé côté serveur/proxy ; (3) pour Whisper local : lancer un serveur compatible avec CORS activé.

### Stockage local
Base **séparée** `lexnote-capture` : `audioSessions, chunks (métadonnées), chunkData (ArrayBuffer), segments, markers, anchors, interruptions`. Audio en `ArrayBuffer` (et non `Blob`) pour un comportement identique sur Chrome/Firefox/Safari. Une saturation du quota ne peut donc pas faire échouer une écriture de notes.
- **Contrôle** : `navigator.storage.estimate()` à chaque segment ; `Audio enregistré : 214 Mo · Espace disponible : …` dans le panneau et les Réglages. < 300 Mo libres (ou > 85 %) : avertissement. < 50 Mo ou `QuotaExceededError` : **l'audio cesse d'être conservé** (interruption « Stockage » consignée), la transcription texte et les notes continuent.
- `navigator.storage.persist()` demandé au démarrage ; Réglages › **Stockage audio** : audio par CM, suppression de l'audio seul (transcription conservée).
- Eviction : sans stockage persistant, le navigateur peut effacer les données sous pression (Safari purge agressivement après ~7 j sans usage hors PWA installée). Exportez régulièrement. Quotas typiques (non vérifiés ici) : Chrome ≈ 60 % du disque, Safari/Firefox plus restrictifs ; l'estimation est exposée quand l'API existe, sinon « inconnu ».
- Suppression d'un CM / matière / module / « tout supprimer » → suppression de l'audio, de la transcription, des marqueurs et des ancrages. L'export JSON inclut transcriptions, marqueurs, ancrages (pas les fichiers audio).

### Permissions
Le micro n'est jamais demandé avant un clic. Première utilisation : avertissement (autorisation du professeur, règlement, droit applicable) → *Annuler* / *J'ai l'autorisation — continuer*. Refus : message explicite, notes intactes. Réafficher l'avertissement : Réglages.

### Interruptions et reprise
Micro refusé/absent/débranché, `MediaRecorder` tombé, moteur HS, réseau perdu, mise en veille (saut d'horloge détecté), stockage plein, segment vide/corrompu, **fermeture accidentelle** : tout ce qui est valide est conservé, l'incident est consigné (visible sur la timeline) et **Reprendre la transcription** ouvre un nouveau run sur la même horloge. À la réouverture après fermeture brutale, le run orphelin est refermé au dernier segment connu (perte ≤ 30 s d'audio ; segments de texte flushés chaque seconde).

### Fonctionnement hors ligne
Notes, enregistrement audio, marqueurs, timeline, réécoute et recherche fonctionnent hors ligne. La transcription dépend du moteur : Web Speech (cloud) et API distante **ne fonctionnent pas** sans réseau (l'audio continue d'être enregistré ; le moteur par chunks peut retranscrire ensuite : « Réessayer ») ; un serveur Whisper local fonctionne hors ligne.

### Mise en veille, arrière-plan
Chrome exempte en général les onglets qui capturent le micro du bridage des minuteurs, mais ce n'est pas garanti sur tous les navigateurs : LexNote détecte les trous d'horloge. À la mise en veille de macOS, l'enregistrement est suspendu : au réveil une interruption « Veille » est consignée et l'enregistrement reprend si le micro est toujours actif, sinon passe en erreur reprenable. Le verrou d'écran empêche la mise en veille *écran* tant que l'enregistrement tourne (non garanti sur tous les navigateurs). **Ne fermez pas la fenêtre** : un `beforeunload` vous prévient.

### Provenance
Les segments sont `source: TRANSCRIPTION`, `verification: UNVERIFIED` — toujours. « Article 1128 du Code civil » entendu par le moteur n'est **jamais** une source vérifiée (`isTrusted` = faux ; testé).

### CourseContext (préparation de l'étape IA)
`buildCourseContext(sessionId)` → `{ session, notes, transcript, markers, noteAnchors, interruptions, audio, documents, sources }`. Les trois sources (**notes / transcription / support du professeur**) restent séparées et étiquetées par provenance. `documents` est vide : l'import PDF/PowerPoint/Word/images est préparé (`SourceDocument`, `DocumentImporter`, `DocumentSource`) mais non implémenté.

### Compatibilité navigateurs
| | Chromium | Firefox | Safari / WebKit |
|---|---|---|---|
| App, notes, PWA | ✅ testé (Playwright, Chromium) | ⚠️ **non testé ici** | ⚠️ **non testé ici** |
| Enregistrement audio | ✅ testé avec micro simulé | attendu (webm/opus) — non testé | attendu (mp4/aac) ; IndexedDB/Blob/ArrayBuffer à valider |
| Web Speech | ✅ API présente (testée avec un faux moteur, pas de vraie voix) | ❌ API absente → audio seul / Whisper | ⚠️ `webkitSpeechRecognition` ; cohabitation micro + reconnaissance non vérifiée |

Les binaires Firefox/WebKit ne sont pas téléchargeables dans l'environnement de développement (CDN bloqué, HTTP 403). La config Playwright prévoit `ALL_BROWSERS=1 npx playwright test` (Firefox + WebKit Playwright) à lancer sur une machine disposant des navigateurs ; **WebKit Playwright ne vaut pas Safari réel**.

## Fonctionnalités actuelles (implémentées et testées)

Toute la V1, plus : transcription (Web Speech et Whisper par API/serveur local), segmentation audio, stockage audio contrôlé, marqueurs, timeline, ancrages notes↔transcription, réécoute (-10 s / ▶ / +10 s), reprise après interruption, mode Focus avec pastille REC, fin de CM avec récapitulatif complet (durée, audio, mots notes/transcription, marqueurs, interruptions + onglets Notes/Transcription/Timeline), recherche dans les transcriptions (ouvre le CM au bon passage), suppression en cascade, `CourseContext`.

## Préparé mais NON implémenté
IA (résumé, restructuration, fiches, flashcards, quiz, vérification des articles/jurisprudence, assistant) · Whisper WASM/WebGPU · import de documents · connexion à REV-EM (architecture préparée, aucune donnée partagée) · recherche sémantique · édition manuelle de la transcription.

## Limites connues
- Pas de vraie voix testée : Web Speech testé avec un faux moteur ; micro = bip simulé par Chromium.
- Pas de niveau sonore affiché : un micro muet n'est pas détecté.
- Une seule capture active à la fois ; pas de gestion multi-onglets.
- Perte maximale de 30 s d'audio sur crash brutal ; la transcription Web Speech non encore « finale » à cet instant est perdue.
- Les segments d'un moteur par chunks arrivent en différé (≥ 30 s).
- La fenêtre de transcription affiche les 300 derniers passages ; les précédents se chargent par paliers.
- Safari/Firefox non testés (voir ci-dessus) ; l'installation PWA elle-même (geste) reste non testée.

## Principes de confidentialité

- Les notes sont d'abord **sur l'appareil** (IndexedDB), puis synchronisées avec **votre espace personnel** Supabase (RLS : personne d'autre n'y accède). L'audio ne quitte jamais l'appareil. Aucune télémétrie, aucune police ou ressource tierce.
- Aucun enregistrement sans action explicite ; l'indicateur REC est toujours visible ; l'audio reste local. Selon le moteur, la *reconnaissance* peut être distante : c'est indiqué dans le panneau.

## Vérifications effectuées (moteur de cours)

- `tsc`, build de production (sans backend simulé) : OK. **281 tests unitaires/DB** (dont 70 pour le moteur : extracteurs PDF/PPTX/DOCX réels, chunking, provenance, conflits, non-invention, incrémental, validation, versions, isolation, hors-ligne) · **77 tests e2e Chromium** (dont le scénario complet matière → séance → notes → transcription + document → cours → consultation d'une source → rechargement).

## Vérifications effectuées (comptes + synchronisation)

- `tsc --noEmit` et build de production OK (le build de production ne contient pas le backend simulé). **158 tests unitaires** (dont 14 tests RLS sur Postgres réel et 8 tests du moteur de synchronisation) · **49 tests e2e Chromium** (backend simulé : comptes, isolation A/B, hors ligne → synchronisation, « autre appareil », conflit, import des anciennes notes, suppression de compte, types de séances, non-régression complète, performance 1/2/3 h).

## Vérifications effectuées (V2 + refonte premium)

- Après la refonte : **132 tests unitaires**, **37 tests e2e Chromium**, typecheck et build OK ; performance de l'éditeur inchangée (p95 ≈ 20 ms en frappe pendant l'enregistrement sur un CM de 3 h).

- `npm run typecheck`, `npm run build` : OK. **122 tests unitaires** (V1 : 35) · **28 tests e2e Chromium** (V1 : 13) : tous passent sur un build neuf (`REUSE_SERVER` n'est plus activé par défaut, pour ne jamais tester un build périmé).
- Couverts : permission/refus, démarrage, pause, reprise, arrêt, segments audio et timestamps, stockage (mémoire **et** IndexedDB, réouverture), quotas, segments de transcription, providers (Web Speech et API Whisper avec faux moteur/serveur), marqueurs, NoteAnchor, recherche dans les transcriptions, réécoute, interruptions (micro débranché, recorder tombé, veille, réseau, moteur HS, stockage plein, segment corrompu, fermeture brutale), erreur provider avec reprise, mode Focus, fin de CM, suppression d'un CM et de ses données audio, absence de perte de notes, `CourseContext`, non-régression V1, PWA hors ligne, console sans erreur.
- **Performance** (Chromium headless, micro simulé, CM de 1 / 2 / 3 h : 8 000 mots de notes/heure, un segment de transcription toutes les 4 s — 900 / 1 800 / 2 700 segments —, marqueurs et ≈ 700 / 1 400 / 2 100 ancrages ; pendant l'enregistrement, un flux de 4 segments/s, ≈ 15× le débit réel) :

| CM | ouverture | frappe au repos (méd. / p95) | frappe pendant l'enregistrement (méd. / p95 / max) | nœuds DOM |
|---|---|---|---|---|
| 1 h | 1,6 s | 15,9 / 19,9 ms | 15,5 / 24,1 / 27,8 ms | 1 797 |
| 2 h | 1,6 s | 19,5 / 22,7 ms | 18,7 / 21,5 / 26,6 ms | 2 412 |
| 3 h | 1,8 s | 19,7 / 23,1 ms | 19,6 / 27,6 / 37,5 ms | 3 027 |

La latence est mesurée de l'insertion au prochain rendu (≈ une image) : l'enregistrement n'a pas d'effet mesurable. Sans la fenêtre de 300 passages, le p95 à 3 h montait à ≈ 70 ms (mesure faite avant correction). Résultats d'une machine de développement sans écran réel : à re-mesurer sur votre Mac.

## Roadmap IA

1. **V1.1** — import JSON, raccourci « nouveau CM » global, export Markdown/PDF/Word.
2. **V2** — documents : import PDF/PowerPoint, reconnaissance du plan du professeur.
3. **V3** — transcription (Whisper local / STT), avec consentement.
4. **V4** — IA : fournisseur configurable (local ou cloud), commandes de la palette, sorties étiquetées *AI / Unverified*, vérification par sources.
5. **V5** — résumés, cours restructuré, fiches, flashcards, quiz, recherche sémantique.
6. **V6** — comptes et synchronisation facultative multi-appareils.
7. **V7** — application macOS (Tauri), fenêtre Companion, raccourcis système globaux.
