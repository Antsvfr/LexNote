# Exploiter la transcription — architecture

Après une séance (CM, TD, TP, cours, séminaire, atelier, projet, révision… — toutes passent par le même modèle `CourseSession`,
qu'elles soient créées dans LexNote ou ouvertes depuis le planning REV-EM), la page de récapitulatif propose
**« Exploiter la transcription »**. Chaque résultat est un **nouveau support** : la transcription originale n'est jamais modifiée.

```
Transcription originale (segments horodatés, jamais modifiés)
  → version nettoyée (CLEAN_TRANSCRIPT)
  → résumé (SUMMARY) → traduction (TRANSLATION)
  → cours structuré, points clés, glossaire, questions d'examen, notes d'étude…
  → fiches, flashcards, quiz, tableau comparatif, chronologie, méthode (moteur de cours existant)
```

## 1. Actions (`src/services/transcript/actions.ts`)

| Nature | Où ça tourne | Exemples | Sans moteur IA |
|---|---|---|---|
| `ai` | Edge Function `study-ai` (serveur) | Résumer, Traduire, Structurer, Points clés, Questions d'examen, À retenir, Définitions, Glossaire, Notions, Plan, Passages importants, Points ambigus, Questions à poser, Expliquer (sélection) | **« Fonction IA non configurée »** — rien n'est simulé |
| `local` | sur l'appareil, déterministe | Nettoyage léger (hésitations, répétitions, ponctuation, paragraphes) | disponible, hors ligne compris |
| `support` | moteur de cours LOCAL existant | Fiche, Flashcards, Quiz, Tableau comparatif, Chronologie, Méthode | disponible (via « Créer un support ») |

Interface : 4 actions principales (Résumer · Traduire · Structurer · Points clés), puis **Plus d'actions** groupées
(Réviser · Comprendre · Analyser · Texte), et au plus 3 **suggestions contextuelles** (indices lexicaux : définitions →
flashcards, comparaisons → tableau, dates → chronologie, étapes → méthode, termes techniques → glossaire, séance dense → fiche).
Les suggestions ne bloquent jamais rien.

Dans l'onglet **Transcription** : recherche (occurrences, précédente/suivante), aller à un instant, copier, exporter
(.txt horodaté, .md), et **sélection d'un passage** → Résumer / Traduire / Expliquer / Flashcard (la flashcard est écrite par
l'étudiant : la réponse reprend le passage, aucune IA).

## 2. Pipeline (`src/services/transcript/pipeline.ts`)

- **Source** : transcription complète, version nettoyée, sélection (plage horodatée) ou support existant (ex. « traduire le résumé seulement »).
- **Garde-fous** : transcription vide → `EmptyTranscriptError` ; trop courte pour l'action → `TooShortError` ; moteur absent →
  `AINotConfiguredError` ; hors ligne → `AIOfflineError` ; réponse invalide → `InvalidModelOutputError` (rien n'est enregistré).
- **Longues transcriptions** : si le texte dépasse ce qu'un appel traite (`maxInputChars`, **plafonné à 60 000 caractères**
  côté client ; le serveur refuse au-delà de 80 000), il est découpé aux frontières de paragraphes ; chaque partie reçoit une
  **synthèse intermédiaire** (`digest`) ; l'action finale travaille sur ces synthèses. Si les synthèses réunies dépassent encore
  la limite, elles sont condensées par groupes (**réduction récursive**, profondeur ≤ 3). Une deuxième action sur la même
  transcription (points clés après un résumé) ne refait aucune synthèse : **un seul appel**.
- **Cache des synthèses (`digestStore.ts`)** : l'ancienne `Map` en mémoire était **perdue à chaque rechargement** (constaté :
  module rechargé = cache vide = analyse complète relancée). Désormais IndexedDB sur l'appareil (base `lexnote-digests`), `Map` en
  premier niveau et en repli (navigation privée). Clé = `user_id | session_id | transcript_version | chunk_version` (empreinte du
  texte de la partie + taille de découpe + niveau de réduction) ` | engine_version` (`digest-v1:<fournisseur>`). Non synchronisé
  dans le cloud ; 2 000 entrées max, 60 jours max ; `clearUser(userId)` disponible.
