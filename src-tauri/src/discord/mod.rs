//! Sidecar do bot Discord — sobe um processo Python filho (venv em dev, binário
//! empacotado via `externalBin`/PyInstaller em release — F4.6) e troca
//! comandos/respostas por JSONL via stdin/stdout. F4.1–4.4 usam esse encanamento
//! pra login (`conectar`), listar canais, e postar/sincronizar o mapa ao vivo.
//!
//! Protocolo em [`protocolo`]; o processo real vive em `sidecar/bot_sidecar.py`
//! (fora deste crate, mantido por outra parte do time). O token
//! (`DISCORD_BOT_TOKEN`) é injetado no spawn a partir do cofre de segredos
//! (`crate::segredos` — repo público, nada embutido no binário); o processo
//! filho também HERDA o env do app (nenhum `env_clear` — `.env()` só
//! ACRESCENTA), então uma env var definida à mão na máquina ainda funciona
//! quando o cofre não está destravado (o `.env()` do cofre, quando roda,
//! sobrepõe a herdada). As demais env vars que ESTE módulo acrescenta
//! (`RPGV2_FFMPEG`, `RPGV2_FAVORITOS`, `RPGV2_CACHE_DIR`) são só caminhos de
//! recurso — contrato combinado com o lado Python do sidecar.

mod protocolo;

use crate::db::connection::Db;
use crate::db::error::AppError;
use crate::db::repositorios::{config_get, config_set};
use crate::domain::mapa::{
    excede_discord, normalizar, render_discord, Mapa, MapaInput, PecaRender, LIMITE_DISCORD,
};
use crate::recursos::resolver_recurso;
use crate::EstadoBatalha;
use protocolo::{
    CanalTexto, CanalVoz, Comando, EventoMusica, Favorito, InfoConexao, MensagemCanal, Resposta,
    RespostaMsgId,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::{Command, CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// Canal + mensagem "viva" da sessão atual (uma por vez). `msg_id` só existe
/// depois do primeiro `discord_postar_mapa`; até lá, sync ao vivo é no-op.
#[derive(Debug, Clone)]
pub struct Sessao {
    pub canal_id: String,
    pub msg_id: Option<String>,
}

/// Estado do sidecar: processo filho (se estiver rodando) + chamadas em
/// aberto aguardando resposta, casadas pelo `id` do [`Comando`] enviado, mais
/// a sessão de postagem (canal/mensagem) e o controle de coalescing do sync
/// ao vivo (`discord_atualizar_mapa`).
#[derive(Default)]
pub struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    pendentes: Mutex<HashMap<String, tauri::async_runtime::Sender<Resposta>>>,
    proximo_id: AtomicU64,
    sessao: Mutex<Option<Sessao>>,
    atualizacao_em_voo: Mutex<bool>,
    /// Última versão pendente do sync ao vivo: `(grade, mapa_id_renderizado)`.
    /// O `mapa_id` viaja junto pra o loop saber se deve sobrepor as peças da batalha.
    atualizacao_pendente: Mutex<Option<(MapaInput, Option<i64>)>>,
}

/// Chave da tabela `config` (SQLite) onde o canal de destino do Discord fica
/// persistido entre sessões.
pub const CHAVE_CANAL: &str = "discord_canal_id";

impl SidecarState {
    /// Reidrata o canal salvo na sessão ao subir o app. `msg_id` começa vazio —
    /// a mensagem "viva" é por-execução (reposta após restart).
    pub fn com_canal(canal_id: Option<String>) -> Self {
        let estado = Self::default();
        if let Some(canal_id) = canal_id {
            if let Ok(mut s) = estado.sessao.lock() {
                *s = Some(Sessao { canal_id, msg_id: None });
            }
        }
        estado
    }
}

/// Caminho do `bot_sidecar.py`, resolvido a partir do diretório do crate
/// (`src-tauri/`, via `CARGO_MANIFEST_DIR`) — não depende do diretório de
/// trabalho em que o app foi iniciado. Só existe em dev: no app empacotado o
/// sidecar é o binário resolvido por `app.shell().sidecar(...)`.
#[cfg(debug_assertions)]
fn caminho_script_dev() -> Result<PathBuf, AppError> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let raiz_projeto = manifest_dir
        .parent()
        .ok_or_else(|| AppError::Msg("CARGO_MANIFEST_DIR sem diretório pai".into()))?;
    Ok(raiz_projeto.join("sidecar").join("bot_sidecar.py"))
}

