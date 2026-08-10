-- Formato canônico de uma técnica no sistema homebrew do mestre, na ordem em
-- que ele escreve na ficha: Ação, Efeito, Custo, Tempo, Dano.
-- A 0002 trouxe só tempo/custo/dano; faltavam `acao` e `efeito`.
--
-- `campos_extras` é a válvula de escape: o sistema muda, então cada técnica
-- pode ter N pares livres (ex.: "Alcance: 15m", "Requisito: Haki desperto")
-- sem tabela nova nem modelo global. Guarda um JSON `[{"nome":..,"valor":..}]`;
-- a leitura é tolerante (JSON quebrado vira lista vazia, nunca erro).
--
-- Tudo TEXT livre, como na 0002 — nada de lista fechada.
-- Aplicado em `habilidade` e em `transformacao_habilidade` (mantém o
-- `HabilidadeDto` unificado entre forma base e transformação).
ALTER TABLE habilidade ADD COLUMN acao   TEXT NOT NULL DEFAULT '';
ALTER TABLE habilidade ADD COLUMN efeito TEXT NOT NULL DEFAULT '';
ALTER TABLE habilidade ADD COLUMN campos_extras TEXT NOT NULL DEFAULT '[]';
ALTER TABLE transformacao_habilidade ADD COLUMN acao   TEXT NOT NULL DEFAULT '';
ALTER TABLE transformacao_habilidade ADD COLUMN efeito TEXT NOT NULL DEFAULT '';
ALTER TABLE transformacao_habilidade ADD COLUMN campos_extras TEXT NOT NULL DEFAULT '[]';
