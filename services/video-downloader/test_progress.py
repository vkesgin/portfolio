import queue
import tempfile
import time
import unittest
from unittest.mock import Mock,patch
import server
from progress import Progress

class ProgressTests(unittest.TestCase):
    def test_transfer_stats_and_retry_redaction(self):
        events=queue.Queue();p=Progress(events)
        p.hook({'status':'downloading','downloaded_bytes':524288,'total_bytes_estimate':1048576,'speed':10000,'eta':52,'fragment_index':3,'fragment_count':9,'filename':'SECRET','info_dict':{'format_id':'video','vcodec':'h264'}})
        event=events.get_nowait()
        self.assertEqual(event['progress'],50);self.assertEqual(event['fragment_count'],9)
        self.assertTrue(event['activity']);self.assertTrue(event['total_estimated'])
        self.assertNotIn('SECRET',str(event))
        p.debug('[download] Got error: HTTP Error 403 https://private.example/path?token=SECRET. Retrying fragment 3 (1/3)')
        event=events.get_nowait();self.assertEqual(event['phase'],'retrying');self.assertEqual(event['notice'],'HTTP 403')
        self.assertNotIn('private.example',str(event));self.assertNotIn('SECRET',str(event));self.assertFalse(event['activity'])
    def test_throttling_keeps_latest_activity_without_filling_queue(self):
        events=queue.Queue();p=Progress(events)
        with patch('progress.time.monotonic',side_effect=[10,10.1,10.6]):
            p.emit(progress=1)
            p.emit(progress=2,activity=True)
            p.emit(progress=3)
        self.assertEqual(events.qsize(),2);events.get_nowait()
        last=events.get_nowait();self.assertEqual(last['progress'],3);self.assertTrue(last['activity'])
    def test_stalled_transfer_is_terminated_and_reason_is_preserved(self):
        with tempfile.TemporaryDirectory() as folder:
            process=Mock();events=Mock()
            job={'status':'running','_process':process,'_dir':folder,'_activity':time.monotonic()-181}
            with patch.dict(server.JOBS,{'stalled':job},clear=True),patch.object(server,'terminate') as stop:
                server.monitor('stalled',events,'download')
                self.assertEqual(job['status'],'error');self.assertIn('180 saniye',job['message'])
                stop.assert_called_once_with(job)
    def test_audio_and_postprocessing_are_distinct(self):
        events=queue.Queue();p=Progress(events)
        p.hook({'status':'downloading','downloaded_bytes':1,'info_dict':{'vcodec':'none'}})
        self.assertEqual(events.get_nowait()['stream'],'Ses')
        p.postprocess({'status':'started','postprocessor':'FFmpegMerger'})
        self.assertEqual(events.get_nowait()['phase'],'processing')

if __name__=='__main__':unittest.main()
