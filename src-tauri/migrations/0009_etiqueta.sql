-- Etiquetas de organização das fichas. Só NPCs recebem etiqueta (regra do
-- domínio, aplicada em `repositorios::escrever_etiquetas`): a lista de
-- jogadores é curta e fixa e continua plana em Fichas e na Batalha.
-- Relação N:N — um NPC pode ser "Marinha" + "Arco Alabasta" + "Chefe".
CREATE TABLE etiqueta (
    id            INTEGER PRIMARY KEY,
    -- NOCASE para "Marinha" e "marinha" serem a mesma etiqueta (o upsert por
    -- nome do save depende disso pra não criar duplicata).
    nome          TEXT NOT NULL UNIQUE COLLATE NOCASE,
    -- Token de cor da paleta fixa do frontend (ver CORES_ETIQUETA), não CSS.
    cor           TEXT NOT NULL DEFAULT 'slate',
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE personagem_etiqueta (
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    etiqueta_id   INTEGER NOT NULL REFERENCES etiqueta(id) ON DELETE CASCADE,
    PRIMARY KEY (personagem_id, etiqueta_id)
);

-- Busca pelo lado da etiqueta (agrupar a lista de Disponíveis na Batalha).
CREATE INDEX idx_personagem_etiqueta_etiqueta ON personagem_etiqueta(etiqueta_id);
