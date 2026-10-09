"""Own only a new private Tester process tree in a native Windows Job.

No existing terminal is attached to this Job. A parent disconnect requests
cancellation; success is acknowledged only after the Job reports zero processes.
"""
import ctypes as c
from ctypes import wintypes as w
import json
import os
import subprocess
import sys
import threading
import time

k = c.WinDLL('kernel32', use_last_error=True)
SIZE_T = c.c_size_t

class IO_COUNTERS(c.Structure):
    _fields_ = [(name, c.c_ulonglong) for name in ('ReadOperationCount', 'WriteOperationCount', 'OtherOperationCount', 'ReadTransferCount', 'WriteTransferCount', 'OtherTransferCount')]

class BASIC_LIMIT(c.Structure):
    _fields_ = [('PerProcessUserTimeLimit', c.c_longlong), ('PerJobUserTimeLimit', c.c_longlong), ('LimitFlags', w.DWORD), ('MinimumWorkingSetSize', SIZE_T), ('MaximumWorkingSetSize', SIZE_T), ('ActiveProcessLimit', w.DWORD), ('Affinity', SIZE_T), ('PriorityClass', w.DWORD), ('SchedulingClass', w.DWORD)]

class EXTENDED_LIMIT(c.Structure):
    _fields_ = [('BasicLimitInformation', BASIC_LIMIT), ('IoInfo', IO_COUNTERS), ('ProcessMemoryLimit', SIZE_T), ('JobMemoryLimit', SIZE_T), ('PeakProcessMemoryUsed', SIZE_T), ('PeakJobMemoryUsed', SIZE_T)]

class ACCOUNTING(c.Structure):
    _fields_ = [(name, c.c_longlong) for name in ('TotalUserTime', 'TotalKernelTime', 'ThisPeriodTotalUserTime', 'ThisPeriodTotalKernelTime')] + [(name, w.DWORD) for name in ('TotalPageFaultCount', 'TotalProcesses', 'ActiveProcesses', 'TotalTerminatedProcesses')]

class STARTUPINFO(c.Structure):
    _fields_ = [('cb', w.DWORD), ('lpReserved', w.LPWSTR), ('lpDesktop', w.LPWSTR), ('lpTitle', w.LPWSTR)] + [(name, w.DWORD) for name in ('dwX', 'dwY', 'dwXSize', 'dwYSize', 'dwXCountChars', 'dwYCountChars', 'dwFillAttribute', 'dwFlags')] + [('wShowWindow', w.WORD), ('cbReserved2', w.WORD), ('lpReserved2', c.c_void_p), ('hStdInput', w.HANDLE), ('hStdOutput', w.HANDLE), ('hStdError', w.HANDLE)]

class PROCESSINFO(c.Structure):
    _fields_ = [('hProcess', w.HANDLE), ('hThread', w.HANDLE), ('dwProcessId', w.DWORD), ('dwThreadId', w.DWORD)]

k.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]
k.CreateJobObjectW.restype = w.HANDLE
k.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
k.QueryInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p]
k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
k.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
k.CreateProcessW.argtypes = [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD, c.c_void_p, w.LPCWSTR, c.POINTER(STARTUPINFO), c.POINTER(PROCESSINFO)]
k.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
k.WaitForSingleObject.restype = w.DWORD
k.ResumeThread.argtypes = [w.HANDLE]
k.ResumeThread.restype = w.DWORD
k.CloseHandle.argtypes = [w.HANDLE]

def require(ok, operation):
    if not ok:
        raise OSError(c.get_last_error(), operation)

def emit(value):
    print(json.dumps(value, separators=(',', ':')), flush=True)

def run():
    request = json.loads(sys.stdin.readline(65537))
    terminal, ini, runner = request['terminal'], request['ini'], request['directory']
    if not os.path.isabs(runner) or os.path.normcase(os.path.dirname(terminal)) != os.path.normcase(runner) or os.path.normcase(os.path.dirname(ini)) != os.path.normcase(runner) or os.path.basename(terminal).lower() != 'terminal64.exe':
        raise ValueError('Tester inputs must belong to the private runner')
    canceled = threading.Event()
    def commands():
        for line in sys.stdin:
            if line.strip() == 'cancel':
                canceled.set()
        canceled.set()  # Controller died or explicitly closed the pipe.
    threading.Thread(target=commands, daemon=True).start()
    job = None
    process = PROCESSINFO()
    assigned = False
    error = None
    cleanup = False
    try:
        job = k.CreateJobObjectW(None, None)
        require(job, 'CreateJobObjectW')
        limits = EXTENDED_LIMIT()
        limits.BasicLimitInformation.LimitFlags = 0x2000  # KILL_ON_JOB_CLOSE; no breakaway.
        require(k.SetInformationJobObject(job, 9, c.byref(limits), c.sizeof(limits)), 'SetInformationJobObject')
        startup = STARTUPINFO()
        startup.cb = c.sizeof(startup)
        command = c.create_unicode_buffer(subprocess.list2cmdline([terminal, '/portable', '/config:' + ini]))
        require(k.CreateProcessW(terminal, command, None, None, False, 0x4, None, runner, c.byref(startup), c.byref(process)), 'CreateProcessW suspended')
        require(k.AssignProcessToJobObject(job, process.hProcess), 'AssignProcessToJobObject')
        assigned = True
        require(k.ResumeThread(process.hThread) != 0xffffffff, 'ResumeThread')
        emit({'type': 'started', 'pid': process.dwProcessId, 'jobOwned': True})
        deadline = time.monotonic() + 900
        while k.WaitForSingleObject(process.hProcess, 100) != 0:
            if canceled.is_set() or time.monotonic() >= deadline:
                error = 'Tester canceled' if canceled.is_set() else 'Tester exceeded 15 minutes'
                break
    except Exception as cause:
        error = str(cause)
    finally:
        # A suspended process that could not join the Job is still owned here.
        if process.hProcess and not assigned:
            require(k.TerminateProcess(process.hProcess, 1), 'Terminate unassigned Tester')
            require(k.WaitForSingleObject(process.hProcess, 2000) == 0, 'Unassigned Tester exit')
        if job:
            require(k.TerminateJobObject(job, 1), 'Terminate Tester Job')
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                accounting = ACCOUNTING()
                require(k.QueryInformationJobObject(job, 1, c.byref(accounting), c.sizeof(accounting), None), 'Query Tester Job')
                if accounting.ActiveProcesses == 0:
                    cleanup = True
                    break
                time.sleep(0.05)
        else:
            cleanup = not process.hProcess
        for handle in (process.hThread, process.hProcess, job):
            if handle:
                k.CloseHandle(handle)
    emit({'type': 'result', 'ok': error is None and cleanup, 'error': error, 'cleanup': {'confirmed': cleanup, 'activeProcesses': 0 if cleanup else None}, 'code': None if cleanup else 'runtime_cleanup_failed'})

try:
    run()
except Exception as error:
    # Without a positive Job receipt, the host must preserve task files.
    emit({'type': 'result', 'ok': False, 'error': str(error), 'code': 'runtime_cleanup_failed', 'cleanup': {'confirmed': False, 'activeProcesses': None}})
    sys.exit(1)
