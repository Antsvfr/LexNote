# Audit de sécurité des données — opérations destructrices

> Objectif : **aucune perte silencieuse**. Pour chaque opération qui supprime, remplace ou abandonne des données : ce qu'elle fait réellement,
> ce que l'étudiant en est informé, ce qui est récupérable, et le test qui le garantit. Audit réalisé sur le code de la branche
> `claude/production-readiness-observability` (lecture du code + tests). Les corrections issues de l'audit sont marquées **CORRIGÉ**.

| Opération | Effet réel | Information de l'étudiant | Récupérable ? | Test |
|---|---|---|---|---|
| **Supprimer une séance** (`library.deleteSession`) | Retire la séance, ses notes, sa transcription et son audio **de l'appareil** ; pierre tombale → suppression **aussi dans le cloud et sur les autres appareils** | Confirmation. **CORRIGÉ** : le texte disait « supprimée de cet appareil » alors que la suppression est propagée ; il le dit maintenant | Cloud : suppression « douce » (`deleted_at`) → restaurable depuis une sauvegarde ou par SQL ; audio : non (local seulement) | `engine.test.ts` « suppression propagée » |
| **Supprimer une matière** (`deleteSubject`) | Idem, avec ses modules et séances | Confirmation avec le **nombre** de séances. **CORRIGÉ** : même correction de texte | Idem | `engine.test.ts` |
| **Tout supprimer** (`library.wipe`, Réglages) | Pierres tombales sur toutes les matières/modules/séances (propagées) | Confirmation + suggestion d'export. **CORRIGÉ** : saisie obligatoire de `SUPPRIMER` (comme la suppression de compte) | Idem (sauvegarde) | revue + `release-critical` |
| **Supprimer le compte** (`deleteAccount`) | Edge Function `delete-account` : compte + données cloud ; efface l'appareil | Double confirmation, saisie de `SUPPRIMER` | **Non** (voulu) | `tests/db` + e2e `accounts.spec.ts` |
| **Se déconnecter** (`signOut`) | **Ne supprime rien** : les données restent dans le stockage local de l'appareil, isolé par compte | **CORRIGÉ** : `confirmSafeLogout` tente d'abord un dernier envoi (5 s max), prévient s'il reste des éléments non synchronisés (« Rien n'est perdu »), et demande confirmation si une transcription est en cours | Oui : tout reste sur l'appareil, repart à la reconnexion | `safeLogout.test.ts` |
| **Déconnecter tous les appareils** (`signOut({everywhere})`) | Révoque les sessions du compte ; **aucune donnée supprimée** | Libellé explicite | Oui | `auth-persistence.spec.ts` |
| **Révoquer un appareil** (`user_device_revoke`) | Tue la session de CET appareil ; ses données locales restent ; le prochain démarrage affiche « session expirée » (`sessionLost`) sans effacer le stockage | Message de connexion | Oui | `tests/db` (devices), `auth-persistence.spec.ts` |
| **Révoquer la liaison REV-EM** (`integration_revoke_link`) | Marque la liaison `REVOKED` ; **aucune donnée LexNote ni REV-EM supprimée** | « Vos données n'ont pas été supprimées » | Oui (relancer depuis REV-EM) | `integration.spec.ts`, `real-e2e.mjs` |
| **Conflit de synchronisation** (`resolveConflict` du moteur) | Notes divergentes : **les deux versions sont conservées** (copie « version locale en conflit ») ; métadonnées seules : la plus récente gagne | Toast + **CORRIGÉ** : bannière « Deux versions de cette note existent. » avec *Garder celle-ci / Garder l'autre / Conserver les deux* ; chaque choix destructeur demande confirmation ; **on écrit avant de supprimer** | Oui jusqu'au choix explicite | `dataLoss.test.ts`, `conflictResolution.test.ts` |
| **Suppression distante d'une séance modifiée localement** | La modification locale **restaure** la séance (`deleted_at` remis à null) | Aucune (la séance réapparaît) | Oui | `dataLoss.test.ts` « suppression distante » |
| **Suppression distante d'une séance non modifiée** | Suppression locale (pierre tombale appliquée) | Aucune | Via sauvegarde | `engine.test.ts` |
| **Mise à jour de l'application (PWA)** | Rechargement de la page | **CORRIGÉ** : jamais automatique ; refusée pendant transcription / enregistrement / synchronisation (`activity.ts`) ; `beforeunload` pendant une transcription | n/a | `activity.test.ts`, `pwa.spec.ts` |
| **Purge du journal IA** (`study_ai_requests`) | Supprime les lignes de plus de 30 jours (métadonnées techniques uniquement) | Documenté | n/a (aucun contenu) | `tests/db/study-ai-budget.test.ts` |

## Risques résiduels (non corrigés, à connaître)
1. **L'audio n'est jamais synchronisé** : supprimer une séance, vider le stockage du navigateur ou perdre l'appareil perd l'audio. Les notes et la transcription (texte) sont dans le cloud.
2. **Pas de corbeille dans l'application** : la suppression « douce » du cloud permet une restauration par l'exploitant (sauvegarde ou SQL), pas par l'étudiant.
3. **Stockage navigateur non persistant** : si le navigateur n'accorde pas `navigator.storage.persist()`, des données **non encore synchronisées** peuvent être évincées en cas de manque d'espace (avertissement dans Réglages et Diagnostic).
4. **Conflit repéré par le titre sur un second appareil** : le marqueur `conflictOf` est local ; sur un autre appareil la copie est reconnue grâce au suffixe « (version locale en conflit) » du titre — un renommage manuel de ce titre masque la bannière (les deux séances restent présentes).
5. **Sauvegarde Supabase** : sans plan avec sauvegardes/PITR, seule la sauvegarde manuelle (`docs/PRODUCTION_RUNBOOK.md` §Sauvegarde) protège d'une erreur d'exploitation.
