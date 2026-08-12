//! Export/import de fichas em JSON autocontido (retrato embutido em base64).
//!
//! O arquivo é sempre um ARRAY, mesmo com uma ficha só — assim o import não
//! precisa saber se veio de "exportar uma" ou "exportar todas".
//!
//! Import nunca sobrescreve: ficha com nome já usado entra como `Nome (2)`.
//! Perder uma duplicata é barato; perder a ficha editada não é.

use crate::db::error::AppError;
use crate::db::repositorios;
use crate::domain::modelos::{
    FichaExportada, HabilidadeInput, ModificadorInput, PericiaInput, PersonagemCompleto,
    PersonagemInput, RetratoExportado, RetratoInput, TracoInput, TransformacaoExportada,
    TransformacaoInput, VERSAO_FICHA,
};
use base64::prelude::{Engine as _, BASE64_STANDARD};
use rusqlite::{Connection, OptionalExtension};
use std::path::Path;

/* --------------------------------- Export --------------------------------- */

/// Lê a imagem de `images_dir` e embute como base64. Imagem sumida do disco
/// não derruba o export — a ficha sai sem retrato.
fn embutir_retrato(images_dir: &Path, caminho: &Option<String>) -> Option<RetratoExportado> {
    let nome_arq = caminho.as_ref()?;
    let bytes = std::fs::read(images_dir.join(nome_arq)).ok()?;
    let formato = Path::new(nome_arq)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_string();
    Some(RetratoExportado {
        base64: BASE64_STANDARD.encode(&bytes),
        formato,
    })
}

fn atributo(p: &PersonagemCompleto, nome: &str) -> i64 {
    p.atributos
        .iter()
        .find(|a| a.nome == nome)
        .map(|a| a.valor)
        .unwrap_or(0)
}

fn para_exportada(p: PersonagemCompleto, images_dir: &Path) -> FichaExportada {
    FichaExportada {
        versao: VERSAO_FICHA,
        tipo: p.tipo.clone(),
        nome: p.nome.clone(),
        descricao: p.descricao.clone(),
        hp: p.hp,
        sp: p.sp,
        escudo: p.escudo,
        forca: atributo(&p, "forca"),
        agilidade: atributo(&p, "agilidade"),
        percepcao: atributo(&p, "percepcao"),
        resistencia: atributo(&p, "resistencia"),
        intuicao: atributo(&p, "intuicao"),
        espirito: atributo(&p, "espirito"),
        carisma: atributo(&p, "carisma"),
        determinacao: atributo(&p, "determinacao"),
        raca: p.raca.clone(),
        oficio: p.oficio.clone(),
        retrato: embutir_retrato(images_dir, &p.retrato),
        habilidades: p.habilidades,
        pericias: p.pericias,
        vantagens: p.vantagens,
        desvantagens: p.desvantagens,
        transformacoes: p
            .transformacoes
            .into_iter()
            .map(|t| TransformacaoExportada {
                nome: t.nome,
                descricao: t.descricao,
                retrato: embutir_retrato(images_dir, &t.retrato),
                modificadores: t.modificadores,
                habilidades: t.habilidades,
            })
            .collect(),
        etiquetas: p.etiquetas,
    }
}

/// Serializa as fichas pedidas como JSON (array), pronto pra gravar em disco.
pub fn exportar(
    conn: &Connection,
    images_dir: &Path,
    ids: &[i64],
) -> Result<String, AppError> {
    let mut fichas = Vec::with_capacity(ids.len());
    for &id in ids {
        fichas.push(para_exportada(repositorios::get_personagem(conn, id)?, images_dir));
    }
    serde_json::to_string_pretty(&fichas).map_err(|e| AppError::Msg(e.to_string()))
}

/* --------------------------------- Import --------------------------------- */

fn retrato_para_input(r: Option<RetratoExportado>) -> RetratoInput {
    match r {
        Some(img) => RetratoInput::Novo {
            base64: img.base64,
            formato: img.formato,
        },
        None => RetratoInput::Nenhum,
    }
}

