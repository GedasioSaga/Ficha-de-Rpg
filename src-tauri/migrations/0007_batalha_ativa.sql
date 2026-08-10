-- Linha única (CHECK id = 1): existe uma batalha ativa por vez, igual ao
-- modelo em memória de hoje (Mutex<Batalha>). `estado` é o snapshot JSON de
-- `Estado`; o RNG (`Dado`) fica de fora de propósito, não é serializável.
CREATE TABLE batalha_ativa (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    estado        TEXT NOT NULL,
    proximo_id    INTEGER NOT NULL,
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
