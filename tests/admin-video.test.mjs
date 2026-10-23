import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {handleVideoDownloader as handle} from '../worker/video-downloader.js';
const origin='https://velikesgin.com';
const env={ALLOWED_ORIGIN:origin,VIDEO_BACKEND_URL:'https://engine.example/',VIDEO_BACKEND_TOKEN:'test-token-'.repeat(6),JWT_SECRET:'unit-secret'};
const id='a'.repeat(32);
function req(path,body,extra={}){return new Request('https://api.example/api/admin/video'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},body:body===undefined?undefined:JSON.stringify(body)});}
const deps={authenticate:async()=>({role:'admin'}),sign:async p=>JSON.stringify(p),verify:async t=>JSON.parse(t),fetchImpl:async()=>{throw Error('unexpected network');}};
test('video gateway: admin role required; no upstream call for guest or another site',async()=>{
 for(const role of [null,{role:'user'}])assert.equal((await handle(req('/analyze',{url:'https://example.com/a'}),env,{...deps,authenticate:async()=>role})).status,401);
 assert.equal((await handle(req('/config',undefined,{Origin:'https://evil.example'}),env,deps)).status,403);
});
test('unconfigured engine is explicit, no public endpoint with missing secret',async()=>{
 const config=await handle(req('/config'),{},deps);assert.equal((await config.json()).configured,false);
 assert.equal((await handle(req('/analyze',{url:'https://example.com'}),{},deps)).status,503);
});
test('analysis validates URL and forwards only expected fields with server credential',async()=>{
 for(const url of ['file:///etc/passwd','javascript:alert(1)','https://u:p@example.com/a'])assert.equal((await handle(req('/analyze',{url}),env,deps)).status,400);
 let call;
 const result=await handle(req('/analyze',{url:'https://example.com/clip',mode:'scan',ignored:'x'}),env,{...deps,fetchImpl:async(u,init)=>{call={u,init};return Response.json({id});}});
 assert.equal(result.status,200);assert.equal(String(call.u),'https://engine.example/v1/analyze');
 assert.deepEqual(JSON.parse(call.init.body),{url:'https://example.com/clip',mode:'scan'});
 assert.equal(call.init.headers.Authorization,'Bearer '+env.VIDEO_BACKEND_TOKEN);
 assert.equal(result.headers.get('Cache-Control'),'no-store, private');
});
test('download quality, source IDs and route IDs are constrained',async()=>{
 assert.equal((await handle(req('/download',{source_id:id,quality:'shell-command'}),env,deps)).status,400);
 assert.equal((await handle(req('/download',{source_id:'../secrets'}),env,deps)).status,400);
 assert.equal((await handle(req('/jobs/../../secret'),env,deps))?.status,undefined);
});
test('tickets are scoped, short lived, and not the admin credential',async()=>{
 const result=await handle(req('/ticket',{job_id:id}),env,{...deps,fetchImpl:async()=>Response.json({status:'ready'})});
 const p=JSON.parse((await result.json()).ticket);
 assert.equal(p.scope,'video-download');assert.equal(p.job,id);assert.ok(p.exp>Date.now()&&p.exp<=Date.now()+90000);
});
test('file transfer uses POST body ticket; rejects expired, foreign, or malformed tickets',async()=>{
 for(const p of [{scope:'admin',job:id,exp:Date.now()+10000},{scope:'video-download',job:id,exp:Date.now()-1},{scope:'video-download',job:'wrong',exp:Date.now()+10000}]){
  const request=new Request('https://api.example/api/admin/video/file',{method:'POST',headers:{Origin:origin,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket:JSON.stringify(p)})});
  assert.equal((await handle(request,env,deps)).status,401);
 }
});
test('file streams without persistence; failed transfers do not reveal credentials',async()=>{
 const ticket=JSON.stringify({scope:'video-download',owner:'a'.repeat(64),job:id,exp:Date.now()+10000});
 const request=new Request('https://api.example/api/admin/video/file',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket})});
 const response=await handle(request,env,{...deps,fetchImpl:async(u,init)=>{assert.equal(init.method,'POST');assert.equal(new URL(u).pathname,'/v1/files/'+id);return new Response('video-data',{headers:{'Content-Disposition':'attachment; filename=test.mp4'}});}});
 assert.equal(await response.text(),'video-data');assert.match(response.headers.get('Content-Disposition'),/attachment/);
 const failure=await handle(req('/jobs/'+id),env,deps);assert.equal(failure.status,502);assert.ok(!(await failure.text()).includes(env.VIDEO_BACKEND_TOKEN));
});
test('downloader UI does not persist links; private service is excluded from site assets',()=>{
 const js=fs.readFileSync(new URL('../assets/js/admin-video.js',import.meta.url),'utf8');
 assert.doesNotMatch(js,/localStorage\.|sessionStorage\.|indexedDB\./);
 assert.match(fs.readFileSync(new URL('../.assetsignore',import.meta.url),'utf8'),/^\/services\//m);
 for(const p of ['../admin.html','../web-src/public/admin.html'])assert.match(fs.readFileSync(new URL(p,import.meta.url),'utf8'),/data-tab="video"/);
});
test('interactive browser controls require admin and use the fixed upstream path',async()=>{
 const route='/browser/'+id+'/action';
 assert.equal((await handle(req(route,{action:'frame'}),env,{...deps,authenticate:async()=>null})).status,401);
 assert.equal((await handle(req(route,{action:'evaluate',code:'unsafe'}),env,deps)).status,400);
 let call;
 const response=await handle(req(route,{action:'click',x:30,y:20}),env,{...deps,fetchImpl:async(u,init)=>{call={u,init};return Response.json({image:'jpeg',choices:[]});}});
 assert.equal(response.status,200);assert.equal(call.u,'https://engine.example/v1/browser/'+id+'/action');
 assert.deepEqual(JSON.parse(call.init.body),{action:'click',x:30,y:20});assert.match(response.headers.get('Cache-Control'),/no-store/);
});
test('Fikir uses its own session namespace and file tickets cannot cross into admin',async()=>{
 const fdeps={...deps,prefix:'/api/inspire/video',scope:'fikir-video-download'};
 const request=new Request('https://api.example/api/inspire/video/analyze',{method:'POST',headers:{Origin:origin,Authorization:'Bearer guest-session','Content-Type':'application/json'},body:JSON.stringify({url:'https://www.youtube.com/watch?v=jNQXAC9IVRw'})});
 let owner;
 const response=await handle(request,env,{...fdeps,fetchImpl:async(u,init)=>{owner=init.headers['X-Video-Owner'];return Response.json({id});}});
 assert.equal(response.status,200);assert.match(owner,/^[a-f0-9]{64}$/);
 const ticket=JSON.stringify({scope:'fikir-video-download',owner,job:id,exp:Date.now()+10000});
 const file=new Request('https://api.example/api/admin/video/file',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({ticket})});
 assert.equal((await handle(file,env,deps)).status,401);
});
