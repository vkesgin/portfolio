import unittest
from egress import allowed_port,connect_public
from interactive import whole_file
import tasks
from tasks import rank,estimate,heights_that_fit,error_message,Refused,TOO_LARGE,filtered,refreshable

MB=1048576
def video(height,**extra):return {'height':height,'vcodec':'avc1',**extra}

class HardeningTests(unittest.TestCase):
    def test_estimate_prefers_declared_size_then_bitrate(self):
        self.assertEqual(estimate({'filesize':10,'tbr':999},60),10)
        self.assertEqual(estimate({'filesize_approx':20},60),20)
        self.assertEqual(estimate({'tbr':8000},100),8000*125*100)
        self.assertIsNone(estimate({},100));self.assertIsNone(estimate({'tbr':8000},None))
    def test_tallest_quality_that_fits_is_tried_first(self):
        info={'duration':600,'formats':[video(2160,filesize=1300*MB),video(1440,filesize=700*MB),video(1080,filesize=300*MB),{'vcodec':'none','filesize':10*MB}]}
        self.assertEqual(heights_that_fit(info,0,1000*MB),[1440,1080])
        self.assertEqual(heights_that_fit(info,1080,1000*MB),[1080])
        self.assertEqual(heights_that_fit(info,0,2000*MB),[2160,1440,1080])
    def test_bitrate_only_formats_are_estimated_and_unknown_sizes_pass(self):
        hls={'duration':600,'formats':[video(2160,tbr=20000),video(720,tbr=2000)]}  # 1.5 GB vs 150 MB
        self.assertEqual(heights_that_fit(hls,0,1000*MB),[720])
        unknown={'formats':[video(1080),video(720)]}
        self.assertEqual(heights_that_fit(unknown,0,1000*MB),[1080,720])
    def test_nothing_fits_still_tries_the_smallest(self):
        info={'duration':10,'formats':[video(1080,filesize=5000*MB),video(480,filesize=3000*MB)]}
        self.assertEqual(heights_that_fit(info,0,1000*MB),[480])
        self.assertEqual(heights_that_fit({'formats':[]},0,1000*MB),[])
    def test_only_own_messages_reach_the_user(self):
        self.assertEqual(error_message(Refused('Özel mesaj')),'Özel mesaj')
        leaked=error_message(ValueError('https://private.example/?token=SECRET'))
        self.assertNotIn('SECRET',leaked);self.assertNotIn('private.example',leaked)
        self.assertEqual(error_message(Exception('File is larger than max-filesize (2 > 1)')),TOO_LARGE)
        self.assertIn('bölge',error_message(Exception('The uploader has not made this video available in your country')))
        self.assertIn('özel',error_message(Exception('Private video. Sign in if you have been granted access')).lower())
        self.assertIn('bulunamadı',error_message(Exception('Unsupported URL: https://x.example/')))
        self.assertIn('429',error_message(Exception('HTTP Error 429: Too Many Requests')))
    def test_live_and_drm_have_distinct_reasons(self):
        with self.assertRaises(Refused) as live:filtered({'protocol':'https','is_live':True})
        self.assertIn('Canlı',str(live.exception))
        with self.assertRaises(Refused) as drm:filtered({'protocol':'https','has_drm':True})
        self.assertIn('DRM',str(drm.exception))
    def test_byte_range_urls_collapse_to_one_whole_file(self):
        a=whole_file('https://cdn.example/v.mp4?sig=abc&bytestart=0&byteend=999')
        b=whole_file('https://cdn.example/v.mp4?sig=abc&bytestart=1000&byteend=1999')
        self.assertEqual(a,b);self.assertEqual(a,'https://cdn.example/v.mp4?sig=abc')
        self.assertEqual(whole_file('https://cdn.example/v.mp4?range=0-5#t=3'),'https://cdn.example/v.mp4')
        self.assertEqual(whole_file('https://cdn.example/a.m3u8?token=1'),'https://cdn.example/a.m3u8?token=1')
    def test_only_extractor_pages_can_be_resolved_again(self):
        self.assertTrue(refreshable({'webpage_url':'https://www.youtube.com/watch?v=x','extractor_key':'Youtube'}))
        self.assertFalse(refreshable({'webpage_url':'https://cdn.example/v.mp4','extractor_key':'Generic'}))
        self.assertFalse(refreshable({'webpage_url':'https://site.example/p','extractor_key':'Youtube','_browser_source':True}))
        self.assertFalse(refreshable({'extractor_key':'Youtube'}));self.assertFalse(refreshable({'webpage_url':'file:///etc/passwd','extractor_key':'X'}))
    def test_unprivileged_ports_are_allowed_but_service_ports_are_not(self):
        for port in (80,443,8080,8443,2053):self.assertTrue(allowed_port(port))
        for port in (22,25,110,993,0):self.assertFalse(allowed_port(port))
        with self.assertRaises(ValueError):connect_public('example.com',22)

