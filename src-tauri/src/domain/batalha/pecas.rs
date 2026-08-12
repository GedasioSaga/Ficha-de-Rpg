//! Peças no mapa (Fase 5) — posicionamento puro dos combatentes no grid do
//! mapa ativo. Sem I/O nem DB: as dimensões do grid vêm de fora (o mapa vive
//! no banco), o chamador carrega o mapa e passa `(grid_linhas, grid_colunas)`.
//!
//! Convenção: `(linha, coluna)` 0-indexado, casando com o índice da grade em
//! [`crate::domain::mapa`]. Regra dura: **1 peça por célula**.

use super::modelos::{Combatente, CombatenteId};
use super::Estado;
use crate::domain::mapa::PecaRender;

/// Coloca a peça `id` em `(linha, coluna)`, clampando ao grid e recusando célula
/// já ocupada por OUTRA peça. Serve tanto o drag inicial quanto o mover (mover
/// pra própria célula passa, porque a checagem exclui a própria peça).
/// Retorna `true` se posicionou, `false` se rejeitou (célula ocupada, grid
/// degenerado, ou `id` inexistente).
pub fn colocar_peca(
    combatentes: &mut [Combatente],
    id: CombatenteId,
    linha: u16,
    coluna: u16,
    grid_linhas: u16,
    grid_colunas: u16,
) -> bool {
    // grid sem célula válida → não há onde colocar.
    if grid_linhas == 0 || grid_colunas == 0 {
        return false;
    }
    if !combatentes.iter().any(|c| c.id == id) {
        return false;
    }
    let alvo = (linha.min(grid_linhas - 1), coluna.min(grid_colunas - 1));
    // 1 peça/célula: rejeita se OUTRA peça já ocupa a célula clampada.
    if combatentes.iter().any(|c| c.id != id && c.posicao == Some(alvo)) {
        return false;
    }
    if let Some(c) = combatentes.iter_mut().find(|c| c.id == id) {
        c.posicao = Some(alvo);
    }
    true
}

/// Tira a peça `id` do mapa (`posicao = None`). Retorna `true` se ela estava no
/// mapa, `false` se já estava fora ou o `id` não existe.
pub fn remover_peca(combatentes: &mut [Combatente], id: CombatenteId) -> bool {
    match combatentes.iter_mut().find(|c| c.id == id) {
        Some(c) => c.posicao.take().is_some(),
        None => false,
    }
}

/// Glifo da peça a partir da posição na ordem de turno (0-indexada):
/// `0→'1'`, `8→'9'`, `9→'A'`, `25→'Z'`. Acima de 35 peças (fora do razoável)
/// cai num marcador genérico `'#'`.
pub fn glifo(indice_na_ordem: usize) -> char {
    let numero = indice_na_ordem + 1;
    match numero {
        1..=9 => (b'0' + numero as u8) as char,
        10..=35 => (b'A' + (numero - 10) as u8) as char,
        _ => '#',
    }
}

