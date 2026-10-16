"""Small trusted file operations inside the same bwrap boundary as bash."""
import base64
import json
from pathlib import Path
import sys

request = json.load(sys.stdin)
path = Path(request['path'])
root = Path('/work')
if not path.is_relative_to(root) or not path.resolve().is_relative_to(root):
    raise ValueError('Path must stay inside /work')
op = request['op']
if op in ('mkdir', 'write', 'write_base64', 'write_tree') and 'inputs' in path.relative_to(root).parts and not request.get('allow_inputs'):
    raise ValueError('Imported inputs are read-only')
if op == 'read':
    if path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError('File exceeds 8 MiB')
    print(base64.b64encode(path.read_bytes()).decode())
elif op == 'access':
    path.stat()
elif op == 'mkdir':
    path.mkdir(parents=True, exist_ok=True)
elif op in ('write', 'write_base64'):
    data = base64.b64decode(request['content'], validate=True) if op == 'write_base64' else request['content'].encode()
    if len(data) > 8 * 1024 * 1024:
        raise ValueError('File exceeds 8 MiB')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
elif op == 'write_tree':
    files = request['content']
    if not isinstance(files, dict) or len(files) > 256:
        raise ValueError('Invalid file tree')
    pending = []
    total = 0
    for name, content in files.items():
        target = path / name
        if Path(name).is_absolute() or '..' in Path(name).parts or not target.resolve().is_relative_to(path.resolve()):
            raise ValueError('File tree path must stay inside its root')
        if 'inputs' in target.relative_to(root).parts and not request.get('allow_inputs'):
            raise ValueError('Imported inputs are read-only')
        data = content.encode()
        total += len(data)
        if len(data) > 8 * 1024 * 1024 or total > 16 * 1024 * 1024:
            raise ValueError('File tree exceeds size limit')
        pending.append((target, data))
    for target, data in pending:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
else:
    raise ValueError('Unknown file operation')