/// Caminho do Python do **venv** do sidecar — o Python do sistema não tem
/// `discord.py` instalado. Mesma resolução via `CARGO_MANIFEST_DIR` que
/// `caminho_script_dev`; precisa bater com o `cmd` em `capabilities/default.json`
/// (o escopo do `shell:allow-execute` casa a string exata). Só existe em dev.
#[cfg(debug_assertions)]
fn caminho_python_venv() -> Result<PathBuf, AppError> {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let raiz_projeto = manifest_dir
        .parent()
        .ok_or_else(|| AppError::Msg("CARGO_MANIFEST_DIR sem diretório pai".into()))?;
    Ok(raiz_projeto
        .join("sidecar")
        .join(".venv")
        .join("Scripts")
        .join("python.exe"))
}

/// Sobe o sidecar (venv em dev, binário empacotado em release) se ainda não
/// estiver rodando, e liga a task que lê o stdout. Idempotente. Corpo de
/// `discord_iniciar`, extraído pra comandos que precisam garantir o processo
/// de pé antes de falar com ele (ex.: `discord_conectar`) poderem chamar sem
/// passar pela borda de IPC. Dev e release só diferem em como o `Command` é
/// montado (`montar_comando_sidecar`); daqui pra baixo é código único — sem
/// isso, o release nunca teria ganhado o leitor de stdout (é o motivo do bug
/// original: toda chamada ficava pendurada pra sempre esperando uma resposta
/// que nunca era lida).
async fn garantir_sidecar_rodando(app: &AppHandle, estado: &SidecarState) -> Result<(), AppError> {
    let ja_rodando = estado
        .child
        .lock()
        .map_err(|e| AppError::Msg(e.to_string()))?
        .is_some();
    if ja_rodando {
        return Ok(());
    }

    let mut comando = aplicar_env_recursos(app, montar_comando_sidecar(app)?);
    // Token do Discord vem do cofre de segredos (repo público: nada embutido
    // no binário do sidecar). Sem cofre destravado o spawn segue sem a env —
    // o `conectar` falha lá dentro com "DISCORD_BOT_TOKEN ausente", que a UI
    // já mostra; a mensagem é o guia certo ("destrave o cofre").
    if let Some(token) = app.state::<crate::segredos::CofreState>().discord_token() {
        comando = comando.env("DISCORD_BOT_TOKEN", token);
    }
    let (mut rx, child) = comando
        .spawn()
        .map_err(|e| AppError::Msg(format!("spawn do sidecar: {e}")))?;

    *estado.child.lock().map_err(|e| AppError::Msg(e.to_string()))? = Some(child);

    let app_eventos = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(evento) = rx.recv().await {
            match evento {
                CommandEvent::Stdout(bytes) => tratar_stdout(&app_eventos, &bytes),
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[sidecar] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Terminated(payload) => {
                    limpar_child(&app_eventos);
                    let _ = app_eventos.emit("discord:sidecar-encerrado", payload.code);
                    break;
                }
                CommandEvent::Error(e) => eprintln!("[sidecar] erro de processo: {e}"),
                _ => {}
            }
        }
    });

    Ok(())
}