class AutomaticScanTests(unittest.TestCase):
    def test_main_video_outranks_short_clips_and_previews(self):
        film=({'duration':600,'formats':[video(720,tbr=2000)]},{'manifest':True})
        teaser=({'duration':12,'formats':[video(1080,tbr=9000)]},{'manifest':False})
        unknown=({'formats':[]},{'player':{'duration':45}})
        ordered=sorted([teaser,unknown,film],key=lambda e:rank(*e),reverse=True)
        self.assertEqual(ordered,[film,unknown,teaser])
    def test_scan_results_are_ranked_and_replayable(self):
        class Fake:
            def __init__(self,opts):self.cookiejar=None
            def __enter__(self):return self
            def __exit__(self,*a):return False
            def extract_info(self,url,download=False):
                if 'broken' in url:raise RuntimeError('403')
                return {'url':url,'protocol':'https','duration':{'https://cdn.example/ad.mp4':15,'https://cdn.example/film.mp4':900}[url]}
            def sanitize_info(self,info):return dict(info)
        found=[dict(url=u,headers={'referer':'https://site.example/'},title='Sayfa',manifest=False,player=None,cookies=[]) for u in ('https://cdn.example/ad.mp4','https://cdn.example/broken.mp4','https://cdn.example/film.mp4')]
        saved=(tasks.scan_browser,tasks.yt_dlp.YoutubeDL,tasks.cookiejar)
        tasks.scan_browser=lambda *a,**k:found;tasks.yt_dlp.YoutubeDL=Fake;tasks.cookiejar=lambda *a:None
        try:
            class Q:
                def put(self,item):pass
            entries=tasks.scan_entries('https://site.example/watch','http://127.0.0.1:1','/tmp',{},Q())
        finally:tasks.scan_browser,tasks.yt_dlp.YoutubeDL,tasks.cookiejar=saved
        self.assertEqual([info['url'] for info,_ in entries],['https://cdn.example/film.mp4','https://cdn.example/ad.mp4'])
        self.assertTrue(entries[0][0]['_browser_source']);self.assertEqual(entries[0][0]['title'],'Sayfa')
        self.assertEqual(entries[0][0]['http_headers'],{'referer':'https://site.example/'})


class YoutubeTests(unittest.TestCase):
    def test_youtube_links_are_recognised_in_every_form(self):
        for url in ('https://www.youtube.com/watch?v=x','https://youtu.be/x','https://m.youtube.com/shorts/x','https://music.youtube.com/watch?v=x','https://WWW.YouTube.com/shorts/x'):
            self.assertTrue(tasks.youtube(url),url)
        for url in ('https://vimeo.com/1','https://notyoutube.com/watch?v=x','https://youtube.com.evil.example/x'):
            self.assertFalse(tasks.youtube(url),url)
    def test_every_fallback_asks_different_players(self):
        seen=[c for extra in tasks.YOUTUBE_FALLBACKS for c in extra['extractor_args']['youtube']['player_client']]
        self.assertEqual(len(seen),len(set(seen)));self.assertGreaterEqual(len(tasks.YOUTUBE_FALLBACKS),3)
    def test_verification_wall_is_explained_as_an_address_problem(self):
        self.assertIn('IP',error_message(Exception("Sign in to confirm you’re not a bot")))
        self.assertIn('IP',error_message(Exception("Sign in to confirm you're not a bot")))


if __name__=='__main__':unittest.main()
