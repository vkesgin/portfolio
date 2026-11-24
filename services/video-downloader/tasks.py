"""Isolated extraction/download process. No saved accounts, history, or cookies."""
import copy
import math
import os
from pathlib import Path
import re
import time
import uuid
from urllib.parse import urlsplit
import yt_dlp
from progress import Progress

AD_HOSTS=('doubleclick.net','googlesyndication.com','googleadservices.com','adnxs.com','adsrvr.org','spotxchange.com','springserve.com','imasdk.googleapis.com')
AD_RE=re.compile(r'(^|[/_.?&=\-])(ads?|advertisement|preroll|midroll|postroll|vast|vpaid)([/_.?&=\-]|$)',re.I)
PROTOCOLS={'http','https','m3u8','m3u8_native','http_dash_segments'}
MAX_BYTES=int(os.environ.get('VIDEO_MAX_MB','1024'))*1024*1024
TOO_LARGE=f'Dosya {MAX_BYTES//1048576} MB sınırını aşıyor. Daha düşük bir kalite seçip tekrar dene.'

GENERIC='Video alınamadı. Bağlantıyı kontrol et. Bazı siteler indirme sunucusundan erişimi engeller.'

class Refused(ValueError):
    """A refusal whose text was written here for the user (never an upstream message)."""


class Quiet:
    def debug(self,*a):pass
    def warning(self,*a):pass
    def error(self,*a):pass


def ad(url):
    p=urlsplit(url)
    return bool(any(p.hostname==x or (p.hostname or '').endswith('.'+x) for x in AD_HOSTS) or AD_RE.search(p.path+'?'+p.query))


def options(proxy):
    return dict(logger=Quiet(),quiet=True,no_warnings=True,cachedir=False,noplaylist=True,
                playlistend=12,lazy_playlist=True,socket_timeout=18,retries=5,fragment_retries=10,file_access_retries=3,
                # Same resolution first; then the codecs every phone/QuickTime/TV can open (H.264 + AAC in MP4).
                # Higher resolutions that only exist as VP9/AV1 are still chosen.
                format_sort=['res','fps','vcodec:h264','acodec:aac'],
                proxy=proxy,enable_file_urls=False,hls_prefer_native=True,external_downloader={'default':'native'},
                js_runtimes={'node':{}},windowsfilenames=True,overwrites=False,
                max_filesize=MAX_BYTES,skip_unavailable_fragments=False,concurrent_fragment_downloads=5)


def filtered(info):
    item=copy.deepcopy(info)
    if item.get('formats'):
        item['formats']=[f for f in item['formats'] if f.get('protocol') in PROTOCOLS and not f.get('has_drm') and not ad(f.get('url',''))]
        if not item['formats']:
            raise Refused('DRM korumalı veya desteklenmeyen yayın.')
    elif item.get('protocol') not in PROTOCOLS:
        raise Refused('Bu yayın türü desteklenmiyor.')
    if item.get('has_drm'):
        raise Refused('Video DRM korumalı; desteklenmiyor.')
    if item.get('is_live'):
        raise Refused('Canlı yayın sürerken indirilemez; yayın bitip kayıt yayınlandığında tekrar dene.')
    return item


def finite(n):return isinstance(n,(int,float)) and math.isfinite(n)


def estimate(fmt,duration):
    """Bytes a format will take: declared size, else bitrate x duration, else unknown (None)."""
    for key in ('filesize','filesize_approx'):
        if finite(fmt.get(key)) and fmt[key]>0:return fmt[key]
    if finite(fmt.get('tbr')) and fmt['tbr']>0 and finite(duration) and duration>0:return fmt['tbr']*125*duration
    return None