/// Monta o `Command` do sidecar — a ÚNICA diferença entre dev e release. Em
/// dev sobe o Python do venv apontando pro `bot_sidecar.py` do repo; em
/// release, o binário empacotado (`externalBin`) resolvido pelo nome.
#[cfg(debug_assertions)]
fn montar_comando_sidecar(app: &AppHandle) -> Result<Command, AppError> {
    let python = caminho_python_venv()?;
    let script = caminho_script_dev()?;
    Ok(app
        .shell()
        .command(python.to_string_lossy().into_owned())
        .args([script.to_string_lossy().into_owned()]))
}

#[cfg(not(debug_assertions))]
fn montar_comando_sidecar(app: &AppHandle) -> Result<Command, AppError> {
    app.shell()
        .sidecar("bot_sidecar")
        .map_err(|e| AppError::Msg(e.to_string()))
}

/// Repassa os caminhos de recursos ao sidecar por env var (`RPGV2_FFMPEG`,
/// `RPGV2_FAVORITOS`, `RPGV2_CACHE_DIR` — contrato combinado com o lado
/// Python). `.env()` só ACRESCENTA ao ambiente herdado (não chama
/// `env_clear`), então isso nunca derruba `DISCORD_BOT_TOKEN` nem o resto do
/// ambiente que o sidecar precisa. Nenhum recurso é obrigatório: se não
/// resolver, só loga e segue sem a var — o sidecar tem fallback próprio pra
/// cada um (mapa/texto no Discord não dependem de ffmpeg).
fn aplicar_env_recursos(app: &AppHandle, comando: Command) -> Command {
    let mut comando = comando;
    if let Some(ffmpeg) = resolver_recurso(app, "ffmpeg.exe") {
        comando = comando.env("RPGV2_FFMPEG", ffmpeg.to_string_lossy().into_owned());
    }
    if let Some(favoritos) = resolver_recurso(app, "discord_config.json") {
        comando = comando.env("RPGV2_FAVORITOS", favoritos.to_string_lossy().into_owned());
    }
    match cache_dir_musica(app) {
        Ok(dir) => comando = comando.env("RPGV2_CACHE_DIR", dir.to_string_lossy().into_owned()),
        Err(e) => eprintln!("[sidecar] cache de música: {e}"),
    }
    comando
}

/// Pasta gravável pro cache de música do sidecar (`app_cache_dir` — dados
/// descartáveis, ao contrário do `app_data_dir` onde mora o `rpg.db`). Cria se
/// não existir; erro aqui não derruba o sidecar, só perde a env var.
fn cache_dir_musica(app: &AppHandle) -> Result<PathBuf, AppError> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| AppError::Msg(e.to_string()))?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Msg(e.to_string()))?;
    Ok(dir)
}

/// Sobe o sidecar explicitamente (botão de debug na UI). Comandos que precisam
/// do sidecar de pé (`discord_conectar`) chamam `garantir_sidecar_rodando` direto.
#[tauri::command]
pub async fn discord_iniciar(app: AppHandle, estado: State<'_, SidecarState>) -> Result<(), AppError> {
    garantir_sidecar_rodando(&app, estado.inner()).await
}

/// Envia `{"cmd":"ping"}` ao sidecar e aguarda a resposta (`"pong"`).
#[tauri::command]
pub async fn discord_ping(estado: State<'_, SidecarState>) -> Result<String, AppError> {
    let data = chamar(estado.inner(), "ping", json!({})).await?;
    Ok(data.as_str().map(str::to_string).unwrap_or_default())
}

/// Conecta o bot: garante o sidecar de pé (sobe se precisar) e faz o handshake
/// `conectar` — devolve o usuário logado e os servidores (guilds) visíveis.
#[tauri::command]
pub async fn discord_conectar(
    app: AppHandle,
    estado: State<'_, SidecarState>,
) -> Result<InfoConexao, AppError> {
    garantir_sidecar_rodando(&app, estado.inner()).await?;
    let data = chamar(estado.inner(), "conectar", json!({})).await?;
    Ok(serde_json::from_value(data)?)
}

