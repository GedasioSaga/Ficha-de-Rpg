-- Presets de encontro: batalhas pré-montadas que o mestre salva com nome e
-- recarrega depois (substituindo a batalha ATIVA). Reusa a mesma serialização
-- de `batalha_ativa` (snapshot JSON de `Estado`), mas em N linhas em vez de 1.
-- `nome` NÃO é único de propósito — o mestre pode ter dois presets "Bandidos".
CREATE TABLE batalha_salva (
    id            INTEGER PRIMARY KEY,
    nome          TEXT NOT NULL,
    descricao     TEXT NOT NULL DEFAULT '',
    estado        TEXT NOT NULL,
    -- Espelha o `proximo_id` de `batalha_ativa`: sem ele o contador de id do
    -- combatente volta errado (podendo colidir com ids já usados) ao restaurar.
    proximo_id    INTEGER NOT NULL,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
