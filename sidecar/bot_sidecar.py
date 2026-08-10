"""Sidecar Python do projeto-rpg-v2 — Fase 4.0/4.1 (harness + Discord).

Fala um protocolo JSONL simples por stdin/stdout com o processo Rust/Tauri:

- Ao subir, anuncia ``{"tipo": "pronto"}`` no stdout.
- Cada linha do stdin é um comando: ``{"id": "...", "cmd": "...", "args": {}}``.
- Cada linha do stdout é uma resposta:
    sucesso -> ``{"id": "...", "ok": true, "data": ...}``
    erro    -> ``{"id": "...", "ok": false, "erro": "..."}``
- Eventos espontâneos (sem id): ``{"tipo": "...", "data": {...}}``.

REGRA CRÍTICA: stdout é EXCLUSIVO do protocolo JSONL. Nenhuma outra saída
pode ir para lá — todo log/debug vai para stderr. Não adicione `print(...)`
sem `file=sys.stderr` neste arquivo.

Fase 4.0 (harness): loop stdio JSONL, dispatcher cmd->handler, ping/pong.
Só stdlib — sem Discord, sem token, sem rede.

Fase 4.1 (este arquivo, seção "Discord"): login gated por comando
explícito ("conectar"), listar canais de texto, postar/editar mensagem
(mapa). O bot roda numa thread própria com seu próprio event loop
asyncio; comandos que falam com o Discord agendam corrotinas nesse loop
via `asyncio.run_coroutine_threadsafe` e esperam o resultado (função
`_agendar_no_bot`).

Fase 4.5 (música, seção "Música"): importa o cog `MusicBot` de
`musica_v1.py` — cópia local do motor do v1 (`Discord/bot.py`), com
caminhos (ffmpeg/cache/favoritos) parametrizados por env var `RPGV2_*`
para rodar empacotado (PyInstaller, F4.6) fora do checkout do v1. Import
feito dentro de `conectar` (login gated, ver seção "Estado do bot
Discord"). Expõe favoritos, canais de voz, entrar/sair de voz e
play/skip/stop/loop como comandos JSONL.
"""

from __future__ import annotations

import asyncio
import importlib
import json
import os
import queue
import sys
import threading
import time
from collections.abc import Callable, Coroutine
from concurrent.futures import Future
from typing import Any

import discord
from discord.ext import commands

# --------------------------------------------------------------------------
# Saída (stdout) e log (stderr) — ambos com lock.
#
# Por quê um lock: desde a F4.1 a thread do bot Discord (`_rodar_bot_thread`,
# ver seção "Estado do bot Discord" abaixo) também manda linhas JSONL
# (eventos espontâneos como "conectado"/"desconectado") e logs, ao mesmo
# tempo que a thread principal despacha comandos — sem lock, duas threads
# escrevendo ao mesmo tempo podem intercalar bytes no meio de uma linha e
# corromper o protocolo.
# --------------------------------------------------------------------------
_stdout_lock = threading.Lock()
_stderr_lock = threading.Lock()

# Canal EXCLUSIVO do protocolo JSONL: um duplicado do descritor 1 original,
# guardado por `_isolar_stdout_do_protocolo` antes de `sys.stdout` ser desviado.
# Enquanto for None (módulo importado por um teste, sem passar pelo `main`), o
# `_enviar` cai no `sys.stdout` normal.
_saida_protocolo: Any = None
# Referência ao objeto de stdout original só para ele não ser coletado: se o
# TextIOWrapper morresse, ele fecharia o descritor 1 ao ser finalizado.
_stdout_original: Any = None


def _isolar_stdout_do_protocolo() -> None:
    """Reserva o descritor 1 para o protocolo e joga `sys.stdout` no stderr.

    stdout é o único canal do protocolo, mas biblioteca de terceiro escreve
    nele sem pedir licença. O yt-dlp imprime a barra de progresso
    (`[download] 88.8% ...`) SEM newline, e ela gruda no começo da linha JSONL
    seguinte — o lado Rust não consegue parsear e descarta a linha inteira,
    perdendo o evento de música (uma das causas da barra de progresso
    dessincronizar). Trocar o `print` de um módulo específico (ver
    `_silenciar_prints_v1`) resolve caso a caso; isolar o descritor resolve a
    classe inteira, inclusive código que ainda nem existe aqui. É o mesmo
    arranjo que servidor de LSP usa por falar protocolo em stdio.

    Idempotente. Se o stdout não tiver descritor real (situação de teste), não
    faz nada — o `_enviar` continua funcionando pelo caminho normal.
    """
    global _saida_protocolo, _stdout_original
    if _saida_protocolo is not None:
        return
    try:
        fd = sys.stdout.fileno()
    except (AttributeError, OSError, ValueError):
        return
    _stdout_original = sys.stdout
    _saida_protocolo = os.fdopen(os.dup(fd), "w", encoding="utf-8", newline="")
    sys.stdout = sys.stderr


def _enviar(obj: dict[str, Any]) -> None:
    """Serializa `obj` como uma linha JSON e escreve no canal do protocolo.

    Thread-safe: a thread do bot Discord emite eventos espontâneos enquanto a
    thread principal responde comandos; sem o lock, duas escritas podem
    intercalar bytes no meio de uma linha e corromper o protocolo.
    """
    linha = json.dumps(obj, ensure_ascii=False)
    destino = _saida_protocolo if _saida_protocolo is not None else sys.stdout
    with _stdout_lock:
        destino.write(linha + "\n")
        destino.flush()


def _log(msg: str) -> None:
    """Log de diagnóstico. NUNCA usar stdout aqui — só stderr."""
    with _stderr_lock:
        print(f"[bot_sidecar] {msg}", file=sys.stderr, flush=True)


# --------------------------------------------------------------------------
# Estado do bot Discord (F4.1)
#
# O login é GATED: só acontece quando o comando "conectar" chega (nunca
# automático no boot). O bot roda numa thread própria (`_bot_thread`) com
# seu próprio event loop asyncio (`_bot_loop`) — nem a thread leitora de
# stdin nem o loop de dispatch principal podem bloquear esperando o
# Discord. Comandos que precisam falar com o Discord (listar canais,
# postar/editar mensagem) agendam uma corrotina nesse loop via
# `asyncio.run_coroutine_threadsafe` e esperam o resultado — é isso que
# `_agendar_no_bot` faz. Do ponto de vista do dispatcher (`_processar_linha`)
# isso continua sendo uma chamada síncrona: o handler recebe args, devolve
# um dado ou lança uma exceção.
#
# `_bot_pronto()` é a fonte da verdade de "está conectado?" — não existe um
# bool paralelo guardando esse estado; perguntamos direto pro objeto
# discord.py (`is_ready()`/`is_closed()`), pra não correr o risco de um
# flag manual dessincronizar do estado real da conexão.
# --------------------------------------------------------------------------

TIMEOUT_LOGIN_S = 30.0  # login no Discord (handshake do gateway)
TIMEOUT_CHAMADA_S = 15.0  # comandos que falam com a API (listar/postar/editar)
TIMEOUT_FECHAR_S = 10.0  # bot.close() no encerramento
TIMEOUT_JOIN_S = 5.0  # esperar a thread do bot morrer após o close

# F4.5/F4.6 — cog de música (MusicBot) importado de `musica_v1.py` (módulo
# local, cópia do v1). `V1_DISCORD_CONFIG` é só o FALLBACK de dev do caminho
# dos favoritos — em produção o Rust passa `RPGV2_FAVORITOS` (ver
# `_cmd_listar_favoritos`). Só leitura deste caminho: nunca escrevemos aqui.
# O cog em si grava seu próprio cache em `RPGV2_CACHE_DIR` (ou o fallback
# `Discord/cache/` do v1) — comportamento do cog importado, não algo que
# criamos nesta F4.5/F4.6.
V1_DISCORD_CONFIG = r"C:\dev\Projeto Rpg\discord_config.json"

_lock_bot = threading.Lock()  # protege as 3 variáveis abaixo
_bot: commands.Bot | None = None
_bot_loop: asyncio.AbstractEventLoop | None = None
_bot_thread: threading.Thread | None = None
_login_future: Future[dict[str, Any]] | None = None


def _bot_pronto() -> bool:
    """True se há um bot logado e a conexão com o Discord está de pé."""
    return _bot is not None and _bot.is_ready() and not _bot.is_closed()


def _resumo_conexao(cliente: commands.Bot) -> dict[str, Any]:
    """Monta o payload {"usuario", "guilds"} devolvido por `conectar`."""
    return {
        "usuario": str(cliente.user),
        "guilds": [{"id": str(g.id), "nome": g.name} for g in cliente.guilds],
    }


