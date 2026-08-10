CREATE TABLE favorito (
    id            INTEGER PRIMARY KEY,
    nome          TEXT NOT NULL,
    url           TEXT NOT NULL,
    categoria     TEXT,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
