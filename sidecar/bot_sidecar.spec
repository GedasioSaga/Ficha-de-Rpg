# -*- mode: python ; coding: utf-8 -*-

import os

# O venv (sidecar/.venv) foi criado sobre o Python base do Anaconda. Nesse
# Python, as DLLs nativas usadas por módulos da stdlib (_ctypes, _bz2,
# _lzma, _sqlite3, pyexpat, _ssl, _hashlib) ficam em Library/bin, não em
# DLLs/ — o resolvedor de dependências do PyInstaller não procura ali
# sozinho e o build sai sem elas. O sintoma nunca aponta pra causa: sem
# ffi.dll o exe morre no `import discord` (discord.opus -> ctypes ->
# _ctypes); sem libssl/libcrypto o `import ssl` falha, o asyncio faz
# `except ImportError: ssl = None` e o login no Discord estoura com
# "SSL is not supported".
#
# Duas defesas, de propósito:
#   1) Library/bin entra no PATH ANTES da Analysis. É o conserto de raiz —
#      o resolvedor do PyInstaller varre o PATH, então qualquer DLL desse
#      diretório que algum .pyd empacotado precise passa a ser encontrada
#      automaticamente, inclusive as que ainda não descobrimos na marra.
#   2) A lista explícita abaixo continua como rede de segurança, pra não
#      depender só do comportamento do resolvedor.
_ANACONDA_LIBRARY_BIN = r"C:\Users\gedasio.filho\anaconda3\Library\bin"
if os.path.isdir(_ANACONDA_LIBRARY_BIN):
    os.environ["PATH"] = _ANACONDA_LIBRARY_BIN + os.pathsep + os.environ.get("PATH", "")

_DLLS_FALTANTES = [
    "ffi.dll",
    "libexpat.dll",
    "liblzma.dll",
    "libbz2.dll",
    "sqlite3.dll",
    "libssl-3-x64.dll",
    "libcrypto-3-x64.dll",
]
_binarios_extra = [
    (os.path.join(_ANACONDA_LIBRARY_BIN, dll), ".")
    for dll in _DLLS_FALTANTES
    if os.path.exists(os.path.join(_ANACONDA_LIBRARY_BIN, dll))
]

# O discord.py carrega o libopus (codec de voz) por CAMINHO DE ARQUIVO, não por
# import: `discord/opus.py:230-234` monta
# `os.path.dirname(os.path.abspath(discord.__file__)) + '/bin/libopus-0.x64.dll'`.
# Como é um .dll de dado (não um módulo nem uma dependência de import table),
# nenhuma análise do PyInstaller o descobre — e o pacote não traz hook pra isso.
# Sem ele, `VoiceClient.play` levanta `discord.opus.OpusNotLoaded`, que é uma
# exceção SEM argumentos: `str(e)` é string vazia, então o erro chegava na UI
# como um toast vermelho totalmente mudo. O destino tem que ser exatamente
# `discord/bin` pra bater com o caminho que o `_load_default` calcula dentro do
# bundle (`__file__` do pacote aponta pra dentro do _MEIPASS).
_DISCORD_BIN = os.path.join(
    os.path.dirname(os.path.abspath(SPEC)), ".venv", "Lib", "site-packages", "discord", "bin"
)
_dados_extra = [
    (os.path.join(_DISCORD_BIN, nome), "discord/bin")
    for nome in ("libopus-0.x64.dll", "libopus-0.x86.dll", "COPYING")
    if os.path.exists(os.path.join(_DISCORD_BIN, nome))
]

a = Analysis(
    ['bot_sidecar.py'],
    pathex=[],
    binaries=_binarios_extra,
    datas=_dados_extra,
    # musica_v1 é importado dinamicamente (importlib.import_module dentro de
    # `conectar`) — sem isso o PyInstaller não analisa o módulo e yt_dlp/nacl
    # (dependências transitivas dele) ficam de fora do build.
    #
    # '_cffi_backend' é a causa raiz provada do erro "PyNaCl library needed
    # in order to use voice" que aparecia em máquina limpa: o PyNaCl 1.5.0
    # compila `nacl/_sodium.pyd` no modo ABI do cffi, e esse .pyd busca o
    # módulo `_cffi_backend` (da lib `cffi`) via import do Python em tempo
    # de execução — não é uma dependência de DLL (não aparece na import
    # table do .pyd) nem um `import` textual em nenhum .py do pacote nacl,
    # então a análise estática do PyInstaller nunca o descobre sozinha. O
    # hook `hook-nacl.py` do pyinstaller-hooks-contrib deveria cobrir isso,
    # mas está desatualizado: procura `nacl/_lib/*_cffi_*.pyd` (layout do
    # PyNaCl < 1.0) e não bate com nada no 1.5.0 (o .pyd hoje é
    # `nacl/_sodium.pyd`, sem pasta `_lib`), então roda e não adiciona nada,
    # em silêncio. Sem `_cffi_backend` aqui, o .exe empacotado falha com
    # `ModuleNotFoundError: No module named '_cffi_backend'` ao importar
    # nacl.secret — só que discord/voice_client.py faz
    # `except ImportError: has_nacl = False`, engolindo esse erro real e
    # trocando por "PyNaCl library needed" bem mais tarde, quando alguém
    # tenta tocar música. Reproduzido e corrigido com script isolado antes
    # de mexer aqui (ver relato da tarefa); com essa linha o mesmo teste
    # passa mesmo com PATH restrito a C:\Windows\System32;C:\Windows.
    hiddenimports=['musica_v1', 'yt_dlp', 'nacl', '_cffi_backend'],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='bot_sidecar',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
