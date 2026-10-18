-- ============================================================================
-- LexNote — RÉCONCILIATION (facultatif, DESTRUCTIF) : suppression définitive de la quarantaine legacy_pr5
-- ============================================================================
-- À lancer seulement APRÈS avoir vérifié le schéma officiel (verify-official-schema.sql : tout PASS) et validé l'application.
-- Supprime les données de l'ancien schéma expérimental. Irréversible. Sans effet si legacy_pr5 n'existe pas.
-- ============================================================================
drop schema if exists legacy_pr5 cascade;
