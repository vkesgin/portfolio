"""Verify the automatic flow: best result downloads unasked, progress is visible, no browser opens by itself."""
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
  # Fully automatic: the engine finds the video (page scan included) and marks its top result `best`.
  if path=='/analyze':
   state['analyze']=state.get('analyze',0)+1;data={'id':('e' if state['analyze']==1 else 'd')*32}
  elif path=='/jobs/'+'e'*32:data={'status':'choices','choices':[{'id':'f'*32,'provider':'Generic','title':'Auto video','ad':False,'duration':95,'heights':[1080,720],'best':True},{'id':'9'*32,'provider':'Generic','title':'Short clip','ad':False,'duration':8,'heights':[360],'best':False}]}
  elif path=='/jobs/'+'d'*32:data={'status':'error','mode':'analyze','phase':'error','message':'Bu sayfada indirilebilir video bulunamadı.'}
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
 # No choice is asked for and no browser opens: the best result starts downloading by itself.
 expect(page.locator('#vkd-details')).to_contain_text('Parça: 47 / 100')
 expect(page.locator('#vkd-details')).to_contain_text('Hız: 1.0 MB/sn')
 assert '/download' in calls and page.locator('#vkd-choices button').count()==0
 page.screenshot(path=str(ROOT/'tests/admin-video-progress.png'),full_page=True)
 expect(page.locator('#vkd-status')).to_contain_text('HTTP 403',timeout=10000)
 assert page.locator('#vkd-browser').is_hidden();assert calls.count('/browser')==0  # nothing opens a browser on its own
 assert 'Hız:' not in page.locator('#vkd-details').inner_text()
 # A search that finds nothing reports it and only offers the manual browser; it does not open it.
 page.locator('#vkd-url').fill('https://example.com/nothing');page.locator('#vkd-submit').click()
 expect(page.locator('#vkd-status')).to_contain_text('bulunamadı')
 expect(page.locator('#vkd-caption')).to_contain_text('Tarayıcıyı aç')
 assert page.locator('#vkd-scan').is_visible() and page.locator('#vkd-browser').is_hidden() and calls.count('/browser')==0
 assert not errors,errors
 browser.close()
http.shutdown();http.server_close()
print('Automatic pick, progress bytes/speed/fragments, preserved failure, manual-only browser: passed')