/// Lista os canais de texto que o bot enxerga (todas as guilds conectadas).
#[tauri::command]
pub async fn discord_listar_canais(
    estado: State<'_, SidecarState>,
) -> Result<Vec<CanalTexto>, AppError> {
    let data = chamar(estado.inner(), "listar_canais_texto", json!({})).await?;
    Ok(serde_json::from_value(data)?)
}

/// Lê até `limite` mensagens (ordem cronológica) de um canal de texto — usado
/// pelo sync de regras da tela Balanceamento.
#[tauri::command]
pub async fn discord_ler_canal(
    estado: State<'_, SidecarState>,
    canal_id: String,
    limite: u32,
) -> Result<Vec<MensagemCanal>, AppError> {
    let data = chamar(
        estado.inner(),
        "ler_canal",
        json!({ "canal_id": canal_id, "limite": limite }),
    )
    .await?;
    Ok(serde_json::from_value(data)?)
}

/// Define o canal de destino da sessão atual; zera a mensagem postada — um
/// canal novo não tem a mensagem antiga, a próxima ação é postar de novo.
#[tauri::command]
pub fn discord_definir_canal(
    estado: State<'_, SidecarState>,
    db: State<'_, Db>,
    canal_id: String,
) -> Result<(), AppError> {
    // Write-through: persiste o canal (sobrevive a restart) antes de setar a sessão.
    {
        let conn = db.conn()?;
        config_set(&conn, CHAVE_CANAL, &canal_id)?;
    }
    *estado.sessao.lock().map_err(|e| AppError::Msg(e.to_string()))? = Some(Sessao { canal_id, msg_id: None });
    Ok(())
}

/// Canal de destino salvo (persistido em `config`). `None` = nunca escolhido —
/// o painel usa isso pra pré-selecionar o `<select>` ao abrir.
#[tauri::command]
pub fn discord_canal_salvo(db: State<'_, Db>) -> Result<Option<String>, AppError> {
    let conn = db.conn()?;
    config_get(&conn, CHAVE_CANAL)
}

/// Posta o mapa (estado atual do editor) no canal definido — vira a mensagem
/// "viva" da sessão; guarda o `msg_id` pra `discord_atualizar_mapa` editar depois.
#[tauri::command]
pub async fn discord_postar_mapa(
    estado: State<'_, SidecarState>,
    bat: State<'_, EstadoBatalha>,
    input: MapaInput,
    mapa_id: Option<i64>,
) -> Result<String, AppError> {
    let canal_id = canal_da_sessao(estado.inner())?;
    let pecas = bat.pecas_para_mapa(mapa_id);
    let anotacoes = bat.anotacoes_para_mapa(mapa_id);
    let texto = renderizar_para_discord(input, &pecas, &anotacoes)?;
    let data = chamar(
        estado.inner(),
        "postar_mapa",
        json!({ "canal_id": canal_id, "texto": texto }),
    )
    .await?;
    let resp: RespostaMsgId = serde_json::from_value(data)?;

    let mut sessao = estado.sessao.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    if let Some(s) = sessao.as_mut() {
        s.msg_id = Some(resp.msg_id.clone());
    }
    Ok(resp.msg_id)
}

/// Atualiza (edita) a mensagem do mapa já postada — *no-op* silencioso se a
/// sessão ainda não tem canal+mensagem (nada pra atualizar antes do 1º post).
///
/// Nome do evento que avisa o front que o sync ao vivo do mapa falhou.
pub const EVENTO_SYNC_FALHOU: &str = "discord:sync-mapa-falhou";

/// Reporta ao front uma falha do sync ao vivo. O laço de sync não pode devolver
/// `Err` (ele é disparado por debounce, não por uma ação direta do usuário), e
/// falhar em silêncio é pior: o mapa congela sem ninguém perceber.
fn avisar_falha_sync(app: &AppHandle, motivo: &str) {
    eprintln!("[discord] sync ao vivo: {motivo}");
    let _ = app.emit(EVENTO_SYNC_FALHOU, motivo.to_string());
}