def heights_that_fit(info,ceiling,room):
    """Heights to try, tallest first, starting at the tallest whose largest variant fits in `room` bytes.

    Formats of unknown size count as fitting; the download itself still enforces the limit, and the
    caller then moves on to the next height."""
    video=[f for f in info.get('formats',[]) if finite(f.get('height')) and f.get('vcodec')!='none']
    heights=sorted({int(f['height']) for f in video if not ceiling or f['height']<=ceiling},reverse=True)
    audio=max((estimate(f,info.get('duration')) or 0 for f in info.get('formats',[]) if f.get('vcodec')=='none'),default=0)
    for index,height in enumerate(heights):
        sizes=[estimate(f,info.get('duration')) for f in video if int(f['height'])==height]
        if all(s is None or s+audio<=room for s in sizes):return heights[index:]
    return heights[-1:]

def public(info,ident):
    return dict(id=ident,title=str(info.get('title') or 'Video')[:250],
                duration=info.get('duration') if finite(info.get('duration')) else None,
                heights=sorted({int(f['height']) for f in info.get('formats',[]) if finite(f.get('height'))},reverse=True),
                provider=info.get('extractor_key') or 'Web',ad=ad(info.get('webpage_url') or info.get('url') or ''),
                size=info.get('filesize') or info.get('filesize_approx'))


PLAY_JS="""() => {
  const videos=[...document.querySelectorAll('video')];
  videos.forEach(v=>{v.muted=true;const p=v.play();if(p&&p.catch)p.catch(()=>{})});
  return videos.map(v=>({src:v.currentSrc,duration:Number.isFinite(v.duration)?v.duration:null,height:v.videoHeight||null}));
}"""
# The biggest visible player (or embedded player frame) on the page: where a person would click to start it.
TARGET_JS="""() => {
  let best=null,area=0;
  for(const e of document.querySelectorAll('video,iframe,[class*="player" i],[id*="player" i]')){
    const r=e.getBoundingClientRect();
    const w=Math.min(r.right,innerWidth)-Math.max(r.left,0),h=Math.min(r.bottom,innerHeight)-Math.max(r.top,0);
    if(w<160||h<90)continue;
    const bonus=e.tagName==='VIDEO'?4:e.tagName==='IFRAME'?2:1;
    if(w*h*bonus>area){area=w*h*bonus;best={x:Math.max(r.left,0)+w/2,y:Math.max(r.top,0)+h/2};}
  }
  return best;
}"""


def scan_browser(url,proxy,directory,notify=lambda message:None):
    """Open the page in a throwaway headless browser, start its player, and collect the media it requests.

    Nobody watches or steers this browser: it is the automatic counterpart of the remote browser."""
    from playwright.sync_api import sync_playwright
    from interactive import MEDIA_EXT,SEGMENT_EXT,user_agent,whole_file
    found={};players={}
    with sync_playwright() as p:
        agent=user_agent(p)
        context=p.chromium.launch_persistent_context(str(Path(directory)/'browser-profile'),headless=True,accept_downloads=False,service_workers='block',
            viewport={'width':1280,'height':720},locale='tr-TR',timezone_id='Europe/Istanbul',**({'user_agent':agent} if agent else {}),
            proxy={'server':proxy},args=['--proxy-bypass-list=<-loopback>','--disable-dev-shm-usage','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--autoplay-policy=no-user-gesture-required','--mute-audio'])
        page=context.new_page()
        def response(r):
            try:
                ct=r.headers.get('content-type','').lower()
                path=urlsplit(r.url).path.lower()
                key=whole_file(r.url)
                if r.status not in (200,206) or key in found or len(found)>=16 or ad(r.url):return
                if path.endswith(SEGMENT_EXT):return
                manifest=path.endswith(('.m3u8','.mpd')) or 'mpegurl' in ct or 'dash+xml' in ct
                if not (manifest or path.endswith(MEDIA_EXT) or ct.startswith('video/')):return
                if manifest and re.search(r'widevine|playready|ContentProtection|METHOD=SAMPLE-AES',r.text()[:1024*1024],re.I):return
                headers={k:v for k,v in r.request.all_headers().items() if k in ('referer','user-agent','origin','authorization')}
                found[key]=dict(url=key,headers=headers,manifest=manifest)
            except Exception:pass
        context.on('response',response)
        context.on('dialog',lambda d:d.dismiss())
        # A click on the player may open an advert in a new tab; it must not take over the scan.
        context.on('page',lambda extra:extra.close() if extra is not page else None)
        try:page.goto(url,wait_until='domcontentloaded',timeout=20000)
        except Exception:pass
        notify('Sayfa açıldı; video oynatıcısı başlatılıyor…')
        quiet=0;seen=0
        for step in range(28):
            for frame in page.frames:
                try:
                    for video in frame.evaluate(PLAY_JS):
                        if video.get('src'):players[whole_file(video['src'])]=video
                except Exception:pass
            # Players that ignore play() need the click a person would make; repeat it a few times
            # for players that first show a poster or a consent layer.
            if not found and step in (3,8,14):
                try:
                    target=page.evaluate(TARGET_JS)
                    if target:page.mouse.click(target['x'],target['y'])
                except Exception:pass
            page.wait_for_timeout(750)
            quiet=quiet+1 if len(found)==seen else 0
            seen=len(found)
            # Stop once something was found and no new stream has appeared for three seconds.
            if found and quiet>=4:break
        try:title=page.title()[:250]
        except Exception:title=''
        cookies=context.cookies()
        context.close()
    return [{**v,'title':title or 'Bulunan video','player':players.get(v['url']),'cookies':cookies} for v in found.values()]


