"""Real Chromium -> authenticated controls -> detection -> download -> cleanup."""
import http.server
import socket
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
import server

class InteractiveTests(unittest.TestCase):
    def test_play_click_capture_download_and_cleanup(self):
        with tempfile.TemporaryDirectory() as temp:
            sample=Path(temp)/'sample.mp4'
            subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=blue:s=160x90:d=2','-c:v','libx264','-pix_fmt','yuv420p',str(sample)],check=True)
            media=sample.read_bytes()
            class Fixture(http.server.BaseHTTPRequestHandler):
                def log_message(self,*a):pass
                def do_GET(self):
                    if self.path=='/clip.mp4':
                        if 'viewer=ok' not in self.headers.get('Cookie','') or not self.headers.get('Referer','').startswith('http://fixture.example/'):
                            self.send_response(403);self.end_headers();return
                        self.send_response(200);self.send_header('Content-Type','video/mp4');self.send_header('Content-Length',str(len(media)));self.end_headers();self.wfile.write(media)
                    else:
                        body=b'''<title>Click to play fixture</title><style>body{margin:0}button{width:200px;height:100px;vertical-align:top}</style><button onclick="document.cookie='viewer=ok; path=/';document.querySelector('video').src='/clip.mp4';document.querySelector('video').play()">Play</button><video controls muted></video>'''
                        self.send_response(200);self.send_header('Content-Type','text/html');self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
            fixture=http.server.ThreadingHTTPServer(('127.0.0.1',0),Fixture)
            threading.Thread(target=fixture.serve_forever,daemon=True).start()
            def connect(host,port):
                if host!='fixture.example':raise ValueError('Test blocks external traffic')
                return socket.create_connection(fixture.server_address,timeout=5)
            with patch.object(server,'TOKEN','t'*64),patch.object(server,'public_addresses',return_value=[]),patch('egress.connect_public',side_effect=connect),TestClient(server.app) as client:
                client.headers['Authorization']='Bearer '+'t'*64
                response=client.post('/v1/browser',json={'url':'http://fixture.example/'})
                self.assertEqual(response.status_code,200,response.text)
                ident=response.json()['id'];folder=Path(server.JOBS[ident]['_dir'])
                client.headers['X-Video-Owner']='another-session'
                self.assertEqual(client.get('/v1/jobs/'+ident).status_code,404)
                self.assertEqual(client.delete('/v1/jobs/'+ident).status_code,404)
                self.assertEqual(client.post(f'/v1/browser/{ident}/action',json={'action':'frame'}).status_code,410)
                client.headers.pop('X-Video-Owner')
                self.assertEqual(client.post(f'/v1/browser/{ident}/action',json={'action':'evaluate'}).status_code,400)
                self.assertEqual(client.post(f'/v1/browser/{ident}/action',json={'action':'click','x':2000}).status_code,422)
                first=client.post(f'/v1/browser/{ident}/action',json={'action':'frame'})
                self.assertEqual(first.status_code,200,first.text[:300]);self.assertTrue(first.json()['image'].startswith('/9j/'))
                self.assertEqual(first.json()['choices'],[])
                client.post(f'/v1/browser/{ident}/action',json={'action':'click','x':100,'y':50})
                for _ in range(12):
                    frame=client.post(f'/v1/browser/{ident}/action',json={'action':'frame'}).json()
                    if frame.get('choices'):break
                    time.sleep(.2)
                self.assertEqual(len(frame['choices']),1)
                source=frame['choices'][0]['id']
                response=client.post('/v1/download',json={'source_id':source})
                self.assertEqual(response.status_code,200,response.text)
                download=response.json()['id']
                client.delete('/v1/jobs/'+ident)
                self.assertFalse(folder.exists());self.assertNotIn(source,server.SOURCES)
                for _ in range(60):
                    state=client.get('/v1/jobs/'+download).json()
                    if state['status']!='running':break
                    time.sleep(.2)
                self.assertEqual(state['status'],'ready',state)
                file=client.post('/v1/files/'+download)
                self.assertEqual(file.status_code,200);self.assertGreater(len(file.content),1000)
                self.assertEqual(client.get('/v1/jobs/'+download).status_code,404)
                self.assertEqual(client.post(f'/v1/browser/{ident}/action',json={'action':'frame'}).status_code,410)
            fixture.shutdown();fixture.server_close()

if __name__=='__main__':unittest.main(verbosity=2)
