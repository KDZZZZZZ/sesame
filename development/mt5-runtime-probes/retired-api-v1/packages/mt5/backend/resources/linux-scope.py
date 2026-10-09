#!/usr/bin/env python3
"""Trusted systemd-scope gate for the bundled Linux backend; never task input."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile


def main():
    configuration = Path(sys.argv[1])
    config = json.loads(configuration.read_text())
    group_name = Path('/proc/self/cgroup').read_text().strip().removeprefix('0::')
    group = Path('/sys/fs/cgroup') / group_name.lstrip('/')
    if group.name != config['unit'] or not group.is_relative_to('/sys/fs/cgroup'):
        raise RuntimeError('Linux task did not enter its private systemd scope')
    limits = {name: (group/name).read_text().strip() for name in config['limits']}
    if limits != config['limits']:
        raise RuntimeError('Linux systemd resource limits were not enforced')
    state = configuration.parent
    (state/'ready.json').write_text(json.dumps({'cgroup': str(group), 'limits': limits}))
    # Generate the unchanged product filter with bundled Python/libseccomp,
    # then pass only its FD to the exact, AppArmor-attached bwrap executable.
    with tempfile.TemporaryFile(dir=state) as policy:
        subprocess.run([config['python'], '--library-path', config['libraries'], config['python_binary'], config['seccomp']],
                       env=os.environ.copy(), stdin=subprocess.DEVNULL, stdout=policy, check=True, timeout=5)
        size = policy.tell()
        if size == 0 or size > 65536 or size % 8:
            raise RuntimeError('Linux seccomp policy has invalid size')
        policy.seek(0)
        child = subprocess.run([config['bwrap'], *config['arguments'], '--seccomp', str(policy.fileno()), *config['argv']],
                               pass_fds=(policy.fileno(),), env={'PATH': '', 'LC_ALL': 'C'})
    events = dict(line.split() for line in (group/'memory.events').read_text().splitlines())
    (state/'result.json').write_text(json.dumps({'exitCode': child.returncode, 'oomKilled': int(events['oom_kill'])}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