def rank(info,candidate):
    """Order what an unattended scan found: the page's main video is the longest, then the largest."""
    duration=info.get('duration') if finite(info.get('duration')) else (candidate.get('player') or {}).get('duration')
    sizes=[estimate(f,duration) or 0 for f in info.get('formats',[])] or [estimate(info,duration) or 0]
    height=max((int(f['height']) for f in info.get('formats',[]) if finite(f.get('height'))),default=0)
    return (duration if finite(duration) else 0,max(sizes),height,bool(candidate.get('manifest')))


def scan_entries(url,proxy,directory,opts,queue):
    """Scan the page unattended and return (info, cookies) pairs, best candidate first."""
    queue.put({'message':'Sayfa otomatik olarak açılıyor; video aranıyor…','activity':True})
    ranked=[]
    for candidate in scan_browser(url,proxy,directory,lambda message:queue.put({'message':message,'activity':True})):
        try:
            with yt_dlp.YoutubeDL({**opts,'http_headers':candidate['headers']}) as ydl:
                cookiejar(ydl,candidate['cookies'])
                item=filtered(ydl.extract_info(candidate['url'],download=False))
                item['title']=candidate['title']
                player=candidate.get('player') or {}
                if not finite(item.get('duration')) and finite(player.get('duration')):item['duration']=player['duration']
                # Downloads resolve this address again with the page's own headers and cookies.
                clean=ydl.sanitize_info(item)
                clean.update(_browser_source=True,url=candidate['url'],http_headers=candidate['headers'])
                ranked.append((rank(clean,candidate),clean,candidate['cookies']))
        except Exception:pass
    ranked.sort(key=lambda entry:entry[0],reverse=True)
    return [(info,cookies) for _,info,cookies in ranked]


