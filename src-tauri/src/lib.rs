// `pub` só pra `src/bin/exportar_semente.rs` reusar
// `db::sincronizacao_nuvem::CONFIG_NAO_EXPORTAR` (FIX6) — nenhum outro
// consumidor externo do crate.
pub mod db;
mod discord;
mod domain;
mod google;
mod migration;
mod recursos;
mod segredos;
mod semente;

use db::connection::{open, Db};
use db::error::AppError;
use db::repositorios::{CargaBatalha, PresetResumo};
use db::sincronizacao_nuvem::{
    self, EventoBootSync, PlanoBaixar, PlanoBoot, PlanoEnvio, SyncResultado, SyncStatus,
};
use discord::{
    discord_atualizar_mapa, discord_auto_seguir, discord_canal_salvo, discord_conectar,
    discord_definir_canal, discord_entrar_voz, discord_iniciar, discord_ler_canal,
    discord_listar_canais, discord_listar_canais_voz, discord_listar_favoritos,
    discord_musica_ab_definir, discord_musica_ab_toggle, discord_musica_loop, discord_musica_play,
    discord_musica_seek, discord_musica_skip, discord_musica_stop, discord_musica_tocar_agora,
    discord_musica_velocidade, discord_ping, discord_postar_mapa, discord_sair_voz, SidecarState,
    CHAVE_CANAL,
};
use domain::batalha::{
    parse_cooldown, pecas_para_render, Atributo, Batalha, DadoXorshift, DanoDistribuido,
    EfeitoRecorrente, EntradaCombatente, Estado, Pool, Pools, Tipo,
};
use domain::mapa::{normalizar, render_discord, Mapa, MapaInput, MapaResumo, PecaRender};
use google::auth::{access_token, google_login, google_logout, google_status, EstadoGoogle};
use domain::modelos::{
    CatalogoPericia, CatalogoPericiaInput, CatalogoTraco, CatalogoTracoInput, Catalogos, Etiqueta,
    EtiquetaInput, Favorito, FavoritoInput, Nota, NotaInput, NotaResumo, PersonagemCompleto,
    PersonagemInput, PersonagemResumo, ResultadoImport,
};
use std::sync::Mutex;
use tauri::Manager;

/// Estado da batalha ativa. Vive em memória (`Mutex<Batalha>`); persistida no
/// SQLite via [`persistir_e_devolver`] após todo comando que muta.
pub(crate) struct EstadoBatalha(Mutex<Batalha>);

impl EstadoBatalha {
    /// Peças (prontas pra render, com glifo/nome/turno) do estado quando `mapa_id`
    /// é o mapa ATIVO da batalha; senão vazio. Lock curto que não cruza `await` —
    /// seguro nos comandos async do Discord. Fonte única da regra "peças só no
    /// mapa ativo", usada pelo preview (`render_mapa_discord`) e pelo sync do Discord.
    pub(crate) fn pecas_para_mapa(&self, mapa_id: Option<i64>) -> Vec<PecaRender> {
        let Some(pedido) = mapa_id else {
            return Vec::new();
        };
        let Ok(b) = self.0.lock() else {
            return Vec::new();
        };
        let estado = b.estado();
        if estado.mapa_id == Some(pedido) {
            pecas_para_render(estado)
        } else {
            Vec::new()
        }
    }

    /// Anotações ao vivo (camada da batalha) do mapa, mesma regra de
    /// [`pecas_para_mapa`]: só quando `mapa_id` é o mapa ATIVO da batalha.
    /// Tuplas `(linha, coluna, símbolo)` — formato que `render_discord` espera,
    /// pra não fazer `domain::mapa` depender de `domain::batalha`.
    pub(crate) fn anotacoes_para_mapa(&self, mapa_id: Option<i64>) -> Vec<(u16, u16, String)> {
        let Some(pedido) = mapa_id else {
            return Vec::new();
        };
        let Ok(b) = self.0.lock() else {
            return Vec::new();
        };
        let estado = b.estado();
        if estado.mapa_id == Some(pedido) {
            estado
                .anotacoes
                .iter()
                .map(|a| (a.linha, a.coluna, a.simbolo.clone()))
                .collect()
        } else {
            Vec::new()
        }
    }
}

/// Ponto único de gravação da batalha: todo comando que MUTA o estado passa
/// por aqui antes de devolver o `Estado` ao frontend. Falha ao gravar NÃO
/// derruba o comando — a jogada do mestre importa mais que o save; loga em
/// stderr e segue (ver regra de robustez do plano da Fatia 1, Parte A).
///
/// INVARIANTE DE LOCK — quem mexer aqui precisa respeitar: quando os dois
/// locks (batalha e `Db`) são mantidos AO MESMO TEMPO, a ordem é sempre
/// **batalha → Db**, que é o que esta função faz (o chamador já segura a
/// batalha e nós pegamos o Db por dentro). Comandos que precisam ler o banco
/// antes — `batalha_adicionar`, `batalha_transformar` — fecham o `conn` num
/// bloco e só depois travam a batalha, de propósito. Travar `Db` e então a
/// batalha **sem soltar o `conn`** inverteria a ordem e abriria deadlock.
fn persistir_e_devolver(db: &Db, bat: &Batalha) -> Estado {
    let (estado, proximo_id) = bat.instantaneo();
    match db.conn() {
        Ok(conn) => {
            if let Err(e) = db::repositorios::batalha_salvar(&conn, estado, proximo_id as i64) {
                eprintln!("[batalha_salvar] falha ao persistir: {e}");
            }
        }
        Err(e) => eprintln!("[batalha_salvar] lock do DB indisponível: {e}"),
    }
    estado.clone()
}

/// Copia um snapshot de batalha ilegível para `app_data/quarentena/`, com
/// timestamp no nome. É a rede de segurança do boot: sem isso, um save que o app
/// não conseguiu interpretar seria apagado pelo primeiro `persistir_e_devolver`
/// da sessão nova, sem ninguém nunca ter visto o conteúdo.
fn guardar_quarentena(app: &tauri::AppHandle, bruto: &str) -> Result<std::path::PathBuf, AppError> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Msg(e.to_string()))?
        .join("quarentena");
    std::fs::create_dir_all(&dir)?;
    let carimbo = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let caminho = dir.join(format!("batalha-{carimbo}.json"));
    std::fs::write(&caminho, bruto)?;
    Ok(caminho)
}

/// Diretório onde os retratos ficam salvos (`app_data/images`).
fn images_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Msg(e.to_string()))?
        .join("images"))
}

#[tauri::command]
fn listar_personagens(
    db: tauri::State<Db>,
    tipo: Option<String>,
) -> Result<Vec<PersonagemResumo>, AppError> {
    let conn = db.conn()?;
    db::repositorios::listar_personagens(&conn, tipo.as_deref())
}

#[tauri::command]
fn get_personagem(db: tauri::State<Db>, id: i64) -> Result<PersonagemCompleto, AppError> {
    let conn = db.conn()?;
    db::repositorios::get_personagem(&conn, id)
}