def _agendar_no_bot(coro: Coroutine[Any, Any, Any], timeout: float = TIMEOUT_CHAMADA_S) -> Any:
    """Agenda `coro` no event loop da thread do bot e espera o resultado.

    Ponte entre o dispatcher (thread principal, síncrono) e o discord.py
    (thread própria, assíncrona). Uma exceção levantada dentro de `coro`
    atravessa o Future e é relançada aqui — quem chama (um handler de
    comando) não precisa saber que isso passou por outra thread.
    """
    if not _bot_pronto():
        coro.close()  # nunca agendada: evita warning "coroutine never awaited"
        raise RuntimeError("não conectado")

    future = asyncio.run_coroutine_threadsafe(coro, _bot_loop)
    try:
        return future.result(timeout=timeout)
    except TimeoutError:
        raise RuntimeError(f"timeout ({timeout:.0f}s) aguardando resposta do Discord")


def _rodar_bot_thread(token: str, login_future: Future[dict[str, Any]]) -> None:
    """Alvo da thread do bot: cria o client, loga e roda o event loop.

    Espelha o padrão do v1 (`DiscordBotThread.run`, ver
    C:/dev/Projeto Rpg/src/managers/discord_integration.py:141), trocando
    QThread por threading.Thread puro. Usamos `cliente.start()` (não
    `cliente.run()`): `run()` tenta registrar signal handlers, que só
    funcionam na thread principal — nesta thread de fundo isso quebraria.
    """
    global _bot, _bot_loop

    intents = discord.Intents.default()
    # voice_states habilita o evento on_voice_state_update, usado pelo
    # auto-join do "gedasiosaga" (F5). NÃO é intent privilegiado — não
    # precisa de configuração no dev portal. (Em discord.py 2.x já vem
    # ligado no default(), mas deixamos explícito por clareza e robustez
    # a mudanças de versão.)
    intents.voice_states = True
    # message_content É privilegiado (precisa ligar também no dev portal):
    # sem ele, channel.history() devolve mensagens com content vazio — o
    # sync de regras (comando ler_canal) depende disso.
    intents.message_content = True
    # Com message_content ligado, comandos de prefixo PASSARIAM a disparar.
    # O prefixo vira uma sentinela impossível de digitar: o cog de música
    # continua carregável (precisa de commands.Bot), mas ninguém no servidor
    # aciona comando por texto.
    cliente = commands.Bot(command_prefix="\0rpgv2\0", intents=intents)

    @cliente.event
    async def on_ready() -> None:
        _log(f"conectado ao Discord como {cliente.user} ({len(cliente.guilds)} guild(s))")
        if not login_future.done():
            login_future.set_result(_resumo_conexao(cliente))
        _enviar({"tipo": "conectado", "data": {"usuario": str(cliente.user)}})

    @cliente.event
    async def on_disconnect() -> None:
        # discord.py chama isto em QUALQUER queda do websocket, não só na
        # queda final — se a lib reconectar sozinha por trás, este evento
        # dispara mesmo assim (ver riscos no relatório).
        _log("desconectado do Discord (websocket)")
        _enviar({"tipo": "desconectado", "data": {}})

    @cliente.event
    async def on_voice_state_update(
        member: discord.Member,
        before: discord.VoiceState,
        after: discord.VoiceState,
    ) -> None:
        # Auto-join/-leave do "gedasiosaga" (F5). A lógica fica em
        # `_tratar_voice_state_update` (portada de Discord/bot.py:842-863 do
        # v1); aqui só encaminhamos. O cog importado NÃO registra esse
        # listener — ele vivia no bot de módulo do v1, não no cog — então
        # não há conflito em declará-lo no client do sidecar.
        await _tratar_voice_state_update(cliente, member, before, after)

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    with _lock_bot:
        _bot = cliente
        _bot_loop = loop

    try:
        loop.run_until_complete(cliente.start(token))
    except discord.LoginFailure as e:
        _log(f"login recusado pelo Discord: {e!r}")
        if not login_future.done():
            login_future.set_exception(
                RuntimeError("token invalido ou login recusado pelo Discord")
            )
    except Exception as e:
        _log(f"erro inesperado na thread do bot: {e!r}")
        if not login_future.done():
            login_future.set_exception(RuntimeError(f"erro ao conectar no Discord: {e}"))
    finally:
        try:
            loop.run_until_complete(cliente.close())
        except Exception:
            pass
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        except Exception:
            pass
        loop.close()
        _log("thread do bot encerrada")


def _encerrar_bot() -> None:
    """Fecha a conexão com o Discord de forma limpa, se houver uma ativa.

    Chamado no EOF do stdin (`main`), antes do processo sair. Idempotente:
    se não há bot ou ele já está fechado, não faz nada.
    """
    with _lock_bot:
        cliente, loop, thread = _bot, _bot_loop, _bot_thread

    if cliente is None or loop is None or cliente.is_closed():
        return

    _log("encerrando conexao com o Discord...")
    try:
        future = asyncio.run_coroutine_threadsafe(cliente.close(), loop)
        future.result(timeout=TIMEOUT_FECHAR_S)
    except Exception as e:
        _log(f"erro ao encerrar bot (seguindo mesmo assim): {e!r}")
    if thread is not None:
        thread.join(timeout=TIMEOUT_JOIN_S)
    _log("conexao com Discord encerrada")


# --------------------------------------------------------------------------
# Dispatcher de comandos: dict cmd -> handler(args) -> data
#
# F4.1 adicionou entradas aqui (conectar, listar_canais_texto, postar_mapa,
# editar_mensagem) sem tocar no loop principal nem no parser — só registrar
# mais um par cmd -> função neste dict. F4.5 (música) faz o mesmo.
# --------------------------------------------------------------------------


def _cmd_ping(_: dict[str, Any]) -> str:
    return "pong"


# Token do bot NÃO vive mais aqui: o repositório é público e o app injeta o
# token via env var DISCORD_BOT_TOKEN no spawn do sidecar (cofre de segredos
# do lado Rust). O placeholder abaixo mantém o fallback _token_embutido()
# inerte — nunca preencher com token real neste arquivo.
_TOKEN_BOT_EMBUTIDO = "__TOKEN_PLACEHOLDER__"


def _token_embutido() -> str | None:
    """Token embutido (F5), ou None se o placeholder ainda não foi preenchido."""
    t = _TOKEN_BOT_EMBUTIDO
    return t if t and not t.startswith("__TOKEN_PLACEHOLDER") else None


def _cmd_conectar(_: dict[str, Any]) -> dict[str, Any]:
    """Loga no Discord usando o token (env DISCORD_BOT_TOKEN ou embutido no app).

    Idempotente: se já há uma conexão de pé, devolve o estado atual sem
    tentar logar de novo. O dispatcher processa uma linha de cada vez (ver
    `main`), então não existe uma segunda chamada a `conectar` concorrente
    de verdade — mas se a thread de uma tentativa anterior ainda estiver
    viva (login em andamento), reaproveita o mesmo Future em vez de abrir
    uma segunda conexão.

    Também garante (best-effort, via `_carregar_cog_musica_melhor_esforco`)
    que o cog de música do v1 esteja carregado — tanto no caminho
    idempotente quanto logo após um login novo. Falha ao carregar música
    NUNCA derruba `conectar`: mapa/texto continuam funcionando.
    """
    global _bot_thread, _login_future

    if _bot_pronto():
        assert _bot is not None
        _carregar_cog_musica_melhor_esforco()
        return _resumo_conexao(_bot)

    token = os.environ.get("DISCORD_BOT_TOKEN") or _token_embutido()
    if not token:
        raise RuntimeError("DISCORD_BOT_TOKEN ausente (nem no ambiente nem embutido)")

    with _lock_bot:
        if _bot_thread is not None and _bot_thread.is_alive() and _login_future is not None:
            fut = _login_future
        else:
            fut = Future()
            _login_future = fut
            _bot_thread = threading.Thread(
                target=_rodar_bot_thread, args=(token, fut), daemon=True, name="discord-bot"
            )
            _bot_thread.start()

    try:
        resultado = fut.result(timeout=TIMEOUT_LOGIN_S)
    except TimeoutError:
        raise RuntimeError(f"timeout ({TIMEOUT_LOGIN_S:.0f}s) aguardando login no Discord")

    _carregar_cog_musica_melhor_esforco()
    return resultado


def _cmd_listar_canais_texto(_: dict[str, Any]) -> list[dict[str, str]]:
    """Lista os canais de texto de todos os guilds em que o bot está."""

    async def _coletar() -> list[dict[str, str]]:
        assert _bot is not None
        return [
            {"id": str(canal.id), "nome": canal.name, "guild": guild.name}
            for guild in _bot.guilds
            for canal in guild.text_channels
        ]

    return _agendar_no_bot(_coletar())


