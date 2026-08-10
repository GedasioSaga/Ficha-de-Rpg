"""Testes do token de player do cog de música, com dublês.

Mesmo estilo dos outros testes do sidecar: sem Discord de verdade.

Contexto (2026-07-26) — o cog tinha `_ignore_after_once`, UM booleano para
todas as trocas de fonte (`seek_to`, `_reconstruir_fonte`, `musica_tocar_agora`).
Cada `voice_client.stop()` gera um callback `after` entregue de forma
assíncrona pela thread do player velho, que pode estar presa em
`FFmpegPCMAudio.read()`. Duas trocas coladas geravam dois callbacks para uma
flag só: o segundo passava direto e caía no `_recover_with_download` (baixando
a faixa inteira à toa) ou no `play_next_auto`, no meio de um seek.

Agora cada `play()` recebe um token e o `after` daquele play carrega o token;
o callback só age se o token ainda for o vigente. Paradas deliberadas
aposentam o player ANTES do `stop()`, fechando a janela entre o `stop()` e o
`play()` seguinte.

Como rodar (a partir da raiz do projeto):
    sidecar\\.venv\\Scripts\\python.exe sidecar\\teste_token_player.py
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import musica_v1  # noqa: E402


class VozFalsa:
    """Dublê do `discord.VoiceClient` que guarda os `after` de cada `play()`.

    Não dispara os callbacks sozinha: os testes disparam na hora que quiserem,
    que é justamente como se simula o callback atrasado de um player morto.
    """

    def __init__(self) -> None:
        self.afters: list[Any] = []
        self.tocando = True
        self.stops = 0

    def play(self, _source, after=None):
        self.afters.append(after)

    def stop(self):
        self.stops += 1

    def is_playing(self) -> bool:
        return self.tocando

    def is_paused(self) -> bool:
        return False

    def is_connected(self) -> bool:
        return True


class CogParaToken(musica_v1.MusicBot):
    """Só o mecanismo de token do cog real, sem o resto do `__init__`.

    Herda de `MusicBot` de propósito: os testes exercitam os métodos de
    verdade (`_tocar_fonte`, `_invalidar_player`, `_handle_track_after`), não
    uma reimplementação.
    """

    def __init__(self, voice_client: VozFalsa) -> None:
        self.voice_client = voice_client
        self.current = {"url": "http://exemplo/faixa", "start_seconds": 0, "duration": 100}
        self.queue: Any = []
        self.loop_mode = False
        self._track_started_at = None
        self._early_end_threshold_seconds = 8.0
        self._token_player = 0
        self._stream_recovery_attempts: dict[str, int] = {}
        self.song_started_callback = None
        self.song_ended_callback = None
        self.avancos = 0
        self.recuperacoes = 0

    def _on_track_after(self, error, token):
        """Roda o handler na hora, em vez de agendar no loop do bot.

        O que importa testar é o token que a closure do `after` carrega até
        aqui; o `_on_track_after` real só faz `run_coroutine_threadsafe`, que
        exigiria um loop de verdade sem exercitar nada do mecanismo.
        """
        asyncio.run(self._handle_track_after(error, token))

    async def play_next_auto(self, force_skip=False):
        """Marcador: contar avanços de fila em vez de tocar de verdade."""
        self.avancos += 1

    async def _recover_with_download(self) -> bool:
        """Marcador: contar o fallback de download (o que gastava 103 MiB à toa)."""
        self.recuperacoes += 1
        return False


def _cog() -> CogParaToken:
    return CogParaToken(VozFalsa())


def _disparar(cog: CogParaToken, indice: int, erro=None) -> None:
    """Dispara o `after` do `indice`-ésimo `play()`, como a thread do player faria."""
    cog.voice_client.afters[indice](erro)


# --------------------------------------------------------------------------
# Mecanismo básico
# --------------------------------------------------------------------------


def teste_cada_play_recebe_um_token_novo() -> None:
    cog = _cog()
    cog._tocar_fonte(object())
    primeiro = cog._token_player
    cog._tocar_fonte(object())
    assert cog._token_player != primeiro, "dois players não podem dividir o mesmo token"


def teste_play_que_levanta_nao_aposenta_o_player_vivo() -> None:
    """Se o `play()` falha, o player de pé continua com token válido.

    Sem isso, o fim natural dele seria confundido com órfão e a fila travava.
    """
    cog = _cog()
    cog._tocar_fonte(object())
    token_vivo = cog._token_player

    def explode(_source, after=None):
        raise RuntimeError("Already playing audio.")

    cog.voice_client.play = explode
    try:
        cog._tocar_fonte(object())
    except RuntimeError:
        pass
    assert cog._token_player == token_vivo, "play falho não pode mexer no token vigente"


# --------------------------------------------------------------------------
# O que NÃO pode avançar a fila
# --------------------------------------------------------------------------


def teste_callback_de_player_aposentado_e_ignorado() -> None:
    """Uma troca de fonte: o `after` do player velho não avança nada."""
    cog = _cog()
    cog._tocar_fonte(object())          # player 0
    cog._invalidar_player()             # troca deliberada
    cog._tocar_fonte(object())          # player 1
    _disparar(cog, 0)
    assert cog.avancos == 0
    assert cog.recuperacoes == 0


def teste_dois_stops_em_rajada_nenhum_callback_avanca() -> None:
    """O caso que quebrava: duas trocas coladas, dois callbacks atrasados.

    Com o booleano único, o segundo callback passava direto — avançava a fila
    e/ou disparava o download inútil. Com token por player, os dois são
    órfãos.
    """
    cog = _cog()
    cog._tocar_fonte(object())          # player 0
    cog._invalidar_player()             # seek 1
    cog._tocar_fonte(object())          # player 1
    cog._invalidar_player()             # seek 2 (colado)
    cog._tocar_fonte(object())          # player 2 — o vivo

    # Os dois callbacks atrasados chegam agora, fora de ordem.
    _disparar(cog, 1)
    _disparar(cog, 0)

    assert cog.avancos == 0, "nenhum callback de player morto pode avançar a fila"
    assert cog.recuperacoes == 0, "nem disparar o fallback de download"


def teste_callback_atrasado_na_janela_entre_stop_e_play() -> None:
    """A corrida que o desenho tem que fechar, não só reduzir.

    Invalidar ANTES do `stop()` faz o callback do player velho já nascer
    órfão, mesmo chegando antes do `play()` seguinte acontecer.
    """
    cog = _cog()
    cog._tocar_fonte(object())          # player 0
    cog._invalidar_player()             # invalida ANTES do stop
    cog.voice_client.stop()
    # o `after` do player velho chega AQUI, antes do play novo
    _disparar(cog, 0)
    assert cog.avancos == 0, "callback na janela stop->play não pode avançar a fila"
    cog._tocar_fonte(object())          # player 1 entra depois, normalmente
    assert cog.avancos == 0


# --------------------------------------------------------------------------
# O que AINDA precisa avançar a fila (não regredir)
# --------------------------------------------------------------------------


def teste_fim_natural_avanca_a_fila() -> None:
    """Ninguém parou: o `after` é do player vigente e a fila anda."""
    cog = _cog()
    cog._tocar_fonte(object())
    _disparar(cog, 0)
    assert cog.avancos == 1, "fim natural de faixa TEM que avançar a fila"


def teste_skip_sem_invalidar_avanca_a_fila() -> None:
    """`skip_music` para o player de propósito MAS quer que a fila ande."""
    cog = _cog()
    cog._tocar_fonte(object())
    asyncio.run(cog.skip_music())       # não invalida, só stop()
    assert cog.voice_client.stops == 1
    _disparar(cog, 0)
    assert cog.avancos == 1, "skip continua contando com o callback pra tocar a próxima"


def teste_stop_music_nao_deixa_a_fila_andar_depois() -> None:
    """`stop_music` limpa tudo; o callback dele não pode acordar a fila."""
    cog = _cog()
    cog._tocar_fonte(object())

    async def _desconectar():
        cog.voice_client = None

    cog.voice_client.disconnect = _desconectar
    voz = cog.voice_client
    asyncio.run(cog.stop_music())
    assert voz.stops == 1
    voz.afters[0](None)
    assert cog.avancos == 0, "após stop, o callback não pode chamar play_next_auto"


def teste_fim_natural_ainda_avanca_depois_de_varios_seeks() -> None:
    """Sequência realista: vários seeks e então a faixa acaba sozinha."""
    cog = _cog()
    cog._tocar_fonte(object())
    for _ in range(3):
        cog._invalidar_player()
        cog.voice_client.stop()
        cog._tocar_fonte(object())
    for i in range(3):                  # todos os callbacks atrasados chegam
        _disparar(cog, i)
    assert cog.avancos == 0
    _disparar(cog, 3)                   # agora o player vivo termina sozinho
    assert cog.avancos == 1, "depois da rajada, o fim natural ainda tem que avançar"


TESTES = [
    teste_cada_play_recebe_um_token_novo,
    teste_play_que_levanta_nao_aposenta_o_player_vivo,
    teste_callback_de_player_aposentado_e_ignorado,
    teste_dois_stops_em_rajada_nenhum_callback_avanca,
    teste_callback_atrasado_na_janela_entre_stop_e_play,
    teste_fim_natural_avanca_a_fila,
    teste_skip_sem_invalidar_avanca_a_fila,
    teste_stop_music_nao_deixa_a_fila_andar_depois,
    teste_fim_natural_ainda_avanca_depois_de_varios_seeks,
]


def main() -> int:
    falhas = 0
    for teste in TESTES:
        try:
            teste()
        except Exception as e:
            falhas += 1
            print(f"FALHOU  {teste.__name__}: {e!r}")
        else:
            print(f"ok      {teste.__name__}")
    print(f"\n{len(TESTES) - falhas}/{len(TESTES)} testes passaram")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(main())
