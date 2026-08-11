import { invoke } from "@tauri-apps/api/core";
import type {
  AtributoNome,
  BatalhaPreset,
  CanalTexto,
  CanalVoz,
  CatalogoPericia,
  CatalogoPericiaInput,
  CatalogoTraco,
  CatalogoTracoInput,
  Catalogos,
  EstadoBatalha,
  Etiqueta,
  EtiquetaInput,
  EventoBootSync,
  Favorito,
  FavoritoInput,
  GoogleStatus,
  InfoConexao,
  Mapa,
  MapaInput,
  MapaResumo,
  MensagemCanal,
  Nota,
  NotaInput,
  NotaResumo,
  PersonagemCompleto,
  PersonagemInput,
  PersonagemResumo,
  PoolNome,
  ResultadoImport,
  SyncResultado,
  SyncStatus,
  Tipo,
  TipoTraco,
  TipoTransporte,
} from "./types";

/** Lista personagens do banco; `tipo` null = todos. */
export const listarPersonagens = (tipo: Tipo | null) =>
  invoke<PersonagemResumo[]>("listar_personagens", { tipo });

/** Ficha completa de um personagem (atributos com rank, habilidades, abas). */
export const getPersonagem = (id: number) =>
  invoke<PersonagemCompleto>("get_personagem", { id });

/** Lê o retrato em `app_data/images/<caminho>` e devolve um data-URL (base64). */
export const retratoDataUrl = (caminho: string) =>
  invoke<string>("retrato_data_url", { caminho });

/** Cria um personagem (save atômico); devolve o id novo. */
export const criarPersonagem = (input: PersonagemInput) =>
  invoke<number>("criar_personagem", { input });

/** Atualiza um personagem inteiro (replace-all das coleções). */
export const atualizarPersonagem = (id: number, input: PersonagemInput) =>
  invoke<void>("atualizar_personagem", { id, input });

/** Exclui um personagem (filhos caem por cascade). */
export const excluirPersonagem = (id: number) =>
  invoke<void>("excluir_personagem", { id });

/** Catálogos de perícias/vantagens/desvantagens pros pickers do form. */
export const listarCatalogos = () => invoke<Catalogos>("listar_catalogos", {});

/* -------------------------------- Etiquetas ------------------------------- */

/** Todas as etiquetas, com a contagem de uso. */
export const listarEtiquetas = () => invoke<Etiqueta[]>("listar_etiquetas", {});

export const criarEtiqueta = (input: EtiquetaInput) =>
  invoke<Etiqueta>("criar_etiqueta", { input });

export const atualizarEtiqueta = (id: number, input: EtiquetaInput) =>
  invoke<Etiqueta>("atualizar_etiqueta", { id, input });

/** Exclui a etiqueta; os personagens ficam, só perdem o vínculo. */
export const excluirEtiqueta = (id: number) =>
  invoke<void>("excluir_etiqueta", { id });

/** Atribuição rápida (sem abrir o form). Devolve as etiquetas resultantes. */
export const definirEtiquetasPersonagem = (
  personagemId: number,
  etiquetas: string[],
) =>
  invoke<string[]>("definir_etiquetas_personagem", { personagemId, etiquetas });

/* --------------------------- Export / import ------------------------------ */

/** Grava as fichas como JSON no caminho escolhido; devolve quantas foram. */
export const exportarFichas = (ids: number[], caminho: string) =>
  invoke<number>("exportar_fichas", { ids, caminho });

/** Importa fichas de um arquivo de export (nunca sobrescreve). */
export const importarFichas = (caminho: string) =>
  invoke<ResultadoImport>("importar_fichas", { caminho });

/* --------------------------------- Batalha -------------------------------- */
// Cada comando devolve o Estado novo da batalha (a UI só substitui o cache).

/** Estado atual da batalha ativa. */
export const batalhaEstado = () => invoke<EstadoBatalha>("batalha_estado", {});

