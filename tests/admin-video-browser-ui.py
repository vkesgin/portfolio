"""UI fallback/control/mobile checks; service integration is tested separately."""
import base64
import http.server
import json
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class Static(http.server.SimpleHTTPRequestHandler):
    def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
    def log_message(self,*a):pass
http=http.server.ThreadingHTTPServer(('127.0.0.1',0),Static)
threading.Thread(target=http.serve_forever,daemon=True).start()
actions=[];deleted=[]
with sync_playwright() as p:
    browser=p.chromium.launch()
    page=browser.new_page(viewport={'width':1440,'height':1100})
    fixture=browser.new_page(viewport={'width':1024,'height':640})
    fixture.set_content('<body style="background:#181818;color:white;font:24px sans-serif;display:grid;place-items:center"><button style="padding:30px">▶ Videoyu oynat</button></body>')
    frame=base64.b64encode(fixture.screenshot(type='jpeg')).decode();fixture.close()
    def api(route):
        path=route.request.url.split('/api/',1)[1]
        if path=='auth/login':data={'token':'ui-fixture'}
        elif path=='projects':data=[]
        elif path=='admin/video/analyze':data={'id':'a'*32}
        elif path=='admin/video/jobs/'+'a'*32:data={'id':'a'*32,'status':'error','message':'Video bulunamadı.'}
        elif path=='admin/video/browser':data={'id':'b'*32}
        elif path=='admin/video/browser/'+'b'*32+'/action':
            action=route.request.post_data_json;actions.append(action)
            data={'image':frame,'url':'https://fixture.example/player','width':1024,'height':640,'choices':[]}
            if any(a['action']=='click' for a in actions):data['choices']=[{'id':'c'*32,'title':'Test videosu','provider':'fixture.example','ad':False,'heights':[]}]
        elif route.request.method=='DELETE':deleted.append(path);data={'ok':True}
        else:data={}
        route.fulfill(json=data)
    page.route('https://vk-portfolio-api.vkesgin38.workers.dev/api/**',api)
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(f'http://127.0.0.1:{http.server_port}/admin.html')
    page.locator('#loginPass').fill('test');page.locator('#loginBtn').click()
    page.locator('[data-tab="video"]').click()
    page.locator('#vkd-url').fill('https://fixture.example/player');page.locator('#vkd-submit').click()
    page.locator('#vkd-screen').wait_for(state='visible')
    page.locator('#vkd-screen').click(position={'x':100,'y':80})
    page.locator('#vkd-browser-choices button').wait_for()
    assert any(a['action']=='click' for a in actions)
    page.screenshot(path=str(ROOT/'tests/admin-video-browser-desktop.png'),full_page=True)
    page.set_viewport_size({'width':390,'height':844})
    page.screenshot(path=str(ROOT/'tests/admin-video-browser-mobile.png'),full_page=True)
    assert page.evaluate('document.documentElement.scrollWidth')<=390
    page.locator('#vkd-down').click();page.wait_for_timeout(1800)
    assert any(a['action']=='scroll' for a in actions)
    page.locator('#vkd-close-browser').click();page.wait_for_timeout(400)
    assert page.locator('#vkd-browser').is_hidden();assert 'admin/video/jobs/'+'b'*32 in deleted
    assert not errors,errors
    browser.close()
http.shutdown();http.server_close()
print('Fallback, remote click, media choices, mobile scrolling, cleanup: passed')
