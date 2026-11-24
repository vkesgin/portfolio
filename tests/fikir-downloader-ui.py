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
calls=[];state={'fail':False}
with sync_playwright() as p:
 browser=p.chromium.launch();page=browser.new_page(viewport={'width':1280,'height':1000})
 page.add_init_script("localStorage.setItem('fikir_token','test-session');localStorage.setItem('fikir_user',JSON.stringify({guest:true,name:'Test'}))")
 def api(route):
  path=route.request.url.split('/api/',1)[1];calls.append((route.request.method,path,route.request.post_data))
  if path=='inspire/config':data={'session':'ok','media':{'download':True,'ig_copy':False,'copy_view':False,'live':False}}
  elif path.startswith('inspire/posts'):data=[{'id':1,'type':'youtube','url':'https://www.youtube.com/watch?v=jNQXAC9IVRw','description':'Test','created_at':'2026-10-23T10:00:00Z','author':'Test','notes':[],'meta':{'title':'Video'},'dl':{'video':False,'image':True,'reason':'youtube'}}]
  elif path=='inspire/video/analyze':data={'id':'a'*32}
  elif path=='inspire/video/jobs/'+'a'*32 and state['fail']:data={'id':'a'*32,'status':'error','mode':'analyze','message':'Bu sayfada video bulunamadı.'}
  elif path=='inspire/video/jobs/'+'a'*32:data={'id':'a'*32,'status':'choices','choices':[{'id':'b'*32,'title':'Video','provider':'Generic','heights':[],'ad':False}]}
  elif path=='inspire/video/download':data={'id':'c'*32}
  elif path=='inspire/video/jobs/'+'c'*32:data={'id':'c'*32,'status':'ready','progress':100,'bytes':5}
  elif path=='inspire/video/ticket':data={'ticket':'t'*32}
  elif path=='inspire/video/file':return route.fulfill(body='video',headers={'Content-Type':'video/mp4','Content-Disposition':'attachment; filename="video.mp4"'})
  else:data={'ok':True}
  route.fulfill(json=data)
 page.route('**/api/**',api)
 page.route('**youtube.com/embed/**',lambda r:r.abort())
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(f'http://127.0.0.1:{server.server_port}/fikir.html')
 # A YouTube card has no file on the board: its "İndir" runs the download engine behind the button, no window opens.
 card=page.locator('.dl-btn[data-action="download"]').first;card.wait_for(state='visible')
 assert card.get_attribute('title')=='Videoyu indir'
 with page.expect_download() as got:card.click()
 assert got.value.suggested_filename=='video.mp4'
 page.get_by_text('İndirme başladı.').wait_for()
 assert page.locator('#video-modal').is_hidden()
 posted=[(p,json.loads(d)) for m,p,d in calls if m=='POST' and p in('inspire/video/analyze','inspire/video/download','inspire/video/ticket')]
 assert posted==[('inspire/video/analyze',{'url':'https://www.youtube.com/watch?v=jNQXAC9IVRw','mode':'analyze'}),('inspire/video/download',{'source_id':'b'*32,'quality':'best'}),('inspire/video/ticket',{'job_id':'c'*32})],posted
 assert any(p=='inspire/video/file' and d=='ticket='+'t'*32 for m,p,d in calls)
 page.wait_for_function("!document.querySelector('.dl-btn[aria-busy=\"true\"]')")
 # the search job is removed, the one that holds the file stays for the transfer
 assert ('DELETE','inspire/video/jobs/'+'a'*32,None) in calls and ('DELETE','inspire/video/jobs/'+'c'*32,None) not in calls
 # a failed search says why on the board and offers the tool
 state['fail']=True;card.click()
 page.get_by_text('Bu sayfada video bulunamadı.').first.wait_for()
 assert page.locator('#video-modal').is_hidden()
 page.get_by_role('button',name='Video aracında aç').click()
 page.locator('#video-modal').wait_for(state='visible')
 page.wait_for_function("document.getElementById('vkd-url').value==='https://www.youtube.com/watch?v=jNQXAC9IVRw'")
 state['fail']=False;page.locator('#video-modal-close').click();assert page.locator('#video-modal').is_hidden()
 # Instagram cards keep the board's own one-click download (9247539); the tool also opens from the header.
 page.locator('#btn-video-tool').click();page.wait_for_timeout(400)  # opening clears the field asynchronously
 page.locator('#vkd-url').fill('https://www.youtube.com/watch?v=jNQXAC9IVRw');page.locator('#vkd-submit').click()
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
print('Fikir: card download without the tool window, header tool, pasted YouTube link, no board write, mobile layout, cleanup passed')
