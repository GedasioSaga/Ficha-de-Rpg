//! Funções de regra puras do motor assistido. Sem estado, sem I/O — o mestre chama,
//! o motor faz a conta, e o mestre pode sobrepor o resultado (override sempre).

use serde::{Deserialize, Serialize};

use super::dado::Dado;

/// Rola 1d20 (`1..=20`).
pub fn rolar_d20(dado: &mut dyn Dado) -> u8 {
    dado.d20()
}

/// Tipo de reação do defensor (que rola 1d20 SEM modificador).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TipoReacao {
    Defender,
    Esquiva,
    ContraAtaque,
}

/// Resultado de uma reação: multiplicador aplicado ao dano recebido + se revida.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ResultadoReacao {
    pub multiplicador: f64,
    pub contra_ataque: bool,
}

/// Resolve a reação do defensor a partir do 1d20 rolado.
///
/// - `Defender`  d20 >= 10 → recebe metade do dano (0.5)
/// - `Esquiva`   d20 >= 15 → recebe zero (0.0)
/// - `ContraAtaque` d20 >= 20 → recebe zero e revida
/// - abaixo do limite em qualquer caso → dano cheio (1.0)
pub fn resolver_reacao(tipo: TipoReacao, d20: u8) -> ResultadoReacao {
    match tipo {
        TipoReacao::Defender if d20 >= 10 => ResultadoReacao {
            multiplicador: 0.5,
            contra_ataque: false,
        },
        TipoReacao::Esquiva if d20 >= 15 => ResultadoReacao {
            multiplicador: 0.0,
            contra_ataque: false,
        },
        TipoReacao::ContraAtaque if d20 >= 20 => ResultadoReacao {
            multiplicador: 0.0,
            contra_ataque: true,
        },
        _ => ResultadoReacao {
            multiplicador: 1.0,
            contra_ataque: false,
        },
    }
}

/// Entrada do cálculo de dano. `base` já vem composto pelo mestre (arma/força/raça
/// embutidos); o motor só aplica o universal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct EntradaDano {
    pub base: i64,
    pub critico: bool,
    pub reducao_percent: Option<u8>,
    pub dano_verdadeiro: bool,
}

/// Resultado do cálculo: valor final + memória (passo-a-passo para log/UI).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ResultadoDano {
    pub valor: i64,
    pub memoria: String,
}

/// Pipeline universal de dano (ordem exata, sem ambiguidade):
/// `base` → crítico ×1.5 → redução % (salvo dano verdadeiro) → piso 0.
pub fn calcular_dano(e: &EntradaDano) -> ResultadoDano {
    let mut dano = e.base;
    let mut memoria = format!("base={}", e.base);

    if e.critico {
        dano = (dano as f64 * 1.5).round() as i64;
        memoria.push_str(&format!(" | crítico x1.5 -> {}", dano));
    }

    if e.dano_verdadeiro {
        if e.reducao_percent.is_some() {
            memoria.push_str(" | dano verdadeiro (ignora redução)");
        }
    } else if let Some(r) = e.reducao_percent {
        dano = (dano as f64 * (1.0 - r as f64 / 100.0)).round() as i64;
        memoria.push_str(&format!(" | redução {}% -> {}", r, dano));
    }

    if dano < 0 {
        dano = 0;
        memoria.push_str(" | piso 0");
    }

    ResultadoDano { valor: dano, memoria }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defender_no_limite() {
        assert_eq!(resolver_reacao(TipoReacao::Defender, 9).multiplicador, 1.0);
        assert_eq!(resolver_reacao(TipoReacao::Defender, 10).multiplicador, 0.5);
    }

    #[test]
    fn esquiva_no_limite() {
        assert_eq!(resolver_reacao(TipoReacao::Esquiva, 14).multiplicador, 1.0);
        assert_eq!(resolver_reacao(TipoReacao::Esquiva, 15).multiplicador, 0.0);
    }

    #[test]
    fn contra_ataque_no_limite() {
        let abaixo = resolver_reacao(TipoReacao::ContraAtaque, 19);
        assert_eq!(abaixo.multiplicador, 1.0);
        assert!(!abaixo.contra_ataque);
        let acerto = resolver_reacao(TipoReacao::ContraAtaque, 20);
        assert_eq!(acerto.multiplicador, 0.0);
        assert!(acerto.contra_ataque);
    }

    fn entrada(base: i64, critico: bool, reducao: Option<u8>, verdadeiro: bool) -> EntradaDano {
        EntradaDano {
            base,
            critico,
            reducao_percent: reducao,
            dano_verdadeiro: verdadeiro,
        }
    }

    #[test]
    fn dano_base_puro() {
        assert_eq!(calcular_dano(&entrada(100, false, None, false)).valor, 100);
    }

    #[test]
    fn dano_critico_1_5x() {
        assert_eq!(calcular_dano(&entrada(100, true, None, false)).valor, 150);
        // arredondamento: 101 * 1.5 = 151.5 -> 152
        assert_eq!(calcular_dano(&entrada(101, true, None, false)).valor, 152);
    }

    #[test]
    fn dano_com_reducao() {
        // 100 * (1 - 0.30) = 70
        assert_eq!(calcular_dano(&entrada(100, false, Some(30), false)).valor, 70);
    }

    #[test]
    fn dano_verdadeiro_ignora_reducao() {
        assert_eq!(calcular_dano(&entrada(100, false, Some(30), true)).valor, 100);
    }

    #[test]
    fn dano_critico_e_reducao_combinados() {
        // 100 -> crit 150 -> redução 40% -> 90
        assert_eq!(calcular_dano(&entrada(100, true, Some(40), false)).valor, 90);
    }

    #[test]
    fn dano_piso_zero() {
        assert_eq!(calcular_dano(&entrada(-50, false, None, false)).valor, 0);
    }
}
