$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class VW {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindow(string c, string n);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cl, string w);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int x, int y, int cx, int cy, uint f);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetWindowLongPtr(IntPtr h, int i, IntPtr v);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern bool SetThreadDpiAwarenessContext(IntPtr v);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
}
"@
try { [VW]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}
try { [VW]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch {}

$script:GWL_EXSTYLE = -20
$script:WS_EX_NOACTIVATE = 0x08000000
$script:WS_EX_TOOLWINDOW = 0x00000080
$script:WS_EX_APPWINDOW = 0x00040000

# SWP flags
$script:SWP_NOSIZE = 0x0001
$script:SWP_NOMOVE = 0x0002
$script:SWP_NOZORDER = 0x0004
$script:SWP_NOACTIVATE = 0x0010
$script:SWP_NOOWNERZORDER = 0x0200

# 找到桌面壁纸/图标层的宿主窗口（Progman，其子窗口 SHELLDLL_DefView 承载桌面图标）
function Get-DesktopProgman {
  $script:pm = [IntPtr]::Zero
  $script:pmArea = 0
  $cb = [VW+EnumProc]{
    param($w, $l)
    $sb = New-Object System.Text.StringBuilder 256
    $null = [VW]::GetClassName($w, $sb, 256)
    if ($sb.ToString() -eq "Progman") {
      $dv = [VW]::FindWindowEx($w, [IntPtr]::Zero, "SHELLDLL_DefView", $null)
      if ($dv -ne [IntPtr]::Zero) {
        $rr = [VW+RECT]::new()
        [VW]::GetWindowRect($w, [ref]$rr) | Out-Null
        $area = ([int]$rr.Right - [int]$rr.Left) * ([int]$rr.Bottom - [int]$rr.Top)
        if ($area -gt $script:pmArea) { $script:pmArea = $area; $script:pm = $w }
      }
    }
    return $true
  }
  $null = [VW]::EnumWindows($cb, [IntPtr]::Zero)
  if ($script:pm -ne [IntPtr]::Zero) { return $script:pm }
  $p2 = [VW]::FindWindow("Progman", $null)
  if ($p2 -ne [IntPtr]::Zero) { return $p2 }
  return [IntPtr]::Zero
}

# 枚举顶层窗口（EnumWindows 返回顺序即 Z 序，从上到下）
function Get-TopWindows {
  $script:list = New-Object System.Collections.ArrayList
  $cb = [VW+EnumProc]{
    param($w, $l)
    $null = $script:list.Add($w)
    return $true
  }
  $null = [VW]::EnumWindows($cb, [IntPtr]::Zero)
  return $script:list
}

# 找出 Z 序中紧邻 $target 上方的那一层窗口，作为插入参照。
# SetWindowPos(h, insertAfter=W) 会把 h 放到 W 的「下面一层」，
# 即 h 紧贴在 W 之下 —— 而 W 恰好在 Progman 之上，于是 h 就落在 Progman 正上方。
function Get-ZInsertAfter($target) {
  $lst = Get-TopWindows
  for ($i = 0; $i -lt $lst.Count; $i++) {
    if ($lst[$i] -eq $target) {
      if ($i -eq 0) { return [IntPtr]::Zero }
      return $lst[$i - 1]
    }
  }
  return [IntPtr]::Zero
}

# 把窗口钉到桌面层正上方：Z 序位置 = 紧贴 Progman 之上（壁纸/图标之上、所有应用窗口之下）
function Pin-ToDesktopLayer($h) {
  $pm = Get-DesktopProgman
  if ($pm -eq [IntPtr]::Zero) { return 0 }
  $ins = Get-ZInsertAfter $pm
  # 只改 Z 序，不动位置尺寸
  [VW]::SetWindowPos($h, $ins, 0, 0, 0, 0, $script:SWP_NOSIZE -bor $script:SWP_NOMOVE -bor $script:SWP_NOACTIVATE -bor $script:SWP_NOOWNERZORDER) | Out-Null
  return $pm.ToInt64()
}

function Unpin-FromDesktopLayer($h) {
  $ex = [VW]::GetWindowLongPtr($h, $script:GWL_EXSTYLE).ToInt64()
  $ex = ($ex -band (-bnot $script:WS_EX_NOACTIVATE))
  [VW]::SetWindowLongPtr($h, $script:GWL_EXSTYLE, [IntPtr]$ex) | Out-Null
  [VW]::SetWindowPos($h, [IntPtr]::Zero, 0, 0, 0, 0, $script:SWP_NOSIZE -bor $script:SWP_NOMOVE -bor $script:SWP_NOACTIVATE -bor $script:SWP_NOOWNERZORDER) | Out-Null
  return 1
}

# 读取窗口屏幕物理坐标（顶层窗口，GetWindowRect 即屏幕坐标）
function Get-ScreenPos($h) {
  $r = [VW+RECT]::new()
  [VW]::GetWindowRect($h, [ref]$r) | Out-Null
  return @([int]$r.Left, [int]$r.Top)
}

# 设置窗口屏幕物理坐标（顶层窗口，x/y 即屏幕坐标）
function Set-ScreenPos($h, $sx, $sy) {
  [VW]::SetWindowPos($h, [IntPtr]::Zero, [int]$sx, [int]$sy, 0, 0, $script:SWP_NOSIZE -bor $script:SWP_NOZORDER -bor $script:SWP_NOACTIVATE) | Out-Null
}

while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $o = $line | ConvertFrom-Json
    $h = [IntPtr][int64]$o.hwnd
    $id = $o.id
    switch ($o.cmd) {
      "embed" {
        $pm = Pin-ToDesktopLayer $h
        if ($pm -eq 0) { Write-Output ("ERR " + $id + " no desktop layer"); break }
        Set-ScreenPos $h ([int]$o.x) ([int]$o.y)
        Write-Output ("OK " + $id + " 1")
      }
      "unembed" {
        $pos = Get-ScreenPos $h
        Unpin-FromDesktopLayer $h
        Set-ScreenPos $h $pos[0] $pos[1]
        Write-Output ("OK " + $id + " 1")
      }
      "pin" {
        $pm = Pin-ToDesktopLayer $h
        Write-Output ("OK " + $id + " " + $pm)
      }
      "setpos" {
        Set-ScreenPos $h ([int]$o.x) ([int]$o.y)
        Write-Output ("OK " + $id + " 1")
      }
      "getpos" {
        $pos = Get-ScreenPos $h
        Write-Output ("OK " + $id + " " + $pos[0] + " " + $pos[1])
      }
      "verify" {
        $pm = Get-DesktopProgman
        $lst = Get-TopWindows
        $idx = -1; $pmIdx = -1
        for ($i = 0; $i -lt $lst.Count; $i++) {
          if ($lst[$i] -eq $h) { $idx = $i }
          if ($lst[$i] -eq $pm) { $pmIdx = $i }
        }
        $below = 0; $belowCls = ""
        if ($idx -ge 0 -and $idx -lt ($lst.Count - 1)) {
          $below = $lst[$idx + 1].ToInt64()
          $sb = New-Object System.Text.StringBuilder 256
          $null = [VW]::GetClassName($lst[$idx + 1], $sb, 256)
          $belowCls = $sb.ToString()
        }
        Write-Output ("OK " + $id + " progman=" + $pm.ToInt64() + " pmZIndex=" + $pmIdx + " myZIndex=" + $idx + " total=" + $lst.Count + " below=" + $below + " belowClass=" + $belowCls)
      }
      default { Write-Output ("ERR " + $id + " unknown") }
    }
  } catch {
    Write-Output ("ERR " + $id + " " + $_.Exception.Message)
  }
  [Console]::Out.Flush()
}
