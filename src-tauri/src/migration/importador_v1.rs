use crate::db::error::AppError;
use crate::db::imagens::salvar_imagem_base64;
use crate::db::repositorios::{inserir_personagem, NovoPersonagem};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::path::Path;

fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}
fn i(v: &Value, k: &str) -> i64 {
    v.get(k).and_then(|x| x.as_i64()).unwrap_or(0)
}

/// Campos de combate (`tempo`/`custo`/`dano`) do objeto `status` de uma
/// habilidade v1. Defensivo: se `status` faltar ou não for objeto (às vezes
/// vem string), devolve vazios — o schema tem DEFAULT ''.
fn combate(h: &Value) -> (String, String, String) {
    match h.get("status") {
        Some(st) if st.is_object() => (s(st, "tempo"), s(st, "custo"), s(st, "dano")),
        _ => (String::new(), String::new(), String::new()),
    }
}

fn importar_registro(
    conn: &Connection,
    images_dir: &Path,
    tipo: &str,
    reg: &Value,
) -> Result<i64, AppError> {
    let retrato_id = match reg.get("forma_base") {
        Some(fb) => {
            salvar_imagem_base64(conn, images_dir, &s(fb, "imagem_data"), &s(fb, "imagem_formato"))?
        }
        None => None,
    };
    let np = NovoPersonagem {
        tipo: tipo.into(),
        nome: s(reg, "nome"),
        descricao: s(reg, "descricao"),
        hp: i(reg, "hp"),
        sp: i(reg, "sp"),
        escudo: i(reg, "escudo"),
        forca: i(reg, "forca"),
        agilidade: i(reg, "agilidade"),
        percepcao: i(reg, "percepcao"),
        resistencia: i(reg, "resistencia"),
        intuicao: i(reg, "intuicao"),
        espirito: i(reg, "espirito"),
        carisma: i(reg, "carisma"),
        determinacao: i(reg, "determinacao"),
        retrato_id,
    };
    let pid = inserir_personagem(conn, &np)?;

    if let Some(arr) = reg.get("habilidades").and_then(|x| x.as_array()) {
        for (ordem, h) in arr.iter().enumerate() {
            let (tempo, custo, dano) = combate(h);
            conn.execute(
                "INSERT INTO habilidade (personagem_id,nome,descricao,ordem,tempo,custo,dano) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![pid, s(h, "nome"), s(h, "descricao"), ordem as i64, tempo, custo, dano],
            )?;
        }
    }
    if let Some(arr) = reg.get("pericias").and_then(|x| x.as_array()) {
        for p in arr {
            conn.execute(
                "INSERT INTO personagem_pericia (personagem_id,nome,descricao,atributo,nivel) \
                 VALUES (?1,?2,?3,?4,?5)",
                params![pid, s(p, "nome"), s(p, "descricao"), s(p, "atributo"), i(p, "nivel")],
            )?;
        }
    }
    for (campo, tabela) in [
        ("vantagens", "personagem_vantagem"),
        ("desvantagens", "personagem_desvantagem"),
    ] {
        if let Some(arr) = reg.get(campo).and_then(|x| x.as_array()) {
            for v in arr {
                conn.execute(
                    &format!(
                        "INSERT INTO {tabela} (personagem_id,nome,descricao,efeito) VALUES (?1,?2,?3,?4)"
                    ),
                    params![pid, s(v, "nome"), s(v, "descricao"), s(v, "efeito")],
                )?;
            }
        }
    }
    if let Some(arr) = reg.get("transformacoes").and_then(|x| x.as_array()) {
        for (ordem, t) in arr.iter().enumerate() {
            let img =
                salvar_imagem_base64(conn, images_dir, &s(t, "imagem_data"), &s(t, "imagem_formato"))?;
            conn.execute(
                "INSERT INTO transformacao (personagem_id,nome,descricao,imagem_id,ordem) \
                 VALUES (?1,?2,?3,?4,?5)",
                params![pid, s(t, "nome"), s(t, "descricao"), img, ordem as i64],
            )?;
            let tid = conn.last_insert_rowid();
            if let Some(mods) = t.get("modificadores").and_then(|x| x.as_object()) {
                for (atr, delta) in mods {
                    conn.execute(
                        "INSERT INTO transformacao_modificador (transformacao_id,atributo,delta) \
                         VALUES (?1,?2,?3)",
                        params![tid, atr, delta.as_i64().unwrap_or(0)],
                    )?;
                }
            }
            if let Some(hs) = t.get("habilidades_especiais").and_then(|x| x.as_array()) {
                for h in hs {
                    let (nome, desc, tempo, custo, dano) = if h.is_string() {
                        (h.as_str().unwrap_or("").to_string(), String::new(), String::new(), String::new(), String::new())
                    } else {
                        let (tempo, custo, dano) = combate(h);
                        (s(h, "nome"), s(h, "descricao"), tempo, custo, dano)
                    };
                    conn.execute(
                        "INSERT INTO transformacao_habilidade (transformacao_id,nome,descricao,tempo,custo,dano) \
                         VALUES (?1,?2,?3,?4,?5,?6)",
                        params![tid, nome, desc, tempo, custo, dano],
                    )?;
                }
            }
        }
    }
    Ok(pid)
}

