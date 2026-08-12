//! Motor da batalha (Slice B1) — máquina de estado + operações do mestre.
//!
//! Efêmero, em memória, headless. Motor **assistido**: o mestre dirige, as funções
//! de regra ([`regras`]) fazem a conta e o mestre pode sobrepor. Cada operação muta
//! o estado e registra um [`Evento`]; `desfazer` reverte a última via snapshot.
//!
//! Fora do B1 (portas abertas no modelo): status temporais nomeados (`Modificador::duracao`),
//! economia de ações (turno é multi-evento), times/AoE (`faccao` + alvo), grid
//! (combatente é id-indexado), persistência (serializar o histórico), e toda a UI.

// B1 é headless: os itens públicos deste módulo são exercitados pelos testes agora e
// consumidos pela UI/comandos no B2. Sem caller de produção ainda — silencia dead_code
// (escopo restrito a este módulo) até o B2 ligar a interface.
#![allow(dead_code, unused_imports)]

mod dado;
mod eventos;
mod modelos;
mod pecas;
mod regras;

pub use dado::{Dado, DadoRoteirizado, DadoXorshift};
pub use eventos::Evento;
pub use modelos::{
    Anotacao, Atributo, Combatente, CombatenteId, Cooldown, DanoDistribuido, EfeitoRecorrente,
    EntradaCombatente, Modificador, OrigemModificador, Pool, Pools, Tipo,
};
pub use pecas::pecas_para_render;
pub use regras::{
    calcular_dano, resolver_reacao, rolar_d20, EntradaDano, ResultadoDano, ResultadoReacao,
    TipoReacao,
};

use serde::{Deserialize, Serialize};

use crate::db::error::AppError;

/// Estado clonável e comparável da batalha (base do undo e dos testes).
/// NÃO contém o RNG (que não é `Clone`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Estado {
    pub combatentes: Vec<Combatente>,
    /// Ordem de iniciativa — um id por combatente. A expansão por `turnos_extras`
    /// é derivada em [`Batalha::ordem_expandida`].
    pub ordem: Vec<CombatenteId>,
    pub ordem_manual: bool,
    pub rodada: u32,
    /// Índice na ordem EXPANDIDA (`0` = primeiro slot da rodada).
    pub indice_turno: usize,
    pub historico: Vec<Evento>,
    /// Mapa ativo da batalha (id da tabela `mapa`). Fonte única do cockpit e do
    /// sync do Discord. `None` = nenhum mapa selecionado.
    pub mapa_id: Option<i64>,
    /// Anotações ao vivo no mapa (camada da batalha — NÃO edita o mapa
    /// permanente). `#[serde(default)]` deixa batalhas salvas antes desta
    /// feature abrirem como lista vazia, sem migration.
    #[serde(default)]
    pub anotacoes: Vec<Anotacao>,
}

impl Estado {
    fn novo() -> Self {
        Estado {
            combatentes: Vec::new(),
            ordem: Vec::new(),
            ordem_manual: false,
            rodada: 1,
            indice_turno: 0,
            historico: Vec::new(),
            mapa_id: None,
            anotacoes: Vec::new(),
        }
    }
}

/// Ordem de iniciativa expandida por `turnos_extras`, a partir do `Estado` puro.
///
/// Existe como função livre (e não só como método de [`Batalha`]) porque quem
/// renderiza as peças pro Discord (`pecas::pecas_para_render`) só recebe
/// `&Estado` — sem isto, essa regra acabaria copiada lá, e uma cópia divergente
/// faria a legenda marcar o turno errado sem ninguém perceber.
pub fn ordem_expandida_de(estado: &Estado) -> Vec<CombatenteId> {
    let mut v = Vec::new();
    for id in &estado.ordem {
        if let Some(c) = estado.combatentes.iter().find(|c| c.id == *id) {
            for _ in 0..(1 + c.turnos_extras as usize) {
                v.push(*id);
            }
        }
    }
    v
}

/// Id do combatente cujo turno é o atual, a partir do `Estado` puro.
pub fn dono_do_turno_de(estado: &Estado) -> Option<CombatenteId> {
    ordem_expandida_de(estado).get(estado.indice_turno).copied()
}

/// O motor da batalha.
pub struct Batalha {
    estado: Estado,
    dado: Box<dyn Dado>,
    undo_stack: Vec<Estado>,
    proximo_id: CombatenteId,
}

impl Batalha {
    pub fn nova(dado: Box<dyn Dado>) -> Self {
        Batalha {
            estado: Estado::novo(),
            dado,
            undo_stack: Vec::new(),
            proximo_id: 1,
        }
    }

    // ---------- leitura ----------

    pub fn estado(&self) -> &Estado {
        &self.estado
    }

    /// Instantâneo pra persistência: `(estado, próximo id)`. NÃO inclui o
    /// `undo_stack` (desfazer é da sessão de trabalho — serializar N estados
    /// inteiros a cada mutação sairia caro) nem o `dado` (RNG, não é `Clone`).
    pub fn instantaneo(&self) -> (&Estado, CombatenteId) {
        (&self.estado, self.proximo_id)
    }

    /// Reconstrói a batalha a partir de um instantâneo salvo (boot do app).
    /// `undo_stack` sempre começa vazio — desfazer não atravessa reinícios.
    pub fn restaurar(estado: Estado, proximo_id: CombatenteId, dado: Box<dyn Dado>) -> Self {
        Batalha { estado, dado, undo_stack: Vec::new(), proximo_id }
    }

    /// Substitui a batalha ATIVA pelo snapshot de um preset salvo (mestre
    /// carregando um encontro pré-montado no meio da sessão). Diferente de
    /// `restaurar` (usado só no boot): aqui a batalha já está rodando, então
    /// entra no undo normal — `desfazer` volta pro estado de antes do preset.
    /// `historico` do preset substitui o da batalha atual (é o histórico DELE,
    /// não um apêndice); o marco `PresetCarregado` fica registrado depois, pra
    /// quem olhar o log saber onde o preset entrou.
    pub fn restaurar_de_preset(&mut self, estado: Estado, proximo_id: CombatenteId, nome_preset: &str) {
        self.iniciar_op();
        self.estado = estado;
        self.proximo_id = proximo_id;
        self.estado
            .historico
            .push(Evento::PresetCarregado { nome: nome_preset.to_string() });
    }

