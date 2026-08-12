export type Tipo = "jogador" | "npc";

export interface PersonagemResumo {
  id: number;
  tipo: Tipo;
  nome: string;
  retrato: string | null;
  forca: number;
  agilidade: number;
  percepcao: number;
  resistencia: number;
  intuicao: number;
  espirito: number;
  carisma: number;
  determinacao: number;
  /** Nomes das etiquetas (só NPCs têm; jogador vem sempre vazio). */
  etiquetas: string[];
}

/** Um dos 8 atributos com o rank (0–13) já calculado pelo backend. */
export interface AtributoRank {
  nome: string;
  valor: number;
  rank: number;
}

/** Par nome/valor livre de uma técnica (ex.: "Alcance: 15m"). */
export interface CampoExtraDto {
  nome: string;
  valor: string;
  uid?: string; // chave de render no editor (client-only; ver HabilidadeDto.uid)
}

export interface HabilidadeDto {
  nome: string;
  descricao: string;
  /**
   * Campos fixos da técnica, todos texto livre. Ordem canônica de exibição:
   * Ação, Efeito, Custo, Tempo, Dano. `tempo` também vira cooldown na Batalha.
   */
  acao: string;
  efeito: string;
  tempo: string;
  custo: string;
  dano: string;
  /** Campos personalizados, exibidos depois dos fixos. */
  campos_extras: CampoExtraDto[];
  /** Chave de render no editor de listas (client-only; ausente na leitura, ignorada pelo backend). */
  uid?: string;
}

export interface PericiaDto {
  nome: string;
  descricao: string;
  atributo: string;
  nivel: number;
  uid?: string; // chave de render no editor (client-only; ver HabilidadeDto.uid)
}

export interface TracoDto {
  nome: string;
  descricao: string;
  efeito: string;
  uid?: string; // chave de render no editor (client-only; ver HabilidadeDto.uid)
}

export interface ModificadorDto {
  atributo: string;
  delta: number;
  uid?: string; // chave de render no editor (client-only; ver HabilidadeDto.uid)
}

export interface TransformacaoDto {
  nome: string;
  descricao: string;
  retrato: string | null;
  modificadores: ModificadorDto[];
  habilidades: HabilidadeDto[];
}

/** Ficha completa (só leitura) de um personagem. Espelha `PersonagemCompleto` do Rust. */
export interface PersonagemCompleto {
  id: number;
  tipo: Tipo;
  nome: string;
  descricao: string;
  hp: number;
  sp: number;
  escudo: number;
  retrato: string | null;
  atributos: AtributoRank[];
  habilidades: HabilidadeDto[];
  pericias: PericiaDto[];
  vantagens: TracoDto[];
  desvantagens: TracoDto[];
  transformacoes: TransformacaoDto[];
  etiquetas: string[];
}

/* ------------------------------- Entrada (save) --------------------------- */
// Espelha o contrato `*Input` do Rust (snake_case, 1:1 com o serde).

/** Como resolver a imagem de um retrato ao salvar. */
export type RetratoInput =
  | { modo: "manter"; caminho: string }
  | { modo: "novo"; base64: string; formato: string }
  | { modo: "nenhum" };

export interface TransformacaoInput {
  nome: string;
  descricao: string;
  retrato: RetratoInput;
  modificadores: ModificadorDto[]; // {atributo, delta} — mesma forma da leitura
  habilidades: HabilidadeDto[]; // forma completa da técnica — mesma forma da leitura
  uid?: string; // chave de render no editor (client-only; ver HabilidadeDto.uid)
}

/** Payload inteiro do save (criar/atualizar). */
export interface PersonagemInput {
  tipo: Tipo;
  nome: string;
  descricao: string;
  hp: number;
  sp: number;
  escudo: number;
  forca: number;
  agilidade: number;
  percepcao: number;
  resistencia: number;
  intuicao: number;
  espirito: number;
  carisma: number;
  determinacao: number;
  retrato: RetratoInput;
  habilidades: HabilidadeDto[];
  pericias: PericiaDto[]; // {nome, descricao, atributo, nivel}
  vantagens: TracoDto[]; // {nome, descricao, efeito}
  desvantagens: TracoDto[];
  transformacoes: TransformacaoInput[];
  /** Etiquetas por nome; o backend faz upsert. Ignorado quando `tipo === "jogador"`. */
  etiquetas: string[];
}

/* -------------------------------- Etiquetas ------------------------------- */

/** Token de cor da etiqueta — a paleta é fechada (validada no Rust). */
export type CorEtiqueta =
  | "slate"
  | "rose"
  | "amber"
  | "emerald"
  | "sky"
  | "violet"
  | "orange"
  | "cyan";

