-- Contador de revisão pra sincronização de nuvem (plano §4, "plano B" —
-- ver db::sincronizacao_nuvem::banco_esta_sujo). `MAX(atualizado_em)` sozinho
-- não pega DELETE (a linha some, o carimbo some junto); este contador soma 1
-- a cada INSERT/UPDATE/DELETE nas tabelas de dado do usuário, então qualquer
-- mudança — inclusive apagar uma ficha — avança `valor` e marca "sujo".
CREATE TABLE sync_revisao (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    valor INTEGER NOT NULL DEFAULT 0
);
INSERT INTO sync_revisao (id, valor) VALUES (1, 0);

CREATE TRIGGER sync_revisao_personagem_ins AFTER INSERT ON personagem
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_personagem_upd AFTER UPDATE ON personagem
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_personagem_del AFTER DELETE ON personagem
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;

CREATE TRIGGER sync_revisao_mapa_ins AFTER INSERT ON mapa
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_mapa_upd AFTER UPDATE ON mapa
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_mapa_del AFTER DELETE ON mapa
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;

CREATE TRIGGER sync_revisao_nota_ins AFTER INSERT ON nota
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_nota_upd AFTER UPDATE ON nota
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_nota_del AFTER DELETE ON nota
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;

CREATE TRIGGER sync_revisao_favorito_ins AFTER INSERT ON favorito
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_favorito_upd AFTER UPDATE ON favorito
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_favorito_del AFTER DELETE ON favorito
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;

CREATE TRIGGER sync_revisao_etiqueta_ins AFTER INSERT ON etiqueta
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_etiqueta_upd AFTER UPDATE ON etiqueta
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_etiqueta_del AFTER DELETE ON etiqueta
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;

CREATE TRIGGER sync_revisao_batalha_ativa_ins AFTER INSERT ON batalha_ativa
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_batalha_ativa_upd AFTER UPDATE ON batalha_ativa
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_batalha_ativa_del AFTER DELETE ON batalha_ativa
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;

CREATE TRIGGER sync_revisao_batalha_salva_ins AFTER INSERT ON batalha_salva
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_batalha_salva_upd AFTER UPDATE ON batalha_salva
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
CREATE TRIGGER sync_revisao_batalha_salva_del AFTER DELETE ON batalha_salva
BEGIN
    UPDATE sync_revisao SET valor = valor + 1 WHERE id = 1;
END;