/// Lista as peças de cada combatente que está posicionado no mapa, prontas
/// pra render (glifo, nome, se é a vez dele). O glifo é o número da ordem de
/// turno (índice do id em `estado.ordem` + 1). Consumida pelos chamadores de
/// `render_discord` (lib.rs e sync do Discord).
pub fn pecas_para_render(estado: &Estado) -> Vec<PecaRender> {
    let turno_atual = super::dono_do_turno_de(estado);
    estado
        .combatentes
        .iter()
        .filter_map(|c| {
            let (linha, coluna) = c.posicao?;
            let indice = estado.ordem.iter().position(|oid| *oid == c.id)?;
            Some(PecaRender {
                linha,
                coluna,
                glifo: glifo(indice),
                nome: c.nome.clone(),
                eh_turno: Some(c.id) == turno_atual,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::modelos::{Pools, Tipo};

    fn comb(id: CombatenteId, posicao: Option<(u16, u16)>) -> Combatente {
        Combatente {
            id,
            personagem_ref: None,
            nome: format!("C{id}"),
            tipo: Tipo::Npc,
            faccao: None,
            base: [0; 8],
            pools: Pools { hp: 10, sp: 0, escudo: 0 },
            modificadores: Vec::new(),
            cooldowns: Vec::new(),
            efeitos_recorrentes: Vec::new(),
            turnos_extras: 0,
            posicao,
            concentracao: 0,
        }
    }

    #[test]
    fn colocar_em_celula_livre() {
        let mut cs = vec![comb(1, None)];
        assert!(colocar_peca(&mut cs, 1, 2, 3, 10, 10));
        assert_eq!(cs[0].posicao, Some((2, 3)));
    }

    #[test]
    fn clamp_fora_do_grid() {
        let mut cs = vec![comb(1, None)];
        // grid 5x8 → índices válidos 0..=4 (linha) e 0..=7 (coluna).
        assert!(colocar_peca(&mut cs, 1, 99, 99, 5, 8));
        assert_eq!(cs[0].posicao, Some((4, 7)));
    }

    #[test]
    fn celula_ocupada_por_outra_peca_rejeita() {
        let mut cs = vec![comb(1, Some((2, 2))), comb(2, None)];
        // 2 tenta ocupar a célula de 1 → rejeita, sem mexer em nada.
        assert!(!colocar_peca(&mut cs, 2, 2, 2, 10, 10));
        assert_eq!(cs[1].posicao, None);
        assert_eq!(cs[0].posicao, Some((2, 2)));
    }

    #[test]
    fn celula_ocupada_apos_clamp_rejeita() {
        let mut cs = vec![comb(1, Some((4, 7))), comb(2, None)];
        // 2 mira fora do grid; clampa pra (4,7) que é de 1 → rejeita.
        assert!(!colocar_peca(&mut cs, 2, 50, 50, 5, 8));
        assert_eq!(cs[1].posicao, None);
    }

    #[test]
    fn mover_pra_mesma_celula_e_noop_bem_sucedido() {
        let mut cs = vec![comb(1, Some((3, 3)))];
        // a própria peça "ocupa" a célula, mas a checagem exclui ela mesma.
        assert!(colocar_peca(&mut cs, 1, 3, 3, 10, 10));
        assert_eq!(cs[0].posicao, Some((3, 3)));
    }

    #[test]
    fn colocar_id_inexistente_falha() {
        let mut cs = vec![comb(1, None)];
        assert!(!colocar_peca(&mut cs, 99, 0, 0, 10, 10));
    }

    #[test]
    fn grid_degenerado_falha() {
        let mut cs = vec![comb(1, None)];
        assert!(!colocar_peca(&mut cs, 1, 0, 0, 0, 10));
        assert!(!colocar_peca(&mut cs, 1, 0, 0, 10, 0));
        assert_eq!(cs[0].posicao, None);
    }

    #[test]
    fn remover_peca_do_mapa() {
        let mut cs = vec![comb(1, Some((1, 1)))];
        assert!(remover_peca(&mut cs, 1));
        assert_eq!(cs[0].posicao, None);
        // remover de novo (já fora) → false.
        assert!(!remover_peca(&mut cs, 1));
        // id inexistente → false.
        assert!(!remover_peca(&mut cs, 42));
    }

    #[test]
    fn glifo_digitos_e_letras() {
        assert_eq!(glifo(0), '1'); // número 1
        assert_eq!(glifo(8), '9'); // número 9
        assert_eq!(glifo(9), 'A'); // número 10
        assert_eq!(glifo(10), 'B'); // número 11
        assert_eq!(glifo(34), 'Z'); // número 35 (última letra)
        assert_eq!(glifo(35), '#'); // número 36: fora do razoável
        assert_eq!(glifo(999), '#');
    }

    #[test]
    fn pecas_para_render_usa_ordem_de_turno() {
        let estado = Estado {
            combatentes: vec![
                comb(10, Some((0, 0))),
                comb(20, None), // sem peça → fora
                comb(30, Some((2, 4))),
            ],
            // ordem: 30 é o 1º turno (glifo '1'), 10 é o 2º ('2').
            ordem: vec![30, 10, 20],
            ordem_manual: false,
            rodada: 1,
            indice_turno: 0,
            historico: Vec::new(),
            mapa_id: Some(7),
            anotacoes: Vec::new(),
        };
        let mut pecas = pecas_para_render(&estado);
        pecas.sort_by_key(|p| p.glifo);
        assert_eq!(
            pecas.iter().map(|p| (p.linha, p.coluna, p.glifo)).collect::<Vec<_>>(),
            vec![(2, 4, '1'), (0, 0, '2')]
        );
        // indice_turno = 0 na ordem expandida → dono do turno é o id 30 (glifo '1').
        assert!(pecas.iter().find(|p| p.glifo == '1').unwrap().eh_turno);
        assert!(!pecas.iter().find(|p| p.glifo == '2').unwrap().eh_turno);
    }

    #[test]
    fn pecas_para_render_marca_turno_apos_expansao_por_turnos_extras() {
        let mut c10 = comb(10, Some((0, 0)));
        c10.turnos_extras = 1; // ocupa 2 slots na ordem expandida: [10, 10, 30]
        let estado = Estado {
            combatentes: vec![c10, comb(30, Some((1, 1)))],
            ordem: vec![10, 30],
            ordem_manual: false,
            rodada: 1,
            indice_turno: 1, // 2º slot expandido ainda é do 10
            historico: Vec::new(),
            mapa_id: Some(7),
            anotacoes: Vec::new(),
        };
        let pecas = pecas_para_render(&estado);
        assert!(pecas.iter().find(|p| p.glifo == '1').unwrap().eh_turno);
        assert!(!pecas.iter().find(|p| p.glifo == '2').unwrap().eh_turno);
    }
}