/** Adiciona um combatente a partir de um personagem (snapshot dos stats). `turnosExtras` = turnos além do 1º. */
export const batalhaAdicionar = (personagemId: number, turnosExtras: number) =>
  invoke<EstadoBatalha>("batalha_adicionar", { personagemId, turnosExtras });

/** Remove um combatente da arena. */
export const batalhaRemover = (id: number) =>
  invoke<EstadoBatalha>("batalha_remover", { id });

/** Aplica dano. `pool` null = escudo absorve primeiro, transbordo no HP. */
export const batalhaDano = (id: number, valor: number, pool: PoolNome | null) =>
  invoke<EstadoBatalha>("batalha_dano", { id, valor, pool });

/** Recupera uma pool (sem teto). */
export const batalhaCurar = (id: number, valor: number, pool: PoolNome) =>
  invoke<EstadoBatalha>("batalha_curar", { id, valor, pool });

/** Calculadora de dano: distribuição instantânea + (opcional) recorrente por N turnos. */
export const batalhaCalculadoraDano = (
  id: number,
  dano: { hp: number; sp: number; escudo: number; escudoTransborda: boolean },
  repetirTurnos: number | null,
) =>
  invoke<EstadoBatalha>("batalha_calculadora_dano", {
    id,
    hp: dano.hp,
    sp: dano.sp,
    escudo: dano.escudo,
    escudoTransborda: dano.escudoTransborda,
    repetirTurnos,
  });

/** Avança para o próximo turno (nova rodada ao dar wrap). */
export const batalhaProximoTurno = () =>
  invoke<EstadoBatalha>("batalha_proximo_turno", {});

/** Força uma nova rodada. */
export const batalhaNovaRodada = () =>
  invoke<EstadoBatalha>("batalha_nova_rodada", {});

/** Desfaz a última ação. */
export const batalhaDesfazer = () =>
  invoke<EstadoBatalha>("batalha_desfazer", {});

/** Reseta a batalha (limpa combatentes). */
export const batalhaResetar = () =>
  invoke<EstadoBatalha>("batalha_resetar", {});

/** Edita quantos turnos EXTRAS o combatente tem na rodada (total = 1 + extras). */
export const batalhaEditarTurnos = (id: number, valor: number) =>
  invoke<EstadoBatalha>("batalha_editar_turnos_extras", { id, valor });

/** Aplica uma transformação da ficha do combatente (troca a ativa; reordena iniciativa). */
export const batalhaTransformar = (id: number, transformacao: string) =>
  invoke<EstadoBatalha>("batalha_transformar", { id, transformacao });

/** Reverte a transformação ativa (volta à forma base). */
export const batalhaReverter = (id: number) =>
  invoke<EstadoBatalha>("batalha_reverter_transformacao", { id });

/** Usa uma habilidade: `tempo` inteiro > 0 = cooldown de N turnos; vazio/texto = permanente. */
export const batalhaUsarHabilidade = (id: number, habilidade: string, tempo: string) =>
  invoke<EstadoBatalha>("batalha_usar_habilidade", { id, habilidade, tempo });

/** Reabilita manualmente uma habilidade travada. */
export const batalhaReabilitar = (id: number, habilidade: string) =>
  invoke<EstadoBatalha>("batalha_reabilitar_habilidade", { id, habilidade });

/** Alterna ordem automática (por agilidade) vs manual. */
export const batalhaAlternarModo = (manual: boolean) =>
  invoke<EstadoBatalha>("batalha_alternar_modo_ordem", { manual });

/** Define a ordem de iniciativa manualmente (entra em modo manual). */
export const batalhaDefinirOrdem = (ordem: number[]) =>
  invoke<EstadoBatalha>("batalha_definir_ordem", { ordem });

/** Define o modificador manual de atributos (buff/debuff ad-hoc). Lista vazia = resetar. */
export const batalhaModificadorManual = (
  id: number,
  deltas: [AtributoNome, number][],
) => invoke<EstadoBatalha>("batalha_modificador_manual", { id, deltas });