pub fn importar_jogadores_npcs(
    conn: &Connection,
    images_dir: &Path,
    jogadores_json: &str,
    npcs_json: &str,
) -> Result<(usize, usize), AppError> {
    let jog: Value = serde_json::from_str(jogadores_json)?;
    let npc: Value = serde_json::from_str(npcs_json)?;
    let mut nj = 0usize;
    let mut nn = 0usize;
    if let Some(obj) = jog.as_object() {
        for (_nome, reg) in obj {
            importar_registro(conn, images_dir, "jogador", reg)?;
            nj += 1;
        }
    }
    if let Some(obj) = npc.as_object() {
        for (_nome, reg) in obj {
            importar_registro(conn, images_dir, "npc", reg)?;
            nn += 1;
        }
    }
    Ok((nj, nn))
}

pub fn importar_catalogos(
    conn: &Connection,
    pericias_json: &str,
    vantagens_json: &str,
    desvantagens_json: &str,
) -> Result<(), AppError> {
    let p: Value = serde_json::from_str(pericias_json)?;
    if let Some(arr) = p.get("pericias").and_then(|x| x.as_array()) {
        for it in arr {
            conn.execute(
                "INSERT INTO catalogo_pericia (nome,descricao,atributo) VALUES (?1,?2,?3)",
                params![s(it, "nome"), s(it, "descricao"), s(it, "atributo")],
            )?;
        }
    }
    let v: Value = serde_json::from_str(vantagens_json)?;
    if let Some(arr) = v.get("vantagens").and_then(|x| x.as_array()) {
        for it in arr {
            conn.execute(
                "INSERT INTO catalogo_vantagem (nome,descricao,efeito) VALUES (?1,?2,?3)",
                params![s(it, "nome"), s(it, "descricao"), s(it, "efeito")],
            )?;
        }
    }
    let d: Value = serde_json::from_str(desvantagens_json)?;
    if let Some(arr) = d.get("desvantagens").and_then(|x| x.as_array()) {
        for it in arr {
            conn.execute(
                "INSERT INTO catalogo_desvantagem (nome,descricao,efeito) VALUES (?1,?2,?3)",
                params![s(it, "nome"), s(it, "descricao"), s(it, "efeito")],
            )?;
        }
    }
    Ok(())
}

