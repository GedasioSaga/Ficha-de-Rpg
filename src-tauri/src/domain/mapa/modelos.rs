use serde::{Deserialize, Serialize};

pub const CELULA_VAZIA: char = '-';
pub const COLUNAS_MIN: u8 = 6;
pub const COLUNAS_MAX: u8 = 26;
pub const LINHAS_MIN: u8 = 3;
pub const LINHAS_MAX: u8 = 50;
/// Consumida por `excede_discord` (guard de tamanho ao postar/atualizar no Discord).
pub const LIMITE_DISCORD: usize = 2000;

/// Mapa completo (grade já normalizada: `linhas` strings de `colunas` chars).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mapa {
    pub id: i64,
    pub titulo: String,
    pub colunas: u8,
    pub linhas: u8,
    pub grade: Vec<String>,
    pub legenda: String,
    pub efeito: String,
    pub criado_em: String,
    pub atualizado_em: String,
}

/// Resumo pra lista lateral (sem a grade).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapaResumo {
    pub id: i64,
    pub titulo: String,
    pub atualizado_em: String,
}

/// Entrada de criação/atualização vinda da UI.
#[derive(Debug, Clone, Deserialize)]
pub struct MapaInput {
    pub titulo: String,
    pub colunas: u8,
    pub linhas: u8,
    pub grade: Vec<String>,
    pub legenda: String,
    pub efeito: String,
}

/// Força a grade ao formato exato: `linhas` strings de `colunas` chars.
/// Célula ausente → CELULA_VAZIA; whitespace/controle numa célula → CELULA_VAZIA.
/// Dimensões são clampadas nos limites.
pub fn normalizar_grade(grade: &[String], colunas: u8, linhas: u8) -> Vec<String> {
    let colunas = colunas.clamp(COLUNAS_MIN, COLUNAS_MAX);
    let linhas = linhas.clamp(LINHAS_MIN, LINHAS_MAX);
    let mut out = Vec::with_capacity(linhas as usize);
    for i in 0..linhas as usize {
        let origem = grade.get(i).map(String::as_str).unwrap_or("");
        let mut chars = origem.chars();
        let mut linha = String::with_capacity(colunas as usize);
        for _ in 0..colunas {
            let c = match chars.next() {
                Some(c) if !c.is_control() && !c.is_whitespace() => c,
                _ => CELULA_VAZIA,
            };
            linha.push(c);
        }
        out.push(linha);
    }
    out
}

/// Normaliza um input inteiro (dimensões clampadas + grade no formato exato).
pub fn normalizar(mut input: MapaInput) -> MapaInput {
    let colunas = input.colunas.clamp(COLUNAS_MIN, COLUNAS_MAX);
    let linhas = input.linhas.clamp(LINHAS_MIN, LINHAS_MAX);
    input.grade = normalizar_grade(&input.grade, colunas, linhas);
    input.colunas = colunas;
    input.linhas = linhas;
    input
}

#[cfg(test)]
mod tests {
    use super::*;

    fn inp(colunas: u8, linhas: u8, grade: &[&str]) -> MapaInput {
        MapaInput {
            titulo: String::new(),
            colunas,
            linhas,
            grade: grade.iter().map(|s| s.to_string()).collect(),
            legenda: String::new(),
            efeito: String::new(),
        }
    }

    #[test]
    fn normaliza_pad_e_crop() {
        let n = normalizar(inp(6, 3, &["XX", "XXXXXXXX"]));
        assert_eq!(n.grade.len(), 3);
        assert_eq!(n.grade[0], "XX----"); // pad até 6
        assert_eq!(n.grade[1], "XXXXXX"); // crop pra 6
        assert_eq!(n.grade[2], "------"); // linha nova
    }

    #[test]
    fn normaliza_clampa_dimensoes() {
        let n = normalizar(inp(100, 1, &[]));
        assert_eq!(n.colunas, 26);
        assert_eq!(n.linhas, 3);
        assert_eq!(n.grade.len(), 3);
        assert_eq!(n.grade[0].chars().count(), 26);
        let n2 = normalizar(inp(2, 99, &[]));
        assert_eq!(n2.colunas, 6);
        assert_eq!(n2.linhas, 50);
    }

    #[test]
    fn normaliza_whitespace_vira_vazio() {
        // colunas=3 violaria COLUNAS_MIN (6); usamos o mínimo válido para não
        // acionar o clamp e confundir com o teste de `normaliza_clampa_dimensoes`.
        let n = normalizar(inp(6, 3, &["X X"]));
        assert_eq!(n.grade[0], "X-X---"); // o espaço do meio vira '-', resto padda
    }
}
