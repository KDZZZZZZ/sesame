"""Official wheel prefetch with durable HTTP Range partials; never installs packages."""
import argparse, hashlib, json, os, re, time, urllib.request
from pathlib import Path
from urllib.parse import urlparse
from pip._vendor.packaging.tags import sys_tags
from pip._vendor.packaging.utils import parse_wheel_filename
PACKAGES={'vnpy':'4.5.0','vnpy_ctastrategy':'1.4.1','PySide6':'6.8.2.1','PySide6_Addons':'6.8.2.1','PySide6_Essentials':'6.8.2.1','shiboken6':'6.8.2.1'}
def official(url):
    value=urlparse(url)
    if value.scheme!='https' or value.hostname!='files.pythonhosted.org' or value.username or value.password: raise ValueError('Unexpected wheel source')
    return url

def save(path,value):
    temporary=path.with_suffix('.tmp');temporary.write_text(json.dumps(value,indent=2),encoding='utf8');os.replace(temporary,path)
def checksum(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()
def download(item,directory,deadline,budget,opener=urllib.request.urlopen):
    target=directory/item['filename'];partial=directory/(item['filename']+'.part');expected=item['sha256']
    if target.exists():
        if target.stat().st_size==item['size'] and checksum(target)==expected:return True,0
        raise ValueError('Completed wheel cache hash mismatch')
    offset=partial.stat().st_size if partial.exists() else 0
    if offset>item['size']:raise ValueError('Partial wheel exceeds declared size')
    if offset==item['size']:
        if checksum(partial)!=expected:partial.unlink();raise ValueError('Partial wheel hash mismatch; removed corrupt partial')
        os.replace(partial,target);return True,0
    request=urllib.request.Request(official(item['url']),headers={'Range':f'bytes={offset}-'} if offset else {})
    with opener(request,timeout=20) as response:
        official(response.geturl())
        response_end=item['size']-1
        if offset or response.status==206:
            match=re.fullmatch(r'bytes (\d+)-(\d+)/(\d+)',response.headers.get('Content-Range',''))
            if response.status!=206 or not match or tuple(map(int,match.groups()))!=(offset,response_end,item['size']):
                raise ValueError('Source did not honor resume Range boundaries; partial preserved, no silent full redownload')
        elif response.status!=200:
            raise ValueError('Unexpected wheel response status')
        length=response.headers.get('Content-Length')
        if length is not None and (not length.isdigit() or int(length)!=item['size']-offset):
            raise ValueError('Wheel response Content-Length does not match declared size')
        used=0
        with partial.open('ab' if offset else 'wb') as f:
            while time.monotonic()<deadline and used<budget:
                chunk=response.read(min(128*1024,budget-used))
                if not chunk:raise ValueError('Wheel response ended before declared size; partial preserved')
                if offset+used+len(chunk)>item['size']:raise ValueError('Wheel response exceeds declared size')
                f.write(chunk);f.flush();used+=len(chunk)
                if f.tell()==item['size']:break
        if partial.stat().st_size==item['size']:
            if response.read(1):
                with partial.open('r+b') as f:f.truncate(offset)
                raise ValueError('Wheel response exceeds declared body boundary; previous partial preserved')
            if checksum(partial)!=expected:partial.unlink();raise ValueError('Wheel hash mismatch; removed corrupt partial')
            os.replace(partial,target);return True,used
        return False,used

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--directory',required=True);parser.add_argument('--report',required=True);parser.add_argument('--seconds',type=int,default=420);parser.add_argument('--bytes',type=int,default=64*1024*1024);args=parser.parse_args()
    directory=Path(args.directory);directory.mkdir(parents=True,exist_ok=True);manifest=directory/'sources.json';items=json.loads(manifest.read_text()) if manifest.exists() else []
    deadline=time.monotonic()+min(420,max(1,args.seconds));budget=min(64*1024*1024,max(1,args.bytes));used=0;failure=None
    try:
        if not items:
            tags=set(sys_tags())
            for name,version in PACKAGES.items():
                with urllib.request.urlopen(f'https://pypi.org/pypi/{name}/{version}/json',timeout=20) as r:data=json.load(r)
                choices=[x for x in data['urls'] if x['packagetype']=='bdist_wheel' and not x.get('yanked') and parse_wheel_filename(x['filename'])[3]&tags]
                if not choices:raise ValueError(f'No official compatible wheel for {name} {version}')
                chosen=sorted(choices,key=lambda x:x['filename'])[0];sha=chosen['digests']['sha256']
                if not re.fullmatch('[a-f0-9]{64}',sha):raise ValueError('Missing wheel digest')
                items.append({'name':name,'version':version,'filename':chosen['filename'],'url':official(chosen['url']),'sha256':sha,'size':chosen['size']})
            save(manifest,items)
        if {(i['name'],i['version']) for i in items}!=set(PACKAGES.items()):raise ValueError('Wheel manifest does not match pinned dependency set')
        for item in items:
            if not re.fullmatch(r'[A-Za-z0-9_.+\-]+\.whl',item['filename']) or not re.fullmatch('[a-f0-9]{64}',item['sha256']) or not isinstance(item['size'],int) or item['size']<=0:raise ValueError('Invalid cached wheel receipt')
            if time.monotonic()>=deadline or used>=budget:break
            target=directory/item['filename'];partial=directory/(item['filename']+'.part')
            before=target.stat().st_size if target.exists() else partial.stat().st_size if partial.exists() else 0
            try:done,count=download(item,directory,deadline,budget-used)
            finally:
                after=target.stat().st_size if target.exists() else partial.stat().st_size if partial.exists() else 0
                used+=max(0,after-before)
            if not done:break
    except Exception as cause:failure=f'{type(cause).__name__}: {cause}'
    progress=[{**i,'downloadedBytes':min(i['size'],(directory/i['filename']).stat().st_size if (directory/i['filename']).exists() else (directory/(i['filename']+'.part')).stat().st_size if (directory/(i['filename']+'.part')).exists() else 0),'complete':(directory/i['filename']).exists()} for i in items]
    result={'complete':bool(items) and all(i['complete'] for i in progress) and not failure,'bytesThisCall':used,'wheels':progress,'error':failure,'observedAt':int(time.time()*1000)}
    save(Path(args.report),result);print(json.dumps(result))
if __name__=='__main__':main()