export interface Etiqueta {
  id: number;
  nome: string;
  cor: CorEtiqueta;
  /** Quantos personagens usam — mostrado na chip do filtro. */
  total: number;
}

export interface EtiquetaInput {
  nome: string;
  cor: CorEtiqueta;
}

/** Retorno de `importarFichas`: quantas entraram e o motivo de cada recusa. */
export interface ResultadoImport {
  importadas: number;
  erros: string[];
}

/* -------------------------------- Catálogos ------------------------------- */

export interface CatalogoPericia {
  id: number;
  nome: string;
  descricao: string;
  atributo: string;
}

export interface CatalogoTraco {
  id: number;
  nome: string;
  descricao: string;
  efeito: string;
}

export interface Catalogos {
  pericias: CatalogoPericia[];
  vantagens: CatalogoTraco[];
  desvantagens: CatalogoTraco[];
}

/** Tipo de traço do catálogo — escolhe a tabela (`catalogo_vantagem`/`catalogo_desvantagem`) no backend. */
export type TipoTraco = "vantagem" | "desvantagem";

/** Entrada de criação/atualização de uma perícia do catálogo. */
export interface CatalogoPericiaInput {
  nome: string;
  descricao: string;
  atributo: string;
}

/** Entrada de criação/atualização de uma vantagem/desvantagem do catálogo. */
export interface CatalogoTracoInput {
  nome: string;
  descricao: string;
  efeito: string;
}

/* --------------------------------- Batalha -------------------------------- */
// Espelha o serde do motor (`domain::batalha`). snake_case, 1:1 com o Rust.

export type PoolNome = "hp" | "sp" | "escudo";

export type AtributoNome =
  | "forca"
  | "agilidade"
  | "percepcao"
  | "resistencia"
  | "intuicao"
  | "espirito"
  | "carisma"
  | "determinacao";

export interface Pools {
  hp: number;
  sp: number;
  escudo: number;
}

export type OrigemModificador = { transformacao: string } | { status: string };

export interface ModificadorBatalha {
  origem: OrigemModificador;
  deltas: [AtributoNome, number][];
  duracao: number | null;
}

export interface Cooldown {
  habilidade: string;
  turnos_restantes: number | null;
}

/** Distribuição de um dano entre as pools (dano recorrente). Espelha o Rust. */
export interface DanoDistribuido {
  hp: number;
  sp: number;
  escudo: number;
  /** Se true, a parte do escudo que exceder o escudo atual transborda pro HP. */
  escudo_transborda: boolean;
}

/** Efeito de dano recorrente: aplica `dano` no início do turno do alvo, por `duracao` turnos. */
export interface EfeitoRecorrente {
  origem: string;
  dano: DanoDistribuido;
  duracao: number;
}

export interface Combatente {
  id: number;
  personagem_ref: number | null;
  nome: string;
  tipo: Tipo;
  faccao: string | null;
  base: number[];
  pools: Pools;
  modificadores: ModificadorBatalha[];
  cooldowns: Cooldown[];
  efeitos_recorrentes: EfeitoRecorrente[];
  turnos_extras: number;
  /** Posição no mapa ativo (0-indexed [linha, coluna]); null = fora do mapa (Fase 3). */
  posicao: [number, number] | null;
}

/** Um evento do log da batalha (opaco no B2 Fatia 1 — só o tipo/registro importa). */
export type EventoBatalha = Record<string, unknown>;

/** Estado da batalha ativa. Espelha `Estado` do Rust. */
export interface EstadoBatalha {
  combatentes: Combatente[];
  ordem: number[];
  ordem_manual: boolean;
  rodada: number;
  indice_turno: number;
  historico: EventoBatalha[];
  /** Mapa ativo da batalha (fonte única do cockpit/Discord); null = nenhum (Fase 3). */
  mapa_id: number | null;
}

/* ----------------------------------- Mapa ---------------------------------- */
export interface Mapa {
  id: number;
  titulo: string;
  colunas: number;
  linhas: number;
  grade: string[];
  legenda: string;
  efeito: string;
  criado_em: string;
  atualizado_em: string;
}

export interface MapaResumo {
  id: number;
  titulo: string;
  atualizado_em: string;
}

export interface MapaInput {
  titulo: string;
  colunas: number;
  linhas: number;
  grade: string[];
  legenda: string;
  efeito: string;
}

/* ----------------------------------- Nota ---------------------------------- */
export interface Nota {
  id: number;
  titulo: string;
  corpo: string;
  criado_em: string;
  atualizado_em: string;
}

