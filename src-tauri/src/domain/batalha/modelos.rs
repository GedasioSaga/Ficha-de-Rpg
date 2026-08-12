//! Modelos de domínio da batalha (Slice B1).
//!
//! Estado puro em memória — sem I/O, DB ou UI. `Combatente::base` é um SNAPSHOT
//! dos atributos na entrada do combate; nada aqui escreve de volta no personagem
//! persistido (mata o bug de sync do v1).

use serde::{Deserialize, Serialize};

/// Os 8 atributos do sistema, na ordem canônica (o índice em [`Combatente::base`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Atributo {
    Forca,
    Agilidade,
    Percepcao,
    Resistencia,
    Intuicao,
    Espirito,
    Carisma,
    Determinacao,
}

impl Atributo {
    /// Todos os atributos, na ordem dos índices de `base`.
    pub const TODOS: [Atributo; 8] = [
        Atributo::Forca,
        Atributo::Agilidade,
        Atributo::Percepcao,
        Atributo::Resistencia,
        Atributo::Intuicao,
        Atributo::Espirito,
        Atributo::Carisma,
        Atributo::Determinacao,
    ];

    /// Índice deste atributo no vetor `base` do combatente.
    pub fn indice(self) -> usize {
        match self {
            Atributo::Forca => 0,
            Atributo::Agilidade => 1,
            Atributo::Percepcao => 2,
            Atributo::Resistencia => 3,
            Atributo::Intuicao => 4,
            Atributo::Espirito => 5,
            Atributo::Carisma => 6,
            Atributo::Determinacao => 7,
        }
    }

    /// Converte a chave usada no DB/DTOs (`"forca"`, `"agilidade"`, …) no atributo.
    pub fn da_chave(nome: &str) -> Option<Atributo> {
        match nome {
            "forca" => Some(Atributo::Forca),
            "agilidade" => Some(Atributo::Agilidade),
            "percepcao" => Some(Atributo::Percepcao),
            "resistencia" => Some(Atributo::Resistencia),
            "intuicao" => Some(Atributo::Intuicao),
            "espirito" => Some(Atributo::Espirito),
            "carisma" => Some(Atributo::Carisma),
            "determinacao" => Some(Atributo::Determinacao),
            _ => None,
        }
    }
}

/// Pool de recurso alvo de dano/cura.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Pool {
    Hp,
    Sp,
    Escudo,
}

/// Tipo do combatente — puramente cosmético (como no v1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Tipo {
    Jogador,
    Npc,
}

/// Pools de recurso. Piso 0, sem teto (paridade v1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pools {
    pub hp: i64,
    pub sp: i64,
    pub escudo: i64,
}

impl Pools {
    pub fn get(&self, pool: Pool) -> i64 {
        match pool {
            Pool::Hp => self.hp,
            Pool::Sp => self.sp,
            Pool::Escudo => self.escudo,
        }
    }

    /// Define uma pool aplicando o piso 0.
    pub fn set(&mut self, pool: Pool, valor: i64) {
        let valor = valor.max(0);
        match pool {
            Pool::Hp => self.hp = valor,
            Pool::Sp => self.sp = valor,
            Pool::Escudo => self.escudo = valor,
        }
    }
}

/// De onde vem um modificador de atributos.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrigemModificador {
    Transformacao(String),
    /// Reservado para status temporais nomeados (slice posterior).
    Status(String),
}

/// Modificador de atributos. Hoje serve transformação (deltas, sem duração); o
/// campo `duracao` deixa a porta aberta para status temporais no futuro.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Modificador {
    pub origem: OrigemModificador,
    pub deltas: Vec<(Atributo, i64)>,
    /// `None` = permanente até reverter; `Some(n)` = expira em `n` turnos do dono.
    pub duracao: Option<u8>,
}

/// Habilidade em cooldown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cooldown {
    pub habilidade: String,
    /// `None` = permanente (resto do combate); `Some(n)` = reabilita em `n` turnos do dono.
    pub turnos_restantes: Option<u8>,
}

