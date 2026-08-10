# Cópia do motor de música do v1 (`Discord/bot.py`), com os caminhos
# (ffmpeg/cache/log) parametrizados por env var para rodar empacotado
# (PyInstaller) fora do checkout do v1 — ver F4.6. Resto do arquivo é
# herdado do v1 sem refatoração.

import discord
from discord.ext import commands
from discord import app_commands
import yt_dlp
import asyncio
import os
from collections import deque
import time
import json
from typing import Dict, Any, Optional

def log_debug(msg):
    try:
        print(msg)
        with open(os.path.join(CACHE_DIR, "debug_music.log"), "a", encoding="utf-8") as f:
            f.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n")
    except:
        pass

# Configurações do bot — arquivo de REFERÊNCIA do v1 (migração da música,
# Fase futura). Token nunca em claro aqui: repo público. Se este código for
# reaproveitado, o token vem do env DISCORD_BOT_TOKEN como no bot_sidecar.
TOKEN = os.environ.get('DISCORD_BOT_TOKEN', '')

# Configurações otimizadas do yt-dlp com fallback para múltiplos formatos
ytdl_format_options = {
    'format': 'bestaudio/best',
    'outtmpl': '%(extractor)s-%(id)s-%(title)s.%(ext)s',
    'restrictfilenames': True,
    'noplaylist': True,
    'nocheckcertificate': True,
    'ignoreerrors': False,
    'logtostderr': False,
    'quiet': True,
    'no_warnings': True,
    'default_search': 'auto',
    'source_address': '0.0.0.0',
    'socket_timeout': 30,
    'retries': 5,
    'fragment_retries': 5,
    'skip_unavailable_fragments': True,
    'keep_fragments': False,
    'buffersize': 16384,
    'http_chunk_size': 10485760,
    'extract_flat': False,
    'writethumbnail': False,
    'writeinfojson': False,
    'writesubtitles': False,
    'writeautomaticsub': False,
    'geo_bypass': True,
    'prefer_ffmpeg': True,
    'keepvideo': False,
    'cachedir': False,
    # Força client Android no YouTube para evitar 403 em URLs de stream recentes.
    'extractor_args': {
        'youtube': {
            'player_client': ['android']
        }
    }
}

# Fallback de dev (v1 rodando do checkout em C:\dev\Projeto Rpg): usado só
# quando as env vars RPGV2_* (contrato com o lado Rust, ver F4.6) não estão
# definidas — build empacotado sempre recebe as env vars do Tauri.
_V1_DISCORD_DIR_FALLBACK = r"C:\dev\Projeto Rpg\Discord"
# Alias mantido para `prewarm_favorites` (código herdado do v1, morto neste
# contexto — o sidecar usa seu próprio `bot`/`setup_hook`, não este módulo).
script_dir = _V1_DISCORD_DIR_FALLBACK

# Configurações do FFmpeg
ffmpeg_path = os.environ.get("RPGV2_FFMPEG") or os.path.join(
    _V1_DISCORD_DIR_FALLBACK, 'ffmpeg-8.0-essentials_build', 'bin', 'ffmpeg.exe'
)

ffmpeg_options = {
    'before_options': '-reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 2 -nostdin',
    'options': '-vn',
    'executable': ffmpeg_path
}

# Diretórios/arquivos de cache persistente (usar existentes). Em produção o
# app instalado fica em Program Files (não gravável) — por isso o cache tem
# que ir para a pasta de dados do app (RPGV2_CACHE_DIR, definida pelo Rust).
CACHE_DIR = os.environ.get("RPGV2_CACHE_DIR") or os.path.join(_V1_DISCORD_DIR_FALLBACK, 'cache')
STREAM_CACHE_FILE = os.path.join(CACHE_DIR, 'stream_cache.json')
PLAYED_CACHE_FILE = os.path.join(CACHE_DIR, 'played_songs_cache.json')
STREAM_CACHE_TTL_SECONDS = 4 * 60 * 60  # 4 horas para evitar URLs expiradas do YouTube

# Instância do yt-dlp
ytdl = yt_dlp.YoutubeDL(ytdl_format_options)