export interface NotaResumo {
  id: number;
  titulo: string;
  atualizado_em: string;
}

export interface NotaInput {
  titulo: string;
  corpo: string;
}

/* --------------------------------- Discord --------------------------------- */
export interface Guild {
  id: string;
  nome: string;
}

/** Resposta de `discordConectar`: usuário logado + servidores (guilds) visíveis. */
export interface InfoConexao {
  usuario: string;
  guilds: Guild[];
}

export interface CanalTexto {
  id: string;
  nome: string;
  guild: string;
}

/** Uma mensagem lida de um canal (sync de regras). Espelha `MensagemCanal` do Rust. */
export interface MensagemCanal {
  autor: string;
  texto: string;
  timestamp: string;
}

/** Um favorito de música (v2 — tabela SQLite própria). `categoria` null = sem categoria. */
export interface Favorito {
  id: number;
  nome: string;
  url: string;
  categoria: string | null;
  criado_em: string;
  atualizado_em: string;
}

/** Entrada de criação/atualização de um favorito (sem id/timestamps). */
export interface FavoritoInput {
  nome: string;
  url: string;
  categoria: string | null;
}

/** Um item da fila de reprodução — parte de `EventoMusica.fila`. */
export interface ItemFila {
  titulo: string | null;
  url: string | null;
  duracao: number | null; // segundos
}

/**
 * Payload do evento `discord:evento` quando `tipo === "musica"` (objeto). Os demais
 * eventos (`desconectado`, etc.) continuam sendo string. Espelha o DTO do sidecar/Rust.
 */
export interface EventoMusica {
  tipo: "musica";
  estado: "tocando" | "pausado" | "parado";
  /** True se o bot tem uma conexão de voz ativa (independe de estar tocando). */
  em_voz: boolean;
  titulo: string | null;
  /** Posição atual, em segundos. */
  posicao: number;
  /** Duração total, em segundos; null quando desconhecida. */
  duracao: number | null;
  velocidade: number;
  loop: boolean;
  ab: { a: number | null; b: number | null; ativo: boolean };
  fila: ItemFila[];
}

/* ---------------------------- Sync de nuvem ---------------------------- */

/**
 * O que a guarda leve decidiu (Rust `Acao`, `#[serde(rename_all = "snake_case")]`).
 * Ver docs/plans/2026-08-10-sync-nuvem.md §4.
 */
export type AcaoSync =
  | "em_dia"
  | "nuvem_mais_nova"
  | "local_mais_novo"
  | "conflito"
  | "sem_nuvem";

/**
 * Espelha `TipoTransporte` (Rust, `db::sincronizacao_nuvem`) — persistido em
 * `config.sync_transporte` (Fase 3, docs/plans/2026-08-11-sync-google-drive.md).
 * `"pasta"` é o default (também o que uma instalação sem a chave assume).
 */
export type TipoTransporte = "pasta" | "drive";

/** Espelha `SyncStatus` (Rust) — devolvido por `sync_status`. */
export interface SyncStatus {
  acao: AcaoSync;
  contador_nuvem: number | null;
  contador_local: number;
  sujo: boolean;
  hora: string | null;
}

/** Espelha `SyncResultado` (Rust) — devolvido por `sync_enviar`/`sync_baixar`. */
export interface SyncResultado {
  sucesso: boolean;
  mensagem: string;
  contador: number | null;
  backup: string | null;
}

/**
 * Espelha `EventoBootSync` (Rust, `#[serde(tag = "tipo")]`) — devolvido por
 * `sync_verificar_boot`, lido uma vez no primeiro render. Desde 2026-08-11 o
 * boot só OLHA a nuvem (lê o manifesto) e avisa; nenhuma variante significa
 * "já baixei" — sincronizar é sempre um botão da tela Sincronização.
 */
export type EventoBootSync =
  | { tipo: "nenhum" }
  | { tipo: "nuvem_mais_nova"; contador: number }
  | { tipo: "conflito_pendente"; contador_nuvem: number };

/**
 * Espelha `GoogleStatus` (Rust, `google::auth`) — devolvido por `google_status`
 * (docs/plans/2026-08-11-sync-google-drive.md, Fase 1). Nunca carrega token.
 */
export interface GoogleStatus {
  conectado: boolean;
  email: string | null;
}

export interface CanalVoz {
  id: string;
  nome: string;
  guild: string;
}

/* ------------------------------ Batalha (presets) --------------------------- */

/** Uma batalha pré-pronta salva (resumo — sem o estado completo). */
export interface BatalhaPreset {
  id: number;
  nome: string;
  descricao: string;
  combatentes: number;
  criado_em: string;
  atualizado_em: string;
}
