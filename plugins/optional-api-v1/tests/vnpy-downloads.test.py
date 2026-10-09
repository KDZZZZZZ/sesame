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
    def test_corrupt_complete_archive_is_not_accepted(self):
        with tempfile.TemporaryDirectory() as d:
            p=pathlib.Path(d);(p/'test.whl').write_bytes(b'123');item={'filename':'test.whl','url':'https://files.pythonhosted.org/test.whl','sha256':'a'*64,'size':3}
            with self.assertRaisesRegex(ValueError,'hash mismatch'):module.download(item,p,time.monotonic()+2,9)
if __name__=='__main__':unittest.main()