def _cmd_ler_canal(args: dict[str, Any]) -> list[dict[str, Any]]:
    """Lê até `limite` mensagens de texto do canal `canal_id`, da mais antiga
    pra mais nova. Só `content` — anexos/embeds ficam de fora."""
    canal_id = args.get("canal_id")
    limite = int(args.get("limite") or 200)
    if not canal_id:
        raise RuntimeError("canal_id obrigatório")

    async def _coletar() -> list[dict[str, Any]]:
        assert _bot is not None
        canal = _bot.get_channel(int(canal_id))
        if canal is None:
            raise RuntimeError(f"canal {canal_id} não encontrado (bot está no servidor?)")
        return [
            {
                "autor": m.author.display_name,
                "texto": m.content,
                "timestamp": m.created_at.isoformat(),
            }
            async for m in canal.history(limit=limite, oldest_first=True)
        ]

    return _agendar_no_bot(_coletar())


def _cmd_postar_mapa(args: dict[str, Any]) -> dict[str, str]:
    """Posta `texto` (já renderizado pelo Rust) no canal `canal_id`."""
    canal_id = args.get("canal_id")
    texto = args.get("texto")
    if not canal_id or texto is None:
        raise RuntimeError("args invalidos: esperado 'canal_id' e 'texto'")
    try:
        canal_id_int = int(canal_id)
    except (TypeError, ValueError):
        raise RuntimeError(f"canal_id invalido: {canal_id!r}")

    async def _postar() -> dict[str, str]:
        assert _bot is not None
        canal = _bot.get_channel(canal_id_int)
        if canal is None:
            try:
                canal = await _bot.fetch_channel(canal_id_int)
            except discord.NotFound:
                raise RuntimeError(f"canal {canal_id} nao encontrado")
            except discord.Forbidden:
                raise RuntimeError(f"sem permissao para acessar o canal {canal_id}")
        try:
            msg = await canal.send(texto)
        except discord.Forbidden:
            raise RuntimeError(f"sem permissao para postar no canal {canal_id}")
        except discord.HTTPException as e:
            raise RuntimeError(f"falha ao postar mensagem: {e}")
        return {"msg_id": str(msg.id)}

    return _agendar_no_bot(_postar())


def _cmd_editar_mensagem(args: dict[str, Any]) -> dict[str, Any]:
    """Edita uma mensagem já postada (`msg_id`, no canal `canal_id`)."""
    canal_id = args.get("canal_id")
    msg_id = args.get("msg_id")
    texto = args.get("texto")
    if not canal_id or not msg_id or texto is None:
        raise RuntimeError("args invalidos: esperado 'canal_id', 'msg_id' e 'texto'")
    try:
        canal_id_int = int(canal_id)
        msg_id_int = int(msg_id)
    except (TypeError, ValueError):
        raise RuntimeError(f"canal_id/msg_id invalido: {canal_id!r}/{msg_id!r}")

    async def _editar() -> dict[str, Any]:
        assert _bot is not None
        canal = _bot.get_channel(canal_id_int)
        if canal is None:
            try:
                canal = await _bot.fetch_channel(canal_id_int)
            except discord.NotFound:
                raise RuntimeError(f"canal {canal_id} nao encontrado")
            except discord.Forbidden:
                raise RuntimeError(f"sem permissao para acessar o canal {canal_id}")
        msg_parcial = canal.get_partial_message(msg_id_int)
        try:
            await msg_parcial.edit(content=texto)
        except discord.NotFound:
            raise RuntimeError(f"mensagem {msg_id} nao encontrada")
        except discord.Forbidden:
            raise RuntimeError(f"sem permissao para editar a mensagem {msg_id}")
        except discord.HTTPException as e:
            raise RuntimeError(f"falha ao editar mensagem: {e}")
        return {}

    return _agendar_no_bot(_editar())


# --------------------------------------------------------------------------
# Música (F4.5/F4.6): importa o cog `MusicBot` de `musica_v1.py` — módulo
# local, cópia do motor do v1 (Discord/bot.py) com caminhos parametrizados
# por env var (ver `sidecar/musica_v1.py`, topo do arquivo) — em vez de
# reescrever fila/yt-dlp/ffmpeg. Import por nome de módulo local (não mais
# sys.path dinâmico apontando pro checkout do v1, que não existe em máquina
# limpa/instalada — ver F4.6).
#
# Achado ao importar: `musica_v1.py` usa `print(...)` cru em vários pontos
# (a própria `log_debug` do v1, e handlers de erro do yt-dlp/ffmpeg) — sem
# tratamento isso vaza pro stdout e corrompe o protocolo JSONL (ver REGRA
# CRÍTICA no topo deste arquivo). `_silenciar_prints_v1` troca o `print` só
# dentro do namespace do módulo importado (não mexe no arquivo em disco).
# --------------------------------------------------------------------------


def _silenciar_prints_v1(modulo_musica: Any) -> None:
    """Redireciona `print()` do módulo `musica_v1` (cópia do v1) para `_log`.

    Python resolve um `print(...)` escrito dentro de uma função pelo
    namespace global do módulo onde ela foi definida antes de cair no
    builtin — por isso atribuir `modulo_musica.print = ...` intercepta toda
    chamada `print(...)` que vive dentro de `musica_v1.py`, sem editar o
    arquivo.
    """

    def _print_via_log(*args: Any, **kwargs: Any) -> None:
        kwargs.pop("file", None)
        kwargs.pop("flush", None)
        _log("[musica-v1] " + " ".join(str(a) for a in args))

    modulo_musica.print = _print_via_log


async def _carregar_cog_musica() -> None:
    """Importa e registra o cog `MusicBot` (musica_v1), se ainda não carregado.

    Idempotente: `_bot.get_cog(...)` é a fonte da verdade (mesmo padrão de
    `_bot_pronto()` — sem flag paralelo). Só é chamada de dentro de
    `conectar`, via `_agendar_no_bot`; nunca está no dict `COMANDOS`.
    """
    assert _bot is not None
    if _bot.get_cog("MusicBot") is not None:
        return

    modulo_musica = importlib.import_module("musica_v1")  # cópia local do v1
    _silenciar_prints_v1(modulo_musica)

    cog = modulo_musica.MusicBot(_bot)
    # Só o callback de "início de faixa": toda partida natural do cog (nova
    # faixa, fila, loop, seek 1x) toca em 1x, sem atempo — `_ao_iniciar_faixa`
    # ressincroniza a velocidade do sidecar pra 1.0 e emite o estado. O
    # callback de "fim" fica desligado de propósito: o loop periódico
    # (`_loop_estado_musica`) detecta a parada e emite "parado" uma vez,
    # evitando um flicker "parado" no meio da fila.
    cog.set_song_started_callback(_ao_iniciar_faixa)
    await _bot.add_cog(cog)

    # Task periódica (no loop do bot): emite posição/estado ~1s e roda o
    # watcher do loop A-B. Só chegamos aqui logo após `add_cog` de um bot/loop
    # NOVO (a idempotência do `conectar` faz o early-return acima nas chamadas
    # repetidas), então sempre criamos no loop vivo atual. Uma task de uma
    # conexão anterior ficou órfã no loop já fechado — inofensiva (será GC).
    global _task_estado_musica
    _task_estado_musica = asyncio.create_task(_loop_estado_musica())
    _log("cog de musica (v1) carregado; loop de estado da musica ativo")


def _carregar_cog_musica_melhor_esforco() -> None:
    """Tenta carregar o cog de música; nunca lança — música é best-effort.

    Chamada a cada `conectar` bem-sucedido (login novo ou idempotente). Se
    falhar (import quebrado, cog ausente), o resto do sidecar (mapa, texto)
    segue funcionando normalmente — só os comandos `musica_*`/`*_voz`
    devolvem erro. Sem lock: assim como `conectar` (ver docstring lá), o
    dispatcher processa uma linha de cada vez — não existe chamada
    concorrente de verdade a esta função.
    """
    try:
        _agendar_no_bot(_carregar_cog_musica())
    except Exception as e:
        _log(f"cog de musica indisponivel, seguindo sem musica: {e!r}")