/** Rank (0..=13) de um atributo para um valor efetivo (base + mods). */
export const calcularRank = (atributo: AtributoNome, valor: number) =>
  invoke<number>("calcular_rank", { atributo, valor });

/* --- Peças no mapa (Fase 3 — só os bindings; UI é da próxima onda). --- */

/** Define o mapa ativo da batalha (fonte única do cockpit/Discord). */
export const batalhaDefinirMapa = (mapaId: number) =>
  invoke<EstadoBatalha>("batalha_definir_mapa", { mapaId });

/** Posiciona uma peça (combatente) numa célula do mapa ativo (drag inicial do roster). */
export const batalhaPosicionarPeca = (id: number, linha: number, coluna: number) =>
  invoke<EstadoBatalha>("batalha_posicionar_peca", { id, linha, coluna });

/** Move uma peça já posicionada para outra célula. */
export const batalhaMoverPeca = (id: number, linha: number, coluna: number) =>
  invoke<EstadoBatalha>("batalha_mover_peca", { id, linha, coluna });

/** Remove a peça do mapa (o combatente volta pra fora do grid). */
export const batalhaRemoverPeca = (id: number) =>
  invoke<EstadoBatalha>("batalha_remover_peca", { id });

/* ----------------------------------- Mapa ---------------------------------- */
/** Lista os mapas (resumo) pra biblioteca lateral. */
export const listarMapas = () => invoke<MapaResumo[]>("listar_mapas", {});

/** Carrega um mapa completo (grade normalizada). */
export const getMapa = (id: number) => invoke<Mapa>("get_mapa", { id });

/** Cria um mapa; devolve o mapa criado (com id). */
export const criarMapa = (input: MapaInput) => invoke<Mapa>("criar_mapa", { input });

/** Salva um mapa inteiro; devolve o mapa atualizado. */
export const atualizarMapa = (id: number, input: MapaInput) =>
  invoke<Mapa>("atualizar_mapa", { id, input });

/** Duplica um mapa (título + " (cópia)"); devolve a cópia. */
export const duplicarMapa = (id: number) => invoke<Mapa>("duplicar_mapa", { id });

/** Exclui um mapa. */
export const excluirMapa = (id: number) => invoke<void>("excluir_mapa", { id });

/** Render do estado atual do editor no formato do Discord (fonte única). `mapaId` = peças da batalha. */
export const renderMapaDiscord = (input: MapaInput, mapaId?: number) =>
  invoke<string>("render_mapa_discord", { input, mapaId });

/* ----------------------------------- Nota ---------------------------------- */
/** Lista as notas (resumo) pra biblioteca lateral. */
export const listarNotas = () => invoke<NotaResumo[]>("listar_notas", {});

/** Carrega uma nota completa (título + corpo). */
export const getNota = (id: number) => invoke<Nota>("get_nota", { id });

/** Cria uma nota; devolve a nota criada (com id). */
export const criarNota = (input: NotaInput) => invoke<Nota>("criar_nota", { input });

/** Salva uma nota inteira; devolve a nota atualizada. */
export const atualizarNota = (id: number, input: NotaInput) =>
  invoke<Nota>("atualizar_nota", { id, input });

/** Exclui uma nota. */
export const excluirNota = (id: number) => invoke<void>("excluir_nota", { id });

/* --------------------------------- Compêndio ------------------------------- */
/** Cria uma perícia no catálogo; devolve a perícia criada (com id). */
export const criarCatalogoPericia = (input: CatalogoPericiaInput) =>
  invoke<CatalogoPericia>("criar_catalogo_pericia", { input });

/** Salva uma perícia do catálogo inteira; devolve a perícia atualizada. */
export const atualizarCatalogoPericia = (id: number, input: CatalogoPericiaInput) =>
  invoke<CatalogoPericia>("atualizar_catalogo_pericia", { id, input });

/** Exclui uma perícia do catálogo (não afeta fichas — os campos são copiados por valor). */
export const excluirCatalogoPericia = (id: number) =>
  invoke<void>("excluir_catalogo_pericia", { id });

