//! Integração com o Google (sync via Drive, docs/plans/2026-08-11-sync-google-drive.md).
//! Fase 1: só autenticação (`auth`). O cliente do Drive entra na Fase 2.

pub mod auth;
pub mod drive;