# --------------------------------------------------------------------------
# Estado avançado da música (F5): velocidade (atempo), loop A-B e auto-join.
#
# Estas quatro coisas NÃO existem no cog do v1 — vivem só no sidecar:
#   - `velocidade`: fator atual do filtro ffmpeg `atempo` (0.5..2.0). O cog
#     sempre toca em 1x; quando reconstruímos a fonte com atempo, guardamos
#     o fator aqui pra calcular a posição corretamente.
#   - `ab_a`/`ab_b`/`ab_ativo`: pontos e liga/desliga do loop A-B.
#   - `auto_seguir_ativo`/`auto_seguir_nick`: toggle + nick do auto-join. Nasce
#     DESLIGADO: quem manda no auto-seguir é a caixa "Bot me segue" da UI, e
#     ela empurra o estado (`auto_seguir_definir`) ao montar e a cada
#     (re)conexão. Já nascer ligado fazia o bot entrar na call sozinho com a
#     caixa desmarcada — o estado do sidecar divergia do que a tela mostrava.
#
# `_lock_musica` protege o dict: `auto_seguir_*` e `ab_*` são escritos pela
# thread do dispatcher (handlers) e lidos pela thread do bot (listener de voz
# / loop de estado). `velocidade` é tocado só na thread do bot, mas passa
# pelo mesmo lock por uniformidade.
# --------------------------------------------------------------------------

INTERVALO_EMIT_MUSICA_S = 1.0  # cadência do evento de estado enquanto tocando
# Duração de um frame de áudio do discord.py (`AudioPlayer.DELAY`, 20 ms). O
# player conta os frames que já mandou em `loops` (discord/player.py:827), e é
# desse contador que `_posicao_atual` tira a posição da faixa.
SEGUNDOS_POR_FRAME = 0.02
# Carimbo que o sidecar põe na fonte que ele mesmo cria (`_reconstruir_fonte`),
# guardando com que `-ss` e que `atempo` aquela fonte nasceu. As fontes do v1
# já trazem o equivalente em `data['start_seconds']` (musica_v1.py:452).
ATRIBUTO_OFFSET_FONTE = "_rpgv2_offset"
ATRIBUTO_FATOR_FONTE = "_rpgv2_fator"

_lock_musica = threading.Lock()
_estado_musica: dict[str, Any] = {
    "velocidade": 1.0,
    "ab_a": None,
    "ab_b": None,
    "ab_ativo": False,
    "auto_seguir_ativo": False,
    "auto_seguir_nick": "gedasiosaga",
}
# Último `estado` ("tocando"/"pausado"/"parado") emitido. Tocado só na thread
# do bot (callbacks/loop periódico/coros de comando) — sem lock.
_ultimo_estado_emitido: str | None = None
# Último `em_voz` emitido — usado só por `_loop_estado_musica` pra detectar a
# transição entrou/saiu da voz e emitir uma vez nesse instante (mesmo padrão
# de `_ultimo_estado_emitido` pro estado de reprodução). Tocado só na thread
# do bot — sem lock.
_ultimo_em_voz_emitido: bool | None = None
# Task do loop periódico de estado (criada em `_carregar_cog_musica`).
_task_estado_musica: asyncio.Task[None] | None = None


def _ler_estado(chave: str) -> Any:
    with _lock_musica:
        return _estado_musica[chave]


def _definir_estado(chave: str, valor: Any) -> None:
    with _lock_musica:
        _estado_musica[chave] = valor


def _ler_ab() -> tuple[float | None, float | None, bool]:
    with _lock_musica:
        return _estado_musica["ab_a"], _estado_musica["ab_b"], _estado_musica["ab_ativo"]


def _ler_auto_seguir() -> tuple[bool, str]:
    with _lock_musica:
        return _estado_musica["auto_seguir_ativo"], _estado_musica["auto_seguir_nick"]


def _em_voz(cog: Any) -> bool:
    """True se o cog tem uma conexão de voz ativa (`voice_client` conectado).

    Critério único de "está na voz?" — reaproveitado por `_estado_reproducao`
    logo abaixo e por `_montar_estado_musica`, pra UI e o resto do sidecar
    nunca divergirem sobre o que conta como conectado.
    """
    if cog is None:
        return False
    vc = cog.voice_client
    return vc is not None and vc.is_connected()


def _estado_reproducao(cog: Any) -> str:
    """Mapeia o estado real do voice_client para 'tocando'|'pausado'|'parado'."""
    if not _em_voz(cog):
        return "parado"
    vc = cog.voice_client
    if vc.is_playing():
        return "tocando"
    if vc.is_paused():
        return "pausado"
    return "parado"


def _carimbar_fonte(fonte: Any, offset: float, fator: float) -> None:
    """Grava na própria fonte o `-ss` e o `atempo` com que ela foi criada.

    Só o sidecar monta fonte com `atempo` (`_reconstruir_fonte`); as do v1
    saem do `_create_source_from_url`, que já grava o offset em
    `data['start_seconds']` e nunca aplica atempo.
    """
    setattr(fonte, ATRIBUTO_OFFSET_FONTE, float(offset))
    setattr(fonte, ATRIBUTO_FATOR_FONTE, float(fator))


def _ancora_da_fonte(fonte: Any) -> tuple[float, float]:
    """De onde a fonte tocando agora começou (`-ss`) e com que `atempo`.

    Três origens, nesta ordem:

    1. carimbo do sidecar (`_carimbar_fonte`) — fonte com `atempo`;
    2. `data['start_seconds']`, que o `_create_source_from_url` do v1 grava
       (musica_v1.py:452/470) — cobre `seek_to`, fila, loop e `play_url_direct`,
       todas em 1x;
    3. nenhum dos dois: hoje só o `_recover_with_download` do v1
       (musica_v1.py:343), que rebaixa a faixa e a toca DO ZERO sem mexer em
       `current['start_seconds']`. Devolver 0 aqui é justamente o certo — era
       essa a diferença que deixava a barra adiantada pelo valor do último seek.
    """
    offset = getattr(fonte, ATRIBUTO_OFFSET_FONTE, None)
    if offset is not None:
        return float(offset), float(getattr(fonte, ATRIBUTO_FATOR_FONTE, 1.0) or 1.0)
    dados = getattr(fonte, "data", None)
    if isinstance(dados, dict):
        return float(dados.get("start_seconds") or 0), 1.0
    return 0.0, 1.0


def _posicao_atual(cog: Any) -> float:
    """Posição (segundos) na timeline da faixa, contando a velocidade atual.

    Conta o áudio REALMENTE entregue ao Discord, não o relógio de parede:
    `AudioPlayer.loops` é quantos frames de 20 ms o player já mandou
    (discord/player.py:827), então `loops * 0.02 * fator` é quanto a faixa
    andou desde que a fonte atual começou — e `_ancora_da_fonte` diz de onde
    ela começou. Com `atempo=2.0` cada segundo de áudio entregue vale 2s de
    timeline, daí o `fator`.

    Por que não o relógio de parede: as duas âncoras que o v1 oferece
    (`cog._track_started_at` e `current['start_seconds']`) são reescritas por
    caminhos que o sidecar não controla, e as duas quebram na prática:

    - `_handle_track_after` zera `_track_started_at` em todo callback `after`
      que ele processa, e um callback pode chegar atrasado (a thread do player
      velho fica presa em `FFmpegPCMAudio.read()`). Com o relógio, a barra
      CONGELAVA em `start_seconds` com o áudio tocando — reproduzido ao vivo
      em 2026-07-26, quando o `_ignore_after_once` ainda era um booleano só
      para todas as trocas de fonte. O token por player (`_tocar_fonte` /
      `_invalidar_player`) fechou essa porta, mas a posição não volta a
      depender do relógio: um `after` legítimo continua zerando a âncora.
    - o mesmo callback pode cair no `_recover_with_download`
      (musica_v1.py:386), que retoca a faixa do zero sem mexer em
      `start_seconds` — a barra ficava adiantada pelo valor do último seek.

    Contando frames nada disso importa: se saiu áudio, a barra anda; se não
    saiu (pausa, ffmpeg engasgado no arranque, voz caída), ela não anda.

    Fallback: sem `_player` (entre o `stop()` e o `play()` de uma troca de
    fonte) resta o começo da fonte que estava tocando.
    """
    if cog is None or cog.current is None:
        return 0.0
    player = getattr(cog.voice_client, "_player", None)
    fonte = getattr(player, "source", None)
    if fonte is None:
        return float(cog.current.get("start_seconds") or 0)
    offset, fator = _ancora_da_fonte(fonte)
    frames = getattr(player, "loops", 0) or 0
    return offset + frames * SEGUNDOS_POR_FRAME * fator


def _fila_atual(cog: Any) -> list[dict[str, Any]]:
    """Converte `cog.queue` (deque, bot.py:294) pro formato serializável do contrato.

    `list(...)` é necessário porque um `deque` não é serializável em JSON
    diretamente; os itens já vêm no formato `{title, url, start_seconds,
    duration}` (bot.py:612/776-781) — aqui só renomeamos pro contrato pt-BR.
    """
    if cog is None:
        return []
    return [
        {
            "titulo": item.get("title"),
            "url": item.get("url"),
            "duracao": float(item["duration"]) if item.get("duration") else None,
        }
        for item in list(cog.queue)
    ]


