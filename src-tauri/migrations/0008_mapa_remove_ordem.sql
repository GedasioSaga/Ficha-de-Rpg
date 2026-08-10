-- A "Ordem" de navegação deixa de ser texto livre: agora é derivada
-- automaticamente das peças no mapa (ver render_discord). O único dado
-- existente na coluna era a string "teste" num mapa de teste — sem valor,
-- ok apagar. `ALTER TABLE ... DROP COLUMN` é seguro aqui (SQLite 3.35+,
-- bundled via rusqlite >= 3.46).
ALTER TABLE mapa DROP COLUMN ordem_navegacao;