/// Coalescing: o front chama isso a cada edição da grade (debounced ~600ms lá),
/// mas o round-trip com o Discord pode demorar mais que isso. Sem isso, duas
/// chamadas correndo em paralelo poderiam responder fora de ordem e a mais
/// LENTA (não a mais recente) venceria, deixando o Discord desatualizado. Aqui
/// só há um envio em voo por vez: chamadas que chegam enquanto outra está
/// rodando só substituem o `MapaInput` pendente; quem está "no volante" reenvia
/// com a versão mais nova antes de soltar (`LiberarEmVoo` garante que o volante
/// solta mesmo se algo no meio falhar).
#[tauri::command]
pub async fn discord_atualizar_mapa(
    app: AppHandle,
    estado: State<'_, SidecarState>,
    bat: State<'_, EstadoBatalha>,
    input: MapaInput,
    mapa_id: Option<i64>,
) -> Result<(), AppError> {
    if sessao_com_mensagem(estado.inner())?.is_none() {
        return Ok(());
    }

    *estado
        .atualizacao_pendente
        .lock()
        .map_err(|e| AppError::Msg(e.to_string()))? = Some((input, mapa_id));

    {
        // Bloco próprio (não só `drop()`): o analisador de `Send` do gerador
        // async trata o fim de escopo léxico do `MutexGuard` como garantia mais
        // confiável do que um `drop()` explícito antes do loop com `.await`.
        let mut em_voo = estado
            .atualizacao_em_voo
            .lock()
            .map_err(|e| AppError::Msg(e.to_string()))?;
        if *em_voo {
            return Ok(()); // já tem alguém no volante — ele pega essa versão no próximo loop
        }
        *em_voo = true;
    }
    let _liberar = LiberarEmVoo(&estado.atualizacao_em_voo);

    loop {
        let proximo = estado
            .atualizacao_pendente
            .lock()
            .map_err(|e| AppError::Msg(e.to_string()))?
            .take();
        let Some((input, mapa_id)) = proximo else { break };
        let Some((canal_id, msg_id)) = sessao_com_mensagem(estado.inner())? else { break };

        let pecas = bat.pecas_para_mapa(mapa_id);
        let anotacoes = bat.anotacoes_para_mapa(mapa_id);
        // Falha aqui NÃO pode ser só `eprintln!`: este laço roda sozinho, sem
        // ninguém olhando, e o `Ok(())` do comando faz o `.catch()` do driver no
        // front nunca disparar. Sem avisar, o mapa no Discord simplesmente
        // congela no meio da sessão (o caso mais provável é a mensagem passar de
        // 2000 chars) e o mestre só descobre muito depois. Daí o evento próprio.
        let texto = match renderizar_para_discord(input, &pecas, &anotacoes) {
            Ok(t) => t,
            Err(e) => {
                avisar_falha_sync(&app, &e.to_string());
                continue;
            }
        };
        if let Err(e) = chamar(
            estado.inner(),
            "editar_mensagem",
            json!({ "canal_id": canal_id, "msg_id": msg_id, "texto": texto }),
        )
        .await
        {
            avisar_falha_sync(&app, &format!("falha ao editar a mensagem: {e}"));
        }
    }

    Ok(())
}

/// Lista os favoritos de música (playlists/URLs salvas) configurados no bot.
#[tauri::command]
pub async fn discord_listar_favoritos(
    estado: State<'_, SidecarState>,
) -> Result<Vec<Favorito>, AppError> {
    let data = chamar(estado.inner(), "listar_favoritos", json!({})).await?;
    Ok(serde_json::from_value(data)?)
}

/// Lista os canais de voz que o bot enxerga (todas as guilds conectadas).
#[tauri::command]
pub async fn discord_listar_canais_voz(
    estado: State<'_, SidecarState>,
) -> Result<Vec<CanalVoz>, AppError> {
    let data = chamar(estado.inner(), "listar_canais_voz", json!({})).await?;
    Ok(serde_json::from_value(data)?)
}

