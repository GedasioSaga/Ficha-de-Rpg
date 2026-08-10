"""Smoke test das duas correções de UI/protocolo pedidas (2026-07-26).

Sem Discord de verdade, com dublês — mesmo estilo de `teste_auto_seguir.py`.

Correção 1 — "a UI não sabe que o bot entrou na voz": `_montar_estado_musica`
passou a trazer `em_voz` (True sempre que `cog.voice_client` está conectado,
mesmo com nada tocando) pra a UI habilitar os controles de música assim que o
bot entra na call — não só quando o usuário clica "Entrar" manualmente (que
era o único caminho que setava o `emVoz` local antigo; o auto-seguir conecta
a voz sem passar por ali).

Correção 2 — "erro sem mensagem vira toast vazio": `_processar_linha` usava
`str(e)` no fallback de exceção; uma exceção levantada sem argumentos (ex.:
`discord.opus.OpusNotLoaded()`) tem `str(e) == ""`, e isso virava
`{"erro": ""}` — um toast vermelho completamente mudo no front. Agora cai pra
`repr(e)` quando `str(e)` é vazio.

Como rodar (a partir da raiz do projeto):
    sidecar\\.venv\\Scripts\\python.exe sidecar\\teste_correcoes_musica_ui.py
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bot_sidecar as bs  # noqa: E402


# --------------------------------------------------------------------------
# Dublês: só os atributos que `_montar_estado_musica`/`_estado_reproducao`/
# `_em_voz` tocam — não precisa da árvore completa (guild/canal/membro) do
# teste de auto-seguir, porque aqui não exercitamos eventos de voz.
# --------------------------------------------------------------------------


class VozFalsa:
    """Dublê do `discord.VoiceClient` com os três métodos que o sidecar lê."""

    def __init__(self, conectado: bool, tocando: bool = False, pausado: bool = False) -> None:
        self._conectado = conectado
        self._tocando = tocando
        self._pausado = pausado

    def is_connected(self) -> bool:
        return self._conectado

    def is_playing(self) -> bool:
        return self._tocando

    def is_paused(self) -> bool:
        return self._pausado


class CogMusicaFalso:
    """Dublê do cog `MusicBot` com o que `_montar_estado_musica` precisa."""

    def __init__(self, voice_client: VozFalsa | None) -> None:
        self.voice_client = voice_client
        self.current: dict[str, Any] | None = None
        self.queue: list[Any] = []
        self.loop_mode = False


class ClienteMusicaFalso:
    """Dublê mínimo do `commands.Bot` só pro `get_cog` de `_cog_musica_opcional`."""

    def __init__(self, cog: CogMusicaFalso | None) -> None:
        self._cog = cog

    def get_cog(self, _nome: str) -> CogMusicaFalso | None:
        return self._cog


class ErroSemMensagem(Exception):
    """Simula uma exceção levantada sem argumentos (ex.: `OpusNotLoaded`)."""


def _handler_falha_sem_mensagem(_args: dict[str, Any]) -> None:
    raise ErroSemMensagem()


def _handler_falha_com_mensagem(_args: dict[str, Any]) -> None:
    raise RuntimeError("canal de voz não encontrado")


# --------------------------------------------------------------------------
# Correção 1 — `em_voz` no payload de música
# --------------------------------------------------------------------------


def teste_em_voz_false_sem_cog_carregado() -> None:
    """Cog de música ainda não carregado (ex.: `conectar` não rodou) — no-op seguro."""
    bs._bot = ClienteMusicaFalso(None)
    payload = bs._montar_estado_musica()
    assert payload["em_voz"] is False
    assert payload["estado"] == "parado"


def teste_em_voz_true_conectado_sem_tocar() -> None:
    """O caso central da correção: bot na call, nada tocando -> em_voz=True.

    Antes desta correção a UI só sabia disso quando o usuário clicava
    "Entrar" manualmente; o auto-seguir conecta a voz sem passar por ali.
    """
    cog = CogMusicaFalso(VozFalsa(conectado=True))
    bs._bot = ClienteMusicaFalso(cog)
    payload = bs._montar_estado_musica()
    assert payload["em_voz"] is True, "bot conectado à voz deveria reportar em_voz=True mesmo parado"
    assert payload["estado"] == "parado", "nada tocando: estado continua 'parado'"


def teste_em_voz_false_desconectado() -> None:
    cog = CogMusicaFalso(VozFalsa(conectado=False))
    bs._bot = ClienteMusicaFalso(cog)
    payload = bs._montar_estado_musica()
    assert payload["em_voz"] is False


def teste_em_voz_e_estado_tocando_juntos() -> None:
    """`em_voz` e `estado` são independentes: tocando implica em_voz, não o contrário."""
    cog = CogMusicaFalso(VozFalsa(conectado=True, tocando=True))
    bs._bot = ClienteMusicaFalso(cog)
    payload = bs._montar_estado_musica()
    assert payload["em_voz"] is True
    assert payload["estado"] == "tocando"


# --------------------------------------------------------------------------
# Correção 2 — exceção sem mensagem nunca vira erro vazio
# --------------------------------------------------------------------------


def teste_excecao_sem_mensagem_produz_erro_nao_vazio() -> None:
    bs.COMANDOS["_teste_falha_sem_mensagem"] = _handler_falha_sem_mensagem
    try:
        resposta = bs._processar_linha(
            '{"id": "1", "cmd": "_teste_falha_sem_mensagem", "args": {}}'
        )
    finally:
        del bs.COMANDOS["_teste_falha_sem_mensagem"]

    assert resposta is not None
    assert resposta["ok"] is False
    assert resposta["erro"], "erro vazio chegaria como toast vermelho mudo no front"
    assert "ErroSemMensagem" in resposta["erro"], (
        f"esperava o tipo da exceção no erro (fallback pro repr), veio: {resposta['erro']!r}"
    )


def teste_excecao_com_mensagem_preserva_texto() -> None:
    """Guarda de não-regressão: exceção normal não deve virar `repr(e)`."""
    bs.COMANDOS["_teste_falha_com_mensagem"] = _handler_falha_com_mensagem
    try:
        resposta = bs._processar_linha(
            '{"id": "2", "cmd": "_teste_falha_com_mensagem", "args": {}}'
        )
    finally:
        del bs.COMANDOS["_teste_falha_com_mensagem"]

    assert resposta is not None
    assert resposta["erro"] == "canal de voz não encontrado"


TESTES = [
    teste_em_voz_false_sem_cog_carregado,
    teste_em_voz_true_conectado_sem_tocar,
    teste_em_voz_false_desconectado,
    teste_em_voz_e_estado_tocando_juntos,
    teste_excecao_sem_mensagem_produz_erro_nao_vazio,
    teste_excecao_com_mensagem_preserva_texto,
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
