//! Perícia pode responder a mais de um atributo ("Força e/ou Percepção"), e o
//! Compêndio foi populado por extração via IA a partir das notas do Discord —
//! o texto que chegou em `atributo` é humano ("(Percepção/Intuição)", "..."),
//! não o slug que o <select> do formulário conhece. Este módulo é a única
//! porta de entrada desse texto: today a migration 0013 normaliza o que já
//! está no banco, mas um novo sync (ou uma edição manual do Compêndio) pode
//! trazer lixo de novo, e o parser tem que aguentar sem propagar pra ficha.

/// Slugs canônicos de atributo, na ordem fixa da ficha (ver `atributos.ts` do
/// frontend). A ordem aqui também é a ordem de saída de [`parse_atributos`].
pub const ATRIBUTOS: [&str; 8] = [
    "forca",
    "agilidade",
    "percepcao",
    "resistencia",
    "intuicao",
    "espirito",
    "carisma",
    "determinacao",
];

/// Troca só os acentos que aparecem em português nos nomes de atributo —
/// sem dependência nova pra isso (`unicode-normalization` seria overkill
/// pra 12 caracteres fixos).
fn remover_acentos(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' => 'a',
            'é' | 'ê' => 'e',
            'í' => 'i',
            'ó' | 'ô' | 'õ' => 'o',
            'ú' => 'u',
            'ç' => 'c',
            outro => outro,
        })
        .collect()
}

/// Recebe o texto humano das regras (ou já um CSV canônico) e devolve os
/// slugs que casam com [`ATRIBUTOS`], sem repetição e na ordem canônica.
/// Texto que não casa com nenhum atributo conhecido (`"..."`, lixo, vazio)
/// é descartado em silêncio — perícia sem atributo reconhecido fica com
/// lista vazia, não quebra o parse do resto do Compêndio.
pub fn parse_atributos(bruto: &str) -> Vec<String> {
    let normalizado = remover_acentos(&bruto.to_lowercase());
    // Ordem importa: "e/ou" tem que sair antes de " e " genérico, senão o
    // "e" de "e/ou" nunca bate no padrão com espaços dos dois lados.
    let normalizado = normalizado.replace("e/ou", "/");
    let normalizado = normalizado.replace(" e ", "/");
    let normalizado = normalizado.replace(['(', ')'], "");
    let normalizado = normalizado.replace(',', "/");

    let mut presentes = [false; ATRIBUTOS.len()];
    for token in normalizado.split('/') {
        let token = token.trim();
        if let Some(pos) = ATRIBUTOS.iter().position(|&a| a == token) {
            presentes[pos] = true;
        }
    }
    ATRIBUTOS
        .iter()
        .zip(presentes)
        .filter(|(_, presente)| *presente)
        .map(|(&slug, _)| slug.to_string())
        .collect()
}

/// Inverso de [`parse_atributos`] pra persistência: junta os slugs em CSV
/// (o mesmo formato que `catalogo_pericia.atributo` guarda desde a 0013).
pub fn serializar_atributos(lista: &[String]) -> String {
    lista.join(",")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn barra_dentro_de_parenteses() {
        assert_eq!(
            parse_atributos("(Percepção/Intuição)"),
            vec!["percepcao".to_string(), "intuicao".to_string()]
        );
    }

    #[test]
    fn e_ou_com_barra() {
        assert_eq!(
            parse_atributos("Força e/ou Percepção"),
            vec!["forca".to_string(), "percepcao".to_string()]
        );
    }

    #[test]
    fn palavra_e_sem_barra() {
        assert_eq!(
            parse_atributos("Força e Percepção"),
            vec!["forca".to_string(), "percepcao".to_string()]
        );
    }

    #[test]
    fn palavra_minuscula_sem_acento_grafico() {
        assert_eq!(parse_atributos("intuição"), vec!["intuicao".to_string()]);
    }

    #[test]
    fn palavra_capitalizada() {
        assert_eq!(parse_atributos("Intuição"), vec!["intuicao".to_string()]);
    }

    #[test]
    fn palavra_entre_parenteses_sem_barra() {
        assert_eq!(parse_atributos("(Intuição)"), vec!["intuicao".to_string()]);
    }

    #[test]
    fn csv_ja_canonico_passa_igual() {
        assert_eq!(
            parse_atributos("percepcao,intuicao"),
            vec!["percepcao".to_string(), "intuicao".to_string()]
        );
    }

    #[test]
    fn placeholder_vira_lista_vazia() {
        assert_eq!(parse_atributos("..."), Vec::<String>::new());
    }

    #[test]
    fn vazio_vira_lista_vazia() {
        assert_eq!(parse_atributos(""), Vec::<String>::new());
    }

    #[test]
    fn lixo_desconhecido_vira_lista_vazia() {
        assert_eq!(parse_atributos("Sabedoria Arcana"), Vec::<String>::new());
    }

    #[test]
    fn dedup_mantem_ordem_canonica() {
        // "Percepção/Percepção" não deveria acontecer nas regras, mas o
        // parser não pode devolver o slug duas vezes se acontecer.
        assert_eq!(
            parse_atributos("Percepção/Percepção"),
            vec!["percepcao".to_string()]
        );
    }

    #[test]
    fn serializar_junta_com_virgula() {
        assert_eq!(
            serializar_atributos(&["percepcao".to_string(), "intuicao".to_string()]),
            "percepcao,intuicao"
        );
    }

    #[test]
    fn serializar_lista_vazia_vira_string_vazia() {
        assert_eq!(serializar_atributos(&[]), "");
    }
}