/// Entra num canal de voz — pré-requisito pra tocar música (`discord_musica_play`).
#[tauri::command]
pub async fn discord_entrar_voz(
    estado: State<'_, SidecarState>,
    canal_id: String,
) -> Result<(), AppError> {
    chamar(estado.inner(), "entrar_voz", json!({ "canal_id": canal_id })).await?;
    Ok(())
}

/// Sai do canal de voz atual.
#[tauri::command]
pub async fn discord_sair_voz(estado: State<'_, SidecarState>) -> Result<(), AppError> {
    chamar(estado.inner(), "sair_voz", json!({})).await?;
    Ok(())
}

/// Toca uma URL no canal de voz atual (o bot decide se toca já ou entra na fila).
#[tauri::command]
pub async fn discord_musica_play(
    estado: State<'_, SidecarState>,
    url: String,
) -> Result<(), AppError> {
    chamar(estado.inner(), "musica_play", json!({ "url": url })).await?;
    Ok(())
}

/// Pula a faixa atual.
#[tauri::command]
pub async fn discord_musica_skip(estado: State<'_, SidecarState>) -> Result<(), AppError> {
    chamar(estado.inner(), "musica_skip", json!({})).await?;
    Ok(())
}

/// Para a reprodução e limpa a fila.
#[tauri::command]
pub async fn discord_musica_stop(estado: State<'_, SidecarState>) -> Result<(), AppError> {
    chamar(estado.inner(), "musica_stop", json!({})).await?;
    Ok(())
}

/// Alterna o loop da faixa atual (liga se estava desligado, e vice-versa).
#[tauri::command]
pub async fn discord_musica_loop(estado: State<'_, SidecarState>) -> Result<(), AppError> {
    chamar(estado.inner(), "musica_loop", json!({})).await?;
    Ok(())
}

/// Interrompe a faixa atual e toca `url` já, mantendo `cog.queue` intacta (botão "▶ Agora").
#[tauri::command]
pub async fn discord_musica_tocar_agora(
    estado: State<'_, SidecarState>,
    url: String,
) -> Result<(), AppError> {
    chamar(estado.inner(), "musica_tocar_agora", json!({ "url": url })).await?;
    Ok(())
}

/// Pula pra `segundos` na faixa atual (religa o `seek_to` do engine do v1).
#[tauri::command]
pub async fn discord_musica_seek(
    estado: State<'_, SidecarState>,
    segundos: f64,
) -> Result<(), AppError> {
    chamar(estado.inner(), "musica_seek", json!({ "segundos": segundos })).await?;
    Ok(())
}

/// Troca a velocidade de reprodução (`atempo` do ffmpeg; faixa útil 0.5..2.0).
#[tauri::command]
pub async fn discord_musica_velocidade(
    estado: State<'_, SidecarState>,
    fator: f64,
) -> Result<(), AppError> {
    chamar(estado.inner(), "musica_velocidade", json!({ "fator": fator })).await?;
    Ok(())
}

/// Define (ou limpa, com `null`) os marcadores A e B do loop.
#[tauri::command]
pub async fn discord_musica_ab_definir(
    estado: State<'_, SidecarState>,
    a: Option<f64>,
    b: Option<f64>,
) -> Result<(), AppError> {
    chamar(estado.inner(), "musica_ab_definir", json!({ "a": a, "b": b })).await?;
    Ok(())
}

/// Liga/desliga o loop A-B (usa os marcadores já definidos).
#[tauri::command]
pub async fn discord_musica_ab_toggle(
    estado: State<'_, SidecarState>,
    ativo: bool,
) -> Result<(), AppError> {
    chamar(estado.inner(), "musica_ab_toggle", json!({ "ativo": ativo })).await?;
    Ok(())
}