#[tauri::command]
fn importar_v1(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    caminho_data: String,
) -> Result<(usize, usize), AppError> {
    let base = std::path::PathBuf::from(caminho_data);
    let dir = images_dir(&app)?;

    let jog = std::fs::read_to_string(base.join("jogadores.json"))?;
    let npc = std::fs::read_to_string(base.join("npcs.json"))?;
    let per = std::fs::read_to_string(base.join("pericias.json"))?;
    let van = std::fs::read_to_string(base.join("vantagens.json"))?;
    let des = std::fs::read_to_string(base.join("desvantagens.json"))?;

    let conn = db.conn()?;
    migration::importador_v1::importar_v1_completo(&conn, &dir, &jog, &npc, &per, &van, &des)
}

#[tauri::command]
fn retrato_data_url(app: tauri::AppHandle, caminho: String) -> Result<String, AppError> {
    use base64::prelude::{Engine as _, BASE64_STANDARD};
    let p = images_dir(&app)?.join(&caminho);
    let bytes = std::fs::read(p)?;
    let b64 = BASE64_STANDARD.encode(&bytes);
    Ok(format!("data:image/png;base64,{b64}"))
}

#[tauri::command]
fn criar_personagem(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    input: PersonagemInput,
) -> Result<i64, AppError> {
    let dir = images_dir(&app)?;
    let conn = db.conn()?;
    let tx = conn.unchecked_transaction()?;
    let id = db::repositorios::criar_personagem(&tx, &dir, &input)?;
    tx.commit()?;
    Ok(id)
}

#[tauri::command]
fn atualizar_personagem(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    id: i64,
    input: PersonagemInput,
) -> Result<(), AppError> {
    let dir = images_dir(&app)?;
    let conn = db.conn()?;
    let tx = conn.unchecked_transaction()?;
    db::repositorios::atualizar_personagem(&tx, &dir, id, &input)?;
    tx.commit()?;
    Ok(())
}

#[tauri::command]
fn excluir_personagem(db: tauri::State<Db>, id: i64) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::excluir_personagem(&conn, id)
}

// ---------- Etiquetas (organização das fichas de NPC) ----------

#[tauri::command]
fn listar_etiquetas(db: tauri::State<Db>) -> Result<Vec<Etiqueta>, AppError> {
    let conn = db.conn()?;
    db::repositorios::listar_etiquetas(&conn)
}

#[tauri::command]
fn criar_etiqueta(db: tauri::State<Db>, input: EtiquetaInput) -> Result<Etiqueta, AppError> {
    let conn = db.conn()?;
    db::repositorios::etiqueta_criar(&conn, &input)
}

#[tauri::command]
fn atualizar_etiqueta(
    db: tauri::State<Db>,
    id: i64,
    input: EtiquetaInput,
) -> Result<Etiqueta, AppError> {
    let conn = db.conn()?;
    db::repositorios::etiqueta_atualizar(&conn, id, &input)
}

#[tauri::command]
fn excluir_etiqueta(db: tauri::State<Db>, id: i64) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::etiqueta_excluir(&conn, id)
}

/// Atribuição rápida (galeria/Batalha) sem passar pelo formulário inteiro.
#[tauri::command]
fn definir_etiquetas_personagem(
    db: tauri::State<Db>,
    personagem_id: i64,
    etiquetas: Vec<String>,
) -> Result<Vec<String>, AppError> {
    let conn = db.conn()?;
    let tx = conn.unchecked_transaction()?;
    let out = db::repositorios::definir_etiquetas_personagem(&tx, personagem_id, &etiquetas)?;
    tx.commit()?;
    Ok(out)
}

// ---------- Export / import de fichas ----------

/// Grava as fichas pedidas como JSON (array) no `caminho` escolhido no diálogo
/// nativo. Devolve quantas foram.
#[tauri::command]
fn exportar_fichas(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    ids: Vec<i64>,
    caminho: String,
) -> Result<usize, AppError> {
    let dir = images_dir(&app)?;
    let conn = db.conn()?;
    let json = db::portabilidade::exportar(&conn, &dir, &ids)?;
    std::fs::write(&caminho, json)?;
    Ok(ids.len())
}

/// Lê um arquivo de export e cria as fichas (nunca sobrescreve; nome repetido
/// vira "Nome (2)"). Tudo numa transação: arquivo corrompido não deixa metade.
#[tauri::command]
fn importar_fichas(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    caminho: String,
) -> Result<ResultadoImport, AppError> {
    let dir = images_dir(&app)?;
    let json = std::fs::read_to_string(&caminho)?;
    let conn = db.conn()?;
    let tx = conn.unchecked_transaction()?;
    let (importadas, erros) = db::portabilidade::importar(&tx, &dir, &json)?;
    tx.commit()?;
    Ok(ResultadoImport { importadas, erros })
}

#[tauri::command]
fn listar_catalogos(db: tauri::State<Db>) -> Result<Catalogos, AppError> {
    let conn = db.conn()?;
    db::repositorios::listar_catalogos(&conn)
}

// ---------- Compêndio (CRUD dos catálogos) ----------

#[tauri::command]
fn criar_catalogo_pericia(
    db: tauri::State<Db>,
    input: CatalogoPericiaInput,
) -> Result<CatalogoPericia, AppError> {
    let conn = db.conn()?;
    db::repositorios::catalogo_pericia_criar(&conn, &input)
}

#[tauri::command]
fn atualizar_catalogo_pericia(
    db: tauri::State<Db>,
    id: i64,
    input: CatalogoPericiaInput,
) -> Result<CatalogoPericia, AppError> {
    let conn = db.conn()?;
    db::repositorios::catalogo_pericia_atualizar(&conn, id, &input)
}

#[tauri::command]
fn excluir_catalogo_pericia(db: tauri::State<Db>, id: i64) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::catalogo_pericia_excluir(&conn, id)
}

#[tauri::command]
fn criar_catalogo_traco(
    db: tauri::State<Db>,
    tipo: String,
    input: CatalogoTracoInput,
) -> Result<CatalogoTraco, AppError> {
    let conn = db.conn()?;
    db::repositorios::catalogo_traco_criar(&conn, &tipo, &input)
}

#[tauri::command]
fn atualizar_catalogo_traco(
    db: tauri::State<Db>,
    tipo: String,
    id: i64,
    input: CatalogoTracoInput,
) -> Result<CatalogoTraco, AppError> {
    let conn = db.conn()?;
    db::repositorios::catalogo_traco_atualizar(&conn, &tipo, id, &input)
}

#[tauri::command]
fn excluir_catalogo_traco(db: tauri::State<Db>, tipo: String, id: i64) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::catalogo_traco_excluir(&conn, &tipo, id)
}

// ---------- Batalha (Fase 2) ----------

#[tauri::command]
fn batalha_estado(bat: tauri::State<EstadoBatalha>) -> Result<Estado, AppError> {
    let b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    Ok(b.estado().clone())
}

