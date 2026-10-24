import asyncio
import socket
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
import server
from egress import public_addresses, connect_public
from tasks import filtered, ad

class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.old_root=server.ROOT
        server.ROOT=Path(self.temp.name)
        server.JOBS.clear();server.SOURCES.clear()
    def tearDown(self):
        server.JOBS.clear();server.SOURCES.clear();server.ROOT=self.old_root
        self.temp.cleanup()
    def test_file_transfer_erases_file_job_and_sources(self):
        folder=server.ROOT/'job';folder.mkdir();path=folder/'video.mp4';path.write_bytes(b'test-video')
        server.JOBS['job']={'status':'ready','_path':str(path),'_dir':str(folder),'expires':time.monotonic()+600}
        server.SOURCES['source']={'owner':'job','expires':time.monotonic()+600}
        response=server.file('job')
        self.assertEqual(response.headers['Content-Length'],'10')
        async def consume():return b''.join([block async for block in response.body_iterator])
        self.assertEqual(asyncio.run(consume()),b'test-video')
        self.assertFalse(folder.exists());self.assertNotIn('job',server.JOBS);self.assertNotIn('source',server.SOURCES)
    def test_expired_metadata_and_files_are_cleaned(self):
        folder=server.ROOT/'expired';folder.mkdir();(folder/'part').write_bytes(b'temp')
        server.JOBS['expired']={'status':'error','expires':0,'_dir':str(folder)}
        server.SOURCES['source']={'owner':'expired','expires':0}
        server.sweep()
        self.assertFalse(folder.exists());self.assertFalse(server.JOBS);self.assertFalse(server.SOURCES)
    def test_private_and_mixed_dns_are_blocked(self):
        for addresses in [['127.0.0.1'],['169.254.169.254'],['::1'],['10.0.0.1'],['8.8.8.8','192.168.1.1']]:
            resolved=[(socket.AF_INET,socket.SOCK_STREAM,6,'',(ip,443)) for ip in addresses]
            with patch('socket.getaddrinfo',return_value=resolved),self.assertRaises(ValueError):public_addresses('public.example',443)
        with self.assertRaises(ValueError):connect_public('public.example',22)
    def test_drm_live_ads_and_non_http_sources_are_rejected(self):
        self.assertTrue(ad('https://ads.doubleclick.net/clip.mp4'))
        for info in [{'protocol':'file'},{'protocol':'https','is_live':True},{'protocol':'https','has_drm':True},{'formats':[{'protocol':'rtmp','url':'rtmp://public.example/a'}]}]:
            with self.assertRaises(ValueError):filtered(info)

if __name__=='__main__':unittest.main(verbosity=2)
