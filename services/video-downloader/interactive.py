"""Ephemeral, remotely controlled browser. Frames and cookies live only in memory."""
import base64
import os
import queue
import re
import time
import uuid
from urllib.parse import urlsplit
from tasks import ad
from urllib.parse import parse_qsl, urlencode, urlunsplit
from media_metadata import describe, enrich

WIDTH, HEIGHT = 1024, 640
MEDIA_EXT = ('.mp4', '.webm', '.m3u8', '.mpd', '.mov', '.m4v', '.mkv', '.flv', '.ogv')
SEGMENT_EXT = ('.ts', '.m4s', '.aac', '.m4a', '.cmfv', '.cmfa')
RANGE_PARAMS = {'bytestart', 'byteend', 'range', 'bytes'}


def whole_file(url):
    """Players fetch one file as many byte-range URLs; keep a single entry that addresses the whole file."""
    parts = urlsplit(url)
    query = [(k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k.lower() not in RANGE_PARAMS]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), ''))


def user_agent(playwright):
    """The bundled headless shell announces itself as HeadlessChrome, which many players refuse outright."""
    try:
        browser = playwright.chromium.launch(headless=True)
        try:major = browser.version.split('.')[0]
        finally:browser.close()
        return f'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{major}.0.0.0 Safari/537.36'
    except Exception:
        return None


KEYS = {'Enter', 'Space', 'Tab', 'Shift+Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'}


def browser_process(commands, replies, url, proxy, directory):
    os.setsid()
    for name in list(os.environ):
        if any(s in name for s in ('SECRET','TOKEN','PASSWORD','API_KEY','RAILWAY_')):
            os.environ.pop(name,None)
    from playwright.sync_api import sync_playwright
    try:
        with sync_playwright() as p:
            agent=user_agent(p)
            context=p.chromium.launch_persistent_context(directory,viewport={'width':WIDTH,'height':HEIGHT},locale='tr-TR',timezone_id='Europe/Istanbul',**({'user_agent':agent} if agent else {}),accept_downloads=False,service_workers='block',headless=True,proxy={'server':proxy},args=['--proxy-bypass-list=<-loopback>','--disable-dev-shm-usage','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
            page=context.new_page()
            found={}
            def response(r,finished=False):
                try:
                    ct=r.headers.get('content-type','').lower()
                    path=urlsplit(r.url).path.lower()
                    if r.status not in (200,206) or ad(r.url):return
                    key=whole_file(r.url)
                    if key not in found and len(found)>=20:return
                    if path.endswith(SEGMENT_EXT):return
                    kind='HLS' if path.endswith('.m3u8') or 'mpegurl' in ct else 'DASH' if path.endswith('.mpd') or 'dash+xml' in ct else 'file'
                    if not (path.endswith(MEDIA_EXT) or ct.startswith('video/') or kind!='file'):return
                    # Reading a manifest on response headers used to block controls until its body arrived.
                    # Only inspect completed manifests. Never read video bodies for metadata.
                    if kind!='file' and not finished:return
                    if key in found:return
                    text=r.text()[:1048576] if kind!='file' else ''
                    if re.search(r'widevine|playready|ContentProtection|METHOD=SAMPLE-AES',text,re.I):return
                    headers={k:v for k,v in r.request.all_headers().items() if k in ('referer','user-agent','origin','authorization')}
                    found[key]={'id':uuid.uuid4().hex,'url':key,'headers':headers,'frame':r.request.frame,'meta':describe(r.headers,text,kind)}
                except Exception:pass
            context.on('response',response)
            context.on('requestfinished',lambda request:response(request.response(),True))
            # Keep popups visible in the same remote viewport, without changing the admin page.
            def popup(new):
                nonlocal page
                page=new
            context.on('page',popup)
            context.on('dialog',lambda d:d.dismiss())
            try:page.goto(url,wait_until='commit',timeout=12000)
            except Exception:pass
            deadline=time.monotonic()+600
            while time.monotonic()<deadline:
                try:command=commands.get(timeout=.1)
                except queue.Empty:
                    page.wait_for_timeout(50)
                    continue
                action=command.get('action','frame')
                if action=='close':break
                try:
                    if page.is_closed():page=context.new_page()
                    if action=='click':page.mouse.click(command['x'],command['y'])
                    elif action=='scroll':page.mouse.wheel(0,command['delta'])
                    elif action=='text':page.keyboard.insert_text(command['text'])
                    elif action=='key':page.keyboard.press(command['key'])
                    elif action=='back':
                        previous=page.go_back(wait_until='commit',timeout=5000)
                        if previous is None and len(context.pages)>1:
                            page.close();page=context.pages[-1]
                    elif action=='reload':page.reload(wait_until='commit',timeout=5000)
                    page.wait_for_timeout(80)
                    screenshot=base64.b64encode(page.screenshot(type='jpeg',quality=40,timeout=5000)).decode()
                    title=page.title()[:250] or 'Bulunan video'
                    cookies=context.cookies()
                    choices=[]
                    frames={}
                    for c in found.values():
                        frame=c['frame']
                        if frame not in frames:
                            try:frames[frame]=frame.evaluate('() => [...document.querySelectorAll("video")].map(v=>({src:v.currentSrc,duration:Number.isFinite(v.duration)?v.duration:null,height:v.videoHeight}))')
                            except Exception:frames[frame]=[]
                    for i,c in enumerate(found.values()):
                        count=sum(other['frame']==c['frame'] for other in found.values())
                        metadata=enrich(c['meta'],frames.get(c['frame'],[]),c['url'],count)
                        choices.append({'public':{'id':c['id'],'title':title+' · '+str(i+1),'provider':urlsplit(c['url']).hostname or 'Tarayıcı','ad':False,**metadata},
                            'info':{'_browser_source':True,'url':page.url if (urlsplit(page.url).hostname or '').endswith('.youtube.com') or urlsplit(page.url).hostname in ('youtube.com','youtu.be') else c['url'],'http_headers':c['headers'],'title':title},'cookies':cookies})
                    replies.put({'image':screenshot,'url':page.url,'width':WIDTH,'height':HEIGHT,'choices':choices},timeout=2)
                except Exception:
                    replies.put({'error':'Sayfa yanıt vermedi. Yenile düğmesini deneyebilirsin.'},timeout=2)
            context.close()
    except Exception:
        try:replies.put({'error':'Tarayıcı oturumu sona erdi. Yeniden aç.'},timeout=1)
        except Exception:pass
