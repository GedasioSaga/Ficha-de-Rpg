"""Testes do auto-seguir de voz (F5) — rodam sem Discord, com dublês.

Por que este arquivo existe: o bug reportado era o bot entrando na call
sozinho com o checkbox "Bot me segue" DESMARCADO. O sidecar nascia com
`auto_seguir_ativo = True`, então o listener de voz continuava ativo mesmo com
a UI desligada — a UI nunca mandava nada até o usuário mexer na caixa.

O que os testes travam:
  1. estado inicial do sidecar = auto-seguir DESLIGADO (o bug);
  2. desligado -> evento de voz NÃO conecta o bot;
  3. ligado -> evento de voz conecta o bot no canal do nick;
  4. `_seguir_agora` (varredura retroativa) entra na call em que o nick já
     estava, e só quando o toggle está ligado.

Como rodar (a partir da raiz do projeto):
    sidecar\\.venv\\Scripts\\python.exe sidecar\\teste_auto_seguir.py

Sem pytest de propósito: o venv do sidecar só tem o que o bot precisa
(discord.py/PyInstaller), e um script com asserts basta pra travar o
comportamento.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import bot_sidecar as bs  # noqa: E402


# --------------------------------------------------------------------------
# Dublês: só os atributos que o código sob teste toca.
# --------------------------------------------------------------------------


class UsuarioFalso:
    def __init__(self, id_: int) -> None:
        self.id = id_


class GuildFalsa:
    def __init__(self, nome: str = "guild-teste") -> None:
        self.name = nome
        self.voice_channels: list[CanalFalso] = []


class VoiceClientFalso:
    def __init__(self, canal: CanalFalso) -> None:
        self.channel = canal
        self.guild = canal.guild
        self.conectado = True

    def is_connected(self) -> bool:
        return self.conectado

    def is_playing(self) -> bool:
        return False

    def is_paused(self) -> bool:
        return False

    async def disconnect(self, force: bool = False) -> None:
        self.conectado = False
        canal: CanalFalso = self.channel
        if self in canal.cliente.voice_clients:
            canal.cliente.voice_clients.remove(self)


class CanalFalso:
    def __init__(self, cliente: ClienteFalso, guild: GuildFalsa, nome: str = "Sala") -> None:
        self.cliente = cliente
        self.guild = guild
        self.name = nome
        self.members: list[MembroFalso] = []
        guild.voice_channels.append(self)

    async def connect(self) -> VoiceClientFalso:
        vc = VoiceClientFalso(self)
        self.cliente.voice_clients.append(vc)
        self.members.append(self.cliente.membro_bot)
        return vc


class MembroFalso:
    def __init__(self, guild: GuildFalsa, nome: str, id_: int) -> None:
        self.guild = guild
        self.id = id_
        self.name = nome
        self.display_name = nome
        self.global_name = nome


class EstadoVozFalso:
    def __init__(self, canal: CanalFalso | None) -> None:
        self.channel = canal


class CogFalso:
    def __init__(self) -> None:
        self.voice_client: Any = None
        # `current`/`queue`: a correção do "em_voz" (bot_sidecar.py) passou a
        # emitir o estado da música (`_emitir_evento_musica`) logo após
        # entrar/sair da voz e no auto-join/-leave — todos caminhos que este
        # arquivo exercita. Sem estes dois atributos, `_montar_estado_musica`
        # lança AttributeError (engolido pelos `except Exception` largos dos
        # listeners de voz), mascarando silenciosamente o problema.
        self.current: dict | None = None
        self.queue: list = []


class ClienteFalso:
    """Dublê do `commands.Bot`.

    `is_ready`/`is_closed` fazem `_bot_pronto()` devolver False de propósito:
    assim `_cmd_auto_seguir_definir` não tenta agendar a varredura retroativa
    num event loop que não existe no teste — cada cenário chama `_seguir_agora`
    direto quando quer exercitar essa parte.
    """

    def __init__(self, guild: GuildFalsa, cog: CogFalso | None) -> None:
        self.user = UsuarioFalso(999)
        self.guilds = [guild]
        self.voice_clients: list[VoiceClientFalso] = []
        self.membro_bot = MembroFalso(guild, "rpg-bot", 999)
        self._cog = cog

    def get_cog(self, _nome: str) -> CogFalso | None:
        return self._cog

    def is_ready(self) -> bool:
        return False

    def is_closed(self) -> bool:
        return True


def montar_cenario() -> tuple[ClienteFalso, CanalFalso, MembroFalso, CogFalso]:
    """Bot + guild + canal de voz vazio + o 'gedasiosaga' fora da call."""
    guild = GuildFalsa()
    cog = CogFalso()
    cliente = ClienteFalso(guild, cog)
    canal = CanalFalso(cliente, guild, "Mesa de RPG")
    membro = MembroFalso(guild, "gedasiosaga", 1)
    bs._bot = cliente  # `_cog_musica_opcional` exige um bot no módulo
    return cliente, canal, membro, cog


def entrar_na_call(cliente: ClienteFalso, canal: CanalFalso, membro: MembroFalso) -> None:
    """Dispara o mesmo caminho do `on_voice_state_update` (nada -> canal)."""
    canal.members.append(membro)
    asyncio.run(
        bs._tratar_voice_state_update(
            cliente, membro, EstadoVozFalso(None), EstadoVozFalso(canal)
        )
    )


# --------------------------------------------------------------------------
# Testes
# --------------------------------------------------------------------------


def teste_sidecar_nasce_desligado() -> None:
    """O bug: o sidecar nascia com o auto-seguir LIGADO e a UI desmarcada."""
    ativo, _nick = bs._ler_auto_seguir()
    assert ativo is False, "sidecar nasceu com o auto-seguir LIGADO (bug do 'bot me segue')"


def teste_desligado_nao_entra_na_call() -> None:
    cliente, canal, membro, cog = montar_cenario()
    bs._cmd_auto_seguir_definir({"ativo": False, "nick": "gedasiosaga"})

    entrar_na_call(cliente, canal, membro)

    assert cliente.voice_clients == [], "bot entrou na call com o auto-seguir DESLIGADO"
    assert cog.voice_client is None


def teste_ligado_entra_na_call() -> None:
    cliente, canal, membro, cog = montar_cenario()
    bs._cmd_auto_seguir_definir({"ativo": True, "nick": "gedasiosaga"})

    entrar_na_call(cliente, canal, membro)

    assert len(cliente.voice_clients) == 1, "bot NÃO entrou na call com o auto-seguir ligado"
    assert cliente.voice_clients[0].channel is canal
    assert cog.voice_client is cliente.voice_clients[0], "cog ficou sem o voice_client"


def teste_ligado_ignora_nick_diferente() -> None:
    cliente, canal, _membro, _cog = montar_cenario()
    bs._cmd_auto_seguir_definir({"ativo": True, "nick": "gedasiosaga"})
    outro = MembroFalso(canal.guild, "fulano", 2)

    entrar_na_call(cliente, canal, outro)

    assert cliente.voice_clients == [], "bot seguiu um nick que não é o configurado"


def teste_seguir_agora_pega_quem_ja_estava_na_call() -> None:
    """Retroativo: `on_voice_state_update` não dispara pra quem já está lá."""
    cliente, canal, membro, cog = montar_cenario()
    canal.members.append(membro)  # já estava na call antes de ligar o toggle
    bs._cmd_auto_seguir_definir({"ativo": True, "nick": "gedasiosaga"})

    asyncio.run(bs._seguir_agora(cliente))

    assert len(cliente.voice_clients) == 1, "não entrou na call em que o nick já estava"
    assert cliente.voice_clients[0].channel is canal
    assert cog.voice_client is cliente.voice_clients[0]


def teste_seguir_agora_respeita_toggle_desligado() -> None:
    cliente, canal, membro, _cog = montar_cenario()
    canal.members.append(membro)
    bs._cmd_auto_seguir_definir({"ativo": False, "nick": "gedasiosaga"})

    asyncio.run(bs._seguir_agora(cliente))

    assert cliente.voice_clients == [], "varredura entrou na call com o toggle DESLIGADO"


TESTES = [
    teste_sidecar_nasce_desligado,
    teste_desligado_nao_entra_na_call,
    teste_ligado_entra_na_call,
    teste_ligado_ignora_nick_diferente,
    teste_seguir_agora_pega_quem_ja_estava_na_call,
    teste_seguir_agora_respeita_toggle_desligado,
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