/** Cria uma vantagem/desvantagem no catálogo; devolve a entrada criada (com id). */
export const criarCatalogoTraco = (tipo: TipoTraco, input: CatalogoTracoInput) =>
  invoke<CatalogoTraco>("criar_catalogo_traco", { tipo, input });

/** Salva uma vantagem/desvantagem do catálogo inteira; devolve a entrada atualizada. */
export const atualizarCatalogoTraco = (tipo: TipoTraco, id: number, input: CatalogoTracoInput) =>
  invoke<CatalogoTraco>("atualizar_catalogo_traco", { tipo, id, input });

/** Exclui uma vantagem/desvantagem do catálogo (não afeta fichas — os campos são copiados por valor). */
export const excluirCatalogoTraco = (tipo: TipoTraco, id: number) =>
  invoke<void>("excluir_catalogo_traco", { tipo, id });

/* --------------------------------- Discord --------------------------------- */
// F4.0: encanamento cru do sidecar (processo Python + JSONL). F4.1–4.4: login,
// canais e postar/sincronizar o mapa ao vivo — tudo por cima do mesmo sidecar.

/** Sobe o processo do sidecar (idempotente — não faz nada se já estiver rodando). */
export const discordIniciar = () => invoke<void>("discord_iniciar", {});

/** Envia um `ping` ao sidecar e devolve a resposta (`"pong"` quando tudo certo). */
export const discordPing = () => invoke<string>("discord_ping", {});

/** Conecta o bot (sobe o sidecar se precisar); devolve usuário logado + guilds visíveis. */
export const discordConectar = () => invoke<InfoConexao>("discord_conectar", {});

/** Lista os canais de texto que o bot enxerga. */
export const discordListarCanais = () => invoke<CanalTexto[]>("discord_listar_canais", {});

/** Lê até `limite` mensagens (ordem cronológica) de um canal de texto — sync de regras. */
export const discordLerCanal = (canalId: string, limite: number) =>
  invoke<MensagemCanal[]>("discord_ler_canal", { canalId, limite });

/** Define o canal de destino da sessão (zera a mensagem postada — trocou de canal). */
export const discordDefinirCanal = (canalId: string) =>
  invoke<void>("discord_definir_canal", { canalId });

/** Canal de destino salvo (persistido entre sessões); null = nunca escolhido. */
export const discordCanalSalvo = () => invoke<string | null>("discord_canal_salvo", {});

/** Posta o mapa no canal definido; devolve o id da mensagem criada. `mapaId` = peças da batalha. */
export const discordPostarMapa = (input: MapaInput, mapaId?: number) =>
  invoke<string>("discord_postar_mapa", { input, mapaId });

/** Atualiza (edita) a mensagem já postada — no-op silencioso se ainda não postou nada. */
export const discordAtualizarMapa = (input: MapaInput, mapaId?: number) =>
  invoke<void>("discord_atualizar_mapa", { input, mapaId });

/* --------------------------------- Música (F4.5) --------------------------------- */
// Por cima do mesmo sidecar/protocolo JSONL — só novos `cmd`s.

/** Lista os canais de voz que o bot enxerga. */
export const discordListarCanaisVoz = () => invoke<CanalVoz[]>("discord_listar_canais_voz", {});

/** Entra num canal de voz — pré-requisito pra tocar música. */
export const discordEntrarVoz = (canalId: string) =>
  invoke<void>("discord_entrar_voz", { canalId });

/** Sai do canal de voz atual. */
export const discordSairVoz = () => invoke<void>("discord_sair_voz", {});

/** Toca uma URL no canal de voz atual (o bot decide se toca já ou entra na fila). */
export const discordMusicaPlay = (url: string) => invoke<void>("discord_musica_play", { url });

/** Pula a faixa atual. */
export const discordMusicaSkip = () => invoke<void>("discord_musica_skip", {});

