import unittest
from media_metadata import describe,enrich

MASTER='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=1280x720\nhi.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200000,RESOLUTION=320x184\nlo.m3u8'

class MetadataTests(unittest.TestCase):
    def test_file_size_from_headers(self):
        self.assertEqual(describe({'content-range':'bytes 0-99/5000'})['size'],5000)
        self.assertEqual(describe({'content-length':'321'})['size'],321)
        self.assertIsNone(describe({})['size'])
    def test_hls_duration_only_for_finished_playlists(self):
        media='#EXTM3U\n#EXTINF:4.0,\na.ts\n#EXTINF:6.5,\nb.ts'
        self.assertIsNone(describe({},media,'HLS')['duration'])
        self.assertEqual(describe({},media+'\n#EXT-X-ENDLIST','HLS')['duration'],10.5)
    def test_dash_duration_bitrate_and_estimated_size(self):
        meta=describe({},'<MPD mediaPresentationDuration="PT1H2M3.5S"><Representation bandwidth="1000000" height="1080"/></MPD>','DASH')
        self.assertEqual(meta['duration'],3723.5);self.assertEqual(meta['heights'],[1080])
        result=enrich(meta,[],'u',1)
        self.assertEqual(result['size'],int(3723.5*1000000/8));self.assertTrue(result['size_estimated']);self.assertNotIn('bitrate',result)
    def test_player_height_does_not_replace_master_playlist_heights(self):
        meta=describe({},MASTER,'HLS')
        result=enrich(meta,[{'src':'u','duration':634.6,'height':184}],'u',3)
        self.assertEqual(result['heights'],[720,184]);self.assertEqual(result['duration'],634.6)
        plain=enrich(describe({'content-length':'9'}),[{'src':'u','duration':5,'height':540}],'u',1)
        self.assertEqual(plain['heights'],[540])
    def test_duration_is_not_shared_between_unrelated_streams(self):
        videos=[{'src':'a','duration':30,'height':720},{'src':'b','duration':5,'height':360}]
        self.assertIsNone(enrich(describe({}),videos,'other',2)['duration'])
        self.assertIsNone(enrich(describe({}),videos[:1],'other',2)['duration'])

if __name__=='__main__':unittest.main()
