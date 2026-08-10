"""Testes do cálculo de posição da faixa (`_posicao_atual`), com dublês.

Mesmo estilo de `teste_auto_seguir.py` / `teste_correcoes_musica_ui.py`: sem
Discord de verdade, só os atributos que a função lê.

Contexto (2026-07-26) — a barra de progresso dessincronizava do áudio. A
posição vinha do relógio de parede (`monotonic() - cog._track_started_at`),
e as duas âncoras que o v1 oferece são reescritas por caminhos que o sidecar
não controla:

- `_handle_track_after` zera `_track_started_at` (musica_v1.py:370) sempre que
  recebe um callback `after` que não está marcado pra ignorar. Como
  `_ignore_after_once` é UM booleano pra todas as trocas de fonte, duas trocas
  coladas geram dois callbacks e o segundo passa direto — a barra congelava em
  `start_seconds` com o áudio tocando (reproduzido ao vivo).
- esse mesmo callback pode chamar `_recover_with_download` (musica_v1.py:343),
  que retoca a faixa DO ZERO sem mexer em `current['start_seconds']` — a barra
  ficava adiantada pelo valor do último seek.

Agora a posição sai do áudio efetivamente entregue ao Discord
(`AudioPlayer.loops`, frames de 20 ms), que não depende de nenhuma das duas.

Como rodar (a partir da raiz do projeto):
    sidecar\\.venv\\Scripts\\python.exe sidecar\\teste_posicao_musica.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bot_sidecar as bs  # noqa: E402


class FonteV1Falsa:
    """Dublê do `YTDLSource` do v1: traz o offset em `data['start_seconds']`."""

    def __init__(self, start_seconds: int) -> None:
        self.data = {"start_seconds": start_seconds}


class FonteCruaFalsa:
    """Dublê de fonte sem offset nenhum — é o caso do `_recover_with_download`."""


class PlayerFalso:
    """Dublê do `AudioPlayer`: a fonte tocando e quantos frames já mandou."""

    def __init__(self, source: Any, loops: int) -> None:
        self.source = source
        self.loops = loops


class VozFalsa:
    """Dublê do `discord.VoiceClient` — só o `_player` interessa aqui."""

    def __init__(self, player: PlayerFalso | None) -> None:
        self._player = player


class CogFalso:
    """Dublê do cog `MusicBot` com o que `_posicao_atual` lê."""

    def __init__(self, voice_client: VozFalsa | None, current: dict[str, Any] | None) -> None:
        self.voice_client = voice_client
        self.current = current


def _cog(fonte: Any, loops: int, start_seconds: int = 0) -> CogFalso:
    """Cog tocando `fonte` com `loops` frames já entregues."""
    return CogFalso(VozFalsa(PlayerFalso(fonte, loops)), {"start_seconds": start_seconds})


# --------------------------------------------------------------------------
# Casos base
# --------------------------------------------------------------------------


def teste_sem_cog_ou_sem_faixa_devolve_zero() -> None:
    assert bs._posicao_atual(None) == 0.0
    assert bs._posicao_atual(CogFalso(None, None)) == 0.0


def teste_conta_frames_entregues_desde_o_inicio() -> None:
    """250 frames de 20 ms = 5s de áudio entregue, faixa começando do zero."""
    assert bs._posicao_atual(_cog(FonteV1Falsa(0), loops=250)) == 5.0


def teste_soma_o_offset_da_fonte_do_v1() -> None:
    """Fonte criada com `-ss 90` (seek do v1): posição = 90 + áudio entregue."""
    assert bs._posicao_atual(_cog(FonteV1Falsa(90), loops=250)) == 95.0


def teste_sem_player_cai_no_comeco_da_fonte() -> None:
    """Entre o `stop()` e o `play()` de uma troca de fonte não há player."""
    cog = CogFalso(VozFalsa(None), {"start_seconds": 42})
    assert bs._posicao_atual(cog) == 42.0


# --------------------------------------------------------------------------
# Velocidade (`atempo`) — só a fonte do sidecar tem
# --------------------------------------------------------------------------


def teste_fonte_carimbada_usa_offset_e_fator_do_carimbo() -> None:
    """`_reconstruir_fonte` carimba: em 2x, 5s entregues valem 10s de timeline."""
    fonte = FonteCruaFalsa()
    bs._carimbar_fonte(fonte, offset=30, fator=2.0)
    assert bs._posicao_atual(_cog(fonte, loops=250)) == 40.0


def teste_carimbo_em_meia_velocidade() -> None:
    fonte = FonteCruaFalsa()
    bs._carimbar_fonte(fonte, offset=10, fator=0.5)
    assert bs._posicao_atual(_cog(fonte, loops=250)) == 12.5


def teste_carimbo_tem_prioridade_sobre_o_data_do_v1() -> None:
    """Fonte do v1 recarimbada pelo sidecar: manda o carimbo, não o `data`."""
    fonte = FonteV1Falsa(start_seconds=90)
    bs._carimbar_fonte(fonte, offset=200, fator=1.0)
    assert bs._posicao_atual(_cog(fonte, loops=50)) == 201.0


# --------------------------------------------------------------------------
# Regressões: os dois modos de dessincronia relatados
# --------------------------------------------------------------------------


def teste_nao_congela_quando_o_v1_zera_track_started_at() -> None:
    """Regressão do "a música volta mas o player não volta".

    `_handle_track_after` zerava `_track_started_at` num callback `after`
    roubado e a posição parava em `start_seconds` para sempre. O contador de
    frames não olha pra esse campo: com áudio saindo, a barra tem que andar.
    """
    cog = _cog(FonteV1Falsa(30), loops=500, start_seconds=30)
    cog._track_started_at = None  # exatamente o que musica_v1.py:370 faz
    assert bs._posicao_atual(cog) == 40.0, "posição não pode congelar em start_seconds"


def teste_recover_with_download_volta_do_zero_sem_adiantar_a_barra() -> None:
    """Regressão do "fica dessincronizada".

    O `_recover_with_download` retoca a faixa do ZERO mas deixa
    `current['start_seconds']` no último seek (90). A fonte dele não tem
    offset nenhum, então a posição tem que seguir o áudio (do zero), não o
    campo obsoleto do cog.
    """
    cog = _cog(FonteCruaFalsa(), loops=250, start_seconds=90)
    assert bs._posicao_atual(cog) == 5.0, "barra não pode ficar adiantada pelo seek antigo"


def teste_posicao_nao_anda_sem_audio_entregue() -> None:
    """Player parado (ffmpeg engasgado, pausa, voz caída): barra parada."""
    assert bs._posicao_atual(_cog(FonteV1Falsa(90), loops=0)) == 90.0


TESTES = [
    teste_sem_cog_ou_sem_faixa_devolve_zero,
    teste_conta_frames_entregues_desde_o_inicio,
    teste_soma_o_offset_da_fonte_do_v1,
    teste_sem_player_cai_no_comeco_da_fonte,
    teste_fonte_carimbada_usa_offset_e_fator_do_carimbo,
    teste_carimbo_em_meia_velocidade,
    teste_carimbo_tem_prioridade_sobre_o_data_do_v1,
    teste_nao_congela_quando_o_v1_zera_track_started_at,
    teste_recover_with_download_volta_do_zero_sem_adiantar_a_barra,
    teste_posicao_nao_anda_sem_audio_entregue,
]


def main() -> int:
    falhas = 0
    for teste in TESTES:
        try:
            teste()
        except Exception as e:
            falhas += 1
            print(f"FALHOU  {teste.__name__}: {e}")
        else:
            print(f"ok      {teste.__name__}")
    print(f"\n{len(TESTES) - falhas}/{len(TESTES)} testes passaram")
    return 1 if falhas else 0


if __name__ == "__main__":
    raise SystemExit(main())
