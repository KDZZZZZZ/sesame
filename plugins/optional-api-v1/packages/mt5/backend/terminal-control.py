"""Inspect/close only the configured terminal, using the native Windows lifecycle.

Runs in the terminal's Windows/Wine Python. Never clicks controls, kills Wine,
or matches a Tester instance merely because it has the same executable name.
"""
import ctypes as c
from ctypes import wintypes as w
import json
import os
import sys

k = c.WinDLL('kernel32', use_last_error=True)
u = c.WinDLL('user32', use_last_error=True)
k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]
k.OpenProcess.restype = w.HANDLE
k.CloseHandle.argtypes = [w.HANDLE]
k.QueryFullProcessImageNameW.argtypes = [w.HANDLE, w.DWORD, w.LPWSTR, c.POINTER(w.DWORD)]
k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
u.GetWindowThreadProcessId.argtypes = [w.HWND, c.POINTER(w.DWORD)]
u.GetWindow.argtypes = [w.HWND, w.UINT]
u.GetWindow.restype = w.HWND
u.GetClassNameW.argtypes = [w.HWND, w.LPWSTR, c.c_int]
u.PostMessageW.argtypes = [w.HWND, w.UINT, w.WPARAM, w.LPARAM]
callback_type = c.WINFUNCTYPE(w.BOOL, w.HWND, w.LPARAM)
u.EnumWindows.argtypes = [callback_type, w.LPARAM]

action, terminal = sys.argv[1:]
if action not in ('inspect', 'close'):
    raise ValueError('Unsupported terminal operation')
found = {}

@callback_type
def visit(hwnd, _):
    if u.GetWindow(hwnd, 4):  # Only unowned top-level windows, not dialogs.
        return True
    window_class = c.create_unicode_buffer(256)
    u.GetClassNameW(hwnd, window_class, 256)
    if window_class.value != 'MetaQuotes::MetaTrader::5.00':
        return True
    pid = w.DWORD()
    u.GetWindowThreadProcessId(hwnd, c.byref(pid))
    handle = k.OpenProcess(0x1000 | 0x100000, False, pid.value)
    if not handle:
        return True
    try:
        path, size = c.create_unicode_buffer(32768), w.DWORD(32768)
        if k.QueryFullProcessImageNameW(handle, 0, path, c.byref(size)):
            try:
                matches = os.path.samefile(path.value, terminal)
            except OSError:
                matches = False
            if matches:
                found.setdefault(pid.value, []).append(int(hwnd))
    finally:
        k.CloseHandle(handle)
    return True

u.EnumWindows(visit, 0)
if len(found) != 1:
    raise RuntimeError('Expected exactly one terminal with a native window; found ' + str(len(found)))
pid, windows = next(iter(found.items()))
if action == 'close':
    handle = k.OpenProcess(0x100000, False, pid)
    if not handle:
        raise RuntimeError('Terminal process is no longer available')
    try:
        for hwnd in windows:
            if not u.PostMessageW(hwnd, 0x0010, 0, 0):  # WM_CLOSE, graceful exit.
                raise RuntimeError('Terminal did not accept its close request')
        if k.WaitForSingleObject(handle, 25000) != 0:
            raise RuntimeError('Terminal did not exit; no force kill or second instance was attempted')
    finally:
        k.CloseHandle(handle)
print(json.dumps({'pid': pid, 'windows': len(windows), 'status': 'closed' if action == 'close' else 'identified'}))
