"""Verify visible progress and that download errors survive browser fallback."""
import http.server,threading
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
ROOT=Path(__file__).resolve().parents[1]
class Static(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def log_message(self,*a):pass
http=http.server.ThreadingHTTPServer(('127.0.0.1',0),Static)
threading.Thread(target=http.serve_forever,daemon=True).start()
state={'poll':0};calls=[]
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1100,'height':900})
 def api(route):
  path=route.request.url.split('/api/admin/video',1)[-1];calls.append(path)
  # Admin is browser-first: the link opens the remote browser, which reports the found video.
  if path=='/browser':data={'id':'a'*32}
  elif path=='/browser/'+'a'*32+'/action':data={'image':'','url':'https://example.com/video','width':1024,'height':640,'choices':[{'id':'b'*32,'provider':'example.com','title':'Test video','ad':False,'kind':'file','duration':95,'size':7340032,'size_estimated':False,'heights':[720]}]}
  elif route.request.method=='DELETE':data={'ok':True}
  elif path=='/download':data={'id':'c'*32}
  elif path=='/jobs/'+'c'*32:
   state['poll']+=1
   data={'status':'running','mode':'download','phase':'downloading','message':'Video indiriliyor…','progress':47,'elapsed_seconds':65,'idle_seconds':2,'downloaded_bytes':52428800,'total_bytes':104857600,'speed':1048576,'eta':50,'fragment_index':47,'fragment_count':100}
   if state['poll']>=3:data.update(status='error',phase='error',message='Kaynak site erişimi reddetti (HTTP 403).')
  else:data=[]
  route.fulfill(json=data)
 page.add_init_script("sessionStorage.setItem('vk_admin_token','test')")
 page.route('https://vk-portfolio-api.vkesgin38.workers.dev/api/**',api)
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(f'http://127.0.0.1:{http.server_port}/admin.html')
 page.locator('[data-tab="video"]').click();page.locator('#vkd-url').fill('https://example.com/video');page.locator('#vkd-submit').click()
 expect(page.locator('#vkd-browser-choices')).to_contain_text('Süre: 1:35')
 page.locator('#vkd-browser-choices button').click()
 expect(page.locator('#vkd-details')).to_contain_text('Parça: 47 / 100')
 expect(page.locator('#vkd-details')).to_contain_text('Hız: 1.0 MB/sn')
 page.screenshot(path=str(ROOT/'tests/admin-video-progress.png'),full_page=True)
 expect(page.locator('#vkd-status')).to_contain_text('HTTP 403',timeout=10000)
 assert page.locator('#vkd-browser').is_hidden();assert calls.count('/browser')==1  # a failed download must not reopen the browser
 assert 'Hız:' not in page.locator('#vkd-details').inner_text()
 assert not errors,errors
 browser.close()
http.shutdown();http.server_close()
print('Progress bytes/speed/fragments/elapsed and preserved download failure: passed')