/// Liga/desliga o auto-seguir de voz do `nick` (o bot entra/segue o canal dele).
#[tauri::command]
pub async fn discord_auto_seguir(
    estado: State<'_, SidecarState>,
    ativo: bool,
    nick: String,
) -> Result<(), AppError> {
    chamar(
        estado.inner(),
        "auto_seguir_definir",
        json!({ "ativo": ativo, "nick": nick }),
    )
    .await?;
    Ok(())
}

/// Serializa e escreve um [`Comando`] como uma linha JSONL no stdin do sidecar.
fn enviar_comando(estado: &SidecarState, comando: &Comando) -> Result<(), AppError> {
    let mut guarda = estado.child.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    let child = guarda
        .as_mut()
        .ok_or_else(|| AppError::Msg("sidecar não iniciado — chame discord_iniciar antes".into()))?;

    let mut linha = serde_json::to_vec(comando)?;
    linha.push(b'\n');
    child
        .write(&linha)
        .map_err(|e| AppError::Msg(format!("escrita no stdin do sidecar: {e}")))
}

/// Trata uma linha de stdout do bot: resolve a chamada pendente (resposta) ou
/// repassa pro front como evento (`{"tipo":...}`, ex. `"pronto"` ao subir).
fn tratar_stdout(app: &AppHandle, bytes: &[u8]) {
    let bruto = String::from_utf8_lossy(bytes);
    let linha = bruto.trim();
    if linha.is_empty() {
        return;
    }

    let valor: Value = match serde_json::from_str(linha) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("[sidecar] linha stdout não é JSON ({e}): {linha}");
            return;
        }
    };

    // Resposta traz `id` (correlação por chamada); evento espontâneo traz `tipo`.
    if valor.get("id").is_some() {
        match serde_json::from_value::<Resposta>(valor) {
            Ok(resp) => resolver_pendente(app, resp),
            Err(e) => eprintln!("[sidecar] resposta malformada ({e}): {linha}"),
        }
    } else if let Some(tipo) = valor.get("tipo").and_then(Value::as_str).map(str::to_string) {
        if tipo == "musica" {
            // now-playing estendido: normaliza (defaults) e repassa o objeto rico.
            match serde_json::from_value::<EventoMusica>(valor) {
                Ok(ev) => {
                    let _ = app.emit("discord:evento", ev);
                }
                Err(e) => eprintln!("[sidecar] evento musica malformado ({e}): {linha}"),
            }
        } else {
            // demais eventos seguem carregando só o `tipo` (compat com os listeners atuais).
            let _ = app.emit("discord:evento", tipo);
        }
    } else {
        eprintln!("[sidecar] linha stdout não reconhecida: {linha}");
    }
}

/// Esquece o processo encerrado — sem isso, `discord_iniciar` acharia (pra
/// sempre) que um sidecar morto ainda está rodando e nunca deixaria reiniciar.
fn limpar_child(app: &AppHandle) {
    let estado = app.state::<SidecarState>();
    if let Ok(mut child) = estado.child.lock() {
        *child = None;
    };
}

fn resolver_pendente(app: &AppHandle, resposta: Resposta) {
    let estado = app.state::<SidecarState>();
    let Ok(mut mapa) = estado.pendentes.lock() else {
        return;
    };
    if let Some(tx) = mapa.remove(&resposta.id) {
        let _ = tx.try_send(resposta);
    }
}

