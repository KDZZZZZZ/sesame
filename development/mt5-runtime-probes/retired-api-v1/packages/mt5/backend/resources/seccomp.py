"""Export a native-architecture filter; executed by the trusted launcher, not the agent."""
import ctypes
import errno
import sys

lib = ctypes.CDLL('libseccomp.so.2', use_errno=True)
lib.seccomp_init.argtypes = [ctypes.c_uint32]
lib.seccomp_init.restype = ctypes.c_void_p
lib.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
lib.seccomp_rule_add.argtypes = [ctypes.c_void_p, ctypes.c_uint32, ctypes.c_int, ctypes.c_uint]
lib.seccomp_export_bpf.argtypes = [ctypes.c_void_p, ctypes.c_int]
lib.seccomp_release.argtypes = [ctypes.c_void_p]
ctx = lib.seccomp_init(0x7fff0000)
if not ctx:
    raise RuntimeError('seccomp_init failed')
try:
    for name in ('mount umount2 pivot_root move_mount mount_setattr fsopen fsconfig fsmount '
                 'ptrace process_vm_readv process_vm_writev bpf perf_event_open keyctl add_key request_key '
                 'reboot kexec_load kexec_file_load init_module finit_module delete_module '
                 'open_by_handle_at unshare setns swapon swapoff userfaultfd').split():
        number = lib.seccomp_syscall_resolve_name(name.encode())
        if number >= 0 and lib.seccomp_rule_add(ctx, 0x50000 | errno.EPERM, number, 0) != 0:
            raise RuntimeError('seccomp rule failed: ' + name)
    if lib.seccomp_export_bpf(ctx, sys.stdout.fileno()) != 0:
        raise RuntimeError('seccomp export failed')
finally:
    lib.seccomp_release(ctx)