def error_message(exc):
    if isinstance(exc,Refused):return str(exc)
    text=str(exc).lower()
    if 'drm' in text:return 'Video DRM korumalı; desteklenmiyor.'
    if 'larger than max-filesize' in text or 'file is larger' in text or 'sınırını aşıyor' in text:return TOO_LARGE
    if 'live event will begin' in text or 'premieres in' in text or 'is upcoming' in text:return 'Bu yayın henüz başlamadı.'
    if 'private video' in text or 'this video is private' in text or 'members-only' in text or 'members only' in text:return 'Video özel veya yalnızca üyelere açık; oturum olmadan indirilemez.'
    if 'age' in text and ('restrict' in text or 'confirm your age' in text):return 'Video yaş kısıtlamalı; kaynak site oturum istiyor.'
    if 'your country' in text or 'your region' in text or 'your location' in text or ('geo' in text and ('block' in text or 'restrict' in text)):return 'Video, indirme sunucusunun bulunduğu ülkede yayında değil (bölge kısıtı). Tarayıcındaki VPN sunucuya aktarılmaz.'
    if 'unavailable' in text or 'has been removed' in text or 'no longer available' in text or 'does not exist' in text:return 'Video kaldırılmış veya artık yayında değil.'
    if 'unsupported url' in text or 'no video formats found' in text or 'no media found' in text:return 'Bu sayfada indirilebilir video bulunamadı.'
    if 'confirm you' in text or 'not a bot' in text:return 'YouTube bu sunucudan gelen istekte doğrulama istiyor; şu an bu sunucudan indirilemiyor. Bir süre sonra tekrar dene.'
    if '403' in text or 'sign in' in text or 'login' in text or 'cookies' in text:return 'Kaynak site erişimi reddetti veya oturum istiyor (HTTP 401/403 olabilir). Tarayıcındaki VPN indirme sunucusuna aktarılmaz. Video bağlantısının süresi de dolmuş olabilir.'
    if '429' in text:return 'Kaynak site çok fazla istek nedeniyle bekletiyor (HTTP 429). Bir süre sonra tekrar dene.'
    if 'timed out' in text or 'timeout' in text:return 'Kaynak sunucu zamanında yanıt vermedi. Tarayıcındaki VPN bu sunucuya aktarılmaz; site sunucudan erişilemiyor olabilir.'
    if '404' in text:return 'Video veya video parçası bulunamadı (HTTP 404). Bağlantı eskimiş olabilir; videoyu yeniden bul.'
    if 'format' in text:return 'Seçilen kalite bu kaynakta yok. En iyi kalite seçeneğini dene.'
    if 'size' in text or 'boyut' in text:return 'Dosya indirme boyutu sınırını aşıyor.'
    return GENERIC


YOUTUBE_HOSTS=('youtu.be','youtube.com','www.youtube.com','m.youtube.com','music.youtube.com')
YOUTUBE_FALLBACK={'extractor_args':{'youtube':{'player_client':['android_vr','web_embedded','web_safari']}}}


def refreshable(info):
    """A page yt-dlp understood can be resolved again; a bare media URL found in the browser cannot."""
    url=info.get('webpage_url') or ''
    return bool(not info.get('_browser_source') and urlsplit(url).scheme in ('http','https')
                and (info.get('extractor_key') or 'Generic')!='Generic')


def download_fresh(opts,info,cookies):
    """Resolve the page again and download in the same session.

    Signed media URLs expire and some sites (YouTube audio, for one) answer 403 to a URL that was
    resolved by an earlier session, so the stored result of the search cannot always be replayed."""
    url=info['webpage_url']
    variants=[{}]+([YOUTUBE_FALLBACK] if (urlsplit(url).hostname or '') in YOUTUBE_HOSTS else [])
    failure=None
    for extra in variants:
        try:
            with yt_dlp.YoutubeDL({**opts,**extra}) as ydl:
                cookiejar(ydl,cookies)
                found=ydl.extract_info(url,download=False)
                if found.get('_type') in ('playlist','multi_video'):
                    entries=[e for e in (found.get('entries') or []) if e]
                    found=next((e for e in entries if e.get('id')==info.get('id')),entries[0] if entries else None)
                    if not found:raise Refused('Video kaldırılmış veya artık yayında değil.')
                ydl.process_ie_result(filtered(found),download=True)
                return
        except Refused:raise
        except Exception as exc:
            failure=exc
            if error_message(exc)==TOO_LARGE:raise
    raise failure


