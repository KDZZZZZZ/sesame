import json, sys
from unittest.mock import patch
import hashlib, importlib.util, io, pathlib, tempfile, time, unittest
spec=importlib.util.spec_from_file_location('download',pathlib.Path(__file__).parent/'../packages/vnpy/download-wheels.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Response(io.BytesIO):
    def __init__(self,data,start):super().__init__(data);self.status=206 if start else 200;self.headers={'Content-Range':f'bytes {start}-7/8'}
    def geturl(self):return 'https://files.pythonhosted.org/test.whl'
class Resume(unittest.TestCase):
    def test_resume_uses_remaining_range_and_verifies_hash(self):
        data=b'12345678';item={'filename':'test.whl','url':'https://files.pythonhosted.org/test.whl','sha256':hashlib.sha256(data).hexdigest(),'size':len(data)};ranges=[]
        def opener(request,timeout):
            offset=int(request.headers.get('Range','bytes=0-').split('=')[1].split('-')[0]);ranges.append(offset);return Response(data[offset:],offset)
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);self.assertEqual(module.download(item,p,time.monotonic()+2,3,opener),(False,3));self.assertEqual((p/'test.whl.part').read_bytes(),b'123');self.assertEqual(module.download(item,p,time.monotonic()+2,9,opener),(True,5));self.assertEqual(ranges,[0,3]);self.assertEqual((p/'test.whl').read_bytes(),data);self.assertEqual(module.download(item,p,time.monotonic()+2,9,opener),(True,0))
    def test_range_not_honored_preserves_partial_without_restarting(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);(p/'test.whl.part').write_bytes(b'123');item={'filename':'test.whl','url':'https://files.pythonhosted.org/test.whl','sha256':'a'*64,'size':8}
            with self.assertRaisesRegex(ValueError,'honor resume'):module.download(item,p,time.monotonic()+2,9,lambda *_args,**_kwargs:Response(b'12345678',0))
            self.assertEqual((p/'test.whl.part').read_bytes(),b'123')
    def test_invalid_complete_range_preserves_prior_bytes(self):
        for value in ['bytes 3-7/999','bytes 3-6/8','bytes 4-7/8']:
            with self.subTest(value=value),tempfile.TemporaryDirectory() as d:
                p=pathlib.Path(d);(p/'test.whl.part').write_bytes(b'123');item={'filename':'test.whl','url':'https://files.pythonhosted.org/test.whl','sha256':hashlib.sha256(b'12345678').hexdigest(),'size':8}
                response=Response(b'45678',3);response.headers['Content-Range']=value
                with self.assertRaisesRegex(ValueError,'boundaries'):module.download(item,p,time.monotonic()+2,9,lambda *_a,**_k:response)
                self.assertEqual((p/'test.whl.part').read_bytes(),b'123')
    def test_short_eof_is_an_explicit_error_and_keeps_progress(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);item={'filename':'test.whl','url':'https://files.pythonhosted.org/test.whl','sha256':'a'*64,'size':8}
            with self.assertRaisesRegex(ValueError,'ended before'):module.download(item,p,time.monotonic()+2,9,lambda *_a,**_k:Response(b'123',0))
            self.assertEqual((p/'test.whl.part').read_bytes(),b'123')
    def test_body_overrun_does_not_promote_wheel(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);(p/'test.whl.part').write_bytes(b'123');item={'filename':'test.whl','url':'https://files.pythonhosted.org/test.whl','sha256':hashlib.sha256(b'12345678').hexdigest(),'size':8}
            with self.assertRaisesRegex(ValueError,'exceeds'):module.download(item,p,time.monotonic()+2,5,lambda *_a,**_k:Response(b'456789',3))
            self.assertEqual((p/'test.whl.part').read_bytes(),b'123');self.assertFalse((p/'test.whl').exists())
    def test_report_counts_bytes_written_before_read_failure(self):
        class Broken(Response):
            def read(self,n=-1):
                if self.tell():raise OSError('connection dropped')
                return super().read(3)
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);items=[{'name':n,'version':v,'filename':n+'.whl','url':'https://files.pythonhosted.org/test.whl','sha256':'a'*64,'size':8} for n,v in module.PACKAGES.items()];(p/'sources.json').write_text(json.dumps(items));report=p/'report.json'
            original=module.download
            with patch.object(module,'download',lambda *a:original(*a,opener=lambda *_a,**_k:Broken(b'12345678',0))),patch.object(sys,'argv',['download','--directory',d,'--report',str(report)]),patch.object(module.urllib.request,'urlopen',lambda *_a,**_k:Broken(b'12345678',0)),patch('builtins.print'):
                module.main()
            result=json.loads(report.read_text());self.assertEqual(result['bytesThisCall'],3);self.assertIn('connection dropped',result['error']);self.assertFalse(result['complete'])
    def test_corrupt_complete_archive_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);(p/'test.whl').write_bytes(b'123');item={'filename':'test.whl','url':'https://files.pythonhosted.org/test.whl','sha256':'a'*64,'size':3}
            with self.assertRaisesRegex(ValueError,'hash mismatch'):module.download(item,p,time.monotonic()+2,9)
if __name__=='__main__':unittest.main()
