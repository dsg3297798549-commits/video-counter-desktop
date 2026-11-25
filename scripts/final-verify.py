"""最终端到端验证：走桌面快捷方式启动，验证窗口/坐标/Z序/配置"""
import ctypes, ctypes.wintypes as wt, subprocess, time, os, json

u = ctypes.WinDLL('user32')


def app_pids():
    tl = subprocess.run(['tasklist', '/FO', 'CSV', '/NH'], capture_output=True)
    d = tl.stdout.decode('mbcs', errors='replace')
    out = set()
    for l in d.splitlines():
        p = [x.strip('"') for x in l.split('","')]
        if p and '成片' in p[0]:
            out.add(int(p[1]))
    return out


def find_win(pids):
    found = []
    EP = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def cb(h, l):
        pid = wt.DWORD()
        u.GetWindowThreadProcessId(h, ctypes.byref(pid))
        if pid.value in pids:
            cls = ctypes.create_unicode_buffer(256)
            u.GetClassNameW(h, cls, 256)
            r = wt.RECT()
            u.GetWindowRect(h, ctypes.byref(r))
            if u.IsWindowVisible(h) and (r.right - r.left) > 50:
                found.append((h, pid.value, cls.value, (r.left, r.top, r.right, r.bottom)))
        return True

    u.EnumWindows(EP(cb), 0)
    return found


def zpos(h):
    lst = []
    EP = ctypes.WINFUNCTYPE(wt.BOOL, wt.HWND, wt.LPARAM)

    def cb(hh, l):
        lst.append(hh)
        return True

    u.EnumWindows(EP(cb), 0)
    if h not in lst:
        return -1, len(lst), None
    i = lst.index(h)
    below = None
    if i + 1 < len(lst):
        c = ctypes.create_unicode_buffer(256)
        u.GetClassNameW(lst[i + 1], c, 256)
        below = c.value
    return i, len(lst), below


# 清掉旧实例
for pid in app_pids():
    subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], capture_output=True)
time.sleep(2)

# 走快捷方式启动（模拟双击）
shell32 = ctypes.WinDLL('shell32')
os.environ.pop('ELECTRON_RUN_AS_NODE', None)
r = shell32.ShellExecuteW(None, 'open', r'C:\Users\aurora\Desktop\成片计数仪.lnk', None, None, 1)
print('ShellExecute(lnk) ret =', r, '(42 = 成功)')
time.sleep(12)

pids = app_pids()
print('应用进程数:', len(pids))
wins = find_win(pids)
if not wins:
    print('!! 未找到窗口')
else:
    h, pid, cls, rect = wins[0]
    i, total, below = zpos(h)
    print(f'窗口: class={cls} rect={rect} size={rect[2]-rect[0]}x{rect[3]-rect[1]}')
    print(f'Z序: {i}/{total} 下一层={below}  -> {"已嵌入桌面图标层上方" if below == "Progman" else "未嵌入"}')

cfgp = r'C:\Users\aurora\AppData\Roaming\VideoCounterDesktop\config.json'
cfg = json.load(open(cfgp, encoding='utf-8'))
print('配置窗口:', cfg['window'])
print('投递箱:', cfg['inbox'])
print('工具目录:', cfg['toolDir'])
print('每日处理时间:', cfg['processTime'], '| 内容线:', cfg['lines'])
print('配置坐标与实际窗口一致:', cfg['window']['x'] == rect[0] and cfg['window']['y'] == rect[1])
