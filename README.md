# LexNote

> L'assistant de prise de notes pour les cours magistraux — pensé pour le droit.
> **Local-first** · **PWA installable** · **hors connexion** · aucune donnée envoyée sur Internet.

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
Variable d'environnement : `VITE_SEED_DEMO=false` désactive les données de démonstration au premier lancement.

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
   ├─ ai/             AIProvider      → NullProvider en V1 (refuse proprement)
   ├─ transcription/  TranscriptionProvider → NullTranscription
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
  store/           Stores Zustand (library, ui, toasts, editorBridge)
  features/
    dashboard/     Accueil
    library/       Matières, modules, liste des CM, dialogue « Nouveau CM »
    editor/        Éditeur : extensions TipTap, barre d'actions, autosave, chrono, panneau assistant
    recap/         Page « Terminer le CM »
    search/        Recherche globale
    palette/       Palette de commandes (Cmd/Ctrl+K)
    settings/      Thème, installation, export, démo
  components/      Primitives UI réutilisables (Modal, Toasts, Logo…)
  data/            Données de démonstration — ISOLÉES, aucune logique applicative n'en dépend
  styles/          Tokens, base, UI, mise en page, pages, éditeur
tests/e2e/         Parcours Playwright
```

## Stockage

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

## Fonctionnalités actuelles (implémentées et testées)

- Navigation : Accueil, Mes matières, Mes CM, Recherche, Réglages ; barre d'onglets sur mobile.
- Accueil : reprise du dernier CM, « CM suivant », chiffres clés, cours récents, matières, recherche.
- Matières → modules → CM : créer, renommer, supprimer (suppression en cascade, avec confirmation) ; numérotation automatique « CM 04 ».
- **Éditeur de CM** : texte, H1/H2/H3, gras, italique, souligné, listes, listes numérotées, citations, séparateurs, liens, annuler/rétablir, retrait (Tab / Maj+Tab, imbrication des listes), raccourcis clavier.
- **Blocs LexNote** : ⚖️ Article, 📚 Jurisprudence, 💡 Définition, ⭐ Important, 🧑‍🏫 Exemple du professeur, ❓ Question / à vérifier (`Ctrl/⌘ + Alt + A/J/D/I/E/Q`, barre d'actions, palette ; *Entrée* sur une ligne vide en fin de bloc pour en sortir).
- **Palette de commandes** `Ctrl/⌘ + K` : navigation, blocs, mise en forme, accès rapide aux CM.
- **Mode Focus** : barre réduite, éditeur agrandi, `Échap` pour quitter.
- **Autosave** local (« Enregistrement… » → « ✓ Enregistré »), chrono de prise de notes (pause possible), plan du CM cliquable.
- **Terminer le CM** → récapitulatif (titre, matière, date, durée, mots, notes).
- **Recherche globale** (accents/casse ignorés) : matières, modules, titres, contenu des notes.
- Thème clair / sombre / système, responsive (desktop → tablette → mobile), PWA installable et hors-ligne, export JSON, données de démonstration supprimables.

## Préparé mais NON implémenté

Ces éléments ont une interface, un type ou un emplacement visuel — **aucun ne produit de résultat** :

- **IA** : `AIProvider`/`aiService` (fournisseur `NullProvider`), catalogue des commandes (Reformuler, Expliquer, Résumer, Développer, Corriger, Vérifier juridiquement) affiché *désactivé « Bientôt »* dans la palette et le panneau.
- **Transcription** : `TranscriptionProvider`, type `Transcript`, `AudioRef` (avec consentement), bouton 🎙 désactivé.
- **Documents** : `DocumentImporter`, `DocumentRef`, bouton « Document » désactivé.
- **Sorties de CM** (cours restructuré, résumé, fiche, articles, jurisprudences, flashcards, questions) : emplacements grisés dans le récapitulatif ; champs prévus dans `CourseSession`.
- **Synchronisation / comptes** : `SyncEngine` (no-op), hook après chaque commit local.
- **Recherche sémantique** : interface `SearchProvider`.
- Éléments juridiques structurés (`legalItems`) : types définis, non extraits automatiquement.

## Principes de confidentialité

- Les notes restent **sur l'appareil** (IndexedDB). Aucun upload, aucune télémétrie, aucune police ou ressource tierce.
- Toute synchronisation future sera **facultative et explicite**.
- Aucun enregistrement audio sans consentement explicite (`AudioRef.consentGivenAt`).

## Vérifications effectuées (V1)

- `npm run typecheck`, `npm run build` : OK.
- Tests unitaires (Vitest) : contrat de stockage (mémoire **et** IndexedDB, dont fermeture/réouverture de la base), CRUD et cascade de suppression, calcul mots/extrait, suppression de la démo, recherche, règles de fiabilité juridique, debounce, dates/textes.
- Tests e2e (Playwright, Chromium) : création matière/module/CM, modification du titre, écriture, blocs (barre, palette, raccourcis), **persistance après rechargement**, sortie rapide sans perte, mode Focus, Terminer le CM, suppression (CM, matière, démo), recherche, thème, commandes IA désactivées, mobile/tablette (pas de défilement horizontal), PWA (manifest, icônes, service worker actif, **navigation hors ligne**), et **aucune erreur console** sur les parcours testés.
- Mesure de performance (Chromium headless, document de ~78 000 mots) : ouverture ≈ 0,6 s ; latence de frappe médiane ≈ 14 ms (une image), p95 ≈ 19 ms, autosave activé.

### Limites connues

- Testé sur Chromium uniquement (pas Safari/Firefox). L'installation PWA elle-même (invite du navigateur / Dock macOS) n'a pas pu être testée de bout en bout ici : manifest, icônes et service worker sont vérifiés, pas le geste d'installation.
- Pas de gestion de conflits multi-onglets : éditer le même CM dans deux onglets simultanément n'est pas protégé.
- La recherche est en mémoire (texte brut, tous les mots) ; elle sera à indexer si la bibliothèque devient très grande.
- Pas d'import de données (seul l'export JSON existe).
- Le mode Focus n'utilise pas le plein écran du navigateur.

## Roadmap

1. **V1.1** — import JSON, raccourci « nouveau CM » global, export Markdown/PDF/Word.
2. **V2** — documents : import PDF/PowerPoint, reconnaissance du plan du professeur.
3. **V3** — transcription (Whisper local / STT), avec consentement.
4. **V4** — IA : fournisseur configurable (local ou cloud), commandes de la palette, sorties étiquetées *AI / Unverified*, vérification par sources.
5. **V5** — résumés, cours restructuré, fiches, flashcards, quiz, recherche sémantique.
6. **V6** — comptes et synchronisation facultative multi-appareils.
7. **V7** — application macOS (Tauri), fenêtre Companion, raccourcis système globaux.
