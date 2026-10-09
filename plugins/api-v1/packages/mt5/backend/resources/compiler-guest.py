#!/usr/bin/env python3
"""Bundled task supervisor. Run only as PID 1 inside the disposable guest."""
import base64
import json
import os
from pathlib import Path
import selectors
import shutil
import subprocess
import sys
import tempfile
import time

if os.getpid() != 1 or "sesame-p0=1" not in Path("/proc/cmdline").read_text():
    raise SystemExit("This probe runs only as PID 1 inside the disposable P0 guest")

cgroups = Path("/sys/fs/cgroup")
(cgroups / "cgroup.subtree_control").write_text("+cpu +memory +pids")
incoming = bytearray()


def receive():
    chunk = os.read(sys.stdin.fileno(), 65536)
    if not chunk:
        raise EOFError("Host control channel closed")
    incoming.extend(chunk)
    if len(incoming) > 64 * 1024 * 1024:
        raise ValueError("Probe request exceeds the protocol budget")


def next_message():
    line, _, rest = incoming.partition(b"\n")
    incoming[:] = rest
    return json.loads(line)


def emit(value):
    encoded = json.dumps(value, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > 64 * 1024 * 1024:
        raise ValueError("Probe response exceeds the 64 MiB transport budget")
    print(encoded, flush=True)


def verify_initramfs():
    # A partial initramfs can still contain Python and this supervisor. It must
    # not announce readiness after the kernel has already rejected the image.
    descriptor = os.open("/dev/kmsg", os.O_RDONLY | os.O_NONBLOCK)
    try:
        while True:
            try:
                record = os.read(descriptor, 65536)
            except BlockingIOError:
                break
            if not record:
                break
            if b"Initramfs unpacking failed:" in record:
                raise RuntimeError(record.decode(errors="replace").strip())
    finally:
        os.close(descriptor)


def prepare_seccomp():
    # Reuse the unchanged product policy; generate it for this guest's native
    # architecture before any untrusted process is accepted.
    policy = tempfile.TemporaryFile(dir="/run")
    try:
        subprocess.run(["/usr/bin/python3", "/seccomp.py"], stdin=subprocess.DEVNULL,
                       stdout=policy, stderr=subprocess.PIPE, check=True, timeout=5)
        size = policy.tell()
        if size == 0 or size > 65536 or size % 8:
            raise ValueError("Invalid native seccomp filter")
        policy.seek(0)
        return policy
    except Exception:
        policy.close()
        raise


def prepare_network():
    markers = [word for word in Path('/proc/cmdline').read_text().split()
               if word.startswith('sesame-network=')]
    if not markers:
        return {'enabled': False, 'mode': 'restricted'}
    if markers != ['sesame-network=unrestricted']:
        raise ValueError('Invalid trusted guest network mode')
    # SquashFS stays immutable. Only these guest-owned resolver files receive
    # writable mounts; neither the host filesystem nor a user path is exposed.
    private = Path(tempfile.mkdtemp(prefix='network-', dir='/tmp'))
    for name in ('hosts', 'resolv.conf', 'nsswitch.conf'):
        target = Path('/etc') / name
        source = private / name
        shutil.copyfile(target, source)
        subprocess.run(['/bin/mount', '--bind', str(source), str(target)],
                       stdin=subprocess.DEVNULL, capture_output=True, check=True, timeout=5)
    result = subprocess.run(['/usr/bin/python3', '/usr/share/sesame-network-p0/configure-network.py',
                             '--mode', 'unrestricted'], stdin=subprocess.DEVNULL,
                            capture_output=True, text=True, check=True, timeout=20)
    configured = json.loads(result.stdout)
    if configured.get('enabled') is not True or configured.get('mode') != 'unrestricted':
        raise ValueError('Guest network initialization was not confirmed')
    # Preserve the existing Mac guest-to-host name for saved scripts. This is
    # the fixed P0 user-network gateway, never a name inferred from task text.
    with Path('/etc/hosts').open('a') as hosts:
        hosts.write('10.0.2.2 host.lima.internal\n')
    return configured


def execute(request, frozen_build=None, deadline_at=None):
    started = time.monotonic()
    profile = request.get("profile", "research")
    if profile not in ("research", "compiler"):
        raise ValueError("Unknown controlled probe profile")
    compiler = profile == "compiler"
    budget = request.get("compilerBudget", "standard")
    if budget not in ("standard", "macos") or (budget == "macos" and not compiler):
        raise ValueError("Unknown or incompatible controlled compiler budget")
    max_timeout = 300 if compiler and budget == "macos" else 120
    timeout = request.get("timeout", 30)
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not 0 < timeout <= max_timeout:
        raise ValueError("Invalid controlled probe timeout")
    group = cgroups / "probe"
    group.mkdir()
    limits = {"memory.max": "2147483648" if compiler else "402653184", "memory.swap.max": "0",
              "pids.max": "256" if compiler else "64", "cpu.max": "200000 100000" if compiler else "100000 100000"}
    for name, value in limits.items():
        (group / name).write_text(value)
    with tempfile.TemporaryDirectory(prefix="probe-", dir="/tmp") as staging:
        work = Path(staging) / "work"
        work.mkdir()
        argv = request.get("argv")
        if argv is None:
            argv = ["/bin/bash", "-c", request["script"]]
        if (not isinstance(argv, list) or not argv
                or any(not isinstance(arg, str) or "\0" in arg for arg in argv)):
            raise ValueError("Invalid execution arguments")
        stdin = request.get("stdin", "")
        if not isinstance(stdin, str):
            raise ValueError("Execution stdin must be text")
        input_bytes = 0
        if len(request.get("files", {})) > 256:
            raise ValueError("Probe inputs exceed 256 files")
        for name, content in request.get("files", {}).items():
            path = Path(name)
            if (not name or path.is_absolute() or ".." in path.parts or "\\" in name
                    or "\0" in name or any(part in ("", ".") for part in name.split("/"))):
                raise ValueError("Invalid probe input path")
            target = work / path
            target.parent.mkdir(parents=True, exist_ok=True)
            payload = base64.b64decode(content, validate=True)
            input_bytes += len(payload)
            if len(payload) > 8 * 1024 * 1024 or input_bytes > 16 * 1024 * 1024:
                raise ValueError("Probe inputs exceed the file budget")
            target.write_bytes(payload)
        args = ["/usr/bin/bwrap", "--unshare-all", "--die-with-parent", "--new-session", "--cap-drop", "ALL", "--clearenv"]
        if network_details['enabled'] and not compiler:
            args += ['--share-net']
            for path in ('/etc/ssl', '/etc/resolv.conf', '/etc/nsswitch.conf', '/etc/hosts'):
                args += ['--ro-bind', path, path]
            args += ['--setenv', 'NODE_USE_ENV_PROXY', '1',
                     '--setenv', 'SSL_CERT_FILE', '/etc/ssl/certs/ca-certificates.crt',
                     '--setenv', 'NODE_EXTRA_CA_CERTS', '/etc/ssl/certs/ca-certificates.crt']
        for path in ("/usr", "/bin", "/lib", "/lib64"):
            args += ["--ro-bind", path, path]
        args += ["--proc", "/proc", "--dev", "/dev", "--size", "268435456" if compiler else "67108864", "--tmpfs", "/tmp", "--dir", "/home/agent", "--bind", str(work), "/work"]
        if compiler:
            for path in ("/opt/wine-staging", "/etc/fonts"):
                args += ["--ro-bind", path, path]
            prefix = Path(staging) / "prefix"
            prefix.mkdir()
            args += ["--bind", str(prefix), "/prefix"]
            if frozen_build is not None:
                frozen = Path(frozen_build)
                # Only receive_compiler supplies this host-verified private copy.
                # No task field can select a host or guest mount source.
                if frozen.resolve() != frozen or not frozen.is_dir():
                    raise ValueError("Invalid frozen compiler directory")
                (frozen / "Include").mkdir(exist_ok=True)
                args += ["--bind", str(frozen), "/build",
                         "--ro-bind", str(frozen / "Include"), "/build/Include",
                         "--ro-bind", str(frozen / ".compiler"), "/build/.compiler",
                         "--ro-bind", str(frozen / "manifest.json"), "/build/manifest.json",
                         "--ro-bind", str(frozen / ".compiler/MetaEditor64.exe"), "/terminal/MetaEditor64.exe",
                         "--setenv", "SESAME_COMPILER_GUEST", "1"]
        if not request.get("allowInputs", False):
            roots = set()
            for name in request.get("files", {}):
                parts = name.split("/")
                if "inputs" in parts:
                    roots.add("/".join(parts[:parts.index("inputs") + 1]))
            for name in sorted(roots):
                args += ["--ro-bind", str(work / name), "/work/" + name]
        if not compiler:
            allowed_env = {"http_proxy", "https_proxy", "all_proxy", "no_proxy",
                           "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY"}
            environment = request.get("networkEnv", {})
            if (not isinstance(environment, dict) or not set(environment) <= allowed_env
                    or any(not isinstance(value, str) or "\0" in value for value in environment.values())):
                raise ValueError("Invalid network environment")
            for key, value in environment.items():
                args += ["--setenv", key, value]
        args += ["--setenv", "PATH", "/usr/local/bin:/usr/bin:/bin", "--setenv", "HOME", "/home/agent", "--setenv", "LANG", "C.UTF-8", "--chdir", "/work", "--seccomp", str(seccomp_policy.fileno()), *argv]

        def attach():
            (group / "cgroup.procs").write_text(str(os.getpid()))

        seccomp_policy.seek(0)
        # A private finite input file preserves stdin bytes without blocking the
        # supervisor on a child that writes output before reading its input.
        with tempfile.TemporaryFile(dir=staging) as task_input:
            task_input.write(stdin.encode("utf-8"))
            task_input.seek(0)
            process = subprocess.Popen(args, stdin=task_input, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, preexec_fn=attach,
                                       pass_fds=(seccomp_policy.fileno(),))
        reason = None
        cleanup_started = None
        output = {"stdout": bytearray(), "stderr": bytearray()}
        total = 0
        deadline = deadline_at if deadline_at is not None else time.monotonic() + timeout

        def stop(why):
            nonlocal reason, cleanup_started
            if reason is None:
                reason = why
                cleanup_started = time.monotonic()
                (group / "cgroup.kill").write_text("1")

        try:
            with selectors.DefaultSelector() as poller:
                poller.register(sys.stdin.fileno(), selectors.EVENT_READ, "control")
                poller.register(process.stdout, selectors.EVENT_READ, "stdout")
                poller.register(process.stderr, selectors.EVENT_READ, "stderr")
                while len(poller.get_map()) > 1 or process.poll() is None:
                    while b"\n" in incoming:
                        control = next_message()
                        if control.get("action") != "cancel" or control.get("id") != request.get("id"):
                            raise ValueError("Only cancellation of the current probe is accepted while running")
                        stop("canceled")
                    if time.monotonic() >= deadline:
                        stop("timeout")
                    if cleanup_started is not None and time.monotonic() - cleanup_started > 2:
                        raise RuntimeError("Task did not exit within 2 seconds of the first kill")
                    for key, _ in poller.select(0.02):
                        if key.data == "control":
                            receive()
                        else:
                            chunk = os.read(key.fileobj.fileno(), 65536)
                            if not chunk:
                                poller.unregister(key.fileobj)
                                key.fileobj.close()
                                continue
                            remaining = max(0, 1048576 - total)
                            accepted = chunk[:remaining]
                            output[key.data].extend(accepted)
                            if request.get("observeOutput") and accepted:
                                emit({"type": "output", "id": request.get("id"), "channel": key.data,
                                      "data": base64.b64encode(accepted).decode()})
                            total += len(chunk)
                            if total > 1048576:
                                stop("output_limit")
        finally:
            cleanup_started = cleanup_started or time.monotonic()
            (group / "cgroup.kill").write_text("1")
            process.wait(timeout=max(0.001, 2 - (time.monotonic() - cleanup_started)))
            while "populated 1" in (group / "cgroup.events").read_text():
                if time.monotonic() - cleanup_started > 2:
                    raise RuntimeError("Task cgroup did not become empty in 2 seconds")
                time.sleep(0.01)
            cleanup_ms = round((time.monotonic() - cleanup_started) * 1000, 3)
        metrics = {name: (group / name).read_text().strip() for name in ("memory.max", "memory.peak", "memory.swap.max", "memory.events", "pids.max", "pids.peak", "pids.events", "cpu.max", "cpu.stat", "cgroup.events")}
        # A compiler-entry failure is a transport/adapter failure. Ordinary
        # MetaEditor diagnostics return entry exit 0 with success:false instead.
        # Preserve the existing nonzero-result behavior of research commands.
        if frozen_build is not None and process.returncode != 0 and reason is None:
            reason = "compiler_entry_failed"
        files = {}
        output_bytes = 0
        # Compiler outputs use their existing separate artifact budget.
        file_limit = (32 if compiler else 8) * 1024 * 1024
        tree_limit = (40 if compiler else 16) * 1024 * 1024
        if reason is None:
            for path in work.rglob("*"):
                if deadline_at is not None and time.monotonic() >= deadline_at:
                    reason = "timeout"
                    break
                if path.is_symlink() or (not path.is_dir() and not path.is_file()):
                    reason = "invalid_file"
                    break
                if path.is_file():
                    size = path.stat().st_size
                    output_bytes += size
                    if path.stat().st_nlink != 1 or size > file_limit or output_bytes > tree_limit or len(files) >= 256:
                        reason = "file_limit"
                        break
                    files[str(path.relative_to(work))] = base64.b64encode(path.read_bytes()).decode()
            if deadline_at is not None and time.monotonic() >= deadline_at:
                reason = "timeout"
        if reason is not None:
            files = {}
        emit({"id": request.get("id"), "exitCode": process.returncode, "stopped": reason,
              "elapsed_ms": round((time.monotonic() - started) * 1000, 3), "cleanup_ms": cleanup_ms, "stdout": output["stdout"].decode(errors="replace"),
              "stderr": output["stderr"].decode(errors="replace"), "files": files, "metrics": metrics})
    group.rmdir()


def receive_compiler(request):
    """Transport a production frozen build separately from 16 MiB research files."""
    sys.path.insert(0, "/usr/share/sesame-runtime")
    from compiler_channel import SnapshotInput
    from compiler_snapshot import receive_snapshot

    if (set(request) != {"action", "id", "manifest_sha256", "compilerBudget"}
            or not isinstance(request["id"], str) or not 0 < len(request["id"]) <= 128
            or request["compilerBudget"] not in ("standard", "macos")):
        raise ValueError("Invalid trusted compiler request")
    budget = request["compilerBudget"]
    started = time.monotonic()
    # Preserve the existing staging and execution budgets as separate stages.
    deadline = started + (120 if budget == "macos" else 60)
    with tempfile.TemporaryDirectory(prefix="compile-transfer-", dir="/tmp") as parent:
        stream = SnapshotInput(sys.stdin.fileno(), incoming, deadline)
        snapshot = receive_snapshot(stream, parent, request["manifest_sha256"],
                                    canceled=lambda: time.monotonic() >= deadline)
        if time.monotonic() >= deadline:
            raise TimeoutError("Frozen-input transfer timed out")
        # Execution has its own budget, fixed before writing readiness. A slow
        # host consuming stdout must not grant extra time to the compiler.
        deadline = time.monotonic() + (300 if budget == "macos" else 120)
        emit({"type": "snapshot_ready", "id": request["id"],
              "manifest_sha256": snapshot["manifest_sha256"],
              "file_count": snapshot["file_count"], "total_bytes": snapshot["total_bytes"],
              "wire_bytes": stream.bytes_read, "transfer_ms": round((time.monotonic() - started) * 1000, 3)})
        remaining = int(deadline - time.monotonic())
        if remaining <= 5:
            raise TimeoutError("Compiler execution deadline expired during readiness")
        inner_timeout = remaining - 5
        execute({"id": request["id"], "profile": "compiler", "compilerBudget": budget,
                 "timeout": remaining, "files": {},
                 "script": "exec /usr/bin/python3 /usr/share/sesame-runtime/compiler_entry.py "
                           f"--budget {budget} --timeout {inner_timeout} "
                           f"--manifest-sha256 {snapshot['manifest_sha256']}"},
                frozen_build=snapshot["directory"], deadline_at=deadline)


try:
    verify_initramfs()
    seccomp_policy = prepare_seccomp()
    network_details = prepare_network()
except (OSError, RuntimeError, ValueError, subprocess.SubprocessError) as error:
    emit({"type": "boot_error", "message": str(error)})
    subprocess.run(["/bin/poweroff", "-f"], check=True)
    raise SystemExit(1)

emit({"type": "ready", "protocol_version": 1, "purpose": "Sesame bundled runtime", "kernel": os.uname().release,
      "network": network_details,
      "controllers": (cgroups / "cgroup.controllers").read_text().strip()})
while True:
    try:
        while b"\n" not in incoming:
            receive()
        request = next_message()
        if request.get("action") == "shutdown":
            subprocess.run(["/bin/poweroff", "-f"], check=True)
        elif request.get("action") == "compile_snapshot":
            try:
                receive_compiler(request)
            except Exception as error:
                # A failed substream has no trustworthy resynchronization point.
                # Discard this disposable guest rather than accept leftover frames.
                emit({"type": "error", "id": request.get("id"), "message": str(error)})
                subprocess.run(["/bin/poweroff", "-f"], check=True)
                raise
        else:
            execute(request)
    except Exception as error:
        if isinstance(error, EOFError):
            subprocess.run(["/bin/poweroff", "-f"], check=True)
            raise SystemExit(0)
        emit({"type": "error", "message": str(error)})
