"""Best-effort metadata from already received headers/manifests; no extra requests."""
import math
import re


def finite(value):
    return value if isinstance(value,(int,float)) and math.isfinite(value) and value>0 else None


def describe(headers, text='', kind='file'):
    result={'kind':kind,'duration':None,'size':None,'size_estimated':False,'bitrate':None,'heights':[]}
    if kind=='file':
        total=re.search(r'/([0-9]+)$',headers.get('content-range',''))
        length=total[1] if total else headers.get('content-length','')
        if str(length).isdigit():result['size']=int(length) or None
    elif kind=='HLS':
        if '#EXT-X-ENDLIST' in text:
            result['duration']=sum(float(n) for n in re.findall(r'#EXTINF:([0-9.]+)',text)) or None
        rates=[int(n) for n in re.findall(r'(?<![\w-])BANDWIDTH=(\d+)',text)]
        result['bitrate']=max(rates) if rates else None
        result['heights']=sorted({int(n) for n in re.findall(r'RESOLUTION=\d+x(\d+)',text)},reverse=True)
    elif kind=='DASH':
        duration=re.search(r'mediaPresentationDuration=["\']PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?["\']',text)
        if duration:result['duration']=sum(float(n or 0)*m for n,m in zip(duration.groups(),[3600,60,1])) or None
        rates=[int(n) for n in re.findall(r'bandwidth=["\'](\d+)',text)]
        result['bitrate']=max(rates) if rates else None
        result['heights']=sorted({int(n) for n in re.findall(r'height=["\'](\d+)',text)},reverse=True)
    return result


def enrich(meta, videos, url, candidate_count):
    result=dict(meta)
    exact=[v for v in videos if v.get('src')==url]
    # Never assign one player's duration to several unrelated/ad streams.
    match=exact[0] if len(exact)==1 else videos[0] if len(videos)==1 and candidate_count==1 else None
    if match:
        result['duration']=finite(match.get('duration')) or result.get('duration')
        # A master playlist already lists every downloadable height; the player only reports the
        # variant it happens to be showing (often the lowest), so it must not replace that list.
        if finite(match.get('height')) and not result.get('heights'):result['heights']=[int(match['height'])]
    if not result.get('size') and result.get('duration') and result.get('bitrate'):
        result['size']=int(result['duration']*result['bitrate']/8)
        result['size_estimated']=True
    result.pop('bitrate',None)
    return result
