"""In-memory status only; never forwards raw downloader logs, URLs or paths."""
import math
import queue
import re
import time


def number(value):
    return value if isinstance(value,(int,float)) and math.isfinite(value) and value>=0 else None


class Progress:
    def __init__(self, events):
        self.events=events
        self.last_emit=-math.inf  # the first event is never throttled
        self.last_transfer=None
        self.pending_activity=False
        self.too_large=False
        self.note=''  # standing remark shown with transfer stats (e.g. quality lowered to fit the limit)

    def emit(self, force=False, **data):
        now=time.monotonic()
        self.pending_activity=self.pending_activity or data.pop('activity',False)
        if not force and now-self.last_emit<.5:return
        data['activity']=self.pending_activity
        try:self.events.put_nowait(data)
        except queue.Full:return
        self.last_emit=now;self.pending_activity=False

    def debug(self,text):
        # Only classify known stage markers; arbitrary extractor output is discarded.
        text=str(text)
        if 'larger than max-filesize' in text.lower():self.too_large=True;return
        if 'retrying' in text.lower() or 'timed out' in text.lower():self.warning(text);return
        if 'Downloading webpage' in text:self.emit(phase='connecting',message='Kaynak sayfa açılıyor…')
        elif 'Downloading m3u8' in text or 'Downloading MPD' in text:
            self.emit(phase='manifest',message='Yayın listesi ve video parçaları bulunuyor…')
        elif 'Downloading' in text and 'API' in text:self.emit(phase='extracting',message='Oynatıcıdan video bilgileri alınıyor…')

    def warning(self,text):
        text=str(text).lower()
        if 'larger than max-filesize' in text:self.too_large=True;return
        if 'retry' in text or 'retrying' in text or 'timed out' in text:
            code=re.search(r'\b(401|403|404|429|500|502|503|504)\b',text)
            self.emit(force=True,phase='retrying',message='Kaynak yanıt vermedi; bağlantı yeniden deneniyor.',notice=('HTTP '+code[1]) if code else 'Bağlantı zaman aşımı veya geçici ağ hatası')
    def error(self,text):self.warning(text)

    def hook(self,data):
        state=data.get('status')
        info=data.get('info_dict') or {}
        stream='Ses' if info.get('vcodec')=='none' else 'Video'
        done=number(data.get('downloaded_bytes')) or 0
        total=number(data.get('total_bytes')) or number(data.get('total_bytes_estimate'))
        token=(info.get('format_id'),done,data.get('fragment_index'))
        activity=token!=self.last_transfer and done>0
        self.last_transfer=token
        if state=='downloading':
            self.emit(phase='downloading',message=stream+' indiriliyor…',activity=activity,
                progress=min(98,int(done/total*100)) if total else 0,
                downloaded_bytes=done,total_bytes=total,total_estimated=not bool(data.get('total_bytes')),
                speed=number(data.get('speed')),eta=number(data.get('eta')),
                fragment_index=number(data.get('fragment_index')),fragment_count=number(data.get('fragment_count')),
                stream=stream,notice=self.note)
        elif state=='finished':
            self.emit(force=True,phase='processing',message=stream+' akışı alındı; sonraki aşama hazırlanıyor…',activity=True,
                downloaded_bytes=done,total_bytes=total,speed=None,eta=None,progress=99,notice='')

    def postprocess(self,data):
        if data.get('status')=='started':
            audio='ExtractAudio' in str(data.get('postprocessor',''))
            if 'Remuxer' in str(data.get('postprocessor','')):
                self.emit(force=True,phase='processing',message='Dosya MP4 olarak paketleniyor…',activity=True,speed=None,eta=None,notice='');return
            self.emit(force=True,phase='processing',message='Ses MP3 biçimine dönüştürülüyor…' if audio else 'Ses ve görüntü birleştiriliyor; dosya tamamlanıyor…',activity=True,speed=None,eta=None,notice='')