def cookiejar(ydl,cookies):
    import http.cookiejar
    for c in cookies:
        domain=c['domain']
        ydl.cookiejar.set_cookie(http.cookiejar.Cookie(0,c['name'],c['value'],None,False,domain,domain.startswith('.'),domain.startswith('.'),c.get('path') or '/',True,c.get('secure',False),int(c['expires']) if c.get('expires',-1)>0 else None,c.get('expires',-1)<=0,None,None,{}))


def execute(queue,mode,payload,proxy,directory):
    os.setsid()
    # The child needs no hosting/API credentials. Browsing stays isolated.
    for name in list(os.environ):
        if any(s in name for s in ('SECRET','TOKEN','PASSWORD','API_KEY','RAILWAY_')):
            os.environ.pop(name,None)
    try:
        report=Progress(queue)
        opts={**options(proxy),'logger':report}
        report.emit(force=True,phase='connecting',message='Kaynak sunucuya bağlanılıyor…',activity=True)
        if mode in ('analyze','scan'):
            entries=[];failure=None;scanned=mode=='scan'
            if mode=='analyze':
                queue.put({'message':'Video ve kalite seçenekleri bulunuyor…'})
                try:
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        try:info=ydl.extract_info(payload['url'],download=False)
                        except Exception:
                            host=urlsplit(payload['url']).hostname or ''
                            if host not in YOUTUBE_HOSTS:raise
                            fallback={**opts,**YOUTUBE_FALLBACK}
                            with yt_dlp.YoutubeDL(fallback) as alternate:
                                info=alternate.extract_info(payload['url'],download=False)
                        items=list(info.get('entries') or []) if info.get('_type') in ('playlist','multi_video') else [info]
                        for item in items[:12]:
                            if not item:continue
                            try:entries.append((ydl.sanitize_info(filtered(item)),[]))
                            except ValueError as refusal:
                                failure=refusal;continue
                except Exception as exc:
                    failure=exc
                # DRM and live refusals are final; anything else gets the unattended page scan.
                scanned=not entries and not isinstance(failure,Refused)
            if scanned:
                entries=scan_entries(payload['url'],proxy,directory,opts,queue)
            if not entries:
                if failure and error_message(failure)!=GENERIC and 'bulunamadı' not in error_message(failure):raise failure
                raise Refused('Bu sayfada indirilebilir video bulunamadı. Sayfa otomatik olarak da tarandı; video oturum, doğrulama veya DRM arkasında olabilir.')
            choices=[]
            for index,(info,cookies) in enumerate(entries):
                ident=uuid.uuid4().hex
                # `best` tells the page it may start this one without asking: the scan's top candidate.
                choices.append({'public':{**public(info,ident),'best':scanned and index==0},'info':info,'cookies':cookies})
            queue.put({'result':'choices','choices':choices})
            return
        report.emit(force=True,phase='resolving',message='İndirme bağlantısı ve seçilen kalite hazırlanıyor…',activity=True)
        info=payload['info']
        if info.get('_browser_source'):
            with yt_dlp.YoutubeDL({**opts,'http_headers':info.get('http_headers',{})}) as ydl:
                cookiejar(ydl,payload.get('cookies',[]))
                resolved=ydl.extract_info(info['url'],download=False)
                resolved['title']=info['title']
                # Keep sending the page's own headers (Referer above all) while downloading, too.
                opts['http_headers']=info.get('http_headers',{})
                info=ydl.sanitize_info(resolved)
        info=filtered(info)
        quality=payload['quality']
        # Take the best quality that fits under the size limit instead of failing on the largest one.
        ceiling=0 if quality in ('best','audio') else int(quality)
        tallest=max((int(f['height']) for f in info.get('formats',[]) if finite(f.get('height')) and (not ceiling or f['height']<=ceiling)),default=0)
        attempts=[None] if quality=='audio' else (heights_that_fit(info,ceiling,int(MAX_BYTES*.95)) or [None])
        paths=[]
        def progress(data):
            if data.get('downloaded_bytes',0)>MAX_BYTES:raise Refused(TOO_LARGE)
            height=(data.get('info_dict') or {}).get('height')
            if quality!='audio' and finite(height) and height<tallest:
                report.note=f'{MAX_BYTES//1048576} MB sınırına sığan en yüksek kalite indiriliyor: {int(height)}p (kaynakta {int(tallest)}p var).'
            report.hook(data)
        opts.update(outtmpl=str(Path(directory)/'%(title).120B.%(ext)s'),merge_output_format='mp4/mkv',progress_hooks=[progress],postprocessor_hooks=[report.postprocess],post_hooks=[lambda p:paths.append(p)])
        if quality=='audio':opts['postprocessors']=[{'key':'FFmpegExtractAudio','preferredcodec':'mp3','preferredquality':'192'}]
        # Streams merged into Matroska are repackaged (no re-encode) as MP4, which phones and QuickTime open.
        else:opts['postprocessors']=[{'key':'FFmpegVideoRemuxer','preferedformat':'mkv>mp4'}]
        path=None
        cookies=payload.get('cookies',[])
        def wipe():
            paths.clear()
            for leftover in Path(directory).iterdir():
                if leftover.is_file():leftover.unlink(missing_ok=True)
        # Audio alone is the case that most often needs a freshly resolved link; start there.
        fresh=quality=='audio' and refreshable(info)
        for index,height in enumerate(attempts[:4]):
            limit=f'[height<=?{height}]' if height else ''
            opts['format']='bestaudio/best' if quality=='audio' else f'bv*{limit}+ba/b{limit}'
            report.too_large=False;oversize=False
            while True:
                try:
                    if fresh:download_fresh(opts,info,cookies)
                    else:
                        with yt_dlp.YoutubeDL(opts) as ydl:
                            cookiejar(ydl,cookies)
                            ydl.process_ie_result(copy.deepcopy(info),download=True)
                    break
                except Exception as exc:
                    oversize=error_message(exc)==TOO_LARGE
                    if oversize:break
                    if isinstance(exc,Refused):raise
                    if fresh or not refreshable(info):
                        # Some hosts refuse the audio track on its own but serve it next to a video
                        # track: take the smallest video with it and keep only the sound.
                        if quality!='audio' or opts['format']!='bestaudio/best':raise
                        opts['format']='wv*+ba/w';wipe()
                        report.emit(force=True,phase='resolving',message='Ses tek başına alınamadı; videoyla birlikte indirilip sese çevriliyor…',activity=True,progress=0)
                        continue
                    # The stored link was refused or has expired: resolve the page again, once.
                    fresh=True;wipe()
                    report.emit(force=True,phase='resolving',message='Video bağlantısı yenileniyor; indirme yeniden deneniyor…',activity=True,progress=0)
            report.too_large=report.too_large or oversize
            path=next((Path(p).resolve() for p in reversed(paths) if Path(p).is_file()),None)
            if path and path.stat().st_size<=MAX_BYTES:break
            if not (report.too_large or path) or index+1>=len(attempts[:4]):break
            # Too large at this height: drop the partial files and try the next one down.
            path=None;wipe()
            report.emit(force=True,phase='resolving',message=f'Bu kalite {MAX_BYTES//1048576} MB sınırını aşıyor; bir alt kalite deneniyor…',activity=True,progress=0)
        if not path or not path.is_relative_to(Path(directory).resolve()):
            # yt-dlp skips (without raising) a format that is larger than max_filesize.
            raise Refused(TOO_LARGE if report.too_large else 'İndirme tamamlanamadı; dosya oluşmadı. Başka bir kalite seçip tekrar dene.')
        if path.stat().st_size>MAX_BYTES:raise Refused(TOO_LARGE)
        queue.put({'result':'file','path':str(path),'name':path.name,'bytes':path.stat().st_size})
    except Exception as exc:
        queue.put({'result':'error','message':error_message(exc)})
