CREATE TABLE imagem (
    id        INTEGER PRIMARY KEY,
    caminho   TEXT NOT NULL,
    formato   TEXT NOT NULL,
    sha256    TEXT UNIQUE,
    criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE personagem (
    id            INTEGER PRIMARY KEY,
    tipo          TEXT NOT NULL CHECK (tipo IN ('jogador','npc')),
    nome          TEXT NOT NULL,
    descricao     TEXT NOT NULL DEFAULT '',
    hp            INTEGER NOT NULL DEFAULT 0,
    sp            INTEGER NOT NULL DEFAULT 0,
    escudo        INTEGER NOT NULL DEFAULT 0,
    forca         INTEGER NOT NULL DEFAULT 0,
    agilidade     INTEGER NOT NULL DEFAULT 0,
    percepcao     INTEGER NOT NULL DEFAULT 0,
    resistencia   INTEGER NOT NULL DEFAULT 0,
    intuicao      INTEGER NOT NULL DEFAULT 0,
    espirito      INTEGER NOT NULL DEFAULT 0,
    carisma       INTEGER NOT NULL DEFAULT 0,
    determinacao  INTEGER NOT NULL DEFAULT 0,
    retrato_id    INTEGER REFERENCES imagem(id) ON DELETE SET NULL,
    criado_em     TEXT NOT NULL DEFAULT (datetime('now')),
    atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_personagem_tipo ON personagem(tipo);
CREATE TABLE habilidade (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', ordem INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE personagem_pericia (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', atributo TEXT NOT NULL DEFAULT '', nivel INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE personagem_vantagem (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', efeito TEXT NOT NULL DEFAULT ''
);
CREATE TABLE personagem_desvantagem (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', efeito TEXT NOT NULL DEFAULT ''
);
CREATE TABLE transformacao (
    id INTEGER PRIMARY KEY,
    personagem_id INTEGER NOT NULL REFERENCES personagem(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '',
    imagem_id INTEGER REFERENCES imagem(id) ON DELETE SET NULL, ordem INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE transformacao_modificador (
    id INTEGER PRIMARY KEY,
    transformacao_id INTEGER NOT NULL REFERENCES transformacao(id) ON DELETE CASCADE,
    atributo TEXT NOT NULL, delta INTEGER NOT NULL
);
CREATE TABLE transformacao_habilidade (
    id INTEGER PRIMARY KEY,
    transformacao_id INTEGER NOT NULL REFERENCES transformacao(id) ON DELETE CASCADE,
    nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT ''
);
CREATE TABLE catalogo_pericia (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', atributo TEXT NOT NULL DEFAULT '');
CREATE TABLE catalogo_vantagem (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', efeito TEXT NOT NULL DEFAULT '');
CREATE TABLE catalogo_desvantagem (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', efeito TEXT NOT NULL DEFAULT '');
