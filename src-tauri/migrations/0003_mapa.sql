CREATE TABLE mapa (
    id               INTEGER PRIMARY KEY,
    titulo           TEXT NOT NULL DEFAULT '',
    colunas          INTEGER NOT NULL DEFAULT 26,
    linhas           INTEGER NOT NULL DEFAULT 7,
    grade            TEXT NOT NULL DEFAULT '[]',
    ordem_navegacao  TEXT NOT NULL DEFAULT '',
    legenda          TEXT NOT NULL DEFAULT '',
    efeito           TEXT NOT NULL DEFAULT '',
    criado_em        TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em    TEXT NOT NULL DEFAULT (datetime('now'))
);
