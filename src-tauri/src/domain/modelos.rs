use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonagemResumo {
    pub id: i64,
    pub tipo: String,
    pub nome: String,
    pub retrato: Option<String>,
    pub forca: i64,
    pub agilidade: i64,
    pub percepcao: i64,
    pub resistencia: i64,
    pub intuicao: i64,
    pub espirito: i64,
    pub carisma: i64,
    pub determinacao: i64,
    /// Nomes das etiquetas do personagem (só NPCs têm). Alimenta o filtro da
    /// galeria e o agrupamento da lista de Disponíveis na Batalha.
    pub etiquetas: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtributoRank {
    pub nome: String,
    pub valor: i64,
    pub rank: u8,
}

/// Par nome/valor livre de uma técnica (ex.: "Alcance" / "15m"). O sistema é
/// homebrew e muda, então além dos campos fixos cada técnica pode ter N desses.
/// Persistido como JSON na coluna `campos_extras` — sem tabela nem modelo global.
/// Os `serde(default)` seguem a tolerância da leitura do banco: a ficha exportada
/// é editável à mão e um par escrito só com `nome` não deve derrubar o lote todo
/// no `importar` (que desserializa o arquivo inteiro de uma vez).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CampoExtra {
    #[serde(default)]
    pub nome: String,
    #[serde(default)]
    pub valor: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HabilidadeDto {
    pub nome: String,
    pub descricao: String,
    /// Campos fixos da técnica, texto livre. Ordem canônica de exibição:
    /// Ação, Efeito, Custo, Tempo, Dano. `tempo` também vira cooldown na Batalha.
    /// Os `serde(default)` mantêm importável a ficha exportada antes da 0011.
    #[serde(default)]
    pub acao: String,
    #[serde(default)]
    pub efeito: String,
    pub tempo: String,
    pub custo: String,
    pub dano: String,
    /// Campos personalizados da técnica, exibidos depois dos fixos.
    #[serde(default)]
    pub campos_extras: Vec<CampoExtra>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PericiaDto {
    pub nome: String,
    pub descricao: String,
    pub atributo: String,
    pub nivel: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TracoDto {
    pub nome: String,
    pub descricao: String,
    pub efeito: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModificadorDto {
    pub atributo: String,
    pub delta: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformacaoDto {
    pub nome: String,
    pub descricao: String,
    pub retrato: Option<String>,
    pub modificadores: Vec<ModificadorDto>,
    pub habilidades: Vec<HabilidadeDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonagemCompleto {
    pub id: i64,
    pub tipo: String,
    pub nome: String,
    pub descricao: String,
    pub hp: i64,
    pub sp: i64,
    pub escudo: i64,
    pub retrato: Option<String>,
    pub atributos: Vec<AtributoRank>,
    pub habilidades: Vec<HabilidadeDto>,
    pub pericias: Vec<PericiaDto>,
    pub vantagens: Vec<TracoDto>,
    pub desvantagens: Vec<TracoDto>,
    pub transformacoes: Vec<TransformacaoDto>,
    /// Nomes das etiquetas (só NPCs); o form recarrega daqui ao editar.
    pub etiquetas: Vec<String>,
}

// --- ENTRADA (Deserialize; vem do frontend) ---

/// Como resolver a imagem de um retrato no save.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "modo", rename_all = "snake_case")]
pub enum RetratoInput {
    /// Mantém a imagem atual (identificada pelo caminho/arquivo já salvo).
    Manter { caminho: String },
    /// Nova imagem: grava com dedup sha256.
    Novo { base64: String, formato: String },
    /// Sem retrato (retrato_id = NULL).
    Nenhum,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HabilidadeInput {
    pub nome: String,
    pub descricao: String,
    /// Ordem canônica de exibição: Ação, Efeito, Custo, Tempo, Dano.
    /// Sem `serde(default)` de propósito (ao contrário do `HabilidadeDto`): este
    /// struct só vem do frontend ou é montado em código, e o save é replace-all —
    /// payload incompleto tem que virar erro alto, não apagar dado em silêncio.
    pub acao: String,
    pub efeito: String,
    pub tempo: String,
    pub custo: String,
    pub dano: String,
    pub campos_extras: Vec<CampoExtra>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PericiaInput {
    pub nome: String,
    pub descricao: String,
    pub atributo: String,
    pub nivel: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TracoInput {
    pub nome: String,
    pub descricao: String,
    pub efeito: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ModificadorInput {
    pub atributo: String,
    pub delta: i64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TransformacaoInput {
    pub nome: String,
    pub descricao: String,
    pub retrato: RetratoInput,
    pub modificadores: Vec<ModificadorInput>,
    pub habilidades: Vec<HabilidadeInput>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PersonagemInput {
    pub tipo: String, // "jogador" | "npc"
    pub nome: String,
    pub descricao: String,
    pub hp: i64,
    pub sp: i64,
    pub escudo: i64,
    pub forca: i64,
    pub agilidade: i64,
    pub percepcao: i64,
    pub resistencia: i64,
    pub intuicao: i64,
    pub espirito: i64,
    pub carisma: i64,
    pub determinacao: i64,
    pub retrato: RetratoInput,
    pub habilidades: Vec<HabilidadeInput>,
    pub pericias: Vec<PericiaInput>,
    pub vantagens: Vec<TracoInput>,
    pub desvantagens: Vec<TracoInput>,
    pub transformacoes: Vec<TransformacaoInput>,
    /// Etiquetas por NOME; o save faz upsert em `etiqueta` e reescreve o vínculo.
    /// Ignorado quando `tipo == "jogador"`. `default` mantém compatível o
    /// importador do v1 e os testes, que não mandam o campo.
    #[serde(default)]
    pub etiquetas: Vec<String>,
}

// --- CATÁLOGOS (Serialize; vai pro frontend) ---

#[derive(Debug, Clone, Serialize)]
pub struct CatalogoPericia {
    pub id: i64,
    pub nome: String,
    pub descricao: String,
    pub atributo: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CatalogoTraco {
    pub id: i64,
    pub nome: String,
    pub descricao: String,
    pub efeito: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Catalogos {
    pub pericias: Vec<CatalogoPericia>,
    pub vantagens: Vec<CatalogoTraco>,
    pub desvantagens: Vec<CatalogoTraco>,
}

// --- CATÁLOGOS: entrada (Deserialize; vem do frontend no CRUD do Compêndio) ---

/// Entrada de criação/atualização de uma perícia do catálogo.
#[derive(Debug, Clone, Deserialize)]
pub struct CatalogoPericiaInput {
    pub nome: String,
    pub descricao: String,
    pub atributo: String,
}

/// Entrada de criação/atualização de uma vantagem/desvantagem do catálogo
/// (mesma forma pras duas; o comando recebe o `tipo` separado pra saber a tabela).
#[derive(Debug, Clone, Deserialize)]
pub struct CatalogoTracoInput {
    pub nome: String,
    pub descricao: String,
    pub efeito: String,
}

/* --------------------------------- Etiqueta -------------------------------- */

/// Etiqueta de organização de NPC (N:N com `personagem`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Etiqueta {
    pub id: i64,
    pub nome: String,
    /// Token da paleta fixa do frontend (`slate`, `rose`, …), não CSS.
    pub cor: String,
    /// Quantos personagens usam a etiqueta — o filtro mostra na chip.
    pub total: i64,
}

/// Entrada de criação/renomeação de etiqueta.
#[derive(Debug, Clone, Deserialize)]
pub struct EtiquetaInput {
    pub nome: String,
    pub cor: String,
}

/* ----------------------- Ficha exportada (arquivo .json) ------------------- */

/// Versão do formato do arquivo. Sobe quando o layout mudar de forma
/// incompatível; o import recusa versão que não conhece.
pub const VERSAO_FICHA: u32 = 1;

/// Imagem embutida no arquivo exportado (autocontido: dá pra mandar a ficha
/// por Discord sem anexo separado).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetratoExportado {
    pub base64: String,
    pub formato: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransformacaoExportada {
    pub nome: String,
    pub descricao: String,
    #[serde(default)]
    pub retrato: Option<RetratoExportado>,
    #[serde(default)]
    pub modificadores: Vec<ModificadorDto>,
    #[serde(default)]
    pub habilidades: Vec<HabilidadeDto>,
}

/// Uma ficha inteira num arquivo. Os `serde(default)` são de propósito: o
/// arquivo é editável à mão e um campo faltando não deve invalidar o import.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FichaExportada {
    pub versao: u32,
    pub tipo: String,
    pub nome: String,
    #[serde(default)]
    pub descricao: String,
    #[serde(default)]
    pub hp: i64,
    #[serde(default)]
    pub sp: i64,
    #[serde(default)]
    pub escudo: i64,
    #[serde(default)]
    pub forca: i64,
    #[serde(default)]
    pub agilidade: i64,
    #[serde(default)]
    pub percepcao: i64,
    #[serde(default)]
    pub resistencia: i64,
    #[serde(default)]
    pub intuicao: i64,
    #[serde(default)]
    pub espirito: i64,
    #[serde(default)]
    pub carisma: i64,
    #[serde(default)]
    pub determinacao: i64,
    #[serde(default)]
    pub retrato: Option<RetratoExportado>,
    #[serde(default)]
    pub habilidades: Vec<HabilidadeDto>,
    #[serde(default)]
    pub pericias: Vec<PericiaDto>,
    #[serde(default)]
    pub vantagens: Vec<TracoDto>,
    #[serde(default)]
    pub desvantagens: Vec<TracoDto>,
    #[serde(default)]
    pub transformacoes: Vec<TransformacaoExportada>,
    #[serde(default)]
    pub etiquetas: Vec<String>,
}

/// Resultado de um import, pra UI dizer o que entrou e o que falhou.
#[derive(Debug, Clone, Serialize)]
pub struct ResultadoImport {
    pub importadas: usize,
    /// Uma mensagem por ficha recusada (nome vazio, versão desconhecida, …).
    pub erros: Vec<String>,
}

/* ----------------------------------- Nota ---------------------------------- */

/// Nota completa (título + corpo em texto livre).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Nota {
    pub id: i64,
    pub titulo: String,
    pub corpo: String,
    pub criado_em: String,
    pub atualizado_em: String,
}

/// Resumo pra lista lateral (sem o corpo).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NotaResumo {
    pub id: i64,
    pub titulo: String,
    pub atualizado_em: String,
}

/// Entrada de criação/atualização vinda da UI.
#[derive(Debug, Clone, Deserialize)]
pub struct NotaInput {
    pub titulo: String,
    pub corpo: String,
}

/* --------------------------------- Favorito -------------------------------- */

/// Favorito de música (v2 é dono dos dados; seed único vem do v1). `categoria`
/// é opcional (coluna anulável).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Favorito {
    pub id: i64,
    pub nome: String,
    pub url: String,
    pub categoria: Option<String>,
    pub criado_em: String,
    pub atualizado_em: String,
}

/// Entrada de criação/atualização vinda da UI.
#[derive(Debug, Clone, Deserialize)]
pub struct FavoritoInput {
    pub nome: String,
    pub url: String,
    pub categoria: Option<String>,
}