/// Adiciona um combatente a partir de um personagem (snapshot dos stats).
#[tauri::command]
fn batalha_adicionar(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    personagem_id: i64,
    turnos_extras: u8,
) -> Result<Estado, AppError> {
    // carrega e libera o lock do DB antes de travar a batalha
    let p = {
        let conn = db.conn()?;
        db::repositorios::get_personagem(&conn, personagem_id)?
    };
    let mut base = [0i64; 8];
    for a in &p.atributos {
        if let Some(attr) = Atributo::da_chave(&a.nome) {
            base[attr.indice()] = a.valor;
        }
    }
    let entrada = EntradaCombatente {
        personagem_ref: Some(p.id),
        nome: p.nome,
        tipo: if p.tipo == "npc" { Tipo::Npc } else { Tipo::Jogador },
        faccao: None,
        base,
        pools: Pools { hp: p.hp, sp: p.sp, escudo: p.escudo },
        turnos_extras,
    };
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.adicionar_combatente(entrada);
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_remover(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.remover_combatente(id)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_dano(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    valor: i64,
    pool: Option<Pool>,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.aplicar_dano(id, valor, pool)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_curar(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    valor: i64,
    pool: Pool,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.recuperar(id, valor, pool)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_proximo_turno(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.proximo_turno();
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_nova_rodada(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.nova_rodada();
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_desfazer(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.desfazer();
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_resetar(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.resetar();
    Ok(persistir_e_devolver(db.inner(), &b))
}

// ---------- Presets de batalha (encontros pré-montados) ----------

/// Tira um snapshot da batalha ATIVA e salva como um NOVO preset nomeado.
#[tauri::command]
fn batalha_preset_salvar(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    nome: String,
    descricao: String,
) -> Result<PresetResumo, AppError> {
    let b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    let (estado, proximo_id) = b.instantaneo();
    let conn = db.conn()?;
    db::repositorios::batalha_preset_salvar(&conn, &nome, &descricao, estado, proximo_id as i64)
}

#[tauri::command]
fn batalha_preset_listar(db: tauri::State<Db>) -> Result<Vec<PresetResumo>, AppError> {
    let conn = db.conn()?;
    db::repositorios::batalha_preset_listar(&conn)
}

/// Substitui a batalha ATIVA pelo preset `id`. Empilha undo como qualquer
/// outro comando mutador (`batalha_desfazer` volta pro estado de antes).
#[tauri::command]
fn batalha_preset_carregar(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: i64,
) -> Result<Estado, AppError> {
    // lê e libera o lock do DB antes de travar a batalha — mesma ordem de
    // `batalha_adicionar` (evita a inversão banida pela invariante de lock).
    let (estado, proximo_id, nome) = {
        let conn = db.conn()?;
        db::repositorios::batalha_preset_obter(&conn, id)?
    };
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.restaurar_de_preset(estado, proximo_id as u32, &nome);
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Atualiza o snapshot de um preset já existente com o estado ATUAL da
/// batalha ativa (nome/descrição não mudam — use `batalha_preset_renomear`).
#[tauri::command]
fn batalha_preset_sobrescrever(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: i64,
) -> Result<PresetResumo, AppError> {
    let b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    let (estado, proximo_id) = b.instantaneo();
    let conn = db.conn()?;
    db::repositorios::batalha_preset_sobrescrever(&conn, id, estado, proximo_id as i64)
}

#[tauri::command]
fn batalha_preset_renomear(
    db: tauri::State<Db>,
    id: i64,
    nome: String,
    descricao: String,
) -> Result<PresetResumo, AppError> {
    let conn = db.conn()?;
    db::repositorios::batalha_preset_renomear(&conn, id, &nome, &descricao)
}

#[tauri::command]
fn batalha_preset_excluir(db: tauri::State<Db>, id: i64) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::batalha_preset_excluir(&conn, id)
}

#[tauri::command]
fn batalha_editar_turnos_extras(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    valor: u8,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.editar_turnos_extras(id, valor)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Aplica uma transformação da ficha do combatente (lê os deltas via `personagem_ref`).
#[tauri::command]
fn batalha_transformar(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    transformacao: String,
) -> Result<Estado, AppError> {
    // 1) descobre a ficha de origem (lock curto na batalha)
    let personagem_ref = {
        let b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
        b.combatente(id)
            .ok_or_else(|| AppError::Msg(format!("combatente {} não encontrado", id)))?
            .personagem_ref
            .ok_or_else(|| AppError::Msg("combatente sem ficha não pode transformar".into()))?
    };
    // 2) carrega a ficha e monta os deltas de atributo da transformação
    let deltas = {
        let conn = db.conn()?;
        let ficha = db::repositorios::get_personagem(&conn, personagem_ref)?;
        let t = ficha
            .transformacoes
            .into_iter()
            .find(|t| t.nome == transformacao)
            .ok_or_else(|| {
                AppError::Msg(format!("transformação '{}' não encontrada na ficha", transformacao))
            })?;
        t.modificadores
            .into_iter()
            .filter_map(|m| Atributo::da_chave(&m.atributo).map(|a| (a, m.delta)))
            .collect::<Vec<(Atributo, i64)>>()
    };
    // 3) aplica (o motor troca a transformação ativa e reordena a iniciativa)
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.aplicar_transformacao(id, transformacao, deltas)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_reverter_transformacao(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.reverter_transformacao(id)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_usar_habilidade(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    habilidade: String,
    tempo: String,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.usar_habilidade(id, habilidade, parse_cooldown(&tempo))?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_reabilitar_habilidade(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    habilidade: String,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.reabilitar_habilidade(id, habilidade)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_alternar_modo_ordem(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    manual: bool,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.alternar_modo_ordem(manual);
    Ok(persistir_e_devolver(db.inner(), &b))
}

#[tauri::command]
fn batalha_definir_ordem(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    ordem: Vec<u32>,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.definir_ordem(ordem)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Define o modificador manual (buff/debuff ad-hoc) de atributos. `deltas` vazio = resetar.
#[tauri::command]
fn batalha_modificador_manual(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    deltas: Vec<(Atributo, i64)>,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.definir_modificador_manual(id, deltas)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Define o nível de concentração (marcador visual do mestre, 0..=3) de um
/// combatente. O botão no cockpit cicla `(atual + 1) % 4`; o clamp fica no
/// domínio (`definir_concentracao`).
#[tauri::command]
fn batalha_concentracao(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    nivel: u8,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.definir_concentracao(id, nivel)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Rank (0..=13) de um atributo para um valor efetivo — usado pelo perfil da batalha ao vivo.
#[tauri::command]
fn calcular_rank(atributo: String, valor: i64) -> u8 {
    domain::rank::calcular_rank(&atributo, valor)
}

// ---------- Peças no mapa (Fase 5) ----------

/// Dimensões `(linhas, colunas)` do mapa ativo da batalha, pra clampar as peças.
/// Erro se não há mapa ativo ou se o mapa sumiu do banco. Locks curtos, um de
/// cada vez (batalha e depois DB), pra não segurar dois ao mesmo tempo.
fn mapa_ativo_dims(db: &Db, bat: &EstadoBatalha) -> Result<(u16, u16), AppError> {
    let mapa_id = {
        let b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
        b.estado()
            .mapa_id
            .ok_or_else(|| AppError::Msg("nenhum mapa ativo na batalha".into()))?
    };
    let conn = db.conn()?;
    let m = db::repositorios::mapa_get(&conn, mapa_id)?;
    Ok((m.linhas as u16, m.colunas as u16))
}

/// Define o mapa ativo da batalha (fonte única do cockpit e do sync do Discord).
#[tauri::command]
fn batalha_definir_mapa(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    mapa_id: i64,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.definir_mapa(mapa_id);
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Posiciona a peça de um combatente (drag do roster). Clampa ao grid e recusa
/// célula ocupada; o estado devolvido reflete se moveu (posição inalterada = rejeitado).
#[tauri::command]
fn batalha_posicionar_peca(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    linha: u16,
    coluna: u16,
) -> Result<Estado, AppError> {
    let (linhas, colunas) = mapa_ativo_dims(db.inner(), bat.inner())?;
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.posicionar_peca(id, linha, coluna, linhas, colunas)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Move uma peça já no mapa (clicar peça + clicar destino). Mesmas regras de posicionar.
#[tauri::command]
fn batalha_mover_peca(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    linha: u16,
    coluna: u16,
) -> Result<Estado, AppError> {
    let (linhas, colunas) = mapa_ativo_dims(db.inner(), bat.inner())?;
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.mover_peca(id, linha, coluna, linhas, colunas)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Tira a peça de um combatente do mapa.
#[tauri::command]
fn batalha_remover_peca(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.remover_peca(id)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Registra um efeito de dano recorrente (tica no início do turno do alvo, por
/// `turnos` turnos do alvo). Mesmo `origem` substitui o efeito anterior.
#[tauri::command]
fn batalha_adicionar_efeito_recorrente(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    origem: String,
    hp: i64,
    sp: i64,
    escudo: i64,
    escudo_transborda: bool,
    turnos: u8,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.adicionar_efeito_recorrente(
        id,
        EfeitoRecorrente {
            origem,
            dano: DanoDistribuido { hp, sp, escudo, escudo_transborda },
            duracao: turnos,
        },
    )?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Remove todos os efeitos recorrentes de um combatente.
#[tauri::command]
fn batalha_limpar_efeitos_recorrentes(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.limpar_efeitos_recorrentes(id)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

/// Calculadora de dano: dano distribuído instantâneo + (opcional) o mesmo dano
/// recorrente por `repetir_turnos` turnos. Uma única op (um undo).
#[tauri::command]
fn batalha_calculadora_dano(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    id: u32,
    hp: i64,
    sp: i64,
    escudo: i64,
    escudo_transborda: bool,
    repetir_turnos: Option<u8>,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.aplicar_calculadora_dano(
        id,
        DanoDistribuido { hp, sp, escudo, escudo_transborda },
        repetir_turnos,
    )?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

// ---------- Mapa (Fase 3) ----------

#[tauri::command]
fn listar_mapas(db: tauri::State<Db>) -> Result<Vec<MapaResumo>, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_listar(&conn)
}

#[tauri::command]
fn get_mapa(db: tauri::State<Db>, id: i64) -> Result<Mapa, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_get(&conn, id)
}

#[tauri::command]
fn criar_mapa(db: tauri::State<Db>, input: MapaInput) -> Result<Mapa, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_criar(&conn, &input)
}

#[tauri::command]
fn atualizar_mapa(db: tauri::State<Db>, id: i64, input: MapaInput) -> Result<Mapa, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_atualizar(&conn, id, &input)
}

#[tauri::command]
fn duplicar_mapa(db: tauri::State<Db>, id: i64) -> Result<Mapa, AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_duplicar(&conn, id)
}

#[tauri::command]
fn excluir_mapa(db: tauri::State<Db>, id: i64) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::mapa_excluir(&conn, id)
}

/// Render do estado ATUAL do editor. Fonte única do texto do Discord. Sobrepõe
/// as peças da batalha quando `mapa_id` é o mapa ativo; senão (ou sem id) só terreno.
#[tauri::command]
fn render_mapa_discord(
    bat: tauri::State<EstadoBatalha>,
    input: MapaInput,
    mapa_id: Option<i64>,
) -> String {
    let pecas = bat.pecas_para_mapa(mapa_id);
    let anotacoes = bat.anotacoes_para_mapa(mapa_id);
    let input = normalizar(input);
    let m = Mapa {
        id: 0,
        titulo: input.titulo,
        colunas: input.colunas,
        linhas: input.linhas,
        grade: input.grade,
        legenda: input.legenda,
        efeito: input.efeito,
        criado_em: String::new(),
        atualizado_em: String::new(),
    };
    render_discord(&m, &pecas, &anotacoes)
}

/// Define (ou remove, com `simbolo` vazio) a anotação ao vivo de uma célula do
/// mapa — camada da batalha (overlay), não edita o mapa permanente.
#[tauri::command]
fn batalha_anotar_mapa(
    db: tauri::State<Db>,
    bat: tauri::State<EstadoBatalha>,
    linha: u16,
    coluna: u16,
    simbolo: String,
) -> Result<Estado, AppError> {
    let mut b = bat.0.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    b.definir_anotacao(linha, coluna, simbolo)?;
    Ok(persistir_e_devolver(db.inner(), &b))
}

// ---------- Nota ----------

#[tauri::command]
fn listar_notas(db: tauri::State<Db>) -> Result<Vec<NotaResumo>, AppError> {
    let conn = db.conn()?;
    db::repositorios::nota_listar(&conn)
}

#[tauri::command]
fn get_nota(db: tauri::State<Db>, id: i64) -> Result<Nota, AppError> {
    let conn = db.conn()?;
    db::repositorios::nota_get(&conn, id)
}

#[tauri::command]
fn criar_nota(db: tauri::State<Db>, input: NotaInput) -> Result<Nota, AppError> {
    let conn = db.conn()?;
    db::repositorios::nota_criar(&conn, &input)
}

#[tauri::command]
fn atualizar_nota(db: tauri::State<Db>, id: i64, input: NotaInput) -> Result<Nota, AppError> {
    let conn = db.conn()?;
    db::repositorios::nota_atualizar(&conn, id, &input)
}

#[tauri::command]
fn excluir_nota(db: tauri::State<Db>, id: i64) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::nota_excluir(&conn, id)
}

// ---------- Favorito (música — SQLite v2, dono dos dados) ----------

#[tauri::command]
fn listar_favoritos(db: tauri::State<Db>) -> Result<Vec<Favorito>, AppError> {
    let conn = db.conn()?;
    db::repositorios::favorito_listar(&conn)
}

#[tauri::command]
fn criar_favorito(db: tauri::State<Db>, input: FavoritoInput) -> Result<Favorito, AppError> {
    let conn = db.conn()?;
    db::repositorios::favorito_criar(&conn, &input)
}

#[tauri::command]
fn atualizar_favorito(
    db: tauri::State<Db>,
    id: i64,
    input: FavoritoInput,
) -> Result<Favorito, AppError> {
    let conn = db.conn()?;
    db::repositorios::favorito_atualizar(&conn, id, &input)
}

#[tauri::command]
fn excluir_favorito(db: tauri::State<Db>, id: i64) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::favorito_excluir(&conn, id)
}

// ---------- Config (KV — usado pela tela Balanceamento p/ chaves Gemini) ----------

#[tauri::command]
fn config_get(db: tauri::State<Db>, chave: String) -> Result<Option<String>, AppError> {
    let conn = db.conn()?;
    db::repositorios::config_get(&conn, &chave)
}

#[tauri::command]
fn config_set(db: tauri::State<Db>, chave: String, valor: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::config_set(&conn, &chave, &valor)
}

// ---------- Sincronização de nuvem (Fase 1 — comandos, sem UI ainda) ----------
// Ver docs/plans/2026-08-10-sync-nuvem.md. Lógica pura em `db::sincronizacao_nuvem`;
// aqui só a parte que depende do `AppHandle` (caminhos) e da conexão viva.

/// `app_data/rpg.db` e `app_data/images` — mesmos caminhos de `setup()`.
fn caminhos_banco(app: &tauri::AppHandle) -> Result<(std::path::PathBuf, std::path::PathBuf), AppError> {
    let dir = app.path().app_data_dir().map_err(|e| AppError::Msg(e.to_string()))?;
    Ok((dir.join("rpg.db"), dir.join("images")))
}

/// Onde `enviar`/`sync_baixar`/o boot materializam o pacote remoto em disco
/// LOCAL antes de aplicar (Fase 3 — nunca a pasta observada por uma nuvem de
/// arquivos, e nunca o Drive em si). Mesmo diretório que `enviar` já usa por
/// dentro (`sync_tmp` ao lado do `rpg.db`) — reaproveitado aqui pros backups
/// remotos do `TransporteDrive`.
fn diretorio_sync_tmp(app: &tauri::AppHandle) -> Result<std::path::PathBuf, AppError> {
    Ok(app.path().app_data_dir().map_err(|e| AppError::Msg(e.to_string()))?.join("sync_tmp"))
}

/// Nome da pasta "Ficha de RPG" no Google Drive do usuário (Q1/Q3 do plano —
/// nome distinto do `grimorio` para não colidir apesar do `client_id`
/// compartilhado).
const NOME_PASTA_DRIVE: &str = "Ficha de RPG";

#[tauri::command]
fn sync_definir_pasta(db: tauri::State<Db>, caminho: String) -> Result<(), AppError> {
    let conn = db.conn()?;
    db::repositorios::config_set(&conn, sincronizacao_nuvem::CHAVE_SYNC_PASTA, &caminho)
}

#[tauri::command]
fn sync_pasta_atual(db: tauri::State<Db>) -> Result<Option<String>, AppError> {
    let conn = db.conn()?;
    db::repositorios::config_get(&conn, sincronizacao_nuvem::CHAVE_SYNC_PASTA)
}

/// FIX C (revisão adversarial, 2026-08-11): antes chamava `status(&conn)`
/// direto, que só olhava pra `sync_pasta` — com transporte Drive isso é
/// sempre `None`, então a tela via "sem nuvem" mesmo com pacote real do
/// outro lado. Agora monta o transporte configurado (mesmo caminho de
/// `sync_enviar`/`sync_baixar`) antes de perguntar o status. Sem transporte
/// configurado ainda (pasta nunca escolhida), o `SemNuvem` de sempre.
///
/// Deadlock de I/O de rede sob o Mutex do banco (docs/plans/2026-08-11-sync-google-drive.md,
/// fix pós-Fase 3): o `Mutex<Connection>` do `Db` gerenciado é a ÚNICA
/// conexão do app — todo comando tranca esse Mutex, então nenhuma chamada de
/// rede pode rodar com ele travado (senão o app inteiro trava até a rede
/// responder). Fase 1 (abaixo) lê tudo que precisa do banco com um lock BREVE
/// que cai antes do `block_on`; a Fase 2, sem nenhum `db.conn()` vivo, faz a
/// rede (`montar_transporte_de` + `status`, cujas assinaturas nem recebem
/// `Connection` — garantia estrutural, não convenção).
#[tauri::command]
fn sync_status(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    google: tauri::State<EstadoGoogle>,
    cofre: tauri::State<segredos::CofreState>,
) -> Result<SyncStatus, AppError> {
    let staging = diretorio_sync_tmp(&app)?;

    // Fase 1 — lock BREVE: só leitura do banco. O guard cai no fim deste
    // bloco, antes do `block_on` da Fase 2.
    let (tipo, pasta, carimbo, sujo) = {
        let conn = db.conn()?;
        let (tipo, pasta) = ler_config_transporte(&conn)?;
        let carimbo = sincronizacao_nuvem::carimbo_ler(&conn)?;
        let sujo = sincronizacao_nuvem::banco_esta_sujo(&conn)?;
        (tipo, pasta, carimbo, sujo)
    };

    // Fase 2 — rede, SEM lock nenhum sobre o `Db`.
    tauri::async_runtime::block_on(async {
        let Some(transporte) = montar_transporte_de(tipo, pasta, &staging, &google, &cofre).await? else {
            return Ok(SyncStatus {
                acao: sincronizacao_nuvem::Acao::SemNuvem,
                contador_nuvem: None,
                contador_local: carimbo.contador,
                sujo,
                hora: carimbo.hora,
            });
        };
        sincronizacao_nuvem::status(&carimbo, sujo, transporte.as_ref()).await
    })
}

/// Lê só a config do transporte (`sync_transporte`/`sync_pasta`) — Fase 1
/// (lock breve) de todo comando de sync. Nunca faz rede.
fn ler_config_transporte(
    conn: &rusqlite::Connection,
) -> Result<(sincronizacao_nuvem::TipoTransporte, Option<String>), AppError> {
    let tipo = sincronizacao_nuvem::TipoTransporte::ler(conn)?;
    let pasta = db::repositorios::config_get(conn, sincronizacao_nuvem::CHAVE_SYNC_PASTA)?;
    Ok((tipo, pasta))
}

/// Monta o transporte a partir de config JÁ LIDA por [`ler_config_transporte`]
/// (Fase 2 — sem `Connection` na assinatura: garantia estrutural de que esta
/// função, que faz `access_token().await` = rede, nunca pode segurar o Mutex
/// do `Db`). `Ok(None)` = transporte "pasta" mas `sync_pasta` ainda não foi
/// escolhida — quem chama decide o que fazer (recusar com mensagem nos
/// comandos manuais; não fazer nada no boot). Transporte "drive" sem conta
/// conectada (ou cofre trancado) sobe como `Err` — o usuário vê a mensagem
/// clara que `google::auth::access_token` já produz.
async fn montar_transporte_de(
    tipo: sincronizacao_nuvem::TipoTransporte,
    pasta: Option<String>,
    dir_local: &std::path::Path,
    estado_google: &EstadoGoogle,
    cofre: &segredos::CofreState,
) -> Result<Option<Box<dyn sincronizacao_nuvem::Transporte>>, AppError> {
    match tipo {
        sincronizacao_nuvem::TipoTransporte::Pasta => {
            let Some(pasta) = pasta else {
                return Ok(None);
            };
            Ok(Some(Box::new(sincronizacao_nuvem::TransportePasta::new(pasta))))
        }
        sincronizacao_nuvem::TipoTransporte::Drive => {
            let token = access_token(estado_google, cofre).await.map_err(AppError::Msg)?;
            let http = google::drive::http()?;
            Ok(Some(Box::new(sincronizacao_nuvem::TransporteDrive::new(
                http,
                token,
                NOME_PASTA_DRIVE,
                dir_local.to_path_buf(),
            ))))
        }
    }
}

/// Resposta padrão quando `montar_transporte` devolve `None` (transporte
/// "pasta" sem `sync_pasta` escolhida ainda) — mesma mensagem de antes da
/// Fase 3, só que agora cobre os dois transportes por igual.
fn sync_resultado_sem_transporte() -> SyncResultado {
    SyncResultado {
        sucesso: false,
        mensagem: "nenhuma pasta de sincronização definida".into(),
        contador: None,
        backup: None,
    }
}

#[tauri::command]
fn sync_enviar(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    google: tauri::State<EstadoGoogle>,
    cofre: tauri::State<segredos::CofreState>,
    forcar: bool,
) -> Result<SyncResultado, AppError> {
    let (banco_vivo, imagens_dir) = caminhos_banco(&app)?;
    let staging = diretorio_sync_tmp(&app)?;

    // Fase 1 — lock BREVE: lê tudo que precisa do banco. `agora` é lido
    // aqui (antes da rede) porque `enviar` não toca mais o banco — é só o
    // que vira `carimbo_hora` se der certo, não precisa ser o instante exato
    // em que a publicação terminou.
    let (tipo, pasta, carimbo, agora) = {
        let conn = db.conn()?;
        let (tipo, pasta) = ler_config_transporte(&conn)?;
        let carimbo = sincronizacao_nuvem::carimbo_ler(&conn)?;
        let agora = sincronizacao_nuvem::sqlite_agora(&conn)?;
        (tipo, pasta, carimbo, agora)
    };

    // Fase 2 — rede, SEM lock: monta o transporte (pode envolver
    // `access_token().await`) e publica o pacote. `enviar` não recebe
    // `Connection` — não grava carimbo nenhum, só devolve o plano.
    let plano = tauri::async_runtime::block_on(async {
        let Some(transporte) = montar_transporte_de(tipo, pasta, &staging, &google, &cofre).await? else {
            return Ok(None);
        };
        sincronizacao_nuvem::enviar(&carimbo, &agora, &banco_vivo, &imagens_dir, transporte.as_ref(), forcar)
            .await
            .map(Some)
    })?;
    let Some(plano) = plano else {
        return Ok(sync_resultado_sem_transporte());
    };

    // Fase 3 — lock BREVE: grava o carimbo conforme o plano (rede já
    // terminou e soltou o Mutex há muito).
    match plano {
        PlanoEnvio::Recusado(resultado) => Ok(resultado),
        PlanoEnvio::Enviado { novo_contador, agora, backup } => {
            let conn = db.conn()?;
            sincronizacao_nuvem::finalizar_enviar(&conn, novo_contador, &agora, backup)
        }
    }
}

/// `sync_baixar` substitui o `rpg.db` por baixo da conexão viva — no Windows
/// o `rename` de `aplicar_pacote` não convive com um handle aberto no
/// destino, então a conexão do `Db` gerenciado é fechada, o arquivo é
/// trocado, e uma nova conexão é reaberta antes de devolver.
///
/// Deadlock de I/O de rede sob o Mutex do banco (docs/plans/2026-08-11-sync-google-drive.md,
/// fix pós-Fase 3): antes o `Mutex<Connection>` ficava travado da Fase 1 até
/// o fim, incluindo TODA a rede (`planejar_baixar` + o download em si) — um
/// `sync_baixar` sozinho travava o app inteiro enquanto baixava do Drive.
/// Agora: Fase 1 (lock breve) só lê config/carimbo/sujo; Fase 2 (SEM lock)
/// decide via `planejar_baixar` e, se for aplicar, já baixa o pacote inteiro
/// pra um temp local (`baixar_pacote_para`, rede) — ainda sem tocar o banco
/// vivo; Fase 3 (lock breve de novo) fecha a conexão, aplica o temp já
/// baixado (`aplicar_pacote`, só disco local — nenhum `.await` aqui dentro),
/// reabre e grava o carimbo. O `Mutex` só fica travado durante I/O local
/// rápido, nunca durante a espera de rede.
#[tauri::command]
fn sync_baixar(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    google: tauri::State<EstadoGoogle>,
    cofre: tauri::State<segredos::CofreState>,
    forcar: bool,
) -> Result<SyncResultado, AppError> {
    let (banco_destino, imagens_dir) = caminhos_banco(&app)?;
    let staging = diretorio_sync_tmp(&app)?;

    // Fase 1 — lock BREVE: só leitura do banco.
    let (tipo, pasta, carimbo, sujo) = {
        let conn = db.conn()?;
        let (tipo, pasta) = ler_config_transporte(&conn)?;
        let carimbo = sincronizacao_nuvem::carimbo_ler(&conn)?;
        let sujo = sincronizacao_nuvem::banco_esta_sujo(&conn)?;
        (tipo, pasta, carimbo, sujo)
    };

    // Fase 2 — rede, SEM lock: decide a ação e, se liberar aplicar, já baixa
    // o `.rpgpack` inteiro pra um temp local — o banco vivo ainda nem foi
    // tocado.
    std::fs::create_dir_all(&staging)?;
    let temp_pacote = staging.join(format!("{}.baixado", sincronizacao_nuvem::NOME_PACOTE));
    let decisao: Result<Result<sincronizacao_nuvem::Manifesto, SyncResultado>, AppError> =
        tauri::async_runtime::block_on(async {
            let Some(transporte) = montar_transporte_de(tipo, pasta, &staging, &google, &cofre).await? else {
                return Ok(Err(sync_resultado_sem_transporte()));
            };
            let manifesto = match sincronizacao_nuvem::planejar_baixar(&carimbo, sujo, transporte.as_ref(), forcar)
                .await?
            {
                PlanoBaixar::Recusar(resultado) => return Ok(Err(resultado)),
                PlanoBaixar::Aplicar(manifesto) => manifesto,
            };
            transporte.baixar_pacote_para(&temp_pacote).await?;
            Ok(Ok(manifesto))
        });
    let decisao = decisao?;
    let manifesto = match decisao {
        Err(resultado) => {
            let _ = std::fs::remove_file(&temp_pacote);
            return Ok(resultado);
        }
        Ok(manifesto) => manifesto,
    };

    // Fase 3 — lock BREVE: fecha a conexão viva, aplica o pacote JÁ BAIXADO
    // (puramente local, sem `.await`), reabre e grava o carimbo. Isolado numa
    // função própria pra `?` não pular a limpeza do temp logo abaixo.
    let resultado = aplicar_baixar_local(&db, &temp_pacote, &banco_destino, &imagens_dir, &manifesto);
    let _ = std::fs::remove_file(&temp_pacote);
    resultado
}

/// Fase 3 de `sync_baixar` (ver doc lá): fecha/reabre a conexão gerenciada
/// ao redor de `aplicar_pacote` (troca de arquivo local) e grava o carimbo.
/// Nenhum `.await` aqui dentro — por isso não é `async` e não precisa de
/// `block_on`; o Mutex fica travado só pelo tempo de I/O de disco local.
fn aplicar_baixar_local(
    db: &Db,
    temp_pacote: &std::path::Path,
    banco_destino: &std::path::Path,
    imagens_dir: &std::path::Path,
    manifesto: &sincronizacao_nuvem::Manifesto,
) -> Result<SyncResultado, AppError> {
    let mut guard = db.conn()?;

    // FIX B (revisão adversarial, 2026-08-11): o pacote chega scrubado de
    // `sync_pasta`/`sync_machine_id`/`sync_transporte` (não só Gemini), então
    // depois de `materializar_banco` trocar o `rpg.db` inteiro essas chaves
    // somem do banco aplicado — a identidade DESTA máquina precisa ser lida
    // ANTES da troca e regravada DEPOIS. Nunca pode virar a identidade da
    // máquina que enviou o pacote.
    let identidade_local = sincronizacao_nuvem::identidade_local_preservar(&guard)?;

    // Troca a conexão viva por uma em memória (placeholder) enquanto o
    // arquivo em disco é substituído, e fecha a antiga antes do rename.
    let placeholder = open_in_memory_para_troca()?;
    let antiga = std::mem::replace(&mut *guard, placeholder);
    if let Err((_, e)) = antiga.close() {
        eprintln!("[sync_baixar] falha ao fechar conexão antiga: {e}");
    }

    let backup = sincronizacao_nuvem::aplicar_pacote(temp_pacote, banco_destino, imagens_dir);

    *guard = open(banco_destino)?;
    sincronizacao_nuvem::identidade_local_restaurar(&guard, &identidade_local)?;

    let backup = backup?;
    sincronizacao_nuvem::finalizar_baixar(&guard, manifesto, backup)
}

fn open_in_memory_para_troca() -> Result<rusqlite::Connection, AppError> {
    db::connection::open_in_memory()
}

/// Verificação de boot: OLHA a nuvem e avisa, nunca move dado (mudança de
/// 2026-08-11, pedido do usuário — "só sincroniza quando eu apertar enviar ou
/// baixar"). Antes ela baixava o `.rpgpack` inteiro e trocava o banco sozinha
/// quando o local estava limpo; agora o único I/O remoto é `ler_manifesto`
/// (poucos KB), e quem baixa é o botão Baixar da tela Sincronização.
///
/// Continua fora do `.setup()` do Tauri (o frontend dispara depois do render,
/// `SyncBootDriver`) — rede no `setup()` segura a janela fechada. E continua
/// com o mesmo faseamento do resto: lock BREVE só pra ler config/carimbo/sujo,
/// rede sem lock nenhum.
///
/// Erro de rede/transporte indisponível não vira `Err` pra UI — devolve
/// `EventoBootSync::Nenhum` e loga, igual o boot antigo dentro do `setup()`
/// fazia (silencioso: o app não pode travar/mostrar erro só porque a nuvem
/// está fora do ar).
#[tauri::command]
fn sync_verificar_boot(
    app: tauri::AppHandle,
    db: tauri::State<Db>,
    google: tauri::State<EstadoGoogle>,
    cofre: tauri::State<segredos::CofreState>,
) -> Result<EventoBootSync, AppError> {
    // `staging` não recebe mais pacote baixado — segue aqui só porque
    // `montar_transporte_de` precisa de um diretório local pro transporte.
    let staging = diretorio_sync_tmp(&app)?;

    // Fase 1 — lock BREVE: só leitura do banco.
    let (tipo, pasta, carimbo, sujo) = {
        let conn = db.conn()?;
        let (tipo, pasta) = ler_config_transporte(&conn)?;
        let carimbo = sincronizacao_nuvem::carimbo_ler(&conn)?;
        let sujo = sincronizacao_nuvem::banco_esta_sujo(&conn)?;
        (tipo, pasta, carimbo, sujo)
    };

    // Fase 2 — rede, SEM lock: acha transporte e lê só o manifesto remoto.
    // Qualquer erro aqui (transporte indisponível, rede fora) vira `None` —
    // nunca derruba o app.
    std::fs::create_dir_all(&staging)?;
    let resultado_fase2: Result<Option<PlanoBoot>, AppError> =
        tauri::async_runtime::block_on(async {
            let Some(transporte) = montar_transporte_de(tipo, pasta, &staging, &google, &cofre).await? else {
                return Ok(None);
            };
            Ok(Some(sincronizacao_nuvem::planejar_boot(&carimbo, sujo, transporte.as_ref()).await?))
        });
    let plano = match resultado_fase2 {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[sync boot] verificação falhou: {e}");
            None
        }
    };

    Ok(match plano {
        None | Some(PlanoBoot::Nenhum) => EventoBootSync::Nenhum,
        Some(PlanoBoot::NuvemMaisNova(m)) => {
            eprintln!("[sync boot] nuvem v{} mais nova — avisando (nada foi baixado)", m.contador);
            EventoBootSync::NuvemMaisNova { contador: m.contador }
        }
        Some(PlanoBoot::Conflito(m)) => {
            eprintln!(
                "[sync boot] nuvem v{} mais nova E há mudanças locais não enviadas — avisando",
                m.contador
            );
            EventoBootSync::ConflitoPendente { contador_nuvem: m.contador }
        }
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        // Sync via Google Drive (Fase 1, docs/plans/2026-08-11-sync-google-drive.md):
        // servidor local de retorno do OAuth (redirect loopback).
        .plugin(tauri_plugin_oauth::init())
        .setup(|app| {
            let dir = app.path().app_data_dir().expect("app_data_dir");
            std::fs::create_dir_all(&dir).ok();

            // Sincronização com a semente empacotada no instalador
            // (`resources/rpg_semente.db` + `resources/imagens_semente/`).
            // Semântica "o que um computador vê todos veem" (decisão do usuário,
            // 2026-08-10): máquina nova importa; UPDATE do app SUBSTITUI o banco
            // local pelo snapshot do master, com backup `rpg.db.bak-*` antes.
            // Falha aqui não derruba o app, só loga e segue.
            let banco_destino = dir.join("rpg.db");
            let banco_semente = recursos::resolver_recurso(app.handle(), "rpg_semente.db");
            let imagens_semente = recursos::resolver_recurso(app.handle(), "imagens_semente");
            let versao_app = app.package_info().version.to_string();
            match semente::sincronizar_semente(
                &banco_destino,
                banco_semente.as_deref(),
                &dir.join("images"),
                imagens_semente.as_deref(),
                &versao_app,
                &dir.join("semente_importada.txt"),
            ) {
                Ok(r) => eprintln!("[semente] {r:?}"),
                Err(e) => eprintln!("[semente] ignorada: {e}"),
            }

            let conn = open(&banco_destino).expect("abrir/migrar SQLite");

            // Cofre de segredos: cache local (senha já digitada nesta máquina) ou
            // re-import silencioso de blob rotacionado. `None` = a UI vai pedir a
            // senha-mestra (`segredos_status`/`segredos_destravar`). Carregado AQUI
            // (antes do boot automático de sync) porque o transporte "drive" da
            // Fase 3 precisa das credenciais do app OAuth pra tentar renovar o
            // access token pelo keyring — sem cofre, o boot simplesmente não acha
            // transporte Drive e segue como se não houvesse nada a fazer.
            let cofre = segredos::carregar_no_setup(app.handle(), &conn);
            // A semente pública chega sem as chaves Gemini (scrubadas no export do
            // master): depois de semear/substituir o banco, a config fica sem a
            // linha — repõe do cofre, sem sobrescrever edição local existente.
            if let Some(s) = &cofre {
                segredos::injetar_gemini_se_ausente(&conn, s);
            }

            // Sincronização de nuvem — o boot automático (Fase 3,
            // docs/plans/2026-08-11-sync-google-drive.md §4 "Boot
            // (automático)") NÃO roda mais aqui. `.setup()` não abre janela
            // nenhuma até devolver, e a sincronização é rede (baixar
            // manifesto/pacote do Drive) — um travamento de rede (firewall/
            // captive portal) prendia o app pra sempre na tela de splash. A
            // sincronização agora roda sob demanda, via comando
            // `sync_verificar_boot`, chamado pelo frontend depois do render
            // (`SyncBootDriver`), usando os estados gerenciados abaixo.

            // Seed único dos favoritos a partir do config do v1 (só quando a tabela
            // está vazia). Robusto: arquivo ausente ou JSON inválido pula sem erro.
            // Prioriza o recurso empacotado (`resources/discord_config.json`); cai pro
            // caminho fixo do v1 só se o recurso não resolver (ex.: máquina de dev sem
            // `bundle.resources` declarado ainda) — mesma máquina onde o v1 mora mesmo.
            // Não semeia por cima do que já veio no banco-semente: só dispara quando a
            // tabela `favorito` está vazia, e um banco-semente de verdade já chega com
            // os favoritos do usuário — a mesma checagem cobre os dois casos.
            let caminho_config = recursos::resolver_recurso(app.handle(), "discord_config.json")
                .unwrap_or_else(|| std::path::PathBuf::from(r"C:\dev\Projeto Rpg\discord_config.json"));
            if let Err(e) = db::repositorios::favorito_seed_se_vazio(&conn, &caminho_config) {
                eprintln!("[seed favoritos] ignorado: {e}");
            }
            // Canal do Discord salvo (persistido entre sessões): lê ANTES de mover
            // `conn` pro estado gerenciado e reidrata a sessão do sidecar.
            let canal_salvo = db::repositorios::config_get(&conn, CHAVE_CANAL).unwrap_or(None);
            // Restaura a batalha do último snapshot salvo (Fatia 1, Parte A).
            // Banco vazio ou snapshot incompatível = comportamento de hoje (batalha
            // nova) — `batalha_carregar` já cobre os dois casos com `None`.
            let dado = Box::new(DadoXorshift::semeado_pelo_relogio());
            let batalha = match db::repositorios::batalha_carregar(&conn) {
                Ok(CargaBatalha::Restaurada(estado, proximo_id)) => {
                    Batalha::restaurar(estado, proximo_id as u32, dado)
                }
                Ok(CargaBatalha::Vazia) => Batalha::nova(dado),
                // Havia uma batalha e não deu pra ler (schema mudou entre versões
                // do app, arquivo adulterado). Abrir batalha nova é o certo, mas a
                // PRIMEIRA jogada iria sobrescrever esse snapshot pra sempre —
                // então copia o cru pra quarentena antes.
                Ok(CargaBatalha::Ilegivel(bruto)) => {
                    match guardar_quarentena(app.handle(), &bruto) {
                        Ok(caminho) => eprintln!(
                            "[batalha_carregar] snapshot ilegível preservado em {}",
                            caminho.display()
                        ),
                        Err(e) => eprintln!("[batalha_carregar] falha ao guardar quarentena: {e}"),
                    }
                    Batalha::nova(dado)
                }
                Err(e) => {
                    eprintln!("[batalha_carregar] leitura falhou, começando batalha nova: {e}");
                    Batalha::nova(dado)
                }
            };
            // machine_id da sincronização de nuvem (docs/plans/2026-08-10-sync-nuvem.md
            // §4): gerado uma vez por máquina, persistido no `config` — NÃO
            // sincroniza, cada PC tem o seu. Falha aqui não derruba o app: sem
            // machine_id o pacote ainda é montado, só fica com o campo vazio.
            if db::repositorios::config_get(&conn, sincronizacao_nuvem::CHAVE_SYNC_MACHINE_ID)
                .unwrap_or(None)
                .is_none()
            {
                let machine_id = sincronizacao_nuvem::gerar_machine_id();
                if let Err(e) = db::repositorios::config_set(
                    &conn,
                    sincronizacao_nuvem::CHAVE_SYNC_MACHINE_ID,
                    &machine_id,
                ) {
                    eprintln!("[sync] falha ao gravar machine_id: {e}");
                }
            }

            app.manage(Db(Mutex::new(conn)));
            app.manage(EstadoBatalha(Mutex::new(batalha)));
            app.manage(SidecarState::com_canal(canal_salvo));
            app.manage(segredos::CofreState::novo(cofre));
            app.manage(EstadoGoogle::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            listar_personagens,
            get_personagem,
            importar_v1,
            retrato_data_url,
            criar_personagem,
            atualizar_personagem,
            excluir_personagem,
            listar_etiquetas,
            criar_etiqueta,
            atualizar_etiqueta,
            excluir_etiqueta,
            definir_etiquetas_personagem,
            exportar_fichas,
            importar_fichas,
            listar_catalogos,
            criar_catalogo_pericia,
            atualizar_catalogo_pericia,
            excluir_catalogo_pericia,
            criar_catalogo_traco,
            atualizar_catalogo_traco,
            excluir_catalogo_traco,
            batalha_estado,
            batalha_adicionar,
            batalha_remover,
            batalha_dano,
            batalha_curar,
            batalha_proximo_turno,
            batalha_nova_rodada,
            batalha_desfazer,
            batalha_resetar,
            batalha_preset_salvar,
            batalha_preset_listar,
            batalha_preset_carregar,
            batalha_preset_sobrescrever,
            batalha_preset_renomear,
            batalha_preset_excluir,
            batalha_editar_turnos_extras,
            batalha_transformar,
            batalha_reverter_transformacao,
            batalha_usar_habilidade,
            batalha_reabilitar_habilidade,
            batalha_alternar_modo_ordem,
            batalha_definir_ordem,
            batalha_modificador_manual,
            batalha_concentracao,
            batalha_definir_mapa,
            batalha_posicionar_peca,
            batalha_mover_peca,
            batalha_remover_peca,
            batalha_anotar_mapa,
            batalha_adicionar_efeito_recorrente,
            batalha_limpar_efeitos_recorrentes,
            batalha_calculadora_dano,
            calcular_rank,
            listar_mapas,
            get_mapa,
            criar_mapa,
            atualizar_mapa,
            duplicar_mapa,
            excluir_mapa,
            render_mapa_discord,
            listar_notas,
            get_nota,
            criar_nota,
            atualizar_nota,
            excluir_nota,
            listar_favoritos,
            criar_favorito,
            atualizar_favorito,
            excluir_favorito,
            discord_iniciar,
            discord_ping,
            discord_conectar,
            discord_listar_canais,
            discord_ler_canal,
            discord_definir_canal,
            discord_canal_salvo,
            discord_postar_mapa,
            discord_atualizar_mapa,
            discord_listar_favoritos,
            discord_listar_canais_voz,
            discord_entrar_voz,
            discord_sair_voz,
            discord_musica_play,
            discord_musica_tocar_agora,
            discord_musica_skip,
            discord_musica_stop,
            discord_musica_loop,
            discord_musica_seek,
            discord_musica_velocidade,
            discord_musica_ab_definir,
            discord_musica_ab_toggle,
            discord_auto_seguir,
            config_get,
            config_set,
            sync_definir_pasta,
            sync_pasta_atual,
            sync_status,
            sync_enviar,
            sync_baixar,
            sync_verificar_boot,
            segredos::segredos_status,
            segredos::segredos_destravar,
            google_login,
            google_status,
            google_logout
        ])
        .run(tauri::generate_context!())
        .expect("erro ao rodar o app");
}