class CacheManager:
    """Cache persistente simples para mapear URL -> stream_url e metadados."""
    def __init__(self):
        os.makedirs(CACHE_DIR, exist_ok=True)
        self.stream_cache_path = STREAM_CACHE_FILE
        self.played_cache_path = PLAYED_CACHE_FILE
        self.stream_cache = self._load_json(self.stream_cache_path)
        self.played_cache = self._load_json(self.played_cache_path)

    def _load_json(self, path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {}

    def _save_json(self, path, data):
        try:
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception:
            pass

    def get_cached_stream(self, url):
        entry = self.stream_cache.get(url)
        if not entry:
            return None
        # Invalida cache antigo criado sem client Android (evita reutilizar stream quebrado)
        if entry.get('yt_client') != 'android':
            return None
        # Invalida cache antigo sem duração válida (necessária para barra de progresso/seek da UI)
        if int(entry.get('duration') or 0) <= 0:
            return None
        ts = entry.get('timestamp')
        if not ts:
            return None
        if (time.time() - ts) < STREAM_CACHE_TTL_SECONDS and 'stream_url' in entry:
            return entry
        return None

    async def resolve_and_cache(self, url, loop):
        try:
            # Primeiro, tentar extrair informações básicas sem formato específico
            basic_options = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': False,
                'ignoreerrors': True,
                'socket_timeout': 30,
                'retries': 3,
                'extractor_args': {
                    'youtube': {
                        'player_client': ['android']
                    }
                }
            }
            
            basic_ytdl = yt_dlp.YoutubeDL(basic_options)
            data = await loop.run_in_executor(None, lambda: basic_ytdl.extract_info(url, download=False))
            
            # Verificar se a extração retornou dados válidos
            if not data:
                raise Exception(f"Não foi possível extrair informações do vídeo: {url}")
            
            if 'entries' in data:
                data = data['entries'][0]
                if not data:
                    raise Exception(f"Entrada de playlist vazia para: {url}")
            
            # Verificar se o vídeo tem formatos de áudio/vídeo válidos
            formats = data.get('formats')
            if not formats:
                # Sem formatos disponíveis
                raise Exception(f"Vídeo '{data.get('title', url)}' não possui formatos disponíveis")
            
            has_audio_video = any(
                f.get('acodec') != 'none' or f.get('vcodec') != 'none' 
                for f in formats 
                if f.get('acodec') != 'images' and f.get('vcodec') != 'images'
            )
            
            if not has_audio_video:
                # Vídeo só tem imagens/storyboards disponíveis
                raise Exception(f"Vídeo '{data.get('title', url)}' não possui formatos de áudio/vídeo válidos - apenas imagens disponíveis")
            
            # Agora tentar extrair com o formato específico
            try:
                data = await loop.run_in_executor(None, lambda: ytdl.extract_info(url, download=False))
                if not data:
                    raise Exception("Extração com formato específico retornou dados vazios")
                if 'entries' in data:
                    data = data['entries'][0]
                    if not data:
                        raise Exception("Entrada de playlist vazia na extração com formato específico")
            except Exception as format_error:
                # Se falhar com formato específico, usar o melhor formato disponível
                print(f"[AVISO] Formato específico falhou, tentando melhor formato disponível: {format_error}")
                fallback_options = basic_options.copy()
                fallback_options['format'] = 'best'
                fallback_ytdl = yt_dlp.YoutubeDL(fallback_options)
                data = await loop.run_in_executor(None, lambda: fallback_ytdl.extract_info(url, download=False))
                if not data:
                    raise Exception("Extração com fallback retornou dados vazios")
                if 'entries' in data:
                    data = data['entries'][0]
                    if not data:
                        raise Exception("Entrada de playlist vazia no fallback")
            
            stream_url = data.get('url')
            if not stream_url:
                raise Exception(f"Não foi possível obter URL de stream para '{data.get('title', url)}'")
                
            entry = {
                'stream_url': stream_url,
                'title': data.get('title') or url,
                'duration': self._parse_duration_fallback(data),
                'http_headers': data.get('http_headers') or {},
                'yt_client': 'android',
                'timestamp': time.time()
            }
            # Guardar no cache
            self.stream_cache[url] = entry
            self._save_json(self.stream_cache_path, self.stream_cache)
            return entry
        except Exception as e:
            print(f"[ERRO] Falha ao resolver URL {url}: {str(e)}")
            raise e

    async def ensure_cached(self, url, loop):
        cached = self.get_cached_stream(url)
        if cached:
            return cached
        try:
            return await self.resolve_and_cache(url, loop)
        except Exception:
            return None

    def note_play(self, url, stream_url):
        self.played_cache[url] = {
            'stream_url': stream_url,
            'timestamp': time.time()
        }
        self._save_json(self.played_cache_path, self.played_cache)

    def _parse_duration_fallback(self, data):
        """Converte duration_string (hh:mm:ss) para segundos quando duration não vier."""
        try:
            duration = data.get('duration')
            if duration is not None:
                return int(duration)
            duration_str = str(data.get('duration_string') or '').strip()
            if not duration_str:
                return 0
            parts = [int(p) for p in duration_str.split(':')]
            if len(parts) == 2:
                return (parts[0] * 60) + parts[1]
            if len(parts) == 3:
                return (parts[0] * 3600) + (parts[1] * 60) + parts[2]
            return 0
        except Exception:
            return 0