def _montar_estado_musica() -> dict[str, Any]:
    """Monta o evento de música ESTENDIDO (contrato F5 com o lado Rust)."""
    cog = _cog_musica_opcional()
    estado = _estado_reproducao(cog)
    titulo: str | None = None
    duracao: float | None = None
    posicao = 0.0
    if cog is not None and cog.current is not None:
        titulo = cog.current.get("title")
        dur = cog.current.get("duration")
        duracao = float(dur) if dur else None
        posicao = _posicao_atual(cog)
        if duracao is not None and posicao > duracao:
            posicao = duracao
    a, b, ab_ativo = _ler_ab()
    loop = bool(getattr(cog, "loop_mode", False)) if cog is not None else False
    return {
        "tipo": "musica",
        "estado": estado,
        "em_voz": _em_voz(cog),
        "titulo": titulo,
        "posicao": round(float(posicao), 3),
        "duracao": duracao,
        "velocidade": float(_ler_estado("velocidade")),
        "loop": loop,
        "ab": {"a": a, "b": b, "ativo": ab_ativo},
        "fila": _fila_atual(cog),
    }


def _emitir_evento_musica() -> None:
    """Emite o evento de música ESTENDIDO (estado vivo) no stdout JSONL.

    Sem argumentos: calcula tudo a partir do cog + estado do sidecar. Deve
    ser chamada na thread do bot (lê o voice_client). `_enviar` é thread-safe.
    """
    global _ultimo_estado_emitido, _ultimo_em_voz_emitido
    payload = _montar_estado_musica()
    _ultimo_estado_emitido = payload["estado"]
    _ultimo_em_voz_emitido = payload["em_voz"]
    _enviar(payload)


def _emitir_evento_musica_seguro() -> None:
    """Agenda um emit de estado no loop do bot (fire-and-forget).

    Usada por handlers que rodam na thread do dispatcher (ex.: A-B) e querem
    dar feedback imediato sem ler o voice_client fora da thread do bot. No-op
    se não conectado (o loop periódico não está rodando mesmo).
    """
    if not _bot_pronto():
        return

    async def _emit() -> None:
        _emitir_evento_musica()

    try:
        asyncio.run_coroutine_threadsafe(_emit(), _bot_loop)
    except Exception as e:
        _log(f"falha ao agendar emit de estado: {e!r}")


def _ao_iniciar_faixa(info: dict[str, Any]) -> None:
    """Callback de início de faixa do cog (roda na thread do bot).

    Toda partida "natural" do cog toca em 1x (nenhum atempo é aplicado por
    esse caminho), então ressincronizamos a velocidade do sidecar pra 1.0 —
    senão a posição derivaria (multiplicaria por um fator que o áudio não tem)
    ao trocar de faixa/loop/fila. Em seguida emite o estado atualizado.
    """
    _definir_estado("velocidade", 1.0)
    _emitir_evento_musica()


async def _reconstruir_fonte(cog: Any, offset: float, fator: float) -> None:
    """Recria a fonte de áudio da faixa atual no `offset`, com `atempo=fator`.

    É a base de três coisas que o cog do v1 NÃO faz: seek preservando a
    velocidade, troca de velocidade (2x) em tempo real e o pulo do loop A-B.
    Reusa o `stream_url`/`http_headers` já resolvidos pelo cache do cog e o
    `_build_ffmpeg_options` do cog (que injeta `-ss`, headers e reconnect) —
    só acrescenta o filtro `-af atempo=<fator>` quando fator != 1.0. NÃO
    reescreve resolução de stream nem toca no v1.

    Aceita o gap curto de áudio inerente a parar+recriar a fonte. Aposenta o
    player velho (`cog._invalidar_player()`) ANTES do `stop()` pra que o
    callback `after` dele — que pode chegar atrasado — não avance a fila, e
    entrega a fonte nova por `cog._tocar_fonte()`, que marca o `after` com o
    token do player novo (mesmo mecanismo do `seek_to`).
    """
    if cog.current is None:
        raise RuntimeError("nada tocando para reposicionar")
    url = cog.current.get("url")
    if not url:
        raise RuntimeError("faixa atual sem url para reposicionar")
    vc = cog.voice_client
    if vc is None or not vc.is_connected():
        raise RuntimeError("nao conectado a um canal de voz")

    entry = cog.cache.get_cached_stream(url)
    if not entry:
        entry = await cog.cache.ensure_cached(url, cog.bot.loop)
    if not entry or not entry.get("stream_url"):
        raise RuntimeError("nao foi possivel resolver o stream para reposicionar a fonte")

    offset_int = max(0, int(offset))
    opts = cog._build_ffmpeg_options(entry.get("http_headers"), start_seconds=offset_int)
    if abs(fator - 1.0) > 1e-6:
        base_options = opts.get("options") or "-vn"
        opts["options"] = f"{base_options} -af atempo={fator:.6g}"

    audio = discord.FFmpegPCMAudio(entry["stream_url"], **opts)
    fonte = discord.PCMVolumeTransformer(audio, volume=0.5)
    # Esta fonte não passa pelo `_create_source_from_url` do v1, então não tem
    # `data['start_seconds']`; e é a única com `atempo`. Sem o carimbo,
    # `_posicao_atual` não saberia de onde ela começou nem em que velocidade.
    _carimbar_fonte(fonte, offset_int, fator)

    # Recheca a conexão logo antes de trocar; se caiu, mata o ffmpeg recém-criado.
    if not vc.is_connected():
        fonte.cleanup()
        raise RuntimeError("conexao de voz caiu durante a reconstrucao da fonte")

    if vc.is_playing() or vc.is_paused():
        cog._invalidar_player()
        vc.stop()

    cog.current["start_seconds"] = offset_int
    dur_cache = int(entry.get("duration") or 0)
    if not cog.current.get("duration") and dur_cache:
        cog.current["duration"] = dur_cache

    cog._tocar_fonte(fonte)
    cog._track_started_at = time.monotonic()
    _definir_estado("velocidade", float(fator))


async def _verificar_loop_ab(cog: Any) -> None:
    """Watcher do loop A-B (roda a cada tick do loop de estado, thread do bot).

    Enquanto A-B ativo e tocando: quando a posição passa de B, reposiciona
    em A (ou 0 se A não definido) na velocidade atual. Ignora intervalo
    inválido (destino >= B) pra não reiniciar em rajada.
    """
    a, b, ativo = _ler_ab()
    if not ativo or b is None:
        return
    vc = cog.voice_client
    if vc is None or not vc.is_playing() or cog.current is None:
        return
    destino = a if a is not None else 0.0
    if destino >= b:
        return
    if _posicao_atual(cog) >= b:
        await _reconstruir_fonte(cog, destino, float(_ler_estado("velocidade")))
        _emitir_evento_musica()


async def _loop_estado_musica() -> None:
    """Emite o estado da música ~1s enquanto tocando/na voz e roda o watcher A-B.

    Criada uma vez em `_carregar_cog_musica`, roda no loop do bot. Emite todo
    tick enquanto `em_voz` (a UI precisa saber que o bot está na call mesmo
    parado, ver correção do "controles ficam desabilitados") OU tocando/
    pausado; nas transições (parou de tocar, entrou/saiu da voz) emite uma
    última vez e então silencia — sem isso o dispatcher de eventos vira spam
    quando não há bot nem música ativos.
    """
    _log("loop de estado da musica iniciado")
    while True:
        try:
            await asyncio.sleep(INTERVALO_EMIT_MUSICA_S)
            cog = _cog_musica_opcional()
            if cog is None:
                continue
            await _verificar_loop_ab(cog)
            estado = _estado_reproducao(cog)
            em_voz = _em_voz(cog)
            tocando_ou_pausado = estado in ("tocando", "pausado")
            estava_ativo = _ultimo_estado_emitido in ("tocando", "pausado")
            mudou_em_voz = em_voz != _ultimo_em_voz_emitido
            if tocando_ou_pausado or estava_ativo or em_voz or mudou_em_voz:
                _emitir_evento_musica()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _log(f"erro no loop de estado da musica: {e!r}")


def _membro_casa_nick(member: Any, nick: str) -> bool:
    """True se `nick` (substring, case-insensitive) casa com name/display/global."""
    alvo = nick.strip().lower()
    if not alvo:
        return False
    for attr in ("name", "display_name", "global_name"):
        val = getattr(member, attr, None)
        if val and alvo in str(val).lower():
            return True
    return False


