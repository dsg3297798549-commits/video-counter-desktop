#!/usr/bin/env python3
# 通过 ctypes 调用 Windows Shell 的 IShellLinkW + IPersistFile 生成标准 .lnk
# 不经过 PowerShell/COM 拦截，纯用户态调用 ole32/shell32
import ctypes, ctypes.wintypes as wt, os, sys

ole32 = ctypes.OleDLL('ole32')
shell32 = ctypes.WinDLL('shell32')

CLSID_ShellLink = '{00021401-0000-0000-C000-000000000046}'
IID_IShellLinkW = '{000214F9-0000-0000-C000-000000000046}'
IID_IPersistFile = '{0000010B-0000-0000-C000-000000000046}'


class GUID(ctypes.Structure):
    _fields_ = [
        ('Data1', ctypes.c_uint32),
        ('Data2', ctypes.c_uint16),
        ('Data3', ctypes.c_uint16),
        ('Data4', ctypes.c_ubyte * 8),
    ]


def parse_guid(s):
    s = s.strip('{}')
    a, b, c, d, e = s.split('-')
    g = GUID()
    g.Data1 = int(a, 16)
    g.Data2 = int(b, 16)
    g.Data3 = int(c, 16)
    tail = (d + e)
    tail = (tail + '0' * 32)[:32]
    for i in range(8):
        g.Data4[i] = int(tail[i * 2:i * 2 + 2], 16)
    return g


def com_hresult(hr):
    if hr < 0:
        raise OSError(f'COM error 0x{hr & 0xFFFFFFFF:08X}')


def main():
    target = r"C:\Users\aurora\AppData\Local\Programs\成片计数仪\成片计数仪.exe"
    workdir = r"C:\Users\aurora\AppData\Local\Programs\成片计数仪"
    desc = "成片计数仪 - 桌面嵌入式投放终端"
    out = os.path.join(os.path.expanduser('~'), 'Desktop', '成片计数仪.lnk')
    if len(sys.argv) > 1:
        out = sys.argv[1]

    shell_link = ctypes.c_void_p()
    ole32.CoInitialize(None)
    com_hresult(ole32.CoCreateInstance(
        ctypes.byref(parse_guid(CLSID_ShellLink)), None, 1,
        ctypes.byref(parse_guid(IID_IShellLinkW)), ctypes.byref(shell_link)))

    def method(idx, restype, argtypes):
        vtbl_ptr = ctypes.cast(shell_link, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        addr = vtbl_ptr[idx]
        return ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)(addr)

    SetPath = method(20, ctypes.c_long, [ctypes.c_wchar_p])
    SetWorkingDirectory = method(9, ctypes.c_long, [ctypes.c_wchar_p])
    SetDescription = method(7, ctypes.c_long, [ctypes.c_wchar_p])
    SetIconLocation = method(17, ctypes.c_long, [ctypes.c_wchar_p, ctypes.c_int])
    Resolve = method(19, ctypes.c_long, [wt.HWND, ctypes.c_long])

    com_hresult(SetPath(shell_link, target))
    com_hresult(SetWorkingDirectory(shell_link, workdir))
    com_hresult(SetDescription(shell_link, desc))
    com_hresult(SetIconLocation(shell_link, target, 0))
    # Resolve 让 Shell 生成有效的 IDList（否则 lnk 无关联）
    Resolve(shell_link, None, 0x00000000 | 0x00000001)  # SLLR_UNKNOWN | SLR_NO_UI

    # QI for IPersistFile
    persist = ctypes.c_void_p()
    qi = method(0, ctypes.c_long, [ctypes.c_void_p, ctypes.c_void_p])
    com_hresult(qi(shell_link, ctypes.byref(parse_guid(IID_IPersistFile)), ctypes.byref(persist)))
    pv = ctypes.cast(persist, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents

    def pmethod(idx, restype, argtypes):
        addr = pv[idx]
        return ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)(addr)

    Save = pmethod(6, ctypes.c_long, [ctypes.c_wchar_p, ctypes.c_long])
    com_hresult(Save(persist, out, 0))  # STGM_CREATE=0x1000 -> 用 0 让系统默认
    # 上面的 Save 参数是 Save(pszFileName, fRemember)
    print('saved:', out, os.path.getsize(out), 'bytes')


if __name__ == '__main__':
    main()
