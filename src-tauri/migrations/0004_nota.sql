CREATE TABLE nota (
    id            INTEGER PRIMARY KEY,
    titulo        TEXT NOT NULL DEFAULT '',
    corpo         TEXT NOT NULL DEFAULT '',
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
