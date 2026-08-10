-- Campos de combate da habilidade que a migração da Fase 0 deixou de fora.
-- TEXT livre: o v1 guarda "1", "-45 de SP", "150", ou até texto não-numérico.
-- Aplicado em `habilidade` e em `transformacao_habilidade` (mantém o
-- `HabilidadeDto` unificado entre forma base e transformação).
ALTER TABLE habilidade ADD COLUMN tempo TEXT NOT NULL DEFAULT '';
ALTER TABLE habilidade ADD COLUMN custo TEXT NOT NULL DEFAULT '';
ALTER TABLE habilidade ADD COLUMN dano  TEXT NOT NULL DEFAULT '';
ALTER TABLE transformacao_habilidade ADD COLUMN tempo TEXT NOT NULL DEFAULT '';
ALTER TABLE transformacao_habilidade ADD COLUMN custo TEXT NOT NULL DEFAULT '';
ALTER TABLE transformacao_habilidade ADD COLUMN dano  TEXT NOT NULL DEFAULT '';