    pub fn historico(&self) -> &[Evento] {
        &self.estado.historico
    }

    pub fn rodada(&self) -> u32 {
        self.estado.rodada
    }

    pub fn combatente(&self, id: CombatenteId) -> Option<&Combatente> {
        self.estado.combatentes.iter().find(|c| c.id == id)
    }

    fn combatente_mut(&mut self, id: CombatenteId) -> Option<&mut Combatente> {
        self.estado.combatentes.iter_mut().find(|c| c.id == id)
    }

    fn exige(&self, id: CombatenteId) -> Result<(), AppError> {
        if self.combatente(id).is_some() {
            Ok(())
        } else {
            Err(AppError::Msg(format!("combatente {} não encontrado", id)))
        }
    }

    /// Ordem de iniciativa expandida por `turnos_extras` (cada combatente ocupa
    /// `1 + turnos_extras` slots por rodada).
    pub fn ordem_expandida(&self) -> Vec<CombatenteId> {
        ordem_expandida_de(&self.estado)
    }

    /// Id do combatente cujo turno é o atual (`None` se a arena está vazia).
    pub fn dono_do_turno(&self) -> Option<CombatenteId> {
        dono_do_turno_de(&self.estado)
    }

    // ---------- undo ----------

    fn iniciar_op(&mut self) {
        self.undo_stack.push(self.estado.clone());
    }

    /// Desfaz a última operação. `false` se não há o que desfazer.
    pub fn desfazer(&mut self) -> bool {
        if let Some(anterior) = self.undo_stack.pop() {
            self.estado = anterior;
            true
        } else {
            false
        }
    }

    // ---------- ordem / iniciativa ----------

    fn reordenar_por_agilidade(&mut self) {
        let mut pares: Vec<(CombatenteId, i64)> = self
            .estado
            .combatentes
            .iter()
            .map(|c| (c.id, c.agilidade_efetiva()))
            .collect();
        // agilidade desc; desempate estável por id asc
        pares.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        self.estado.ordem = pares.into_iter().map(|(id, _)| id).collect();
    }

    fn clampar_indice(&mut self) {
        let len = self.ordem_expandida().len();
        if len == 0 {
            self.estado.indice_turno = 0;
        } else if self.estado.indice_turno >= len {
            self.estado.indice_turno %= len;
        }
    }

    // ---------- operações do mestre ----------

    /// Adiciona um combatente (snapshot dos stats). Retorna o id atribuído.
    pub fn adicionar_combatente(&mut self, entrada: EntradaCombatente) -> CombatenteId {
        self.iniciar_op();
        let id = self.proximo_id;
        self.proximo_id += 1;
        let combatente = Combatente {
            id,
            personagem_ref: entrada.personagem_ref,
            nome: entrada.nome.clone(),
            tipo: entrada.tipo,
            faccao: entrada.faccao,
            base: entrada.base,
            pools: entrada.pools,
            modificadores: Vec::new(),
            cooldowns: Vec::new(),
            efeitos_recorrentes: Vec::new(),
            turnos_extras: entrada.turnos_extras,
            posicao: None,
            concentracao: 0,
        };
        self.estado.combatentes.push(combatente);
        if self.estado.ordem_manual {
            self.estado.ordem.push(id);
        } else {
            self.reordenar_por_agilidade();
        }
        self.estado
            .historico
            .push(Evento::CombatenteAdicionado { id, nome: entrada.nome });
        id
    }

