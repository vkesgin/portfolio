import asyncio
from contextlib import asynccontextmanager
import hmac
import multiprocessing as mp
import os
from pathlib import Path
import queue
import shutil
import signal
import tempfile
import threading
import time
import uuid
from urllib.parse import quote, urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from egress import ProxyServer, Proxy, public_addresses
from tasks import execute, MAX_BYTES

TOKEN=os.environ.get('VIDEO_BACKEND_TOKEN','')
RETENTION=600
LOCK=threading.RLock()
JOBS={}
SOURCES={}
ROOT=None
PROXY=None
CTX=mp.get_context('spawn')


def terminate(job):
    process=job.get('_process')
    if process:
        if process.is_alive():
            try:os.killpg(process.pid,signal.SIGKILL)
            except ProcessLookupError:pass
        process.join(timeout=2)
    shutil.rmtree(job.get('_dir',''),ignore_errors=True)


def erase(ident):
    with LOCK:
        job=JOBS.pop(ident,None)
        for key in [k for k,v in SOURCES.items() if v.get('owner')==ident]:
            SOURCES.pop(key,None)
    if job:terminate(job)


def sweep():
    now=time.monotonic()
    with LOCK:
        old=[k for k,j in JOBS.items() if j['expires']<now]
        for k in [k for k,v in SOURCES.items() if v['expires']<now]:SOURCES.pop(k,None)
    for key in old:erase(key)


@asynccontextmanager
async def lifespan(app):
    global PROXY, ROOT
    ROOT=Path(tempfile.mkdtemp(prefix='vk-video-'))
    PROXY=ProxyServer(('127.0.0.1',0),Proxy)
    threading.Thread(target=PROXY.serve_forever,daemon=True).start()
    async def cleanup():
        while True:
            await asyncio.sleep(15)
            await asyncio.to_thread(sweep)
    task=asyncio.create_task(cleanup())
    try:yield
    finally:
        task.cancel()
        for ident in list(JOBS):erase(ident)
        PROXY.shutdown();PROXY.server_close()
        shutil.rmtree(ROOT,ignore_errors=True)

app=FastAPI(lifespan=lifespan,docs_url=None,redoc_url=None,openapi_url=None)

@app.middleware('http')
async def access(request,call_next):
    if request.url.path!='/health':
        if len(TOKEN)<32:return JSONResponse({'error':'İndirme motorunun bağlantısı henüz yapılandırılmadı.'},status_code=503)
        provided=request.headers.get('authorization','')
        if not hmac.compare_digest(provided,'Bearer '+TOKEN):return JSONResponse({'error':'Yetkisiz'},status_code=401)
    response=await call_next(request)
    response.headers['Cache-Control']='no-store, private'
    response.headers['X-Content-Type-Options']='nosniff'
    return response

@app.exception_handler(ValueError)
async def bad_value(request,exc):return JSONResponse({'error':str(exc)},status_code=400)

class Analyze(BaseModel):
    url:str=Field(max_length=8192)
    mode:str='analyze'
class Download(BaseModel):
    source_id:str=Field(max_length=40)
    quality:str='best'


def valid_url(value):
    value=value.strip()
    p=urlsplit(value)
    if p.scheme not in ('http','https') or not p.hostname or p.username or p.password or (p.port and p.port not in (80,443)):
        raise ValueError('Geçerli bir http(s) video bağlantısı gir.')
    try:
        public_addresses(p.hostname,p.port or (443 if p.scheme=='https' else 80))
    except OSError:
        raise ValueError('Bağlantının sunucusu bulunamadı.')
    return value


def monitor(ident,events,mode):
    limit=900 if mode=='download' else 100
    deadline=time.monotonic()+limit
    job=JOBS[ident]
    got_result=False
    while time.monotonic()<deadline:
        with LOCK:
            if ident not in JOBS:return
        try:
            disk_bytes=sum(p.stat().st_size for p in Path(job['_dir']).rglob('*') if p.is_file())
        except OSError:
            return
        if disk_bytes>MAX_BYTES*2:
            job.update(status='error',message='Dosya boyutu sınırı aşıldı.')
            break
        try:data=events.get(timeout=.5)
        except queue.Empty:
            if not job['_process'].is_alive():
                # Queue messages can arrive just after the process exits.
                try:data=events.get(timeout=.5)
                except queue.Empty:break
            else:continue
        with LOCK:
            if ident not in JOBS:return
            result=data.get('result')
            if result=='choices':
                public=[]
                for choice in data['choices']:
                    SOURCES[choice['public']['id']]={**choice,'owner':ident,'expires':time.monotonic()+RETENTION}
                    public.append(choice['public'])
                job.update(status='choices',choices=public,message='İndirmek istediğin videoyu seç.',expires=time.monotonic()+RETENTION)
                got_result=True;break
            if result=='file':
                job.update(status='ready',progress=100,message='Video hazır.',name=data['name'],bytes=data['bytes'],_path=data['path'],expires=time.monotonic()+RETENTION)
                got_result=True;break
            if result=='error':
                job.update(status='error',message=data['message'],expires=time.monotonic()+RETENTION)
                got_result=True;break
            job.update({k:v for k,v in data.items() if k in ('message','progress')})
    job['_process'].join(timeout=1)
    if not got_result:
        job.update(status='error',message='İşlem tamamlanamadı veya süre sınırına ulaştı.',expires=time.monotonic()+RETENTION)
    if job['status']!='ready':terminate(job)
    events.close()


