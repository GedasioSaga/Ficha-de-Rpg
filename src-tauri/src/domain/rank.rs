//! Cálculo de rank (0..=13) por atributo.
//!
//! Portado VERBATIM do v1 `Projeto Rpg/src/utils/rank_calculator.py`, que expõe
//! uma função por atributo (`calcular_rank_forca`, `calcular_rank_agilidade`, …)
//! retornando uma string `"Rank N"`. Cada atributo tem sua própria tabela de
//! thresholds não-linear — não há tabela default. Aqui devolvemos o número N.

/// Rank do `atributo` para o `valor` informado, no intervalo 0..=13.
///
/// `atributo` deve ser um dos 8 nomes de coluna do personagem (`forca`,
/// `agilidade`, `percepcao`, `resistencia`, `intuicao`, `espirito`, `carisma`,
/// `determinacao`). Nome desconhecido devolve 0 (rede de segurança; o Python
/// original não tem esse caso pois expõe uma função nomeada por atributo).
pub fn calcular_rank(atributo: &str, valor: i64) -> u8 {
    match atributo {
        "forca" => rank_forca(valor),
        "agilidade" => rank_agilidade(valor),
        "percepcao" => rank_percepcao(valor),
        "resistencia" => rank_resistencia(valor),
        "intuicao" => rank_intuicao(valor),
        "espirito" => rank_espirito(valor),
        "carisma" => rank_carisma(valor),
        "determinacao" => rank_determinacao(valor),
        _ => 0,
    }
}

/// Modificador de teste de atributo a partir do rank (0..=13).
///
/// Testes de atributo no B1 são `1d20 + rank_para_modificador(rank)`. A regra é
/// `rank / 2` uniforme (decisão 3 do spec): bate exato com a prosa do v1 em
/// R1..R10 e cobre R0 e R11..R13 (que a prosa nunca definiu) sem caso especial.
/// R0=0, R10=+5, R11=+5, R12=+6, R13=+6.
// Consumida em combate pela UI/comandos do B2; por ora só pelos testes.
#[allow(dead_code)]
pub fn rank_para_modificador(rank: u8) -> i8 {
    (rank / 2) as i8
}

fn rank_forca(valor: i64) -> u8 {
    if valor < 40 {
        1
    } else if valor < 90 {
        2
    } else if valor < 150 {
        3
    } else if valor < 320 {
        4
    } else if valor < 510 {
        5
    } else if valor < 765 {
        6
    } else if valor < 1725 {
        7
    } else if valor < 2200 {
        8
    } else if valor < 2700 {
        9
    } else {
        10
    }
}

fn rank_agilidade(valor: i64) -> u8 {
    if valor < 33 {
        1
    } else if valor < 60 {
        2
    } else if valor < 90 {
        3
    } else if valor < 140 {
        4
    } else if valor < 210 {
        5
    } else if valor < 315 {
        6
    } else if valor < 400 {
        7
    } else if valor < 600 {
        8
    } else if valor < 950 {
        9
    } else {
        10
    }
}

fn rank_percepcao(valor: i64) -> u8 {
    if valor < 30 {
        1
    } else if valor < 80 {
        2
    } else if valor < 130 {
        3
    } else if valor < 220 {
        4
    } else if valor < 330 {
        5
    } else if valor < 500 {
        6
    } else if valor < 750 {
        7
    } else if valor < 1125 {
        8
    } else if valor < 1500 {
        9
    } else {
        10
    }
}

fn rank_resistencia(valor: i64) -> u8 {
    if valor < 1 {
        0
    } else if valor < 40 {
        1
    } else if valor < 140 {
        2
    } else if valor < 240 {
        3
    } else if valor < 480 {
        4
    } else if valor < 720 {
        5
    } else if valor < 1620 {
        6
    } else if valor < 2430 {
        7
    } else if valor < 5500 {
        8
    } else if valor < 8250 {
        9
    } else {
        10
    }
}

fn rank_intuicao(valor: i64) -> u8 {
    if valor < 30 {
        1
    } else if valor < 80 {
        2
    } else if valor < 150 {
        3
    } else if valor < 240 {
        4
    } else if valor < 275 {
        5
    } else if valor < 360 {
        6
    } else if valor < 540 {
        7
    } else if valor < 810 {
        8
    } else if valor < 1215 {
        9
    } else {
        10
    }
}