    pub fn remover_combatente(&mut self, id: CombatenteId) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        self.estado.combatentes.retain(|c| c.id != id);
        self.estado.ordem.retain(|x| *x != id);
        if !self.estado.ordem_manual {
            self.reordenar_por_agilidade();
        }
        self.clampar_indice();
        self.estado.historico.push(Evento::CombatenteRemovido { id });
        Ok(())
    }

    /// Alterna ordem automática (por agilidade) vs manual.
    pub fn alternar_modo_ordem(&mut self, manual: bool) {
        self.iniciar_op();
        self.estado.ordem_manual = manual;
        if !manual {
            self.reordenar_por_agilidade();
        }
        self.estado.historico.push(Evento::ModoOrdemAlternado { manual });
    }

    /// Define a ordem manualmente (entra em modo manual). Ids desconhecidos = erro;
    /// combatentes faltantes são anexados ao fim.
    pub fn definir_ordem(&mut self, ordem: Vec<CombatenteId>) -> Result<(), AppError> {
        for id in &ordem {
            self.exige(*id)?;
        }
        self.iniciar_op();
        let mut nova = ordem;
        for c in &self.estado.combatentes {
            if !nova.contains(&c.id) {
                nova.push(c.id);
            }
        }
        self.estado.ordem = nova.clone();
        self.estado.ordem_manual = true;
        self.clampar_indice();
        self.estado.historico.push(Evento::OrdemDefinida { ordem: nova });
        Ok(())
    }

    pub fn editar_turnos_extras(&mut self, id: CombatenteId, valor: u8) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        if let Some(c) = self.combatente_mut(id) {
            c.turnos_extras = valor;
        }
        self.clampar_indice();
        self.estado
            .historico
            .push(Evento::TurnosExtrasEditados { id, valor });
        Ok(())
    }

    /// Aplica uma transformação (aditiva). Só 1 ativa: remove a anterior antes.
    pub fn aplicar_transformacao(
        &mut self,
        id: CombatenteId,
        nome: String,
        deltas: Vec<(Atributo, i64)>,
    ) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        if let Some(c) = self.combatente_mut(id) {
            c.modificadores
                .retain(|m| !matches!(m.origem, OrigemModificador::Transformacao(_)));
            c.modificadores.push(Modificador {
                origem: OrigemModificador::Transformacao(nome.clone()),
                deltas,
                duracao: None,
            });
        }
        if !self.estado.ordem_manual {
            self.reordenar_por_agilidade();
        }
        self.estado
            .historico
            .push(Evento::TransformacaoAplicada { id, nome });
        Ok(())
    }

    /// Reverte a transformação ativa do combatente (se houver).
    pub fn reverter_transformacao(&mut self, id: CombatenteId) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        let mut nome_revertido: Option<String> = None;
        if let Some(c) = self.combatente_mut(id) {
            if let Some(pos) = c
                .modificadores
                .iter()
                .position(|m| matches!(m.origem, OrigemModificador::Transformacao(_)))
            {
                if let OrigemModificador::Transformacao(n) = &c.modificadores[pos].origem {
                    nome_revertido = Some(n.clone());
                }
                c.modificadores.remove(pos);
            }
        }
        if !self.estado.ordem_manual {
            self.reordenar_por_agilidade();
        }
        if let Some(nome) = nome_revertido {
            self.estado
                .historico
                .push(Evento::TransformacaoRevertida { id, nome });
        }
        Ok(())
    }

    /// Aplica um modificador arbitrário (ex.: status temporal com `duracao`).
    pub fn aplicar_modificador(
        &mut self,
        id: CombatenteId,
        modificador: Modificador,
    ) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        let origem = modificador.origem.clone();
        if let Some(c) = self.combatente_mut(id) {
            c.modificadores.push(modificador);
        }
        if !self.estado.ordem_manual {
            self.reordenar_por_agilidade();
        }
        self.estado
            .historico
            .push(Evento::ModificadorAplicado { id, origem });
        Ok(())
    }

    /// Define o modificador manual (buff/debuff ad-hoc do mestre) de um combatente.
    /// Ao contrário de [`aplicar_modificador`](Self::aplicar_modificador), que empilha,
    /// este **substitui** o modificador manual anterior (só 1, como a transformação).
    /// `deltas` vazio remove o modificador manual (é o "Resetar Modificadores").
    /// Transformações e outros status ficam intactos.
    pub fn definir_modificador_manual(
        &mut self,
        id: CombatenteId,
        deltas: Vec<(Atributo, i64)>,
    ) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        if let Some(c) = self.combatente_mut(id) {
            c.modificadores
                .retain(|m| !matches!(&m.origem, OrigemModificador::Status(s) if s == "Manual"));
            if !deltas.is_empty() {
                c.modificadores.push(Modificador {
                    origem: OrigemModificador::Status("Manual".to_string()),
                    deltas,
                    duracao: None,
                });
            }
        }
        if !self.estado.ordem_manual {
            self.reordenar_por_agilidade();
        }
        self.estado.historico.push(Evento::ModificadorAplicado {
            id,
            origem: OrigemModificador::Status("Manual".to_string()),
        });
        Ok(())
    }

    /// Define o nível de concentração de um combatente (marcador do mestre,
    /// 0=neutro, 1..=3). Só rótulo visual — nenhum efeito em atributo/dano.
    /// `nivel` é clampado em 0..=3 (o botão cicla `(atual + 1) % 4`).
    pub fn definir_concentracao(&mut self, id: CombatenteId, nivel: u8) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        if let Some(c) = self.combatente_mut(id) {
            c.concentracao = nivel.min(3);
        }
        Ok(())
    }

    /// Usa uma habilidade: trava por `cooldown` turnos (`None` = permanente).
    pub fn usar_habilidade(
        &mut self,
        id: CombatenteId,
        habilidade: String,
        cooldown: Option<u8>,
    ) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        if let Some(c) = self.combatente_mut(id) {
            c.cooldowns.retain(|cd| cd.habilidade != habilidade);
            c.cooldowns.push(Cooldown {
                habilidade: habilidade.clone(),
                turnos_restantes: cooldown,
            });
        }
        self.estado.historico.push(Evento::HabilidadeUsada {
            id,
            habilidade,
            cooldown,
        });
        Ok(())
    }

    /// Reabilita manualmente uma habilidade travada.
    pub fn reabilitar_habilidade(
        &mut self,
        id: CombatenteId,
        habilidade: String,
    ) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        if let Some(c) = self.combatente_mut(id) {
            c.cooldowns.retain(|cd| cd.habilidade != habilidade);
        }
        self.estado.historico.push(Evento::HabilidadeReabilitada {
            id,
            habilidade,
            automatica: false,
        });
        Ok(())
    }

    /// Rola 1d20 e registra no histórico.
    pub fn rolar_d20(&mut self) -> u8 {
        self.iniciar_op();
        let valor = self.dado.d20();
        self.estado.historico.push(Evento::D20Rolado { valor });
        valor
    }

    /// Aplica dano. Sem `pool`, o escudo absorve primeiro e o transbordo vai ao HP.
    /// `valor` é o número FINAL (o mestre já compôs/sobrepôs). Piso 0. SP nunca é
    /// debitado por dano.
    pub fn aplicar_dano(
        &mut self,
        id: CombatenteId,
        valor: i64,
        pool: Option<Pool>,
    ) -> Result<(), AppError> {
        self.exige(id)?;
        if valor < 0 {
            return Err(AppError::Msg("dano não pode ser negativo".into()));
        }
        self.iniciar_op();
        let mut eventos: Vec<Evento> = Vec::new();
        if let Some(c) = self.combatente_mut(id) {
            match pool {
                Some(p) => {
                    let atual = c.pools.get(p);
                    let debitado = valor.min(atual.max(0));
                    c.pools.set(p, atual - valor);
                    eventos.push(Evento::DanoAplicado { id, pool: p, valor: debitado });
                }
                None => {
                    let escudo = c.pools.escudo.max(0);
                    let no_escudo = valor.min(escudo);
                    if no_escudo > 0 {
                        c.pools.set(Pool::Escudo, escudo - no_escudo);
                        eventos.push(Evento::DanoAplicado {
                            id,
                            pool: Pool::Escudo,
                            valor: no_escudo,
                        });
                    }
                    let resto = valor - no_escudo;
                    if resto > 0 {
                        let hp = c.pools.hp;
                        let no_hp = resto.min(hp.max(0));
                        c.pools.set(Pool::Hp, hp - resto);
                        eventos.push(Evento::DanoAplicado { id, pool: Pool::Hp, valor: no_hp });
                    }
                }
            }
        }
        self.estado.historico.extend(eventos);
        Ok(())
    }

    /// Recupera uma pool (sem teto). `valor` >= 0.
    pub fn recuperar(&mut self, id: CombatenteId, valor: i64, pool: Pool) -> Result<(), AppError> {
        self.exige(id)?;
        if valor < 0 {
            return Err(AppError::Msg("recuperação não pode ser negativa".into()));
        }
        self.iniciar_op();
        if let Some(c) = self.combatente_mut(id) {
            let atual = c.pools.get(pool);
            c.pools.set(pool, atual + valor);
        }
        self.estado
            .historico
            .push(Evento::Recuperado { id, pool, valor });
        Ok(())
    }

    /// Registra um efeito de dano recorrente no combatente. Mesmo `origem`
    /// substitui (não empilha o mesmo status). `duracao` em turnos do alvo (>= 1).
    pub fn adicionar_efeito_recorrente(
        &mut self,
        id: CombatenteId,
        efeito: EfeitoRecorrente,
    ) -> Result<(), AppError> {
        self.exige(id)?;
        if efeito.duracao == 0 {
            return Err(AppError::Msg("duração do efeito deve ser >= 1".into()));
        }
        self.iniciar_op();
        if let Some(c) = self.combatente_mut(id) {
            c.efeitos_recorrentes.retain(|e| e.origem != efeito.origem);
            c.efeitos_recorrentes.push(efeito);
        }
        Ok(())
    }

    /// Remove todos os efeitos recorrentes de um combatente.
    pub fn limpar_efeitos_recorrentes(&mut self, id: CombatenteId) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        if let Some(c) = self.combatente_mut(id) {
            c.efeitos_recorrentes.clear();
        }
        Ok(())
    }

    /// Op da calculadora de dano: aplica a distribuição instantaneamente e, se
    /// `repetir` for `Some(n)` (n >= 1), registra o mesmo dano como efeito
    /// recorrente por `n` turnos do alvo. Uma única op (um snapshot de undo).
    pub fn aplicar_calculadora_dano(
        &mut self,
        id: CombatenteId,
        dano: DanoDistribuido,
        repetir: Option<u8>,
    ) -> Result<(), AppError> {
        self.exige(id)?;
        self.iniciar_op();
        self.aplicar_dano_distribuido(id, &dano);
        if let Some(n) = repetir {
            if n >= 1 {
                if let Some(c) = self.combatente_mut(id) {
                    let origem = "Calculadora".to_string();
                    c.efeitos_recorrentes.retain(|e| e.origem != origem);
                    c.efeitos_recorrentes
                        .push(EfeitoRecorrente { origem, dano, duracao: n });
                }
            }
        }
        Ok(())
    }

    /// Avança para o próximo turno; ao passar do fim da ordem, inicia nova rodada.
    /// No início do turno do dono, decrementa durações e cooldowns dele.
    pub fn proximo_turno(&mut self) {
        self.iniciar_op();
        let exp = self.ordem_expandida();
        if exp.is_empty() {
            self.estado.historico.push(Evento::ProximoTurno {
                rodada: self.estado.rodada,
                indice: 0,
            });
            return;
        }
        self.estado.indice_turno += 1;
        if self.estado.indice_turno >= exp.len() {
            self.estado.indice_turno = 0;
            self.estado.rodada += 1;
            self.estado
                .historico
                .push(Evento::NovaRodada { rodada: self.estado.rodada });
        }
        if let Some(dono) = self.dono_do_turno() {
            self.decrementar_no_turno(dono);
            self.tick_efeitos_recorrentes(dono);
        }
        self.estado.historico.push(Evento::ProximoTurno {
            rodada: self.estado.rodada,
            indice: self.estado.indice_turno,
        });
    }

    /// Força uma nova rodada (zera o índice de turno).
    pub fn nova_rodada(&mut self) {
        self.iniciar_op();
        self.estado.rodada += 1;
        self.estado.indice_turno = 0;
        self.estado
            .historico
            .push(Evento::NovaRodada { rodada: self.estado.rodada });
    }

    /// Reseta a batalha (limpa combatentes e ordem; o histórico mantém o marco).
    pub fn resetar(&mut self) {
        self.iniciar_op();
        self.estado.combatentes.clear();
        self.estado.ordem.clear();
        self.estado.rodada = 1;
        self.estado.indice_turno = 0;
        self.estado.ordem_manual = false;
        self.estado.mapa_id = None;
        self.estado.anotacoes.clear();
        self.estado.historico.push(Evento::Resetado);
    }

    // ---------- peças no mapa (Fase 5) ----------

    /// Define o mapa ativo da batalha (fonte única do cockpit e do sync do Discord).
    /// Fora do undo/histórico: é ajuste de cenário, não ação de combate.
    pub fn definir_mapa(&mut self, mapa_id: i64) {
        self.estado.mapa_id = Some(mapa_id);
    }

    /// Coloca a peça do combatente `id` em `(linha, coluna)` (drag inicial do roster).
    /// Clampa ao grid e recusa célula ocupada por OUTRA peça (1 peça/célula).
    /// `true` = (re)posicionada; `false` = rejeitada (célula ocupada). Fora do undo
    /// de combate de propósito (movimento espacial não é ação de combate) — mas o
    /// histórico registra o `PecaMovida` mesmo assim, pro mestre reconstruir a cena.
    pub fn posicionar_peca(
        &mut self,
        id: CombatenteId,
        linha: u16,
        coluna: u16,
        grid_linhas: u16,
        grid_colunas: u16,
    ) -> Result<bool, AppError> {
        self.exige(id)?;
        self.colocar_peca_com_log(id, linha, coluna, grid_linhas, grid_colunas)
    }

    /// Move uma peça já no mapa. Mesmas regras de [`posicionar_peca`](Self::posicionar_peca):
    /// clamp + 1 peça/célula (mover pra própria célula é no-op bem-sucedido).
    pub fn mover_peca(
        &mut self,
        id: CombatenteId,
        linha: u16,
        coluna: u16,
        grid_linhas: u16,
        grid_colunas: u16,
    ) -> Result<bool, AppError> {
        self.exige(id)?;
        self.colocar_peca_com_log(id, linha, coluna, grid_linhas, grid_colunas)
    }

    /// Chama `pecas::colocar_peca` e, se aceito, empurra `Evento::PecaMovida` no
    /// histórico. `de` é a posição ANTES da chamada (`None` = peça ainda fora do
    /// mapa, ou seja, primeira colocação). Compartilhada por `posicionar_peca` e
    /// `mover_peca`, que na engine são a mesma operação.
    fn colocar_peca_com_log(
        &mut self,
        id: CombatenteId,
        linha: u16,
        coluna: u16,
        grid_linhas: u16,
        grid_colunas: u16,
    ) -> Result<bool, AppError> {
        let de = self.combatente(id).and_then(|c| c.posicao);
        let ok = pecas::colocar_peca(
            &mut self.estado.combatentes,
            id,
            linha,
            coluna,
            grid_linhas,
            grid_colunas,
        );
        if ok {
            if let Some(para) = self.combatente(id).and_then(|c| c.posicao) {
                self.estado.historico.push(Evento::PecaMovida { id, de, para });
            }
        }
        Ok(ok)
    }

    /// Tira a peça do combatente `id` do mapa (`posicao = None`).
    pub fn remover_peca(&mut self, id: CombatenteId) -> Result<(), AppError> {
        self.exige(id)?;
        let de = self.combatente(id).and_then(|c| c.posicao);
        let removeu = pecas::remover_peca(&mut self.estado.combatentes, id);
        if removeu {
            if let Some(de) = de {
                self.estado.historico.push(Evento::PecaRemovida { id, de });
            }
        }
        Ok(())
    }

    /// Define (ou remove) a anotação ao vivo de uma célula do mapa — camada da
    /// batalha, não edita o mapa permanente. `simbolo` é normalizado pro
    /// PRIMEIRO caractere não-vazio; vazio/só espaço REMOVE a anotação da
    /// célula. 1 anotação por célula (a existente é substituída). Sem `exige`
    /// (não é combatente). Nunca falha — `Result` só pra casar com o padrão
    /// dos outros mutadores no comando Tauri.
    pub fn definir_anotacao(&mut self, linha: u16, coluna: u16, simbolo: String) -> Result<(), AppError> {
        self.iniciar_op();
        self.estado
            .anotacoes
            .retain(|a| !(a.linha == linha && a.coluna == coluna));
        if let Some(ch) = simbolo.trim().chars().next() {
            self.estado.anotacoes.push(Anotacao { linha, coluna, simbolo: ch.to_string() });
        }
        Ok(())
    }

    // ---------- cadência interna ----------

    /// Decrementa durações de modificadores e cooldowns do dono no início do seu turno.
    fn decrementar_no_turno(&mut self, dono: CombatenteId) {
        let mut reabilitadas: Vec<String> = Vec::new();
        let mut expirados: Vec<OrigemModificador> = Vec::new();

        if let Some(c) = self.combatente_mut(dono) {
            for cd in c.cooldowns.iter_mut() {
                if let Some(t) = cd.turnos_restantes {
                    if t > 1 {
                        cd.turnos_restantes = Some(t - 1);
                    } else {
                        reabilitadas.push(cd.habilidade.clone());
                    }
                }
            }
            c.cooldowns.retain(|cd| !reabilitadas.contains(&cd.habilidade));

            for m in c.modificadores.iter_mut() {
                if let Some(d) = m.duracao {
                    if d > 1 {
                        m.duracao = Some(d - 1);
                    } else {
                        expirados.push(m.origem.clone());
                    }
                }
            }
            c.modificadores.retain(|m| !expirados.contains(&m.origem));
        }

        for hab in reabilitadas {
            self.estado.historico.push(Evento::HabilidadeReabilitada {
                id: dono,
                habilidade: hab,
                automatica: true,
            });
        }
        let agilidade_mudou = !expirados.is_empty();
        for origem in expirados {
            self.estado
                .historico
                .push(Evento::ModificadorExpirado { id: dono, origem });
        }
        if agilidade_mudou && !self.estado.ordem_manual {
            self.reordenar_por_agilidade();
        }
    }

    /// No início do turno do dono, aplica cada efeito de dano recorrente e
    /// decrementa sua duração (expira em 0). Espelha `decrementar_no_turno`: o
    /// efeito que expira ainda aplica o dano neste tick.
    fn tick_efeitos_recorrentes(&mut self, dono: CombatenteId) {
        let mut aplicar: Vec<DanoDistribuido> = Vec::new();
        let mut expirados: Vec<String> = Vec::new();
        if let Some(c) = self.combatente_mut(dono) {
            if c.efeitos_recorrentes.is_empty() {
                return;
            }
            aplicar = c.efeitos_recorrentes.iter().map(|ef| ef.dano.clone()).collect();
            for ef in c.efeitos_recorrentes.iter_mut() {
                if ef.duracao > 1 {
                    ef.duracao -= 1;
                } else {
                    expirados.push(ef.origem.clone());
                }
            }
            c.efeitos_recorrentes.retain(|ef| !expirados.contains(&ef.origem));
        }
        for dano in &aplicar {
            self.aplicar_dano_distribuido(dono, dano);
        }
        for origem in expirados {
            self.estado
                .historico
                .push(Evento::EfeitoRecorrenteExpirado { id: dono, origem });
        }
    }

    /// Aplica uma distribuição de dano (escudo com overflow p/ HP opcional, + HP/SP
    /// diretos) SEM abrir snapshot de undo — chamado dentro do `iniciar_op` do
    /// `proximo_turno`. Espelha a lógica de `aplicar_dano`.
    fn aplicar_dano_distribuido(&mut self, id: CombatenteId, dano: &DanoDistribuido) {
        let mut eventos: Vec<Evento> = Vec::new();
        if let Some(c) = self.combatente_mut(id) {
            if dano.escudo > 0 {
                let escudo = c.pools.escudo.max(0);
                let no_escudo = dano.escudo.min(escudo);
                if no_escudo > 0 {
                    c.pools.set(Pool::Escudo, escudo - no_escudo);
                    eventos.push(Evento::DanoAplicado { id, pool: Pool::Escudo, valor: no_escudo });
                }
                let resto = dano.escudo - no_escudo;
                if resto > 0 && dano.escudo_transborda {
                    let hp = c.pools.hp;
                    let no_hp = resto.min(hp.max(0));
                    c.pools.set(Pool::Hp, hp - resto);
                    if no_hp > 0 {
                        eventos.push(Evento::DanoAplicado { id, pool: Pool::Hp, valor: no_hp });
                    }
                }
            }
            if dano.hp > 0 {
                let hp = c.pools.hp;
                let no_hp = dano.hp.min(hp.max(0));
                c.pools.set(Pool::Hp, hp - dano.hp);
                if no_hp > 0 {
                    eventos.push(Evento::DanoAplicado { id, pool: Pool::Hp, valor: no_hp });
                }
            }
            if dano.sp > 0 {
                let sp = c.pools.sp;
                let no_sp = dano.sp.min(sp.max(0));
                c.pools.set(Pool::Sp, sp - dano.sp);
                if no_sp > 0 {
                    eventos.push(Evento::DanoAplicado { id, pool: Pool::Sp, valor: no_sp });
                }
            }
        }
        self.estado.historico.extend(eventos);
    }
}