- **Traduction et nettoyage IA** : partie par partie (≤ 16 000 caractères, la sortie ayant la taille de l'entrée), dans l'ordre,
  sans condensation.
- **Sortie** : un document en blocs (`docSchema`, zod) — titres, paragraphes, listes, définitions, encadrés « À retenir » /
  « Attention » / « Passage incertain », tableaux, questions. Les passages incertains restent signalés.

## 3. Traduction

Langues prioritaires : français, anglais, espagnol, allemand, italien (`LANGUAGES`, `src/domain/derived.ts` — ajouter une
langue = ajouter une ligne). Choix : transcription complète **ou** résumé seulement. La langue source est détectée (mots outils)
et transmise. La traduction est un **nouveau** support `TRANSLATION` (langue, langue source, source) ; **« Voir l'original »**
affiche côte à côte la transcription (ou le résumé) d'origine.

## 4. Résumé

Express (5 à 10 points), Standard (sections), Détaillé (complet mais condensé). Consigne serveur : sens respecté, rien
d'inventé, notions conservées, vraie hiérarchie. Éditable, sauvegardé, régénérable, lié à la séance.

## 5. StudyArtifact (aucun système parallèle)

Mêmes table, synchronisation, RLS que les supports du cours reconstruit. Ajouts (migration `20261015000000`, rétrocompatible) :

| Colonne | Rôle |
|---|---|
| `source_type` | `reconstructed-course` (défaut, données existantes) ou `transcript` |
| `source_session_id` | séance source (obligatoire pour `transcript`) |
| `source_transcript_version` | empreinte de la transcription traitée |
| `language`, `generation_type`, `generator` | langue, action, moteur `{providerId, model, local}` |
| `parent_artifact_id` | support d'origine (traduction d'un résumé…) |
| `revisions` | versions antérieures (10 max) : **une version modifiée n'est jamais écrasée** |

La provenance complète (`provenance` jsonb) porte aussi les options, la plage sélectionnée, le nombre de mots et de parties.
Les types `SUMMARY`, `TRANSLATION`, `CLEAN_TRANSCRIPT`, `STRUCTURED_NOTES`, `KEY_POINTS`, `GLOSSARY`, `EXAM_QUESTIONS`,
`STUDY_NOTE` s'ajoutent aux 8 types existants (`COURSE_SHEET` = fiche de révision, nom conservé).

**REV-EM** : le contrat `lexnote-revem/v1` ne connaît que les 8 types du cours reconstruit ; les documents dérivés ne lui sont
pas exposés (`isContractArtifact`) tant qu'une version du contrat ne les prévoit pas. Les séances ouvertes depuis REV-EM sont
des séances ordinaires : toutes les actions s'y appliquent. Un type de séance ajouté après la v1 (ex. `PROJECT`) est transmis
comme `OTHER`.

## 6. IA côté serveur (`supabase/functions/study-ai`)

