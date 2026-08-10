CREATE TABLE config (
    chave         TEXT PRIMARY KEY,
    valor         TEXT NOT NULL,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