/// Interpreta o campo `tempo` da habilidade (texto livre da ficha) como cooldown.
///
/// Inteiro positivo → `Some(n)` turnos do dono; vazio ou não-numérico → `None`
/// (desabilitada até o fim do combate). Paridade com a regra do v1 em `usar_habilidade`.
pub fn parse_cooldown(tempo: &str) -> Option<u8> {
    match tempo.trim().parse::<i64>() {
        Ok(n) if n > 0 => Some(n.min(u8::MAX as i64) as u8),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ent(nome: &str, agilidade: i64, hp: i64, escudo: i64) -> EntradaCombatente {
        let mut base = [0i64; 8];
        base[Atributo::Agilidade.indice()] = agilidade;
        EntradaCombatente {
            personagem_ref: None,
            nome: nome.to_string(),
            tipo: Tipo::Npc,
            faccao: None,
            base,
            pools: Pools { hp, sp: 50, escudo },
            turnos_extras: 0,
        }
    }

    fn nova() -> Batalha {
        Batalha::nova(Box::new(DadoRoteirizado::new(vec![10, 15, 20])))
    }

    #[test]
    fn iniciativa_por_agilidade_desc() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 30, 100, 0));
        let c = b.adicionar_combatente(ent("C", 50, 100, 0));
        let d = b.adicionar_combatente(ent("D", 40, 100, 0));
        assert_eq!(b.estado().ordem, vec![c, d, a]);
    }

    #[test]
    fn iniciativa_desempate_estavel_por_id() {
        let mut b = nova();
        let x = b.adicionar_combatente(ent("X", 40, 100, 0));
        let y = b.adicionar_combatente(ent("Y", 40, 100, 0));
        assert_eq!(b.estado().ordem, vec![x, y]);
    }

    #[test]
    fn ordem_manual_preserva_e_anexa() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 0));
        let c = b.adicionar_combatente(ent("C", 90, 100, 0));
        b.definir_ordem(vec![a, c]).unwrap();
        assert_eq!(b.estado().ordem, vec![a, c]);
        assert!(b.estado().ordem_manual);
        let d = b.adicionar_combatente(ent("D", 999, 100, 0));
        assert_eq!(b.estado().ordem, vec![a, c, d]);
    }

    #[test]
    fn turnos_extras_expande_e_da_wrap() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 50, 100, 0));
        let c = b.adicionar_combatente(ent("C", 10, 100, 0));
        b.editar_turnos_extras(a, 1).unwrap();
        assert_eq!(b.ordem_expandida(), vec![a, a, c]);
        assert_eq!(b.dono_do_turno(), Some(a));
        b.proximo_turno();
        assert_eq!(b.dono_do_turno(), Some(a));
        b.proximo_turno();
        assert_eq!(b.dono_do_turno(), Some(c));
        assert_eq!(b.rodada(), 1);
        b.proximo_turno();
        assert_eq!(b.rodada(), 2);
        assert_eq!(b.dono_do_turno(), Some(a));
    }

    #[test]
    fn efeito_recorrente_tica_no_turno_do_alvo_e_expira() {
        let mut b = nova();
        let alvo = b.adicionar_combatente(ent("Alvo", 50, 100, 20)); // agilidade 50 → 1º
        let _outro = b.adicionar_combatente(ent("Outro", 10, 100, 0)); // agilidade 10 → 2º

        b.adicionar_efeito_recorrente(
            alvo,
            EfeitoRecorrente {
                origem: "Veneno".into(),
                dano: DanoDistribuido { hp: 5, sp: 0, escudo: 30, escudo_transborda: true },
                duracao: 2,
            },
        )
        .unwrap();

        let pools = |b: &Batalha| b.estado().combatentes.iter().find(|c| c.id == alvo).unwrap().pools;

        // dono inicial é o alvo, mas o tick só roda em proximo_turno — ainda intacto.
        assert_eq!(pools(&b).hp, 100);
        assert_eq!(pools(&b).escudo, 20);

        b.proximo_turno(); // dono = Outro → não tica no alvo
        assert_eq!(pools(&b).hp, 100);

        b.proximo_turno(); // wrap → dono = Alvo → 1º tick
        // escudo 20 absorve 20; sobra 10 transborda; +5 direto = 15 no HP
        assert_eq!(pools(&b).escudo, 0);
        assert_eq!(pools(&b).hp, 85);

        b.proximo_turno(); // Outro
        b.proximo_turno(); // Alvo → 2º tick (duração chega a 0, expira)
        // escudo já 0: 30 transborda + 5 = 35 no HP: 85 - 35 = 50
        assert_eq!(pools(&b).hp, 50);

        b.proximo_turno(); // Outro
        b.proximo_turno(); // Alvo → efeito expirado, sem dano
        assert_eq!(pools(&b).hp, 50);
    }

    #[test]
    fn calculadora_dano_instantaneo_e_recorrente() {
        let mut b = nova();
        let alvo = b.adicionar_combatente(ent("Alvo", 50, 100, 20));
        let _o = b.adicionar_combatente(ent("O", 10, 100, 0));

        // 30 no escudo (overflow) + 10 direto no HP, repetindo por 1 turno.
        b.aplicar_calculadora_dano(
            alvo,
            DanoDistribuido { hp: 10, sp: 0, escudo: 30, escudo_transborda: true },
            Some(1),
        )
        .unwrap();

        let pools = |b: &Batalha| b.estado().combatentes.iter().find(|c| c.id == alvo).unwrap().pools;

        // instantâneo: escudo 20 absorve 20, sobra 10 → HP; +10 direto = 20 no HP → 80
        assert_eq!(pools(&b).escudo, 0);
        assert_eq!(pools(&b).hp, 80);

        b.proximo_turno(); // O
        b.proximo_turno(); // Alvo → tick recorrente: escudo 0 → 30 overflow + 10 = 40 → 40
        assert_eq!(pools(&b).hp, 40);
    }

    #[test]
    fn transformacao_aditiva_e_reverte() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 20, 100, 0));
        b.aplicar_transformacao(a, "Fúria".into(), vec![(Atributo::Forca, 30), (Atributo::Agilidade, 10)])
            .unwrap();
        let c = b.combatente(a).unwrap();
        assert_eq!(c.atributo_efetivo(Atributo::Forca), 30);
        assert_eq!(c.agilidade_efetiva(), 30);
        b.reverter_transformacao(a).unwrap();
        let c = b.combatente(a).unwrap();
        assert_eq!(c.atributo_efetivo(Atributo::Forca), 0);
        assert_eq!(c.agilidade_efetiva(), 20);
    }

    #[test]
    fn so_uma_transformacao_ativa() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 20, 100, 0));
        b.aplicar_transformacao(a, "T1".into(), vec![(Atributo::Forca, 10)]).unwrap();
        b.aplicar_transformacao(a, "T2".into(), vec![(Atributo::Forca, 100)]).unwrap();
        let c = b.combatente(a).unwrap();
        assert_eq!(c.atributo_efetivo(Atributo::Forca), 100);
        assert_eq!(c.modificadores.len(), 1);
    }

    #[test]
    fn transformacao_muda_agilidade_reordena() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 20, 100, 0));
        let c = b.adicionar_combatente(ent("C", 50, 100, 0));
        assert_eq!(b.estado().ordem, vec![c, a]);
        b.aplicar_transformacao(a, "Boost".into(), vec![(Atributo::Agilidade, 100)]).unwrap();
        assert_eq!(b.estado().ordem, vec![a, c]);
    }

    #[test]
    fn cooldown_conta_no_turno_do_dono_e_reabilita() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 50, 100, 0));
        let _c = b.adicionar_combatente(ent("C", 10, 100, 0));
        b.usar_habilidade(a, "Golpe".into(), Some(2)).unwrap();
        assert!(b.combatente(a).unwrap().habilidade_travada("Golpe"));
        b.proximo_turno(); // -> C
        assert!(b.combatente(a).unwrap().habilidade_travada("Golpe"));
        b.proximo_turno(); // wrap -> A, decrementa 2->1
        assert!(b.combatente(a).unwrap().habilidade_travada("Golpe"));
        b.proximo_turno(); // -> C
        b.proximo_turno(); // wrap -> A, decrementa 1->0 reabilita
        assert!(!b.combatente(a).unwrap().habilidade_travada("Golpe"));
    }

    #[test]
    fn cooldown_permanente_nao_reabilita_sozinho() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 50, 100, 0));
        b.usar_habilidade(a, "Ultimate".into(), None).unwrap();
        for _ in 0..10 {
            b.proximo_turno();
        }
        assert!(b.combatente(a).unwrap().habilidade_travada("Ultimate"));
        b.reabilitar_habilidade(a, "Ultimate".into()).unwrap();
        assert!(!b.combatente(a).unwrap().habilidade_travada("Ultimate"));
    }

    #[test]
    fn dano_escudo_absorve_antes_do_hp() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 30));
        b.aplicar_dano(a, 50, None).unwrap();
        let c = b.combatente(a).unwrap();
        assert_eq!(c.pools.escudo, 0);
        assert_eq!(c.pools.hp, 80);
        assert_eq!(c.pools.sp, 50);
    }

    #[test]
    fn dano_pool_explicita_e_piso_zero() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 40, 100));
        b.aplicar_dano(a, 100, Some(Pool::Hp)).unwrap();
        assert_eq!(b.combatente(a).unwrap().pools.hp, 0);
        assert_eq!(b.combatente(a).unwrap().pools.escudo, 100);
    }

    #[test]
    fn recuperar_sem_teto() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 0));
        b.recuperar(a, 50, Pool::Hp).unwrap();
        assert_eq!(b.combatente(a).unwrap().pools.hp, 150);
    }

    #[test]
    fn desfazer_restaura_estado_anterior() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 0));
        let antes = b.estado().clone();
        b.aplicar_dano(a, 40, Some(Pool::Hp)).unwrap();
        assert_eq!(b.combatente(a).unwrap().pools.hp, 60);
        assert!(b.desfazer());
        assert_eq!(b.estado(), &antes);
        assert_eq!(b.combatente(a).unwrap().pools.hp, 100);
    }

    #[test]
    fn desfazer_vazio_retorna_false() {
        let mut b = nova();
        assert!(!b.desfazer());
    }

    #[test]
    fn rolar_d20_roteirizado_e_registra() {
        let mut b = Batalha::nova(Box::new(DadoRoteirizado::new(vec![17, 3])));
        assert_eq!(b.rolar_d20(), 17);
        assert_eq!(b.rolar_d20(), 3);
        let rolagens: Vec<u8> = b
            .historico()
            .iter()
            .filter_map(|e| match e {
                Evento::D20Rolado { valor } => Some(*valor),
                _ => None,
            })
            .collect();
        assert_eq!(rolagens, vec![17, 3]);
    }

    #[test]
    fn resetar_limpa_combatentes() {
        let mut b = nova();
        b.adicionar_combatente(ent("A", 10, 100, 0));
        b.adicionar_combatente(ent("B", 20, 100, 0));
        b.resetar();
        assert!(b.estado().combatentes.is_empty());
        assert_eq!(b.rodada(), 1);
    }

    #[test]
    fn modificador_manual_define_substitui_reseta() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 20, 100, 0));
        b.definir_modificador_manual(a, vec![(Atributo::Forca, 5), (Atributo::Agilidade, 10)])
            .unwrap();
        let c = b.combatente(a).unwrap();
        assert_eq!(c.atributo_efetivo(Atributo::Forca), 5);
        assert_eq!(c.agilidade_efetiva(), 30);
        assert_eq!(c.modificadores.len(), 1);
        // redefinir substitui (não empilha)
        b.definir_modificador_manual(a, vec![(Atributo::Forca, 8)]).unwrap();
        let c = b.combatente(a).unwrap();
        assert_eq!(c.atributo_efetivo(Atributo::Forca), 8);
        assert_eq!(c.agilidade_efetiva(), 20);
        assert_eq!(c.modificadores.len(), 1);
        // vazio = reset
        b.definir_modificador_manual(a, vec![]).unwrap();
        let c = b.combatente(a).unwrap();
        assert_eq!(c.atributo_efetivo(Atributo::Forca), 0);
        assert!(c.modificadores.is_empty());
    }

    #[test]
    fn modificador_manual_coexiste_com_transformacao() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 20, 100, 0));
        b.aplicar_transformacao(a, "T".into(), vec![(Atributo::Forca, 100)]).unwrap();
        b.definir_modificador_manual(a, vec![(Atributo::Forca, 5)]).unwrap();
        assert_eq!(b.combatente(a).unwrap().atributo_efetivo(Atributo::Forca), 105);
        // resetar o manual NÃO remove a transformação
        b.definir_modificador_manual(a, vec![]).unwrap();
        let c = b.combatente(a).unwrap();
        assert_eq!(c.atributo_efetivo(Atributo::Forca), 100);
        assert_eq!(c.modificadores.len(), 1);
    }

    #[test]
    fn modificador_manual_muda_agilidade_reordena() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 20, 100, 0));
        let c = b.adicionar_combatente(ent("C", 50, 100, 0));
        assert_eq!(b.estado().ordem, vec![c, a]);
        b.definir_modificador_manual(a, vec![(Atributo::Agilidade, 100)]).unwrap();
        assert_eq!(b.estado().ordem, vec![a, c]);
    }

    #[test]
    fn instantaneo_e_restaurar_preservam_estado() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 20, 100, 10));
        b.aplicar_dano(a, 30, None).unwrap();
        b.posicionar_peca(a, 2, 3, 10, 10).unwrap();

        let (estado, proximo_id) = b.instantaneo();
        let estado = estado.clone();

        let restaurada = Batalha::restaurar(
            estado.clone(),
            proximo_id,
            Box::new(DadoRoteirizado::new(vec![1])),
        );
        assert_eq!(restaurada.estado(), &estado);
        // undo_stack não sobrevive à restauração: nada pra desfazer.
        let mut restaurada = restaurada;
        assert!(!restaurada.desfazer());
    }

    #[test]
    fn primeira_colocacao_registra_de_none() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 0));
        assert!(b.posicionar_peca(a, 2, 3, 10, 10).unwrap());
        let ultimo = b.historico().last().unwrap();
        assert_eq!(ultimo, &Evento::PecaMovida { id: a, de: None, para: (2, 3) });
    }

    #[test]
    fn mover_peca_registra_origem_e_destino() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 0));
        b.posicionar_peca(a, 2, 3, 10, 10).unwrap();
        assert!(b.mover_peca(a, 5, 6, 10, 10).unwrap());
        let ultimo = b.historico().last().unwrap();
        assert_eq!(
            ultimo,
            &Evento::PecaMovida { id: a, de: Some((2, 3)), para: (5, 6) }
        );
    }

    #[test]
    fn mover_rejeitado_nao_registra_evento() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 0));
        let c = b.adicionar_combatente(ent("C", 5, 100, 0));
        b.posicionar_peca(a, 2, 3, 10, 10).unwrap();
        b.posicionar_peca(c, 5, 6, 10, 10).unwrap();
        let tamanho_antes = b.historico().len();
        // C tenta ocupar a célula de A → rejeitado, sem evento novo.
        assert!(!b.mover_peca(c, 2, 3, 10, 10).unwrap());
        assert_eq!(b.historico().len(), tamanho_antes);
    }

    #[test]
    fn remover_peca_registra_origem() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 0));
        b.posicionar_peca(a, 2, 3, 10, 10).unwrap();
        b.remover_peca(a).unwrap();
        let ultimo = b.historico().last().unwrap();
        assert_eq!(ultimo, &Evento::PecaRemovida { id: a, de: (2, 3) });
    }

    #[test]
    fn remover_peca_fora_do_mapa_nao_registra_evento() {
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 0));
        let tamanho_antes = b.historico().len();
        b.remover_peca(a).unwrap(); // já estava fora do mapa
        assert_eq!(b.historico().len(), tamanho_antes);
    }

    #[test]
    fn desfazer_mantem_historico_de_movimento_consistente() {
        // posicionar_peca não abre snapshot de undo (é fora da economia de combate),
        // mas o evento entra no histórico igual. `aplicar_dano` abre snapshot ANTES
        // de rodar — o snapshot já inclui o movimento. `desfazer` deve reverter só o
        // dano, preservando o `PecaMovida` no histórico.
        let mut b = nova();
        let a = b.adicionar_combatente(ent("A", 10, 100, 0));
        b.posicionar_peca(a, 2, 3, 10, 10).unwrap();
        b.aplicar_dano(a, 40, Some(Pool::Hp)).unwrap();
        assert!(b.desfazer());

        assert_eq!(b.combatente(a).unwrap().pools.hp, 100); // dano desfeito
        assert_eq!(b.combatente(a).unwrap().posicao, Some((2, 3))); // posição preservada
        assert!(b
            .historico()
            .iter()
            .any(|e| matches!(e, Evento::PecaMovida { id, .. } if *id == a)));
        assert!(!b.historico().iter().any(|e| matches!(e, Evento::DanoAplicado { .. })));
    }

    #[test]
    fn parse_cooldown_regras() {
        assert_eq!(parse_cooldown("2"), Some(2));
        assert_eq!(parse_cooldown(" 5 "), Some(5));
        assert_eq!(parse_cooldown(""), None);
        assert_eq!(parse_cooldown("3 turnos"), None);
        assert_eq!(parse_cooldown("0"), None);
        assert_eq!(parse_cooldown("-1"), None);
    }
}