pub fn importar_v1_completo(
    conn: &Connection,
    images_dir: &Path,
    jogadores_json: &str,
    npcs_json: &str,
    pericias_json: &str,
    vantagens_json: &str,
    desvantagens_json: &str,
) -> Result<(usize, usize), AppError> {
    // Idempotência: se já há personagens, não reimporta (nome não é UNIQUE -> duplicaria).
    let ja: i64 = conn.query_row("SELECT count(*) FROM personagem", [], |r| r.get(0))?;
    if ja > 0 {
        let nj: i64 =
            conn.query_row("SELECT count(*) FROM personagem WHERE tipo='jogador'", [], |r| r.get(0))?;
        let nn: i64 =
            conn.query_row("SELECT count(*) FROM personagem WHERE tipo='npc'", [], |r| r.get(0))?;
        return Ok((nj as usize, nn as usize));
    }
    let tx = conn.unchecked_transaction()?;
    let (nj, nn) = importar_jogadores_npcs(&tx, images_dir, jogadores_json, npcs_json)?;
    importar_catalogos(&tx, pericias_json, vantagens_json, desvantagens_json)?;
    tx.commit()?;
    Ok((nj, nn))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_in_memory;

    const PNG_1X1: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HBGWAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

    #[test]
    fn importa_jogador_com_imagem_filhos_e_transformacao() {
        let conn = open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("rpgv2_test_imgs");
        let _ = std::fs::remove_dir_all(&tmp);

        let jog = format!(
            r#"{{"Luffy":{{"nome":"Luffy","descricao":"cap","hp":100,"sp":10,"escudo":0,
            "forca":9,"agilidade":8,"percepcao":5,"resistencia":7,"intuicao":4,"espirito":6,
            "carisma":9,"determinacao":10,
            "habilidades":[{{"nome":"Gomu","descricao":"borracha","status":{{"tempo":"1","custo":"-45 de SP","dano":"150"}}}}],
            "pericias":[{{"nome":"Luta","descricao":"","atributo":"forca","nivel":3}}],
            "vantagens":[],"desvantagens":[],
            "forma_base":{{"imagem_data":"{PNG_1X1}","imagem_formato":"png"}},
            "transformacoes":[{{"nome":"Gear 2","descricao":"","modificadores":{{"agilidade":3,"forca":2}},
            "habilidades_especiais":["Jet"],"imagem_data":"","imagem_formato":""}}]}}}}"#
        );
        let npc = "{}";

        let (nj, nn) = importar_jogadores_npcs(&conn, &tmp, &jog, npc).unwrap();
        assert_eq!((nj, nn), (1, 0));

        let contar = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(contar("SELECT count(*) FROM personagem WHERE tipo='jogador'"), 1);
        assert_eq!(contar("SELECT count(*) FROM habilidade"), 1);
        assert_eq!(contar("SELECT count(*) FROM personagem_pericia"), 1);
        assert_eq!(contar("SELECT count(*) FROM transformacao"), 1);
        assert_eq!(contar("SELECT count(*) FROM transformacao_modificador"), 2);
        assert_eq!(contar("SELECT count(*) FROM transformacao_habilidade"), 1);
        assert_eq!(contar("SELECT count(*) FROM imagem"), 1);

        // Objeto `status` extraído na habilidade base...
        let hab: (String, String, String) = conn
            .query_row("SELECT tempo,custo,dano FROM habilidade", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(hab, ("1".into(), "-45 de SP".into(), "150".into()));
        // ...e habilidade especial em string vira campos vazios (fallback defensivo).
        let esp: (String, String, String) = conn
            .query_row("SELECT tempo,custo,dano FROM transformacao_habilidade", [], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?))
            })
            .unwrap();
        assert_eq!(esp, (String::new(), String::new(), String::new()));

        let caminho: String = conn
            .query_row("SELECT caminho FROM imagem", [], |r| r.get(0))
            .unwrap();
        assert!(tmp.join(caminho).exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn importa_catalogos_ok() {
        let conn = open_in_memory().unwrap();
        importar_catalogos(
            &conn,
            r#"{"pericias":[{"nome":"Furtividade","descricao":"d","atributo":"agilidade"}]}"#,
            r#"{"vantagens":[{"nome":"Sortudo","descricao":"d","efeito":"e"}]}"#,
            r#"{"desvantagens":[{"nome":"Codigo","descricao":"d","efeito":"e"}]}"#,
        )
        .unwrap();
        let c = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(c("SELECT count(*) FROM catalogo_pericia"), 1);
        assert_eq!(c("SELECT count(*) FROM catalogo_vantagem"), 1);
        assert_eq!(c("SELECT count(*) FROM catalogo_desvantagem"), 1);
    }

    #[test]
    fn importar_v1_completo_e_idempotente() {
        let conn = open_in_memory().unwrap();
        let tmp = std::env::temp_dir().join("rpgv2_test_idem");
        let _ = std::fs::remove_dir_all(&tmp);
        let jog = format!(
            r#"{{"Luffy":{{"nome":"Luffy","forca":9,"forma_base":{{"imagem_data":"{PNG_1X1}","imagem_formato":"png"}}}},"Zoro":{{"nome":"Zoro","forca":8}}}}"#
        );
        let npc = r#"{"Marine":{"nome":"Marine","forca":3}}"#;
        let per = r#"{"pericias":[{"nome":"Luta","descricao":"","atributo":"forca"}]}"#;
        let van = r#"{"vantagens":[]}"#;
        let des = r#"{"desvantagens":[]}"#;

        let a = importar_v1_completo(&conn, &tmp, &jog, npc, per, van, des).unwrap();
        assert_eq!(a, (2, 1)); // 2 jogadores, 1 npc

        // segunda chamada NÃO duplica
        let b = importar_v1_completo(&conn, &tmp, &jog, npc, per, van, des).unwrap();
        assert_eq!(b, (2, 1));

        let total: i64 = conn.query_row("SELECT count(*) FROM personagem", [], |r| r.get(0)).unwrap();
        assert_eq!(total, 3); // ainda 3, não 6
        let cat: i64 = conn.query_row("SELECT count(*) FROM catalogo_pericia", [], |r| r.get(0)).unwrap();
        assert_eq!(cat, 1); // catálogo também não duplicou
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