class YTDLSource(discord.PCMVolumeTransformer):
    def __init__(self, source, *, data, volume=0.5):
        super().__init__(source, volume)
        self.data = data
        self.title = data.get('title')
        self.url = data.get('url')

    @classmethod
    async def from_url(cls, url, *, loop=None, stream=True):
        loop = loop or asyncio.get_event_loop()

        # Extração direta sem cache manual
        data = await loop.run_in_executor(None, lambda: ytdl.extract_info(url, download=not stream))
        if 'entries' in data:
            data = data['entries'][0]
        filename = data['url'] if stream else ytdl.prepare_filename(data)
        ffmpeg_opts = dict(ffmpeg_options)
        http_headers = data.get('http_headers') or {}
        user_agent = http_headers.get('User-Agent')
        if user_agent:
            ffmpeg_opts['before_options'] = f"{ffmpeg_opts['before_options']} -user_agent \"{str(user_agent).replace('\"', '\\\"')}\""
        return cls(discord.FFmpegPCMAudio(filename, **ffmpeg_opts), data=data)


async def prewarm_favorites(bot, cache_mgr: CacheManager):
    """Pré-aquecer cache para favoritos do arquivo discord_config.json."""
    try:
        base_dir = os.path.dirname(script_dir)  # projeto raiz
        config_path = os.path.join(base_dir, 'discord_config.json')
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
        favorites = config.get('favorites', [])
        urls = [fav.get('url') for fav in favorites if fav.get('url')]
        if not urls:
            return

        sem = asyncio.Semaphore(2)

        async def _ensure(url):
            async with sem:
                await cache_mgr.ensure_cached(url, bot.loop)

        await asyncio.gather(*[_ensure(u) for u in urls])
    except Exception:
        # Silencia erros para não impactar o bot
        pass