async def _entrar_no_canal(cliente: commands.Bot, canal: Any) -> None:
    """Conecta (ou move) o bot pro `canal` e mantém `cog.voice_client` em dia.

    Compartilhada pelo auto-join do listener de voz e pela varredura retroativa
    (`_seguir_agora`) — as duas precisam exatamente do mesmo caminho de
    conexão. Loga e engole `ClientException` (ex.: já existe uma conexão em
    andamento): auto-join nunca deve derrubar quem chamou.
    """
    vc = discord.utils.get(cliente.voice_clients, guild=canal.guild)
    try:
        if vc is None:
            vc = await canal.connect()
        elif isinstance(vc, discord.VoiceClient) and vc.channel != canal:
            await vc.move_to(canal)
        cog = _cog_musica_opcional()
        if cog is not None:
            cog.voice_client = vc
        # A UI (PlayerMusica) não sabe que o bot entrou na call por este
        # caminho (auto-join do listener de voz / varredura retroativa) — só
        # pelo clique manual em "Entrar". Emite aqui pra ela habilitar os
        # controles sem esperar o próximo tick do loop periódico (até 1s).
        _emitir_evento_musica()
    except discord.ClientException as e:
        _log(f"auto-join em {getattr(canal, 'name', '?')!r} falhou: {e!r}")


async def _seguir_agora(cliente: commands.Bot) -> None:
    """Entra na call em que o nick JÁ está, sem esperar evento de voz.

    `on_voice_state_update` só dispara em MUDANÇA de estado: se o usuário já
    estava na call quando o auto-seguir foi ligado (ou quando o bot conectou),
    nenhum evento chega e o bot ficaria de fora até o próximo entra/sai. Esta
    varredura fecha o buraco lendo os canais de voz que a lib já tem em cache
    — quem está em call entra no cache de membros mesmo sem o intent
    privilegiado `members` (`MemberCacheFlags.voice`, ligado automaticamente
    por `intents.voice_states`). Para no primeiro canal que casa.

    Nunca lança: roda fire-and-forget no loop do bot.
    """
    try:
        ativo, nick = _ler_auto_seguir()
        if not ativo or not nick:
            return
        id_bot = getattr(cliente.user, "id", None)
        for guild in cliente.guilds:
            for canal in guild.voice_channels:
                for membro in canal.members:
                    if getattr(membro, "id", None) == id_bot:
                        continue
                    if _membro_casa_nick(membro, nick):
                        await _entrar_no_canal(cliente, canal)
                        return
    except Exception as e:
        _log(f"auto-seguir imediato falhou: {e!r}")


def _agendar_auto_seguir_imediato() -> None:
    """Agenda `_seguir_agora` no loop do bot (chamada da thread do dispatcher).

    Fire-and-forget de propósito: conectar na voz pode demorar e o handler do
    comando não deve segurar o dispatcher por isso. No-op se o bot ainda não
    está conectado — sem conexão não há canal pra varrer, e quem entrar depois
    cai no listener normal.
    """
    if not _bot_pronto():
        return
    cliente, loop = _bot, _bot_loop
    if cliente is None or loop is None:
        return
    try:
        asyncio.run_coroutine_threadsafe(_seguir_agora(cliente), loop)
    except Exception as e:
        _log(f"falha ao agendar auto-seguir imediato: {e!r}")


async def _tratar_voice_state_update(
    cliente: commands.Bot, member: Any, before: Any, after: Any
) -> None:
    """Auto-join/-leave do "gedasiosaga" (portado de Discord/bot.py:842-863).

    Diferença vs. v1: dispara ao ENTRAR *ou* MOVER (before.channel !=
    after.channel), não só em join do zero; e respeita o toggle
    `auto_seguir_ativo`/`auto_seguir_nick`. Mantém `cog.voice_client` em
    sincronia como os handlers de voz existentes. Nunca lança (é um listener).
    """
    try:
        if cliente.user is not None and getattr(member, "id", None) == cliente.user.id:
            return

        ativo, nick = _ler_auto_seguir()
        entrou_ou_moveu = after.channel is not None and before.channel != after.channel
        if ativo and nick and entrou_ou_moveu and _membro_casa_nick(member, nick):
            await _entrar_no_canal(cliente, after.channel)

        # Auto-leave: se o bot ficou sozinho no canal, desconecta — a não ser
        # que ainda esteja tocando (mesma ressalva do v1).
        vc = discord.utils.get(cliente.voice_clients, guild=member.guild)
        if vc is not None and getattr(vc, "channel", None) is not None and len(vc.channel.members) == 1:
            cog = _cog_musica_opcional()
            if cog is not None and cog.voice_client is not None and cog.voice_client.is_playing():
                return
            try:
                await vc.disconnect()
            except Exception as e:
                _log(f"auto-leave falhou: {e!r}")
            if cog is not None:
                cog.voice_client = None
            _emitir_evento_musica()  # simétrico ao emit do auto-join: UI sabe que saiu na hora
    except Exception as e:
        _log(f"erro em on_voice_state_update: {e!r}")


def _cog_musica_obrigatorio() -> Any:
    """Devolve o cog MusicBot já carregado ou lança erro claro.

    Tipo de retorno `Any` de propósito: a classe `MusicBot` só existe em
    tempo de execução (import dinâmico em `_carregar_cog_musica`), não dá
    pra tipar contra ela sem importar `Discord/bot.py` do v1 no topo deste
    arquivo — o que quebraria o login gated (nada de Discord/rede no boot).
    """
    assert _bot is not None
    cog = _bot.get_cog("MusicBot")
    if cog is None:
        raise RuntimeError("cog de musica nao carregado (veja o log do 'conectar')")
    return cog


def _cog_musica_opcional() -> Any:
    """Como `_cog_musica_obrigatorio`, mas devolve None em vez de lançar.

    Usado por handlers que devem ser no-op gracioso (ex.: `sair_voz`), não
    um erro, quando o cog ainda não foi carregado.
    """
    assert _bot is not None
    return _bot.get_cog("MusicBot")


def _cmd_listar_favoritos(_: dict[str, Any]) -> list[dict[str, str]]:
    """Lê os favoritos (`discord_config.json`); só leitura.

    Caminho vem de `RPGV2_FAVORITOS` (env var do Rust, F4.6) ou, se ausente,
    do fallback de dev `V1_DISCORD_CONFIG` (checkout do v1).
    """
    caminho = os.environ.get("RPGV2_FAVORITOS") or V1_DISCORD_CONFIG
    try:
        with open(caminho, encoding="utf-8") as f:
            config = json.load(f)
    except FileNotFoundError:
        raise RuntimeError(f"discord_config.json nao encontrado: {caminho}")
    except json.JSONDecodeError as e:
        raise RuntimeError(f"discord_config.json invalido ({caminho}): {e}")

    return [
        {
            "nome": fav.get("name", ""),
            "url": fav.get("url", ""),
            "categoria": fav.get("category", ""),
        }
        for fav in config.get("favorites", [])
    ]


def _cmd_listar_canais_voz(_: dict[str, Any]) -> list[dict[str, str]]:
    """Lista os canais de voz de todos os guilds em que o bot está."""

    async def _coletar() -> list[dict[str, str]]:
        assert _bot is not None
        return [
            {"id": str(canal.id), "nome": canal.name, "guild": guild.name}
            for guild in _bot.guilds
            for canal in guild.voice_channels
        ]

    return _agendar_no_bot(_coletar())


def _cmd_entrar_voz(args: dict[str, Any]) -> dict[str, str]:
    """Conecta (ou move) o bot para o canal de voz `canal_id`."""
    canal_id = args.get("canal_id")
    if not canal_id:
        raise RuntimeError("args invalidos: esperado 'canal_id'")
    try:
        canal_id_int = int(canal_id)
    except (TypeError, ValueError):
        raise RuntimeError(f"canal_id invalido: {canal_id!r}")

    async def _entrar() -> dict[str, str]:
        assert _bot is not None
        canal = _bot.get_channel(canal_id_int)
        if canal is None:
            try:
                canal = await _bot.fetch_channel(canal_id_int)
            except discord.NotFound:
                raise RuntimeError(f"canal {canal_id} nao encontrado")
            except discord.Forbidden:
                raise RuntimeError(f"sem permissao para acessar o canal {canal_id}")
        if not isinstance(canal, (discord.VoiceChannel, discord.StageChannel)):
            raise RuntimeError(f"canal {canal_id} nao e um canal de voz")

        cog = _cog_musica_obrigatorio()
        try:
            voice_client = discord.utils.get(_bot.voice_clients, guild=canal.guild)
            if voice_client is None:
                voice_client = await canal.connect()
            elif isinstance(voice_client, discord.VoiceClient) and voice_client.channel != canal:
                await voice_client.move_to(canal)
        except discord.ClientException as e:
            raise RuntimeError(f"nao foi possivel conectar na voz: {e}")

        cog.voice_client = voice_client  # mantém o cog em sincronia (ver play_url_direct)
        # A UI espera este comando resolver pra habilitar os controles — emite
        # o estado (com em_voz=True) antes de responder, sem esperar o loop.
        _emitir_evento_musica()
        return {"canal_id": str(canal.id), "canal_nome": canal.name}

    return _agendar_no_bot(_entrar())


