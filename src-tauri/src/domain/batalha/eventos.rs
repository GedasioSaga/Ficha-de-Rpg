//! Vocabulário do log de eventos. Cada operação do motor registra um evento em
//! `Estado::historico` (paridade com o "HistoricoWindow" do v1). O `desfazer`
//! restaura o estado anterior via snapshot.
//!
//! Valores rolados ficam gravados no evento (`D20Rolado`), então o histórico é um
//! registro fiel do que aconteceu — e serializá-lo é a base do save/load (slice posterior).

use serde::{Deserialize, Serialize};

use super::modelos::{CombatenteId, OrigemModificador, Pool};
use super::regras::TipoReacao;

/// Um evento registrado no histórico da batalha.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Evento {
    CombatenteAdicionado { id: CombatenteId, nome: String },
    CombatenteRemovido { id: CombatenteId },
    OrdemDefinida { ordem: Vec<CombatenteId> },
    ModoOrdemAlternado { manual: bool },
    TurnosExtrasEditados { id: CombatenteId, valor: u8 },
    TransformacaoAplicada { id: CombatenteId, nome: String },
    TransformacaoRevertida { id: CombatenteId, nome: String },
    ModificadorAplicado { id: CombatenteId, origem: OrigemModificador },
    HabilidadeUsada { id: CombatenteId, habilidade: String, cooldown: Option<u8> },
    HabilidadeReabilitada { id: CombatenteId, habilidade: String, automatica: bool },
    ModificadorExpirado { id: CombatenteId, origem: OrigemModificador },
    EfeitoRecorrenteExpirado { id: CombatenteId, origem: String },
    D20Rolado { valor: u8 },
    ReacaoResolvida { tipo: TipoReacao, d20: u8, multiplicador: f64, contra_ataque: bool },
    DanoAplicado { id: CombatenteId, pool: Pool, valor: i64 },
    Recuperado { id: CombatenteId, pool: Pool, valor: i64 },
    ProximoTurno { rodada: u32, indice: usize },
    NovaRodada { rodada: u32 },
    Resetado,
    /// Peça posicionada/movida no mapa. `de: None` = primeira colocação (drag do
    /// roster); `de: Some(..)` = mover peça já no mapa. Uma variante só porque o
    /// motor usa a mesma operação (`pecas::colocar_peca`) pros dois casos — a
    /// distinção "entrou" vs "moveu" vive na UI, olhando se `de` é `None`.
    PecaMovida { id: CombatenteId, de: Option<(u16, u16)>, para: (u16, u16) },
    /// Peça tirada do mapa. `de` guarda a célula que ela ocupava, pro histórico
    /// dizer de onde saiu.
    PecaRemovida { id: CombatenteId, de: (u16, u16) },
    /// Preset de encontro carregado por cima da batalha ativa (substitui
    /// `Estado` inteiro — ver `Batalha::restaurar_de_preset`).
    PresetCarregado { nome: String },
}