fn rank_espirito(valor: i64) -> u8 {
    if valor < 1 {
        0
    } else if valor < 35 {
        1
    } else if valor < 75 {
        2
    } else if valor < 115 {
        3
    } else if valor < 140 {
        4
    } else if valor < 210 {
        5
    } else if valor < 315 {
        6
    } else if valor < 472 {
        7
    } else if valor < 700 {
        8
    } else if valor < 1060 {
        9
    } else if valor < 1590 {
        10
    } else if valor < 2385 {
        11
    } else if valor < 2500 {
        12
    } else {
        13
    }
}

fn rank_carisma(valor: i64) -> u8 {
    if valor < 20 {
        1
    } else if valor < 55 {
        2
    } else if valor < 100 {
        3
    } else if valor < 150 {
        4
    } else if valor < 200 {
        5
    } else if valor < 240 {
        6
    } else if valor < 315 {
        7
    } else if valor < 472 {
        8
    } else if valor < 700 {
        9
    } else {
        10
    }
}

fn rank_determinacao(valor: i64) -> u8 {
    if valor < 16 {
        1
    } else if valor < 40 {
        2
    } else if valor < 80 {
        3
    } else if valor < 130 {
        4
    } else if valor < 175 {
        5
    } else if valor < 195 {
        6
    } else if valor < 295 {
        7
    } else if valor < 440 {
        8
    } else if valor < 660 {
        9
    } else if valor < 1590 {
        10
    } else if valor < 2385 {
        11
    } else if valor < 2500 {
        12
    } else {
        13
    }
}

#[cfg(test)]
mod tests {
    use super::{calcular_rank, rank_para_modificador};

    // Todos os casos são derivados DIRETO das tabelas do Python original
    // (Projeto Rpg/src/utils/rank_calculator.py), testando o valor logo abaixo
    // e logo acima de um threshold.

    #[test]
    fn rank_para_modificador_tabela_completa() {
        // `rank / 2` uniforme (decisão 3 do spec da batalha): R0..R13.
        let esperado = [0i8, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6];
        for (rank, &modif) in esperado.iter().enumerate() {
            assert_eq!(rank_para_modificador(rank as u8), modif, "rank {}", rank);
        }
    }

    #[test]
    fn forca_no_primeiro_threshold() {
        // py linhas 3-6: valor < 40 -> "Rank 1"; valor < 90 -> "Rank 2"
        assert_eq!(calcular_rank("forca", 39), 1);
        assert_eq!(calcular_rank("forca", 40), 2);
    }

    #[test]
    fn resistencia_tem_rank_zero() {
        // py linhas 72-75: valor < 1 -> "Rank 0"; valor < 40 -> "Rank 1"
        assert_eq!(calcular_rank("resistencia", 0), 0);
        assert_eq!(calcular_rank("resistencia", 1), 1);
    }

    #[test]
    fn agilidade_satura_no_rank_10() {
        // py linhas 42-45: valor < 950 -> "Rank 9"; else -> "Rank 10"
        assert_eq!(calcular_rank("agilidade", 949), 9);
        assert_eq!(calcular_rank("agilidade", 950), 10);
    }

    #[test]
    fn espirito_vai_ate_rank_13() {
        // py linhas 144-147: valor < 2500 -> "Rank 12"; else -> "Rank 13"
        assert_eq!(calcular_rank("espirito", 2499), 12);
        assert_eq!(calcular_rank("espirito", 2500), 13);
    }

    #[test]
    fn determinacao_no_primeiro_threshold() {
        // py linhas 174-177: valor < 16 -> "Rank 1"; valor < 40 -> "Rank 2"
        assert_eq!(calcular_rank("determinacao", 15), 1);
        assert_eq!(calcular_rank("determinacao", 16), 2);
    }

    #[test]
    fn atributo_desconhecido_e_zero() {
        // Rede de segurança: nome fora dos 8 conhecidos -> 0.
        assert_eq!(calcular_rank("inexistente", 999), 0);
    }
}