class MusicBot(commands.Cog):
    def __init__(self, bot):
        self.bot = bot
        self.queue = deque()
        self.current = None
        self.loop_mode = False
        self.voice_client = None
        self.cache = CacheManager()
        self.song_started_callback = None
        self.song_ended_callback = None
        self._stream_recovery_attempts = {}
        self._track_started_at = None
        self._early_end_threshold_seconds = 8.0
        # Identidade do player vigente. Cada `voice_client.play()` recebe um
        # token novo, e o `after` daquele play carrega esse token; o callback
        # só age se o token dele ainda for o vigente. Substituiu o
        # `_ignore_after_once` (um booleano só pra todas as trocas de fonte):
        # cada `stop()` gera um `after` entregue de forma assíncrona pela
        # thread do player velho, então duas trocas coladas geravam dois
        # callbacks pra uma flag só e o segundo passava direto — avançando a
        # fila/disparando o fallback de download no meio de um seek.
        self._token_player = 0

    def _build_ffmpeg_options(
        self,
        http_headers: Optional[Dict[str, Any]] = None,
        start_seconds: int = 0
    ) -> Dict[str, Any]:
        """Monta opções do FFmpeg com headers do yt-dlp para evitar 403 do YouTube."""
        opts = dict(ffmpeg_options)
        headers = http_headers or {}
        user_agent = headers.get('User-Agent')
        referer = headers.get('Referer') or 'https://www.youtube.com/'

        if user_agent:
            safe_ua = str(user_agent).replace('"', '\\"')
            opts['before_options'] = f"{opts['before_options']} -user_agent \"{safe_ua}\""

        safe_ref = str(referer).replace('"', '\\"')
        opts['before_options'] = f"{opts['before_options']} -headers \"Referer: {safe_ref}\\r\\n\""
        if start_seconds and start_seconds > 0:
            opts['before_options'] = f"{opts['before_options']} -ss {int(start_seconds)}"
        return opts

    def _invalidar_player(self):
        """Aposenta o player vigente ANTES de um `stop()` que nós mesmos damos.

        Chamar antes do `stop()` (e não depois) é o que fecha a janela entre o
        `stop()` e o `play()` seguinte: o `after` do player velho pode chegar
        no meio dela, e a partir daqui ele já não casa com o token vigente.
        Só para paradas deliberadas — quem quer que a fila ande sozinha
        (`skip`) não invalida.
        """
        self._token_player += 1

    def _tocar_fonte(self, source):
        """Único caminho de `voice_client.play()`: marca o `after` com um token.

        O token vira o vigente só DEPOIS do `play()` — se o `play()` levantar,
        o player que estiver de pé continua com o token dele válido, senão o
        fim natural dele seria confundido com órfão e a fila travava.
        """
        token = self._token_player + 1
        self.voice_client.play(source, after=lambda erro, t=token: self._on_track_after(erro, t))
        self._token_player = token

    async def _recover_with_download(self) -> bool:
        """Fallback: baixa temporariamente o áudio para contornar 403 de stream."""
        if not self.current or not self.current.get('url') or not self.voice_client:
            return False
        try:
            log_debug(f"[DEBUG] Tentando fallback com download local: {self.current['url']}")
            source = await YTDLSource.from_url(self.current['url'], loop=self.bot.loop, stream=False)
            if source and getattr(source, 'title', None):
                self.current['title'] = source.title
            self._track_started_at = time.monotonic()
            self._tocar_fonte(source)
            log_debug("[DEBUG] Fallback com download local iniciado com sucesso")
            return True
        except Exception as e:
            log_debug(f"[ERRO] Fallback com download local falhou: {e}")
            return False

    async def _handle_track_after(self, error, token):
        """Tratamento assíncrono do fim de faixa com tentativa de recuperação.

        `token` identifica o player que disparou este `after`; se não é mais o
        vigente, o callback é órfão de um player que nós já aposentamos (seek,
        troca de velocidade, tocar_agora) e não pode mexer na fila.
        """
        if token != self._token_player:
            return

        current_url = self.current.get('url') if self.current else None
        elapsed = None
        if self._track_started_at is not None:
            elapsed = time.monotonic() - self._track_started_at
        self._track_started_at = None

        if error:
            err_text = str(error)
            log_debug(f"[ERRO] Reprodução finalizada com erro: {err_text}")
            attempts = self._stream_recovery_attempts.get(current_url, 0) if current_url else 0

            # Erros de acesso ao stream do YouTube: tentar uma vez por URL com download local
            if current_url and attempts < 1 and ("403" in err_text or "Forbidden" in err_text or "HTTP Error" in err_text):
                self._stream_recovery_attempts[current_url] = attempts + 1
                recovered = await self._recover_with_download()
                if recovered:
                    return
        else:
            # Alguns encerramentos prematuros chegam sem erro no callback.
            attempts = self._stream_recovery_attempts.get(current_url, 0) if current_url else 0
            if current_url and elapsed is not None and elapsed < self._early_end_threshold_seconds and attempts < 1:
                log_debug(
                    f"[WARN] Encerramento precoce ({elapsed:.2f}s) sem erro. "
                    "Tentando fallback local."
                )
                self._stream_recovery_attempts[current_url] = attempts + 1
                recovered = await self._recover_with_download()
                if recovered:
                    return

        await self.play_next_auto()

    def _on_track_after(self, error, token):
        """Callback síncrono do player Discord (roda na thread do player)."""
        asyncio.run_coroutine_threadsafe(self._handle_track_after(error, token), self.bot.loop)

    def set_song_started_callback(self, callback):
        self.song_started_callback = callback
        
    def set_song_ended_callback(self, callback):
        self.song_ended_callback = callback

    def is_user_in_voice(self, interaction):
        return interaction.user.voice is not None

    async def join_voice_channel(self, interaction):
        if not self.is_user_in_voice(interaction):
            await interaction.response.send_message("❌ Você precisa estar em um canal de voz!")
            return False
        
        channel = interaction.user.voice.channel
        
        try:
            if self.voice_client is None:
                self.voice_client = await channel.connect()
            elif self.voice_client.channel != channel:
                await self.voice_client.move_to(channel)
            return True
        except:
            return False

    async def _create_source_from_url(self, url: str, start_seconds: int = 0):
        """Cria um source usando o cache quando possível, extraindo apenas se necessário."""
        try:
            entry = self.cache.get_cached_stream(url)
            if not entry:
                entry = await self.cache.ensure_cached(url, self.bot.loop)
            elif int(entry.get('duration') or 0) <= 0:
                # Re-extrair metadados quando a duração não estiver disponível
                refreshed = await self.cache.resolve_and_cache(url, self.bot.loop)
                if refreshed:
                    entry = refreshed
            
            if not entry or not entry.get('stream_url'):
                raise Exception("Não foi possível obter URL de stream válida")
                
            try:
                ffmpeg_opts = self._build_ffmpeg_options(
                    entry.get('http_headers'),
                    start_seconds=start_seconds
                )
                audio = discord.FFmpegPCMAudio(entry['stream_url'], **ffmpeg_opts)
                data = {
                    'title': entry.get('title') or url,
                    'url': url,
                    'duration': int(entry.get('duration') or 0),
                    'start_seconds': int(start_seconds or 0)
                }
                self.cache.note_play(url, entry['stream_url'])
                return YTDLSource(audio, data=data)
            except Exception as ffmpeg_error:
                print(f"[ERRO] Falha no FFmpeg: {ffmpeg_error}")
                # Fallback: se a URL de stream falhar (expirada), re-extrair
                entry = await self.cache.resolve_and_cache(url, self.bot.loop)
                if entry and entry.get('stream_url'):
                    ffmpeg_opts = self._build_ffmpeg_options(
                        entry.get('http_headers'),
                        start_seconds=start_seconds
                    )
                    audio = discord.FFmpegPCMAudio(entry['stream_url'], **ffmpeg_opts)
                    data = {
                        'title': entry.get('title') or url,
                        'url': url,
                        'duration': int(entry.get('duration') or 0),
                        'start_seconds': int(start_seconds or 0)
                    }
                    self.cache.note_play(url, entry['stream_url'])
                    return YTDLSource(audio, data=data)
                else:
                    raise Exception(f"Erro ao processar áudio: {str(ffmpeg_error)}")
                
        except Exception as e:
            error_msg = str(e)
            if "apenas imagens disponíveis" in error_msg:
                raise Exception(f"❌ Este vídeo não pode ser reproduzido - {error_msg}")
            elif "Requested format is not available" in error_msg:
                raise Exception("❌ Formato de vídeo não disponível. Tente outro vídeo.")
            else:
                # Último recurso: usar extração direta
                try:
                    source = await YTDLSource.from_url(url, loop=self.bot.loop, stream=True)
                    # Atualiza cache com o resultado
                    return source
                except Exception as direct_error:
                    raise Exception(f"❌ Erro ao processar vídeo: {str(direct_error)}")
        
        return {
            'error': True,
            'message': 'Falha ao criar source de áudio'
        }

    async def play_next_auto(self, force_skip=False):
        # Pequeno delay para garantir que o estado do voice_client seja atualizado após o término da música
        await asyncio.sleep(1)
        
        if self.voice_client and self.voice_client.is_playing() and not force_skip:
            log_debug("Ainda tocando, ignorando play_next_auto")
            return
        
        log_debug(f"play_next_auto chamado. Fila: {len(self.queue)}, Loop: {self.loop_mode}")
        
        # Loop mode
        if self.loop_mode and self.current and not force_skip:
            try:
                # Loop deve reiniciar a música do começo, não do último seek.
                loop_start = 0
                self.current['start_seconds'] = 0
                source = await self._create_source_from_url(self.current['url'], start_seconds=loop_start)
                if not self.current.get('duration'):
                    self.current['duration'] = int(getattr(source, 'data', {}).get('duration') or 0)
                self._tocar_fonte(source)
                self._track_started_at = time.monotonic()
                if self.song_started_callback:
                    try:
                        self.song_started_callback(dict(self.current))
                    except Exception as e:
                        log_debug(f"Erro no callback de início (loop): {e}")
                return
            except:
                pass
        
        # Notificar fim da música (se não for loop) e permitir preenchimento da fila
        if self.song_ended_callback and self.current:
            try:
                log_debug("Chamando callback de fim de música")
                self.song_ended_callback(self.current)
                # Delay para permitir que o presenter preencha a fila
                await asyncio.sleep(1.0)
            except Exception as e:
                log_debug(f"Erro no callback de fim de música: {e}")

        # Próxima da fila
        if self.queue:
            next_song = self.queue.popleft()
            self.current = next_song
            try:
                next_start = int(next_song.get('start_seconds', 0) or 0)
                source = await self._create_source_from_url(next_song['url'], start_seconds=next_start)
                if not self.current.get('duration'):
                    self.current['duration'] = int(getattr(source, 'data', {}).get('duration') or 0)
                
                # Notificar início da música
                if self.song_started_callback:
                    try:
                        self.song_started_callback(dict(self.current))
                    except Exception as e:
                        log_debug(f"Erro no callback de início de música: {e}")

                self._tocar_fonte(source)
                self._track_started_at = time.monotonic()
                return
            except:
                if self.queue:
                    await self.play_next_auto()
        else:
            # Fila vazia
            if self.loop_mode and self.current and not force_skip:
                try:
                    # Loop deve reiniciar a música do começo, não do último seek.
                    loop_start = 0
                    self.current['start_seconds'] = 0
                    source = await self._create_source_from_url(self.current['url'], start_seconds=loop_start)
                    if not self.current.get('duration'):
                        self.current['duration'] = int(getattr(source, 'data', {}).get('duration') or 0)
                    self._tocar_fonte(source)
                    self._track_started_at = time.monotonic()
                    if self.song_started_callback:
                        try:
                            self.song_started_callback(dict(self.current))
                        except Exception as e:
                            log_debug(f"Erro no callback de início (loop-fila-vazia): {e}")
                    return
                except:
                    # Evitar desconectar quando em modo loop; manter conexão e tentar novamente no próximo ciclo
                    return
            
            # Loop desativado ou sem música atual: desconectar com segurança
            self.current = None
            if self.voice_client and self.voice_client.is_connected():
                await self.voice_client.disconnect()
                self.voice_client = None

    @app_commands.command(name="play", description="Toca uma música do YouTube")
    async def play(self, interaction: discord.Interaction, url: str):
        await interaction.response.defer()
        
        if not await self.join_voice_channel(interaction):
            return
        
        try:
            # Se não está tocando nada, tocar imediatamente com cache/extração única
            if not (self.voice_client and self.voice_client.is_playing()):
                source = await self._create_source_from_url(url, start_seconds=0)
                duration = int(getattr(source, 'data', {}).get('duration') or 0)
                self.current = {
                    'title': source.title,
                    'url': url,
                    'start_seconds': 0,
                    'duration': duration
                }
                # Tocar imediatamente e agendar próxima reprodução automática
                self._tocar_fonte(source)
                self._track_started_at = time.monotonic()
                if self.song_started_callback:
                    try:
                        self.song_started_callback(dict(self.current))
                    except Exception as e:
                        log_debug(f"Erro no callback de início (play): {e}")
                embed = discord.Embed(
                    title="🎵 Tocando agora",
                    description=f"**{self.current['title']}**",
                    color=0x00ff00
                )
                await interaction.followup.send(embed=embed)
            else:
                # Já está tocando: enfileirar sem extrair agora (reduz latência e CPU)
                cached = self.cache.stream_cache.get(url)
                title = cached.get('title') if cached else url
                duration = int(cached.get('duration') or 0) if cached else 0
                self.queue.append({'title': title, 'url': url, 'start_seconds': 0, 'duration': duration})
                position = len(self.queue)
                embed = discord.Embed(
                    title="📝 Adicionado à fila",
                    description=f"**{title}**\nPosição: {position}",
                    color=0x0099ff
                )
                await interaction.followup.send(embed=embed)
                
        except Exception as e:
            await interaction.followup.send(f"❌ Erro: {str(e)}")

    @app_commands.command(name="skip", description="Pula a música atual")
    async def skip(self, interaction: discord.Interaction):
        if not self.is_user_in_voice(interaction):
            await interaction.response.send_message("❌ Você precisa estar em um canal de voz!")
            return
        
        if self.voice_client and self.voice_client.is_playing():
            if len(self.queue) > 0:
                # Apenas para a atual; o callback 'after' cuidará de tocar a próxima
                self.voice_client.stop()
                embed = discord.Embed(
                    title="⏭️ Música pulada",
                    description="Tocando a próxima...",
                    color=0xff9900
                )
                await interaction.response.send_message(embed=embed)
            elif self.loop_mode and self.current:
                # Em modo loop, parar fará o callback reiniciar conforme configuração atual
                self.voice_client.stop()
                embed = discord.Embed(
                    title="🔁 Música reiniciada",
                    description=f"**{self.current['title']}**",
                    color=0x9932cc
                )
                await interaction.response.send_message(embed=embed)
            else:
                self.voice_client.stop()
                embed = discord.Embed(
                    title="⏹️ Reprodução parada",
                    description="Fila vazia",
                    color=0x808080
                )
                await interaction.response.send_message(embed=embed)
        else:
            await interaction.response.send_message("❌ Nenhuma música tocando!")

    @app_commands.command(name="loop", description="Ativa/desativa o modo loop")
    async def loop(self, interaction: discord.Interaction):
        if not self.is_user_in_voice(interaction):
            await interaction.response.send_message("❌ Você precisa estar em um canal de voz!")
            return
        
        self.loop_mode = not self.loop_mode
        status = "ativado" if self.loop_mode else "desativado"
        emoji = "🔁" if self.loop_mode else "➡️"
        
        embed = discord.Embed(
            title=f"{emoji} Loop {status}",
            description=f"Modo loop **{status}**",
            color=0x9932cc if self.loop_mode else 0x808080
        )
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="queue", description="Mostra a fila de músicas")
    async def queue_command(self, interaction: discord.Interaction):
        if not self.queue:
            embed = discord.Embed(
                title="📝 Fila vazia",
                description="Nenhuma música na fila",
                color=0x808080
            )
        else:
            queue_list = "\n".join([f"{i+1}. {song['title']}" for i, song in enumerate(list(self.queue)[:10])])
            if len(self.queue) > 10:
                queue_list += f"\n... e mais {len(self.queue) - 10} músicas"
            
            embed = discord.Embed(
                title="📝 Fila de músicas",
                description=queue_list,
                color=0x0099ff
            )
        
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="stop", description="Para a música e limpa a fila")
    async def stop(self, interaction: discord.Interaction):
        if not self.is_user_in_voice(interaction):
            await interaction.response.send_message("❌ Você precisa estar em um canal de voz!")
            return
        
        if self.voice_client:
            self.queue.clear()
            self.current = None
            self.loop_mode = False
            
            if self.voice_client.is_playing():
                # Parada deliberada (ver `stop_music`).
                self._invalidar_player()
                self.voice_client.stop()

            await self.voice_client.disconnect()
            self.voice_client = None

    # Métodos utilitários para integração externa
    def get_loop_mode(self) -> bool:
        """Retorna o estado atual do modo loop (para sincronização externa)."""
        return bool(self.loop_mode)

    def toggle_loop_external(self) -> bool:
        """Alterna o modo loop (uso externo, sem interação/embeds) e retorna o estado atual."""
        self.loop_mode = not self.loop_mode
        return self.loop_mode

    async def play_url_direct(self, url: str, channel, start_seconds: int = 0):
        """Método de compatibilidade para tocar URL diretamente, com tempo inicial opcional."""
        try:
            log_debug(f"[DEBUG] play_url_direct chamado para: {url} (start_seconds={start_seconds})")
            # Conecta ao canal se necessário
            voice_client = discord.utils.get(self.bot.voice_clients, guild=channel.guild)
            if not voice_client:
                log_debug(f"[DEBUG] Conectando ao canal: {channel.name}")
                voice_client = await channel.connect()
            elif voice_client.channel != channel:
                log_debug(f"[DEBUG] Movendo para canal: {channel.name}")
                await voice_client.move_to(channel)
            
            self.voice_client = voice_client
            start_seconds = max(0, int(start_seconds or 0))
            
            # Se não está tocando, tocar imediatamente com cache/extração única
            if not self.voice_client.is_playing():
                log_debug(f"[DEBUG] Criando source para: {url} no tempo {start_seconds}s")
                try:
                    source = await self._create_source_from_url(url, start_seconds=start_seconds)
                    if isinstance(source, dict) and source.get('error'):
                         raise Exception(source.get('message'))
                    duration = int(getattr(source, 'data', {}).get('duration') or 0)
                    
                    self.current = {
                        'title': source.title,
                        'url': url,
                        'start_seconds': start_seconds,
                        'duration': duration
                    }
                    log_debug(f"[DEBUG] Iniciando playback: {source.title}")
                    self._tocar_fonte(source)
                    self._track_started_at = time.monotonic()
                    if self.song_started_callback:
                        try:
                            self.song_started_callback(dict(self.current))
                        except Exception as e:
                            log_debug(f"Erro no callback de início (direct): {e}")
                except Exception as e:
                    log_debug(f"[ERRO] Falha ao criar source ou tocar: {e}")
                    raise e
            else:
                # Se já está tocando, apenas enfileirar sem extrair agora
                log_debug(f"[DEBUG] Já tocando. Adicionando à fila: {url} (start={start_seconds}s)")
                cached = self.cache.stream_cache.get(url)
                title = cached.get('title') if cached else url
                duration = int(cached.get('duration') or 0) if cached else 0
                self.queue.append({
                    'title': title,
                    'url': url,
                    'start_seconds': start_seconds,
                    'duration': duration
                })
                
        except Exception as e:
            log_debug(f"[ERRO CRÍTICO] play_url_direct falhou: {e}")
            import traceback
            traceback.print_exc()

    async def seek_to(self, seconds: int):
        """Move a faixa atual para um ponto específico em segundos."""
        if not self.voice_client or not self.current:
            return

        target = max(0, int(seconds or 0))
        source = await self._create_source_from_url(self.current['url'], start_seconds=target)

        if self.voice_client.is_playing() or self.voice_client.is_paused():
            # Aposenta o player velho ANTES do stop: o `after` dele pode chegar
            # na janela entre o stop e o play abaixo.
            self._invalidar_player()
            self.voice_client.stop()

        self.current['start_seconds'] = target
        if not self.current.get('duration'):
            self.current['duration'] = int(getattr(source, 'data', {}).get('duration') or 0)
        self._tocar_fonte(source)
        self._track_started_at = time.monotonic()
        if self.song_started_callback:
            try:
                self.song_started_callback(dict(self.current))
            except Exception as e:
                log_debug(f"Erro no callback de seek: {e}")
    
    async def skip_music(self):
        """Método de compatibilidade para pular música"""
        if self.voice_client and self.voice_client.is_playing():
            # Apenas parar; o callback 'after' avançará sozinho
            self.voice_client.stop()
    
    async def stop_music(self):
        """Método de compatibilidade para parar música"""
        if self.voice_client:
            self.queue.clear()
            self.current = None
            self.loop_mode = False

            if self.voice_client.is_playing():
                # Parada deliberada: o `after` desse player não pode acordar o
                # `play_next_auto` depois que já limpamos fila/faixa.
                self._invalidar_player()
                self.voice_client.stop()
            
            await self.voice_client.disconnect()
            self.voice_client = None

