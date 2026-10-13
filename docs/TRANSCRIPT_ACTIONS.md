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
- **Longues transcriptions** : si le texte dépasse ce qu'un appel traite (`maxInputChars`, 60 000 caractères par défaut), il est
  découpé aux frontières de paragraphes ; chaque partie reçoit une **synthèse intermédiaire** (`digest`), **mise en cache par
  version de la transcription** ; l'action finale travaille sur ces synthèses. Une deuxième action sur la même transcription
  (points clés après un résumé) ne refait aucune synthèse : **un seul appel**.
- **Traduction et nettoyage IA** : partie par partie, dans l'ordre, sans condensation.
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
- Sortie structurée (`output_config.format` JSON Schema) ; repli automatique en cas de refus (`fallbacks: "default"`) ;
  effort réduit pour les tâches mécaniques (traduction, nettoyage, synthèses intermédiaires).
- **Cache de prompt** : système identique pour toutes les tâches, texte source en premier (bloc mis en cache), consigne de la
  tâche ensuite — plusieurs actions sur la même transcription réutilisent le même préfixe.
- Côté application : `VITE_AI_URL=https://<ref>.supabase.co/functions/v1/study-ai`. Sans cette variable : aucune IA, et
  l'interface l'affiche.
- Tests : `handler.test.ts` (Deno, sans réseau : `fetch` remplacé).

## 7. Déploiement (rien n'est déployé par cette PR)

1. Appliquer la migration `20261015000000_transcript_derived_artifacts.sql` **avant** de déployer le frontend.
2. `supabase secrets set ANTHROPIC_API_KEY=… APP_ORIGINS=https://lex-note-svfr.vercel.app` (optionnel : `STUDY_AI_MODEL`).
3. `supabase functions deploy study-ai`.
4. Vercel : `VITE_AI_URL=https://<ref>.supabase.co/functions/v1/study-ai`, puis redéployer.
5. Vérifier sur une vraie séance : résumé, traduction, longue transcription (découpage), erreurs.

## 8. Limites

- Edge Function non testée contre un vrai modèle (aucune clé dans l'environnement de développement).
- Export PDF = impression du navigateur (« Imprimer / PDF ») ; Markdown, texte et presse-papiers sont natifs.
- Pas de limite de débit par utilisateur dans `study-ai` (à ajouter si nécessaire : quota par jour).
- La détection de langue et les suggestions sont des indices lexicaux, pas des analyses.
