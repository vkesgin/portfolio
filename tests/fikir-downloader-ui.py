"""Fikir shared downloader: card and paste flows do not write board records."""
import http.server,json,threading
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
class Static(http.server.SimpleHTTPRequestHandler):
 def __init__(self,*a,**kw):super().__init__(*a,directory=str(ROOT),**kw)
 def log_message(self,*a):pass
server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Static)
threading.Thread(target=server.serve_forever,daemon=True).start()
calls=[]
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000})
 page.add_init_script("localStorage.setItem('fikir_token','test-session');localStorage.setItem('fikir_user',JSON.stringify({guest:true,name:'Test'}))")
 def api(route):
  path=route.request.url.split('/api/',1)[1];calls.append((route.request.method,path,route.request.post_data))
  if path=='inspire/config':data={'session':'ok','media':{'download':True,'ig_copy':False,'copy_view':False,'live':False}}
  elif path.startswith('inspire/posts'):data=[{'id':1,'type':'youtube','url':'https://www.youtube.com/watch?v=jNQXAC9IVRw','description':'Test','created_at':'2026-10-23T10:00:00Z','author':'Test','notes':[],'meta':{'title':'Video'},'dl':{'video':False,'image':True,'reason':'youtube'}}]
  elif path=='inspire/video/analyze':data={'id':'a'*32}
  elif path=='inspire/video/jobs/'+'a'*32:data={'id':'a'*32,'status':'choices','choices':[{'id':'b'*32,'title':'Video','provider':'Generic','heights':[],'ad':False}]}
  else:data={'ok':True}
  route.fulfill(json=data)
 page.route('**/api/**',api)
 page.route('**youtube.com/embed/**',lambda r:r.abort())
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(f'http://127.0.0.1:{server.server_port}/fikir.html')
 page.locator('[data-action="download"]').first.wait_for(state='visible')
 page.locator('[data-action="download"]').first.click()
 page.locator('#vkd-choices button').wait_for()
 assert page.locator('#vkd-url').input_value().startswith('https://www.youtube.com/')
 assert any(p=='inspire/video/analyze' for m,p,d in calls)
 assert not any(m=='POST' and p.startswith('inspire/posts') for m,p,d in calls)
 assert page.locator('.gtranslate_wrapper').count()==0
 page.screenshot(path=str(ROOT/'tests/fikir-downloader-desktop.png'),full_page=True)
 page.set_viewport_size({'width':390,'height':844})
 page.screenshot(path=str(ROOT/'tests/fikir-downloader-mobile.png'),full_page=True)
 assert page.evaluate('document.documentElement.scrollWidth')<=390
 page.locator('#video-modal-close').click();assert page.locator('#video-modal').is_hidden()
 page.locator('#btn-video-tool').click();page.wait_for_timeout(100)
 assert page.locator('#vkd-url').input_value()==''
 page.locator('#video-modal-close').click()
 assert not errors,errors
 browser.close()
server.shutdown();server.server_close()
print('Fikir: YouTube card, paste tool, no board write, mobile layout, cleanup passed')