# Configuração do bot
intents = discord.Intents.default()
# Desativa message_content para reduzir eventos desnecessários
intents.message_content = False
intents.voice_states = True

bot = commands.Bot(command_prefix='!', intents=intents)

@bot.event
async def on_ready():
    pass  # Removido print para reduzir logs

@bot.event
async def on_voice_state_update(member, before, after):
    if member == bot.user:
        return
    
    # Auto-join para gedasiosaga
    user_names = [member.name.lower(), member.display_name.lower()]
    if hasattr(member, 'global_name') and member.global_name:
        user_names.append(member.global_name.lower())
    
    if any("gedasiosaga" in name for name in user_names) and after.channel and not before.channel:
        voice_client = discord.utils.get(bot.voice_clients, guild=member.guild)
        if not voice_client:
            try:
                await after.channel.connect()
            except:
                pass
        elif voice_client.channel != after.channel:
            try:
                await voice_client.move_to(after.channel)
            except:
                pass
    
    # Auto-leave quando sozinho
    voice_client = discord.utils.get(bot.voice_clients, guild=member.guild)
    if voice_client and voice_client.channel and len(voice_client.channel.members) == 1:
        # Não desconectar automaticamente enquanto estiver reproduzindo
        music_cog = bot.get_cog('MusicBot')
        if music_cog and music_cog.voice_client and music_cog.voice_client.is_playing():
            return
        await voice_client.disconnect()

# Setup
async def setup_hook():
    await bot.add_cog(MusicBot(bot))
    try:
        await bot.tree.sync()
    except:
        pass
    # Pré-aquecer cache de favoritos em background
    cog = bot.get_cog('MusicBot')
    if cog:
        bot.loop.create_task(prewarm_favorites(bot, cog.cache))

bot.setup_hook = setup_hook

if __name__ == '__main__':
    bot.run(TOKEN)