def start(mode,payload,title):
    sweep()
    with LOCK:
        if sum(j['status']=='running' for j in JOBS.values())>=2:raise HTTPException(429,'İki işlem sürüyor. Birinin bitmesini bekle.')
        if len(JOBS)>=50 or len(SOURCES)>=100:raise HTTPException(429,'Geçici işlem alanı dolu. Birkaç dakika sonra tekrar dene.')
        ident=uuid.uuid4().hex
        directory=ROOT/ident;directory.mkdir(mode=0o700)
        events=CTX.Queue(maxsize=200)
        proxy=f'http://127.0.0.1:{PROXY.server_address[1]}'
        process=CTX.Process(target=execute,args=(events,mode,payload,proxy,str(directory)),daemon=False)
        JOBS[ident]=dict(id=ident,status='running',title=title,progress=0,message='Hazırlanıyor…',expires=time.monotonic()+1200,_dir=str(directory),_process=process)
        process.start()
    threading.Thread(target=monitor,args=(ident,events,mode),daemon=True).start()
    return {'id':ident}

@app.get('/health')
def health():return {'ok':True,'service':'vk-video-downloader','persistent_storage':False,'configured':len(TOKEN)>=32}

@app.post('/v1/analyze')
def analyze(data:Analyze):
    if data.mode not in ('analyze','scan'):raise ValueError('Geçersiz tespit yöntemi.')
    return start(data.mode,{'url':valid_url(data.url)},'Video aranıyor')

@app.post('/v1/download')
def download(data:Download):
    if data.quality not in ('best','2160','1080','720','480','audio'):raise ValueError('Geçersiz kalite.')
    sweep()
    with LOCK:
        source=SOURCES.get(data.source_id)
        if not source:raise HTTPException(410,'Video bağlantısının süresi doldu. Yeniden bul.')
        if source['public']['ad']:raise ValueError('Reklam işareti taşıyan akış indirilmez.')
        payload={'info':source['info'],'cookies':source['cookies'],'quality':data.quality}
    return start('download',payload,source['public']['title'])

@app.get('/v1/jobs/{ident}')
def state(ident:str):
    sweep()
    with LOCK:
        job=JOBS.get(ident)
        if not job:raise HTTPException(404,'İşlem bulunamadı veya temizlendi.')
        return {k:v for k,v in job.items() if not k.startswith('_') and k!='expires'}

@app.delete('/v1/jobs/{ident}')
def cancel(ident:str):
    erase(ident)
    return {'ok':True}

@app.post('/v1/files/{ident}')
def file(ident:str):
    with LOCK:
        job=JOBS.get(ident)
        if not job or job['status']!='ready':raise HTTPException(410,'Dosya hazır değil veya temizlendi.')
        job['status']='transferring'
        job['expires']=time.monotonic()+1800
        path=Path(job['_path'])
        if not path.is_file() or not path.resolve().is_relative_to(ROOT.resolve()):raise HTTPException(410,'Dosya temizlendi.')
    def chunks():
        try:
            with path.open('rb') as stream:
                while block:=stream.read(262144):yield block
        finally:erase(ident)
    return StreamingResponse(chunks(),media_type='application/octet-stream',headers={
        'Content-Length':str(path.stat().st_size),
        'Content-Disposition':"attachment; filename=video"+path.suffix+"; filename*=UTF-8''"+quote(path.name),
        'Cache-Control':'no-store, private'})

if __name__=='__main__':
    import uvicorn
    uvicorn.run(app,host='0.0.0.0',port=int(os.environ.get('PORT','8080')),access_log=False,log_level='critical')