def _cmd_sair_voz(_: dict[str, Any]) -> dict[str, Any]:
    """Desconecta do canal de voz atual. Idempotente (no-op se já desconectado)."""

    async def _sair() -> dict[str, Any]:
        assert _bot is not None
        cog = _cog_musica_opcional()
        if cog is not None and cog.voice_client is not None:
            if cog.voice_client.is_connected():
                await cog.voice_client.disconnect()
            cog.voice_client = None
        elif _bot.voice_clients:
            # Sem cog (ou voice_client do cog dessincronizado) mas o bot
            # ainda tem uma conexão de voz de baixo nível pendurada: limpa
            # mesmo assim, pra não deixar o bot preso num canal. force=True
            # porque `VoiceProtocol.disconnect` (tipo estático aqui) não
            # tem default pro parâmetro — só a subclasse `VoiceClient` tem.
            for vc in list(_bot.voice_clients):
                await vc.disconnect(force=True)
        _emitir_evento_musica()  # em_voz=False já refletido antes de responder
        return {}

    return _agendar_no_bot(_sair())


def _cmd_musica_play(args: dict[str, Any]) -> dict[str, Any]:
    """Toca (ou enfileira, se já tocando) `url` no canal de voz conectado."""
    url = args.get("url")
    if not url:
        raise RuntimeError("args invalidos: esperado 'url'")

    async def _tocar() -> dict[str, Any]:
        cog = _cog_musica_obrigatorio()
        if cog.voice_client is None or not cog.voice_client.is_connected():
            raise RuntimeError("nao conectado a um canal de voz — use 'entrar_voz' primeiro")
        await cog.play_url_direct(url, cog.voice_client.channel)
        return {}

    return _agendar_no_bot(_tocar())


def _cmd_musica_tocar_agora(args: dict[str, Any]) -> dict[str, Any]:
    """Interrompe a faixa atual e toca `url` já, sem mexer em `cog.queue`.

    Resolve a fonte nova como o `play_url_direct` do v1 faz
    (`cog._create_source_from_url`, que já cuida de cache/`resolve_and_cache`/
    fallback — bot.py:725-781), e troca a faixa como `_reconstruir_fonte` deste
    arquivo faz (`cog._invalidar_player()` + `vc.stop()` + `cog._tocar_fonte()`).
    Diferença chave: a fonte é de uma URL nova (não a atual), e `cog.queue` não
    é tocada — quem já estava enfileirado continua na mesma posição, tocando
    depois desta.
    """
    url = args.get("url")
    if not url:
        raise RuntimeError("args invalidos: esperado 'url'")

    async def _tocar_agora() -> dict[str, Any]:
        cog = _cog_musica_obrigatorio()
        vc = cog.voice_client
        if vc is None or not vc.is_connected():
            raise RuntimeError("nao conectado a um canal de voz — use 'entrar_voz' primeiro")

        fonte = await cog._create_source_from_url(url, start_seconds=0)
        if isinstance(fonte, dict) and fonte.get("error"):
            raise RuntimeError(fonte.get("message") or "falha ao resolver a url")

        # Recheca a conexão logo antes de trocar; se caiu, mata o ffmpeg recém-criado
        # (mesmo cuidado de `_reconstruir_fonte`).
        if not vc.is_connected():
            fonte.cleanup()
            raise RuntimeError("conexao de voz caiu durante a resolucao da fonte")

        if vc.is_playing() or vc.is_paused():
            cog._invalidar_player()
            vc.stop()

        duracao = int(getattr(fonte, "data", {}).get("duration") or 0)
        cog.current = {"title": fonte.title, "url": url, "start_seconds": 0, "duration": duracao}
        cog._tocar_fonte(fonte)
        cog._track_started_at = time.monotonic()
        # Fonte nova sempre toca em 1x (sem atempo) — ressincroniza a velocidade
        # do sidecar, senão `_posicao_atual` deriva usando um fator que o áudio
        # desta faixa não tem (mesmo raciocínio de `_ao_iniciar_faixa`).
        _definir_estado("velocidade", 1.0)
        _emitir_evento_musica()
        return {}

    return _agendar_no_bot(_tocar_agora())


def _cmd_musica_skip(_: dict[str, Any]) -> dict[str, Any]:
    """Pula a música atual; o callback 'after' do cog toca a próxima da fila."""

    async def _skip() -> dict[str, Any]:
        await _cog_musica_obrigatorio().skip_music()
        return {}

    return _agendar_no_bot(_skip())


def _cmd_musica_stop(_: dict[str, Any]) -> dict[str, Any]:
    """Para a reprodução, limpa a fila e desconecta da voz (método do cog)."""

    async def _stop() -> dict[str, Any]:
        await _cog_musica_obrigatorio().stop_music()
        return {}

    return _agendar_no_bot(_stop())


def _cmd_musica_loop(_: dict[str, Any]) -> dict[str, bool]:
    """Alterna o modo loop da faixa atual e devolve o novo estado."""

    async def _loop() -> dict[str, bool]:
        return {"loop_ativo": _cog_musica_obrigatorio().toggle_loop_external()}

    return _agendar_no_bot(_loop())


def _cmd_musica_seek(args: dict[str, Any]) -> dict[str, Any]:
    """Move a faixa atual para `segundos`, preservando a velocidade atual.

    Se a velocidade é 1x, delega ao `seek_to` do cog (reusa a lógica do v1,
    inclusive o callback e o token de player). Se está em 2x/0.5x, usa a
    reconstrução própria com `atempo` — senão o `seek_to` do v1 (que não
    conhece atempo) jogaria a faixa de volta pra 1x.
    """
    segundos = args.get("segundos")
    if not isinstance(segundos, (int, float)):
        raise RuntimeError("args invalidos: esperado 'segundos' numerico")
    alvo = max(0.0, float(segundos))

    async def _seek() -> dict[str, Any]:
        cog = _cog_musica_obrigatorio()
        if cog.voice_client is None or not cog.voice_client.is_connected():
            raise RuntimeError("nao conectado a um canal de voz")
        if cog.current is None:
            raise RuntimeError("nada tocando para buscar posicao")
        fator = float(_ler_estado("velocidade"))
        if abs(fator - 1.0) <= 1e-6:
            await cog.seek_to(int(alvo))
        else:
            await _reconstruir_fonte(cog, alvo, fator)
        _emitir_evento_musica()
        return {}

    return _agendar_no_bot(_seek())


def _cmd_musica_velocidade(args: dict[str, Any]) -> dict[str, Any]:
    """Troca a velocidade (0.5..2.0) em tempo real via `atempo`, no ponto atual.

    Reconstrói a fonte no offset atual com o novo fator (gap curto de áudio
    inevitável). Guarda o fator no estado do sidecar.
    """
    fator = args.get("fator")
    if not isinstance(fator, (int, float)):
        raise RuntimeError("args invalidos: esperado 'fator' numerico")
    fator = float(fator)
    if fator < 0.5 or fator > 2.0:
        raise RuntimeError("fator fora do intervalo permitido (0.5..2.0)")

    async def _mudar() -> dict[str, Any]:
        cog = _cog_musica_obrigatorio()
        if cog.voice_client is None or not cog.voice_client.is_connected():
            raise RuntimeError("nao conectado a um canal de voz")
        if cog.current is None:
            raise RuntimeError("nada tocando para mudar a velocidade")
        offset = _posicao_atual(cog)
        await _reconstruir_fonte(cog, offset, fator)
        _emitir_evento_musica()
        return {}

    return _agendar_no_bot(_mudar())


def _cmd_musica_ab_definir(args: dict[str, Any]) -> dict[str, Any]:
    """Define os pontos A e B do loop (segundos); `null` limpa cada um."""
    a = args.get("a")
    b = args.get("b")
    if a is not None and not isinstance(a, (int, float)):
        raise RuntimeError("args invalidos: 'a' deve ser numero ou null")
    if b is not None and not isinstance(b, (int, float)):
        raise RuntimeError("args invalidos: 'b' deve ser numero ou null")
    with _lock_musica:
        _estado_musica["ab_a"] = float(a) if a is not None else None
        _estado_musica["ab_b"] = float(b) if b is not None else None
    _emitir_evento_musica_seguro()
    return {}