- Authentification par le jeton de l'utilisateur ; clé du modèle = secret serveur (`ANTHROPIC_API_KEY`) ; CORS limité à
  `APP_ORIGINS` ; seul du **texte** est reçu (jamais l'audio) ; rien n'est stocké côté fonction.
- Fournisseur interchangeable : seule `callModel` dépend du fournisseur (SDK officiel Anthropic, modèle par défaut
  `claude-opus-5-5`, surchargeable par `STUDY_AI_MODEL`).
- Sortie structurée (`output_config.format` JSON Schema) ; effort réduit pour les tâches mécaniques (traduction, nettoyage,
  synthèses intermédiaires).
- **Refus du modèle** : **aucun repli, aucun contournement**. `stop_reason: "refusal"` → HTTP 422 `{error:"refused"}`, journalisé
  `refused`, aucune nouvelle tentative (ni serveur ni client). Les nouvelles tentatives (SDK, `maxRetries: 2`) ne concernent que
  l'indisponibilité technique (429 / 5xx / réseau du fournisseur).
- **Limites de sortie par action** (`maxTokensFor`, plus de `max_tokens: 64000`) : base + marge de réflexion (1 000 pour les
  tâches à effort réduit, 3 000 sinon). Résumé express 1 500, standard 4 000, détaillé 8 000 ; points clés / à retenir /
  explication / fiches 2 500 ; définitions / glossaire / notions / plan 4 000 ; questions / ambiguïtés / passages 3 500 ;
  synthèse intermédiaire 800–3 000 (≈ 0,3 × entrée) ; structuration 3 000–12 000 (≈ 1,1 × entrée) ; traduction / nettoyage
  1 000–12 000 (≈ 1,5 × entrée). Sortie tronquée → 502 `truncated` (rien n'est enregistré).
- **Limitation de débit par utilisateur** (migration `20261016000000_study_ai_usage.sql`) : avant tout appel payant, la fonction
  appelle `study_ai_acquire` (clé `service_role`, côté serveur uniquement ; verrou consultatif par utilisateur → atomique) :
  appels simultanés (défaut 2), par minute (12), par jour (200), volume de texte par jour (3 000 000 caractères). Dépassement →
  **429** `{error:"rate_limited", reason:"concurrent"|"per_minute"|"per_day"|"chars_per_day", limit, retry_after}` + en-tête
  `Retry-After` ; l'application affiche un message clair (« Trop de demandes IA en une minute (max 12). Réessayez dans 37 s. »).
  Contrôle indisponible → 503 `rate_limit_unavailable` (**fermé** : aucun appel non compté). Journal sans texte (utilisateur,
  tâche, taille, état, jetons de sortie), purgé après 2 jours ; RLS forcée, aucun droit navigateur. Réglable par secrets :
  `STUDY_AI_MAX_CONCURRENT`, `STUDY_AI_MAX_PER_MINUTE`, `STUDY_AI_MAX_PER_DAY`, `STUDY_AI_MAX_CHARS_PER_DAY`,
  `STUDY_AI_TIMEOUT_MS` (120 000) ; `STUDY_AI_MODEL` reste un secret serveur. Aucun réglage sensible côté frontend.
- Délai fournisseur dépassé → 504 `timeout` ; fournisseur saturé → 503 `provider_busy`.
- **Cache de prompt** : système identique pour toutes les tâches, texte source en premier (bloc mis en cache), consigne de la
  tâche ensuite — plusieurs actions sur la même transcription réutilisent le même préfixe.
- Côté application : `VITE_AI_URL=https://<ref>.supabase.co/functions/v1/study-ai`. Sans cette variable : aucune IA, et
  l'interface l'affiche.
- Tests : `handler.test.ts` (Deno, sans réseau : `fetch` remplacé) ; `tests/db/study-ai-usage.test.ts` (limites sur un vrai
  Postgres) ; `scripts/prod/study-ai-smoke.mjs` (smoke test RÉEL, manuel) + son auto-test sans clé.

## 7. Déploiement (rien n'est déployé par cette PR)

Ordre de fusion : #12 (réconciliation) → #10 (lancement REV-EM, migration `20261014`) → **#11**. Ne jamais rejouer
`20261012` / `20261013` en production (déjà appliquées).

1. Appliquer **uniquement** `20261015000000_transcript_derived_artifacts.sql` puis `20261016000000_study_ai_usage.sql`
   (après `20261014` de #10), **avant** de déployer le frontend.
2. `supabase secrets set ANTHROPIC_API_KEY=… APP_ORIGINS=https://lex-note-svfr.vercel.app` (optionnels : `STUDY_AI_MODEL`,
   `STUDY_AI_MAX_*`, `STUDY_AI_TIMEOUT_MS`). `SUPABASE_SERVICE_ROLE_KEY` est fourni automatiquement aux fonctions.
3. `supabase functions deploy study-ai`.
4. **Smoke test réel** : `node scripts/prod/study-ai-smoke.mjs` (dry-run), puis `SMOKE_CONFIRM=1 SMOKE_RATE_LIMIT=1 …`.
   Délai et erreur fournisseur : sur un projet de test (`SMOKE_EXPECT_TIMEOUT=1` avec `STUDY_AI_TIMEOUT_MS` bas ;
   `SMOKE_EXPECT_PROVIDER_ERROR=1` avec une clé invalide). **Tant qu'il n'est pas passé, la fonction n'est pas « prête pour la
   production ».**
5. Vercel : `VITE_AI_URL=https://<ref>.supabase.co/functions/v1/study-ai`, puis redéployer.

## 8. Limites

- Edge Function **non testée contre un vrai modèle** (aucune clé dans l'environnement de développement) : smoke test réel à faire.
- Refus du modèle : non provocable de façon fiable sur un vrai modèle → vérifié uniquement par les tests Deno.
- Export PDF = impression du navigateur (« Imprimer / PDF ») ; Markdown, texte et presse-papiers sont natifs.
- La détection de langue et les suggestions sont des indices lexicaux, pas des analyses.