/// Envia um comando ao sidecar e aguarda a resposta, devolvendo o `data` bruto
/// (ou erro, se `ok:false` ou o sidecar cair no meio da chamada). Comandos
/// tipados (`discord_conectar`, `discord_listar_canais`, etc.) fazem o
/// `serde_json::from_value` do formato esperado por cima disso — reusa a
/// mesma infra de correlação por `id` do F4.0 (`ping`).
async fn chamar(estado: &SidecarState, cmd: &str, args: Value) -> Result<Value, AppError> {
    let id = estado.proximo_id.fetch_add(1, Ordering::Relaxed).to_string();
    let (tx, mut rx) = tauri::async_runtime::channel::<Resposta>(1);
    estado
        .pendentes
        .lock()
        .map_err(|e| AppError::Msg(e.to_string()))?
        .insert(id.clone(), tx);

    let comando = Comando { id: id.clone(), cmd: cmd.into(), args };
    if let Err(e) = enviar_comando(estado, &comando) {
        estado.pendentes.lock().map_err(|e| AppError::Msg(e.to_string()))?.remove(&id);
        return Err(e);
    }

    let resposta = rx
        .recv()
        .await
        .ok_or_else(|| AppError::Msg(format!("sidecar encerrou sem responder '{cmd}'")))?;

    if !resposta.ok {
        // Trata ausência E string vazia/em branco como "sem mensagem": uma
        // exceção Python sem argumentos (ex.: `OpusNotLoaded()`) já chega do
        // sidecar como `erro: ""` (ver `_processar_linha`) — sem isso o front
        // receberia um toast de erro completamente vazio.
        let erro = resposta
            .erro
            .filter(|e| !e.trim().is_empty())
            .unwrap_or_else(|| format!("erro desconhecido do sidecar em '{cmd}'"));
        return Err(AppError::Msg(erro));
    }
    Ok(resposta.data.unwrap_or(Value::Null))
}

/// Canal definido pra sessão atual, ou erro legível se nenhum foi escolhido ainda.
fn canal_da_sessao(estado: &SidecarState) -> Result<String, AppError> {
    let sessao = estado.sessao.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    sessao
        .as_ref()
        .map(|s| s.canal_id.clone())
        .ok_or_else(|| AppError::Msg("nenhum canal selecionado — escolha um canal antes de postar".into()))
}

/// `(canal_id, msg_id)` só quando a sessão já tem os dois — senão `None`
/// (sync ao vivo antes do primeiro post é no-op, não erro).
fn sessao_com_mensagem(estado: &SidecarState) -> Result<Option<(String, String)>, AppError> {
    let sessao = estado.sessao.lock().map_err(|e| AppError::Msg(e.to_string()))?;
    Ok(sessao
        .as_ref()
        .and_then(|s| s.msg_id.as_ref().map(|m| (s.canal_id.clone(), m.clone()))))
}

/// Monta um `Mapa` provisório (sem persistência) só pra reusar `render_discord`
/// como fonte única do texto — mesmo truque de `render_mapa_discord` em `lib.rs`.
fn mapa_provisorio(input: MapaInput) -> Mapa {
    let input = normalizar(input);
    Mapa {
        id: 0,
        titulo: input.titulo,
        colunas: input.colunas,
        linhas: input.linhas,
        grade: input.grade,
        legenda: input.legenda,
        efeito: input.efeito,
        criado_em: String::new(),
        atualizado_em: String::new(),
    }
}

/// Renderiza pro formato Discord com o guard de tamanho — Discord corta
/// mensagens acima de `LIMITE_DISCORD` chars; melhor falhar legível do que postar cortado.
fn renderizar_para_discord(
    input: MapaInput,
    pecas: &[PecaRender],
    anotacoes: &[(u16, u16, String)],
) -> Result<String, AppError> {
    let texto = render_discord(&mapa_provisorio(input), pecas, anotacoes);
    if excede_discord(&texto) {
        return Err(AppError::Msg(format!(
            "mapa tem {} caracteres — passa do limite de {LIMITE_DISCORD} do Discord, reduza antes de postar",
            texto.chars().count()
        )));
    }
    Ok(texto)
}

/// Reseta `atualizacao_em_voo` pra `false` ao sair de escopo (mesmo em erro
/// dentro do loop de coalescing) — sem isso, uma falha no meio deixaria a
/// flag travada em `true` pra sempre e todo `discord_atualizar_mapa` futuro
/// viraria no-op silencioso.
struct LiberarEmVoo<'a>(&'a Mutex<bool>);

impl Drop for LiberarEmVoo<'_> {
    fn drop(&mut self) {
        if let Ok(mut em_voo) = self.0.lock() {
            *em_voo = false;
        }
    }
}