def _cmd_musica_ab_toggle(args: dict[str, Any]) -> dict[str, Any]:
    """Liga/desliga o loop A-B (não mexe nos pontos A/B guardados)."""
    ativo = args.get("ativo")
    if not isinstance(ativo, bool):
        raise RuntimeError("args invalidos: esperado 'ativo' booleano")
    with _lock_musica:
        _estado_musica["ab_ativo"] = ativo
    _emitir_evento_musica_seguro()
    return {}


def _cmd_auto_seguir_definir(args: dict[str, Any]) -> dict[str, Any]:
    """Atualiza o toggle e o nick do auto-join (lido pelo listener de voz).

    A UI é a autoridade: manda este comando ao montar o player, a cada
    (re)conexão do bot e sempre que a caixa/nick mudam. Ligar dispara uma
    varredura imediata (`_seguir_agora`) pro caso de o nick já estar numa call
    — aí não vem evento de voz nenhum. Vale mesmo sem bot conectado: só guarda
    o estado (a varredura vira no-op).
    """
    ativo = args.get("ativo")
    nick = args.get("nick")
    if not isinstance(ativo, bool):
        raise RuntimeError("args invalidos: esperado 'ativo' booleano")
    if not isinstance(nick, str) or not nick.strip():
        raise RuntimeError("args invalidos: esperado 'nick' string nao vazia")
    with _lock_musica:
        _estado_musica["auto_seguir_ativo"] = ativo
        _estado_musica["auto_seguir_nick"] = nick.strip()
    if ativo:
        _agendar_auto_seguir_imediato()
    return {}


COMANDOS: dict[str, Callable[[dict[str, Any]], Any]] = {
    "ping": _cmd_ping,
    # F4.1 — Discord (login/canais/mensagens/mapa):
    "conectar": _cmd_conectar,
    "listar_canais_texto": _cmd_listar_canais_texto,
    "ler_canal": _cmd_ler_canal,
    "postar_mapa": _cmd_postar_mapa,
    "editar_mensagem": _cmd_editar_mensagem,
    # F4.5 — música (cog MusicBot do v1, carregado dentro de `conectar`):
    "listar_favoritos": _cmd_listar_favoritos,
    "listar_canais_voz": _cmd_listar_canais_voz,
    "entrar_voz": _cmd_entrar_voz,
    "sair_voz": _cmd_sair_voz,
    "musica_play": _cmd_musica_play,
    "musica_tocar_agora": _cmd_musica_tocar_agora,
    "musica_skip": _cmd_musica_skip,
    "musica_stop": _cmd_musica_stop,
    "musica_loop": _cmd_musica_loop,
    # F5 — música avançada (posição/seek/velocidade/loop A-B) e auto-join:
    "musica_seek": _cmd_musica_seek,
    "musica_velocidade": _cmd_musica_velocidade,
    "musica_ab_definir": _cmd_musica_ab_definir,
    "musica_ab_toggle": _cmd_musica_ab_toggle,
    "auto_seguir_definir": _cmd_auto_seguir_definir,
}


def _processar_linha(linha: str) -> dict[str, Any] | None:
    """Converte uma linha de stdin numa resposta JSONL (dict pronto p/ _enviar).

    Retorna None se a linha deve ser ignorada (linha em branco).

    Contrato: esta função NUNCA lança exceção. Qualquer problema — JSON
    inválido, formato inesperado, ou o próprio handler do comando quebrando
    — vira ``{"ok": false, "erro": ...}`` em vez de subir e derrubar o loop
    principal (e, com ele, o processo inteiro).
    """
    # lstrip do BOM: ferramentas Windows (PowerShell, editores) às vezes
    # prefixam BOM (U+FEFF) na primeira linha; o Tauri escreve bytes crus
    # sem BOM, mas tolerar aqui evita rejeitar um JSON válido só pela marca.
    linha = linha.lstrip(chr(0xFEFF)).strip()
    if not linha:
        return None

    id_ = None
    try:
        obj = json.loads(linha)

        if not isinstance(obj, dict):
            return {"id": None, "ok": False, "erro": "esperado objeto JSON na linha"}

        id_ = obj.get("id")
        cmd = obj.get("cmd")
        args = obj.get("args") or {}

        if not isinstance(cmd, str):
            return {"id": id_, "ok": False, "erro": f"cmd invalido ou ausente: {cmd!r}"}

        handler = COMANDOS.get(cmd)
        if handler is None:
            return {"id": id_, "ok": False, "erro": f"cmd desconhecido: {cmd}"}

        dado = handler(args)
        return {"id": id_, "ok": True, "data": dado}

    except json.JSONDecodeError as e:
        _log(f"linha invalida (json malformado): {e}")
        return {"id": None, "ok": False, "erro": f"json invalido: {e}"}

    except Exception as e:
        # Cobre handler que lança, args em formato inesperado, cmd de tipo
        # exótico, etc. Na F4.1 os handlers de Discord/música vão poder
        # falhar de verdade (timeout, permissão, canal de voz ausente) —
        # é aqui que isso vira resposta de erro em vez de crash do sidecar.
        _log(f"erro inesperado processando comando (id={id_!r}): {e!r}")
        # Algumas exceções (ex.: `discord.opus.OpusNotLoaded`) não levam
        # argumento — `str(e)` vira "" e o front recebe um erro mudo (toast
        # vermelho vazio). `repr(e)` sempre tem pelo menos o tipo da exceção.
        return {"id": id_, "ok": False, "erro": str(e) or repr(e)}


# --------------------------------------------------------------------------
# Leitura de stdin numa thread dedicada.
#
# Por quê: `for linha in sys.stdin` bloqueia a thread até a próxima linha
# (ou EOF) chegar. O v1 já usava esse padrão de thread dedicada + fila para
# não travar a interface (ver discord_integration.py:42 `DiscordBotThread`
# e a fila em :64 `self._command_queue`) — lá era QThread + asyncio.Queue;
# aqui é a versão simplificada só-stdlib: threading.Thread + queue.Queue,
# sem asyncio/Qt. O main thread fica livre para o loop de dispatch e, na
# F4.1, para também coordenar a thread do bot Discord.
# --------------------------------------------------------------------------

_FIM_DA_ENTRADA = object()  # sentinela: sinaliza EOF do stdin para a fila


def _ler_stdin(fila: queue.Queue) -> None:
    try:
        for linha in sys.stdin:
            fila.put(linha)
    except Exception as e:
        # Ex.: erro de decodificação no meio do stream. Não deixamos a
        # thread morrer em silêncio — registra e ainda assim sinaliza fim,
        # pro loop principal não ficar esperando para sempre.
        _log(f"erro lendo stdin: {e!r}")
    finally:
        fila.put(_FIM_DA_ENTRADA)


def main() -> int:
    # Risco Windows: quando stdin/stdout/stderr não são um console (são
    # pipes do processo Tauri, o caso normal aqui), o Python no Windows pode
    # herdar a codepage do sistema (cp1252/cp850) em vez de UTF-8. Como o
    # protocolo é JSON com texto em pt-BR (acentos) e `ensure_ascii=False`,
    # forçamos UTF-8 explicitamente nos três streams para não depender da
    # codepage do ambiente onde o Tauri sobe o processo. (Descoberto no
    # self-test: sem o stderr aqui, "—" saía como "�" no log.)
    for _stream in (sys.stdin, sys.stdout, sys.stderr):
        _reconfig = getattr(_stream, "reconfigure", None)
        if _reconfig is not None:
            _reconfig(encoding="utf-8")

    # Depois da codepage, antes de qualquer coisa escrever: separa o canal do
    # protocolo do `sys.stdout` que as bibliotecas enxergam (ver a docstring de
    # `_isolar_stdout_do_protocolo`). Daqui pra frente, `print` solto de
    # terceiro vai pro log em vez de corromper uma linha JSONL.
    _isolar_stdout_do_protocolo()

    _log("iniciando (F4.1 Discord + F4.5 musica, gated por comando 'conectar')")

    fila: queue.Queue = queue.Queue()
    leitor = threading.Thread(
        target=_ler_stdin, args=(fila,), daemon=True, name="stdin-reader"
    )
    leitor.start()

    _enviar({"tipo": "pronto"})
    _log("pronto, aguardando comandos")

    while True:
        item = fila.get()
        if item is _FIM_DA_ENTRADA:
            _log("EOF no stdin — encerrando")
            break

        resposta = _processar_linha(item)
        if resposta is not None:
            _enviar(resposta)

    # Se o bot estiver logado, fecha a conexão antes de sair do processo.
    _encerrar_bot()
    _log("encerrado")
    return 0


if __name__ == "__main__":
    sys.exit(main())
