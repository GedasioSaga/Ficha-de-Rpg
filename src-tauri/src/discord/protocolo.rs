//! Contrato JSONL trocado com o sidecar Python via stdin/stdout (Fase 4).
//! Uma linha = um objeto JSON. Espelhado 1:1 em `sidecar/bot_sidecar.py`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// App → bot, escrito (mais `\n`) no stdin do processo filho.
#[derive(Debug, Serialize)]
pub struct Comando {
    pub id: String,
    pub cmd: String,
    pub args: Value,
}

/// Bot → app: a resposta de um [`Comando`], casada pelo `id`. Eventos
/// espontâneos (`{"tipo":...}`, ex. `"pronto"`/`"desconectado"`/`"musica"`) são
/// despachados por presença de `tipo` em `tratar_stdout` e repassados ao front
/// via `discord:evento` (o `musica` normalizado como [`EventoMusica`]).
#[derive(Debug, Clone, Deserialize)]
pub struct Resposta {
    pub id: String,
    pub ok: bool,
    #[serde(default)]
    pub data: Option<Value>,
    #[serde(default)]
    pub erro: Option<String>,
}

/// Trecho A-B do loop, dentro do evento `musica`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FaixaAB {
    #[serde(default)]
    pub a: Option<f64>,
    #[serde(default)]
    pub b: Option<f64>,
    #[serde(default)]
    pub ativo: bool,
}

/// Evento `musica` (now-playing estendido) emitido pelo sidecar. Tolerante a
/// campos faltando (defaults) pra não quebrar durante a integração com o Python;
/// reemitido normalizado pro front via `discord:evento`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventoMusica {
    pub tipo: String,
    #[serde(default = "estado_parado")]
    pub estado: String,
    #[serde(default)]
    pub em_voz: bool,
    #[serde(default)]
    pub titulo: Option<String>,
    #[serde(default)]
    pub posicao: f64,
    #[serde(default)]
    pub duracao: Option<f64>,
    #[serde(default = "velocidade_normal")]
    pub velocidade: f64,
    // `loop` é palavra reservada em Rust: mapeada de/para o JSON via rename.
    #[serde(default, rename = "loop")]
    pub em_loop: bool,
    #[serde(default)]
    pub ab: FaixaAB,
    #[serde(default)]
    pub fila: Vec<ItemFila>,
}

fn estado_parado() -> String {
    "parado".to_string()
}

fn velocidade_normal() -> f64 {
    1.0
}

/// Um servidor (guild) que o bot enxerga — item de `InfoConexao::guilds`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Guild {
    pub id: String,
    pub nome: String,
}

/// Resposta de `conectar`: quem o bot é (usuário logado) + guilds visíveis.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InfoConexao {
    pub usuario: String,
    pub guilds: Vec<Guild>,
}

/// Um canal de texto — item da resposta de `listar_canais_texto`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanalTexto {
    pub id: String,
    pub nome: String,
    pub guild: String,
}

/// Uma mensagem de canal — item da resposta de `ler_canal` (sync de regras).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MensagemCanal {
    pub autor: String,
    pub texto: String,
    pub timestamp: String,
}

/// Resposta de `postar_mapa`: id da mensagem criada, guardado na sessão pra
/// `editar_mensagem` (via `discord_atualizar_mapa`) mirar depois.
#[derive(Debug, Clone, Deserialize)]
pub struct RespostaMsgId {
    pub msg_id: String,
}

/// Um favorito de música (playlist/URL salva no bot) — item de `listar_favoritos`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Favorito {
    pub nome: String,
    pub url: String,
    pub categoria: String,
}

/// Um canal de voz — item da resposta de `listar_canais_voz`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanalVoz {
    pub id: String,
    pub nome: String,
    pub guild: String,
}

/// Um item da fila de reprodução — parte de [`EventoMusica::fila`]. Espelha o
/// dict `{titulo, url, duracao}` montado por `_fila_atual` no sidecar a partir
/// de `cog.queue` (bot.py:294).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ItemFila {
    pub titulo: Option<String>,
    pub url: Option<String>,
    #[serde(default)]
    pub duracao: Option<f64>,
}