/** Para a reprodução e limpa a fila. */
export const discordMusicaStop = () => invoke<void>("discord_musica_stop", {});

/** Alterna o loop da faixa atual. */
export const discordMusicaLoop = () => invoke<void>("discord_musica_loop", {});

/** Toca `url` imediatamente, interrompendo a faixa atual e mantendo a fila intacta. */
export const discordMusicaTocarAgora = (url: string) =>
  invoke<void>("discord_musica_tocar_agora", { url });

/* --- Música avançada (Fase 2): seek, velocidade, loop A-B, auto-seguir. --- */

/** Salta para `segundos` na faixa atual. */
export const discordMusicaSeek = (segundos: number) =>
  invoke<void>("discord_musica_seek", { segundos });

/** Troca a velocidade de reprodução (0.5/1/1.5/2×; re-stream no offset atual). */
export const discordMusicaVelocidade = (fator: number) =>
  invoke<void>("discord_musica_velocidade", { fator });

/** Define os marcadores do loop A-B (null zera o respectivo ponto). */
export const discordMusicaAbDefinir = (a: number | null, b: number | null) =>
  invoke<void>("discord_musica_ab_definir", { a, b });

/** Liga/desliga o loop A-B (sem apagar os marcadores). */
export const discordMusicaAbToggle = (ativo: boolean) =>
  invoke<void>("discord_musica_ab_toggle", { ativo });

/** Liga/desliga o bot seguindo um usuário pelo nick (auto-join no canal de voz dele). */
export const discordAutoSeguir = (ativo: boolean, nick: string) =>
  invoke<void>("discord_auto_seguir", { ativo, nick });

/* --- Favoritos v2 (tabela SQLite própria; substitui o discord_listar_favoritos do sidecar). --- */

/** Lista os favoritos de música salvos no banco (v2). */
export const listarFavoritos = () => invoke<Favorito[]>("listar_favoritos", {});

/** Cria um favorito; devolve o favorito criado (com id). */
export const criarFavorito = (input: FavoritoInput) =>
  invoke<Favorito>("criar_favorito", { input });

/** Atualiza um favorito inteiro; devolve o favorito atualizado. */
export const atualizarFavorito = (id: number, input: FavoritoInput) =>
  invoke<Favorito>("atualizar_favorito", { id, input });

/** Exclui um favorito. */
export const excluirFavorito = (id: number) =>
  invoke<void>("excluir_favorito", { id });

/* --------------------------- Batalha (presets) ------------------------------ */
// Biblioteca de batalhas pré-prontas: salva/recarrega a arena inteira (combatentes,
// pools, iniciativa) sob um nome. Separado do estado ao vivo (`batalha_estado`).

/** Salva a batalha atual como um preset novo. */
export const batalhaPresetSalvar = (nome: string, descricao: string) =>
  invoke<BatalhaPreset>("batalha_preset_salvar", { nome, descricao });

/** Lista os presets salvos (resumo) pra biblioteca. */
export const batalhaPresetListar = () =>
  invoke<BatalhaPreset[]>("batalha_preset_listar", {});

/** Carrega um preset — substitui a batalha em andamento pelo estado salvo. */
export const batalhaPresetCarregar = (id: number) =>
  invoke<EstadoBatalha>("batalha_preset_carregar", { id });

/** Sobrescreve um preset existente com o estado atual da batalha. */
export const batalhaPresetSobrescrever = (id: number) =>
  invoke<BatalhaPreset>("batalha_preset_sobrescrever", { id });

/** Renomeia/redescreve um preset (não mexe no estado salvo). */
export const batalhaPresetRenomear = (id: number, nome: string, descricao: string) =>
  invoke<BatalhaPreset>("batalha_preset_renomear", { id, nome, descricao });

/** Exclui um preset. */
export const batalhaPresetExcluir = (id: number) =>
  invoke<void>("batalha_preset_excluir", { id });

/* --------------------------------- Config --------------------------------- */

/** Lê uma config por chave; null = nunca definida. */
export const configGet = (chave: string) =>
  invoke<string | null>("config_get", { chave });

