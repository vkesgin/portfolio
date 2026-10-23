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

AD_HOSTS=('doubleclick.net','googlesyndication.com','googleadservices.com','adnxs.com','adsrvr.org','spotxchange.com','springserve.com','imasdk.googleapis.com')
AD_RE=re.compile(r'(^|[/_.?&=\-])(ads?|advertisement|preroll|midroll|postroll|vast|vpaid)([/_.?&=\-]|$)',re.I)
PROTOCOLS={'http','https','m3u8','m3u8_native','http_dash_segments'}
MAX_BYTES=int(os.environ.get('VIDEO_MAX_MB','1024'))*1024*1024

class Quiet:
    def debug(self,*a):pass
    def warning(self,*a):pass
    def error(self,*a):pass


def ad(url):
    p=urlsplit(url)
    return bool(any(p.hostname==x or (p.hostname or '').endswith('.'+x) for x in AD_HOSTS) or AD_RE.search(p.path+'?'+p.query))


def options(proxy):
    return dict(logger=Quiet(),quiet=True,no_warnings=True,cachedir=False,noplaylist=True,
                playlistend=12,lazy_playlist=True,socket_timeout=18,retries=2,fragment_retries=3,
                proxy=proxy,enable_file_urls=False,hls_prefer_native=True,external_downloader={'default':'native'},
                js_runtimes={'node':{}},windowsfilenames=True,overwrites=False,
                max_filesize=MAX_BYTES,skip_unavailable_fragments=False,concurrent_fragment_downloads=3)


def filtered(info):
    item=copy.deepcopy(info)
    if item.get('formats'):
        item['formats']=[f for f in item['formats'] if f.get('protocol') in PROTOCOLS and not f.get('has_drm') and not ad(f.get('url',''))]
        if not item['formats']:
            raise ValueError('DRM korumalı veya desteklenmeyen yayın.')
    elif item.get('protocol') not in PROTOCOLS:
        raise ValueError('Bu yayın türü desteklenmiyor.')
    if item.get('has_drm') or item.get('is_live'):
        raise ValueError('DRM korumalı veya devam eden canlı yayın desteklenmiyor.')
    return item


def finite(n):return isinstance(n,(int,float)) and math.isfinite(n)

def public(info,ident):
    return dict(id=ident,title=str(info.get('title') or 'Video')[:250],
                duration=info.get('duration') if finite(info.get('duration')) else None,
                heights=sorted({int(f['height']) for f in info.get('formats',[]) if finite(f.get('height'))},reverse=True),
                provider=info.get('extractor_key') or 'Web',ad=ad(info.get('webpage_url') or info.get('url') or ''),
                size=info.get('filesize') or info.get('filesize_approx'))


