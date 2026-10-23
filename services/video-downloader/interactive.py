"""Ephemeral, remotely controlled browser. Frames and cookies live only in memory."""
import base64
import os
import queue
import re
import time
import uuid
from urllib.parse import urlsplit
from tasks import ad

WIDTH, HEIGHT = 1024, 640
KEYS = {'Enter', 'Space', 'Tab', 'Shift+Tab', 'Escape', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'}


def browser_process(commands, replies, url, proxy, directory):
    os.setsid()
    for name in list(os.environ):
        if any(s in name for s in ('SECRET','TOKEN','PASSWORD','API_KEY','RAILWAY_')):
            os.environ.pop(name,None)
    from playwright.sync_api import sync_playwright
    try:
        with sync_playwright() as p:
            context=p.chromium.launch_persistent_context(directory,viewport={'width':WIDTH,'height':HEIGHT},accept_downloads=False,service_workers='block',headless=True,proxy={'server':proxy},args=['--proxy-bypass-list=<-loopback>','--disable-dev-shm-usage','--force-webrtc-ip-handling-policy=disable_non_proxied_udp'])
            page=context.new_page()
            found={}
            def response(r):
                try:
                    ct=r.headers.get('content-type','').lower()
                    path=urlsplit(r.url).path.lower()
                    if r.status not in (200,206) or r.url in found or len(found)>=20 or ad(r.url):return
                    if path.endswith(('.ts','.m4s','.aac','.m4a')):return
                    if not (path.endswith(('.mp4','.webm','.m3u8','.mpd','.mov')) or ct.startswith('video/') or 'mpegurl' in ct or 'dash+xml' in ct):return
                    if path.endswith(('.m3u8','.mpd')) or 'mpegurl' in ct or 'dash+xml' in ct:
                        if re.search(r'widevine|playready|ContentProtection|METHOD=SAMPLE-AES',r.text()[:1048576],re.I):return
                    headers={k:v for k,v in r.request.all_headers().items() if k in ('referer','user-agent','origin','authorization')}
                    found[r.url]={'id':uuid.uuid4().hex,'url':r.url,'headers':headers}
                except Exception:pass
            context.on('response',response)
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
                    screenshot=base64.b64encode(page.screenshot(type='jpeg',quality=55,timeout=5000)).decode()
                    title=page.title()[:250] or 'Bulunan video'
                    cookies=context.cookies()
                    choices=[{'public':{'id':c['id'],'title':title+' · '+str(i+1),'provider':urlsplit(c['url']).hostname or 'Tarayıcı','ad':False,'heights':[]},'info':{'_browser_source':True,'url':page.url if (urlsplit(page.url).hostname or '').endswith('.youtube.com') or urlsplit(page.url).hostname in ('youtube.com','youtu.be') else c['url'],'http_headers':c['headers'],'title':title},'cookies':cookies} for i,c in enumerate(found.values())]
                    replies.put({'image':screenshot,'url':page.url,'width':WIDTH,'height':HEIGHT,'choices':choices},timeout=2)
                except Exception:
                    replies.put({'error':'Sayfa yanıt vermedi. Yenile düğmesini deneyebilirsin.'},timeout=2)
            context.close()
    except Exception:
        try:replies.put({'error':'Tarayıcı oturumu sona erdi. Yeniden aç.'},timeout=1)
        except Exception:pass