/** Grava/atualiza uma config. */
export const configSet = (chave: string, valor: string) =>
  invoke<void>("config_set", { chave, valor });

/* ---------------------------- Cofre de segredos ---------------------------- */

/** "destravado" | "trancado" (pede senha-mestra) | "ausente" (bundle sem cofre). */
export const segredosStatus = () => invoke<string>("segredos_status", {});

/** Destrava o cofre com a senha-mestra (1x por máquina). Erro = senha incorreta. */
export const segredosDestravar = (senha: string) =>
  invoke<void>("segredos_destravar", { senha });

/* -------------------------- Sync de nuvem -------------------------- */
// Ver docs/plans/2026-08-10-sync-nuvem.md. Pasta escolhida pelo usuário via
// diálogo nativo (tauri-plugin-dialog); os comandos só recebem o caminho.

/** Grava a pasta da nuvem escolhida (dialog nativo, fora daqui). */
export const syncDefinirPasta = (caminho: string) =>
  invoke<void>("sync_definir_pasta", { caminho });

/** Pasta salva atualmente; null = ainda não configurada. */
export const syncPastaAtual = () => invoke<string | null>("sync_pasta_atual", {});

/** Compara carimbo local x manifesto da nuvem e devolve a ação sugerida. */
export const syncStatus = () => invoke<SyncStatus>("sync_status", {});

/** Grava o pacote na nuvem. `forcar` pula o aviso "por cima de algo mais novo". */
export const syncEnviar = (forcar: boolean) =>
  invoke<SyncResultado>("sync_enviar", { forcar });

/** Baixa o pacote da nuvem e substitui o banco local (com backup). `forcar` pula os avisos. */
export const syncBaixar = (forcar: boolean) =>
  invoke<SyncResultado>("sync_baixar", { forcar });

/**
 * Dispara a sincronização automática do boot (Fase 3) sob demanda — não roda
 * mais dentro do `.setup()` do Tauri (rede bloqueava a abertura da janela).
 * Chamado pelo `SyncBootDriver` depois do primeiro render.
 */
export const syncVerificarBoot = () => invoke<EventoBootSync>("sync_verificar_boot", {});

/**
 * Chave espelhando `CHAVE_SYNC_TRANSPORTE` (Rust, `db::sincronizacao_nuvem`).
 * Sem comando dedicado: `config_get`/`config_set` (já genéricos) bastam — só
 * duas telas escrevem aqui, então validar o valor no backend não paga a pena
 * ainda (Fase 4, docs/plans/2026-08-11-sync-google-drive.md).
 */
const CHAVE_SYNC_TRANSPORTE = "sync_transporte";

/** Transporte configurado; `null`/valor desconhecido cai em `"pasta"` (default do Rust). */
export const syncTransporteAtual = async (): Promise<TipoTransporte> =>
  (await configGet(CHAVE_SYNC_TRANSPORTE)) === "drive" ? "drive" : "pasta";

/** Troca o transporte usado por `sync_enviar`/`sync_baixar`/o boot. */
export const syncDefinirTransporte = (tipo: TipoTransporte) =>
  configSet(CHAVE_SYNC_TRANSPORTE, tipo);

/* ---------------------- Sync via Google Drive (transporte) ---------------------- */
// Ver docs/plans/2026-08-11-sync-google-drive.md. Fase 1: só login/status/logout —
// o access token nunca cruza pro TS, fica só no Rust (`google::auth`).

/** Abre o navegador pro login Google (OAuth2+PKCE); devolve o e-mail conectado. */
export const googleLogin = () => invoke<string>("google_login", {});

/** Situação da conexão: conectado + e-mail, ou desconectado. Nunca inclui token. */
export const googleStatus = () => invoke<GoogleStatus>("google_status", {});

/** Esquece a conta (apaga o refresh token do Gerenciador de Credenciais). */
export const googleLogout = () => invoke<void>("google_logout", {});