/// Nome livre pro import: `Smoker` ocupado vira `Smoker (2)`, depois `(3)`…
/// Colisão é por (nome, tipo) — um NPC "Smoker" não briga com o jogador "Smoker".
fn nome_livre(conn: &Connection, nome: &str, tipo: &str) -> Result<String, AppError> {
    let existe = |candidato: &str| -> Result<bool, AppError> {
        Ok(conn
            .query_row(
                "SELECT 1 FROM personagem WHERE nome = ?1 AND tipo = ?2",
                rusqlite::params![candidato, tipo],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    };
    if !existe(nome)? {
        return Ok(nome.to_string());
    }
    // Teto pra não girar pra sempre num banco corrompido; 999 cópias do mesmo
    // nome é problema de outra natureza.
    for n in 2..1000 {
        let candidato = format!("{nome} ({n})");
        if !existe(&candidato)? {
            return Ok(candidato);
        }
    }
    Err(AppError::Msg(format!("nomes esgotados para \"{nome}\"")))
}

fn para_input(f: FichaExportada, nome: String) -> PersonagemInput {
    PersonagemInput {
        tipo: f.tipo,
        nome,
        descricao: f.descricao,
        hp: f.hp,
        sp: f.sp,
        escudo: f.escudo,
        forca: f.forca,
        agilidade: f.agilidade,
        percepcao: f.percepcao,
        resistencia: f.resistencia,
        intuicao: f.intuicao,
        espirito: f.espirito,
        carisma: f.carisma,
        determinacao: f.determinacao,
        raca: f.raca,
        oficio: f.oficio,
        retrato: retrato_para_input(f.retrato),
        habilidades: f
            .habilidades
            .into_iter()
            .map(|h| HabilidadeInput {
                nome: h.nome,
                descricao: h.descricao,
                acao: h.acao,
                efeito: h.efeito,
                tempo: h.tempo,
                custo: h.custo,
                dano: h.dano,
                campos_extras: h.campos_extras,
            })
            .collect(),
        pericias: f
            .pericias
            .into_iter()
            .map(|p| PericiaInput {
                nome: p.nome,
                descricao: p.descricao,
                atributo: p.atributo,
            })
            .collect(),
        vantagens: f
            .vantagens
            .into_iter()
            .map(|t| TracoInput {
                nome: t.nome,
                descricao: t.descricao,
                efeito: t.efeito,
            })
            .collect(),
        desvantagens: f
            .desvantagens
            .into_iter()
            .map(|t| TracoInput {
                nome: t.nome,
                descricao: t.descricao,
                efeito: t.efeito,
            })
            .collect(),
        transformacoes: f
            .transformacoes
            .into_iter()
            .map(|t| TransformacaoInput {
                nome: t.nome,
                descricao: t.descricao,
                retrato: retrato_para_input(t.retrato),
                modificadores: t
                    .modificadores
                    .into_iter()
                    .map(|m| ModificadorInput {
                        atributo: m.atributo,
                        delta: m.delta,
                    })
                    .collect(),
                habilidades: t
                    .habilidades
                    .into_iter()
                    .map(|h| HabilidadeInput {
                        nome: h.nome,
                        descricao: h.descricao,
                        acao: h.acao,
                        efeito: h.efeito,
                        tempo: h.tempo,
                        custo: h.custo,
                        dano: h.dano,
                        campos_extras: h.campos_extras,
                    })
                    .collect(),
            })
            .collect(),
        etiquetas: f.etiquetas,
    }
}

fn validar_ficha(f: &FichaExportada) -> Result<(), AppError> {
    if f.versao != VERSAO_FICHA {
        return Err(AppError::Msg(format!(
            "versão {} não suportada (esperado {VERSAO_FICHA})",
            f.versao
        )));
    }
    if f.nome.trim().is_empty() {
        return Err(AppError::Msg("ficha sem nome".into()));
    }
    if f.tipo != "jogador" && f.tipo != "npc" {
        return Err(AppError::Msg(format!("tipo inválido: {}", f.tipo)));
    }
    Ok(())
}

/// Importa o JSON (array de fichas). Cada ficha é independente: uma recusada
/// não impede as outras — a mensagem volta em `erros` pra UI mostrar.
/// Espera-se estar dentro de uma transação (o comando abre uma).
pub fn importar(
    conn: &Connection,
    images_dir: &Path,
    json: &str,
) -> Result<(usize, Vec<String>), AppError> {
    let fichas: Vec<FichaExportada> = serde_json::from_str(json)
        .map_err(|e| AppError::Msg(format!("arquivo não é um export de fichas válido: {e}")))?;

    let mut importadas = 0usize;
    let mut erros = Vec::new();
    for f in fichas {
        let rotulo = if f.nome.trim().is_empty() {
            "(sem nome)".to_string()
        } else {
            f.nome.clone()
        };
        let resultado = validar_ficha(&f).and_then(|()| {
            let nome = nome_livre(conn, f.nome.trim(), &f.tipo)?;
            repositorios::criar_personagem(conn, images_dir, &para_input(f, nome))
        });
        match resultado {
            Ok(_) => importadas += 1,
            Err(e) => erros.push(format!("{rotulo}: {e}")),
        }
    }
    Ok((importadas, erros))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::connection::open_in_memory;
    use crate::domain::modelos::{CampoExtra, HabilidadeDto, ModificadorDto};

    /// Técnica com um valor DIFERENTE em cada campo: assim uma troca de campo no
    /// mapeamento `HabilidadeDto -> HabilidadeInput` (ex.: `acao: h.efeito`)
    /// compila limpo mas quebra o teste, em vez de passar despercebida.
    fn habilidade_completa(nome: &str) -> HabilidadeDto {
        HabilidadeDto {
            nome: nome.into(),
            descricao: "Corre em linha reta".into(),
            acao: "Acao Completa".into(),
            efeito: "Nenhum".into(),
            tempo: "1".into(),
            custo: "-45 de SP".into(),
            dano: "Forca + Agilidade".into(),
            campos_extras: vec![CampoExtra {
                nome: "Alcance".into(),
                valor: "15m".into(),
            }],
        }
    }

    fn ficha_minima(nome: &str, tipo: &str) -> FichaExportada {
        FichaExportada {
            versao: VERSAO_FICHA,
            tipo: tipo.into(),
            nome: nome.into(),
            descricao: String::new(),
            hp: 10,
            sp: 5,
            escudo: 0,
            forca: 3,
            agilidade: 0,
            percepcao: 0,
            resistencia: 0,
            intuicao: 0,
            espirito: 0,
            carisma: 0,
            determinacao: 0,
            raca: "Mink".into(),
            oficio: "Ferreiro".into(),
            retrato: None,
            habilidades: vec![habilidade_completa("Grande Chifre")],
            pericias: Vec::new(),
            vantagens: Vec::new(),
            desvantagens: Vec::new(),
            transformacoes: vec![TransformacaoExportada {
                nome: "Forma Desperta".into(),
                descricao: String::new(),
                retrato: None,
                modificadores: vec![ModificadorDto {
                    atributo: "forca".into(),
                    delta: 2,
                }],
                habilidades: vec![habilidade_completa("Chifre Duplo")],
            }],
            etiquetas: vec!["Marinha".into()],
        }
    }

    fn json_de(fichas: &[FichaExportada]) -> String {
        serde_json::to_string(fichas).unwrap()
    }

    #[test]
    fn importa_e_exporta_ida_e_volta() {
        let conn = open_in_memory().unwrap();
        let dir = std::env::temp_dir().join("rpg-v2-teste-portabilidade");
        let (n, erros) = importar(&conn, &dir, &json_de(&[ficha_minima("Smoker", "npc")])).unwrap();
        assert_eq!((n, erros.len()), (1, 0));

        let id: i64 = conn
            .query_row("SELECT id FROM personagem WHERE nome='Smoker'", [], |r| r.get(0))
            .unwrap();
        let json = exportar(&conn, &dir, &[id]).unwrap();
        let volta: Vec<FichaExportada> = serde_json::from_str(&json).unwrap();
        assert_eq!(volta.len(), 1);
        assert_eq!(volta[0].nome, "Smoker");
        assert_eq!(volta[0].hp, 10);
        assert_eq!(volta[0].forca, 3);
        assert_eq!(volta[0].raca, "Mink");
        assert_eq!(volta[0].oficio, "Ferreiro");
        assert_eq!(volta[0].etiquetas, vec!["Marinha".to_string()]);

        // Campos da técnica sobrevivem à ida e à volta, um a um (forma base…).
        let h = &volta[0].habilidades[0];
        assert_eq!(h.nome, "Grande Chifre");
        assert_eq!(h.acao, "Acao Completa");
        assert_eq!(h.efeito, "Nenhum");
        assert_eq!(h.tempo, "1");
        assert_eq!(h.custo, "-45 de SP");
        assert_eq!(h.dano, "Forca + Agilidade");
        assert_eq!(
            h.campos_extras,
            vec![CampoExtra {
                nome: "Alcance".into(),
                valor: "15m".into()
            }]
        );

        // …e dentro da transformação, que é um mapeamento separado.
        let ht = &volta[0].transformacoes[0].habilidades[0];
        assert_eq!(ht.nome, "Chifre Duplo");
        assert_eq!(ht.acao, "Acao Completa");
        assert_eq!(ht.efeito, "Nenhum");
        assert_eq!(ht.custo, "-45 de SP");
        assert_eq!(ht.dano, "Forca + Agilidade");
        assert_eq!(
            ht.campos_extras,
            vec![CampoExtra {
                nome: "Alcance".into(),
                valor: "15m".into()
            }]
        );
    }

    #[test]
    fn nome_repetido_vira_copia_sem_sobrescrever() {
        let conn = open_in_memory().unwrap();
        let dir = std::env::temp_dir().join("rpg-v2-teste-portabilidade");
        let ficha = ficha_minima("Smoker", "npc");
        importar(&conn, &dir, &json_de(&[ficha.clone()])).unwrap();
        importar(&conn, &dir, &json_de(&[ficha.clone()])).unwrap();
        importar(&conn, &dir, &json_de(&[ficha])).unwrap();

        let nomes: Vec<String> = conn
            .prepare("SELECT nome FROM personagem ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(nomes, vec!["Smoker", "Smoker (2)", "Smoker (3)"]);
    }

    #[test]
    fn jogador_importado_nao_recebe_etiqueta() {
        let conn = open_in_memory().unwrap();
        let dir = std::env::temp_dir().join("rpg-v2-teste-portabilidade");
        importar(&conn, &dir, &json_de(&[ficha_minima("Luffy", "jogador")])).unwrap();
        let id: i64 = conn
            .query_row("SELECT id FROM personagem WHERE nome='Luffy'", [], |r| r.get(0))
            .unwrap();
        assert!(repositorios::etiquetas_do_personagem(&conn, id).unwrap().is_empty());
    }

    #[test]
    fn ficha_invalida_nao_derruba_o_lote() {
        let conn = open_in_memory().unwrap();
        let dir = std::env::temp_dir().join("rpg-v2-teste-portabilidade");
        let mut ruim = ficha_minima("Zumbi", "npc");
        ruim.versao = 99;
        let boa = ficha_minima("Tashigi", "npc");
        let (n, erros) = importar(&conn, &dir, &json_de(&[ruim, boa])).unwrap();
        assert_eq!(n, 1);
        assert_eq!(erros.len(), 1);
        assert!(erros[0].starts_with("Zumbi: "), "erro nomeia a ficha: {}", erros[0]);
    }
}