def scan_browser(url,proxy,directory):
    from playwright.sync_api import sync_playwright
    found={}
    with sync_playwright() as p:
        context=p.chromium.launch_persistent_context(str(Path(directory)/'browser-profile'),headless=True,accept_downloads=False,proxy={'server':proxy},args=['--proxy-bypass-list=<-loopback>','--disable-dev-shm-usage','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
        page=context.new_page()
        def response(r):
            try:
                ct=r.headers.get('content-type','').lower()
                path=urlsplit(r.url).path.lower()
                if r.status not in (200,206) or r.url in found or len(found)>=16 or ad(r.url):return
                if path.endswith(('.ts','.m4s','.aac','.m4a')):return
                if not (path.endswith(('.mp4','.webm','.m3u8','.mpd','.mov')) or ct.startswith('video/') or 'mpegurl' in ct or 'dash+xml' in ct):return
                manifest=path.endswith(('.m3u8','.mpd')) or 'mpegurl' in ct or 'dash+xml' in ct
                if manifest and re.search(r'widevine|playready|ContentProtection|METHOD=SAMPLE-AES',r.text()[:1024*1024],re.I):return
                headers={k:v for k,v in r.request.all_headers().items() if k in ('referer','user-agent','origin','authorization')}
                found[r.url]=dict(url=r.url,headers=headers,title=page.title() or 'Bulunan video')
            except Exception:pass
        context.on('response',response)
        try:
            page.goto(url,wait_until='domcontentloaded',timeout=20000)
        except Exception:pass
        for _ in range(16):
            for frame in page.frames:
                try:frame.evaluate('() => document.querySelectorAll("video").forEach(v=>{v.muted=true;v.play().catch(()=>{})})')
                except Exception:pass
            page.wait_for_timeout(750)
        cookies=context.cookies()
        context.close()
    return [dict(**v,cookies=cookies) for v in found.values()]


def error_message(exc):
    text=str(exc).lower()
    if 'drm' in text:return 'Video DRM korumalı; desteklenmiyor.'
    if '403' in text or 'sign in' in text or 'login' in text or 'cookies' in text:return 'Kaynak site erişimi reddetti veya oturum istiyor. Sunucunun bağlantısı bu kaynağa erişemiyor.'
    if 'format' in text:return 'Seçilen kalite bu kaynakta yok. En iyi kalite seçeneğini dene.'
    if 'size' in text or 'boyut' in text:return 'Dosya indirme boyutu sınırını aşıyor.'
    return 'Video alınamadı. Bağlantıyı kontrol et veya tarayıcıyla tespiti dene. Bazı siteler sunucudan erişimi engeller.'


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
        opts=options(proxy)
        if mode in ('analyze','scan'):
            entries=[]
            if mode=='scan':
                queue.put({'message':'Sayfa geçici tarayıcıda inceleniyor…'})
                for candidate in scan_browser(payload['url'],proxy,directory):
                    try:
                        with yt_dlp.YoutubeDL({**opts,'http_headers':candidate['headers']}) as ydl:
                            cookiejar(ydl,candidate['cookies'])
                            item=filtered(ydl.extract_info(candidate['url'],download=False))
                            item['title']=candidate['title']
                            entries.append((ydl.sanitize_info(item),candidate['cookies']))
                    except Exception:pass
            else:
                queue.put({'message':'Video ve kalite seçenekleri bulunuyor…'})
                with yt_dlp.YoutubeDL(opts) as ydl:
                    info=ydl.extract_info(payload['url'],download=False)
                    items=list(info.get('entries') or []) if info.get('_type') in ('playlist','multi_video') else [info]
                    for item in items[:12]:
                        if not item:continue
                        try:entries.append((ydl.sanitize_info(filtered(item)),[]))
                        except ValueError:continue
            if not entries:raise ValueError('Video bulunamadı.')
            choices=[]
            for info,cookies in entries:
                ident=uuid.uuid4().hex
                choices.append({'public':public(info,ident),'info':info,'cookies':cookies})
            queue.put({'result':'choices','choices':choices})
            return
        info=payload['info']
        if info.get('_browser_source'):
            with yt_dlp.YoutubeDL({**opts,'http_headers':info.get('http_headers',{})}) as ydl:
                cookiejar(ydl,payload.get('cookies',[]))
                resolved=ydl.extract_info(info['url'],download=False)
                resolved['title']=info['title']
                info=ydl.sanitize_info(resolved)
        info=filtered(info)
        quality=payload['quality']
        fmt='bestaudio/best' if quality=='audio' else 'bv*+ba/b' if quality=='best' else f'bv*[height<=?{int(quality)}]+ba/b[height<=?{int(quality)}]'
        paths=[]
        def progress(data):
            if data['status']=='downloading':
                total=data.get('total_bytes') or data.get('total_bytes_estimate')
                if data.get('downloaded_bytes',0)>MAX_BYTES:raise ValueError('Dosya boyutu sınırı aşıldı.')

                try:queue.put_nowait({'progress':min(98,int(data.get('downloaded_bytes',0)/total*100)) if total else 0,'message':'Video hazırlanıyor…'})
                except __import__('queue').Full:pass
            elif data['status']=='finished':queue.put({'progress':99,'message':'Ses ve görüntü birleştiriliyor…'})
        opts.update(format=fmt,outtmpl=str(Path(directory)/'%(title).120B.%(ext)s'),merge_output_format='mp4/mkv',progress_hooks=[progress],post_hooks=[lambda p:paths.append(p)])
        if quality=='audio':opts['postprocessors']=[{'key':'FFmpegExtractAudio','preferredcodec':'mp3','preferredquality':'192'}]
        with yt_dlp.YoutubeDL(opts) as ydl:
            cookiejar(ydl,payload.get('cookies',[]))
            ydl.process_ie_result(info,download=True)
        path=next((Path(p).resolve() for p in reversed(paths) if Path(p).is_file()),None)
        if not path or not path.is_relative_to(Path(directory).resolve()) or path.stat().st_size>MAX_BYTES:
            raise ValueError('Dosya boyutu veya indirme hatası.')
        queue.put({'result':'file','path':str(path),'name':path.name,'bytes':path.stat().st_size})
    except Exception as exc:
        queue.put({'result':'error','message':error_message(exc)})