/// Distribuição de um dano entre as pools — usada pelo dano recorrente.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DanoDistribuido {
    pub hp: i64,
    pub sp: i64,
    pub escudo: i64,
    /// Se `true`, a parte do escudo que exceder o escudo atual transborda pro HP.
    pub escudo_transborda: bool,
}

/// Efeito de dano recorrente: aplica `dano` no início do turno do alvo, por
/// `duracao` turnos (do alvo). Espelha a cadência de duração dos modificadores.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EfeitoRecorrente {
    /// Rótulo do efeito (ex.: "Veneno"); mesmo rótulo substitui, não empilha.
    pub origem: String,
    pub dano: DanoDistribuido,
    /// Turnos restantes do alvo (>= 1).
    pub duracao: u8,
}

/// Anotação ao vivo numa célula do mapa (camada da batalha, não edita o mapa
/// permanente). `simbolo` é sempre exatamente 1 caractere — normalizado em
/// [`super::Batalha::definir_anotacao`]. 1 anotação por célula.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Anotacao {
    pub linha: u16,
    pub coluna: u16,
    pub simbolo: String,
}

/// Identificador sintético de um combatente na arena (próprio da batalha, não do DB).
pub type CombatenteId = u32;

/// Um combatente na arena.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Combatente {
    pub id: CombatenteId,
    /// Id do personagem no DB (`None` = combatente ad-hoc, sem ficha).
    pub personagem_ref: Option<i64>,
    pub nome: String,
    pub tipo: Tipo,
    /// Facção/lado. `None` no B1 — abre times/AoE depois.
    pub faccao: Option<String>,
    /// Snapshot dos 8 atributos, na ordem de [`Atributo::TODOS`].
    pub base: [i64; 8],
    pub pools: Pools,
    pub modificadores: Vec<Modificador>,
    pub cooldowns: Vec<Cooldown>,
    /// Efeitos de dano recorrente ativos (aplicados no início do turno do alvo).
    pub efeitos_recorrentes: Vec<EfeitoRecorrente>,
    pub turnos_extras: u8,
    /// Posição da peça no grid do mapa ativo: `(linha, coluna)` 0-indexado.
    /// `None` = combatente ainda não colocado no mapa. Definida via comando
    /// (drag/mover), nunca pela [`EntradaCombatente`].
    pub posicao: Option<(u16, u16)>,
    /// Nível de concentração (marcador do mestre): 0 = neutro, 1..=3 = X1/X2/X3.
    /// Só rótulo visual, sem efeito mecânico. `#[serde(default)]` deixa
    /// snapshots de batalha antigos (sem o campo) abrirem como 0.
    #[serde(default)]
    pub concentracao: u8,
}

impl Combatente {
    /// Valor efetivo de um atributo = base + soma dos deltas dos modificadores ativos.
    pub fn atributo_efetivo(&self, attr: Atributo) -> i64 {
        let base = self.base[attr.indice()];
        let extra: i64 = self
            .modificadores
            .iter()
            .flat_map(|m| m.deltas.iter())
            .filter(|(a, _)| *a == attr)
            .map(|(_, d)| *d)
            .sum();
        base + extra
    }

    pub fn agilidade_efetiva(&self) -> i64 {
        self.atributo_efetivo(Atributo::Agilidade)
    }

    /// `true` se a habilidade está travada (em cooldown ou permanente).
    pub fn habilidade_travada(&self, habilidade: &str) -> bool {
        self.cooldowns.iter().any(|c| c.habilidade == habilidade)
    }
}

/// Dados para inserir um combatente. Os atributos/pools são copiados (snapshot) na entrada.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EntradaCombatente {
    pub personagem_ref: Option<i64>,
    pub nome: String,
    pub tipo: Tipo,
    pub faccao: Option<String>,
    pub base: [i64; 8],
    pub pools: Pools,
    pub turnos_extras: u8,
}
