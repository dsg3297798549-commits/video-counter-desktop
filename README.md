# 成片计数仪 · Video Counter

Windows 桌面应用（Electron），用于统计剪辑成片数量。

## 功能

- 拖拽 / 粘贴截图到窗口，自动识别画面中的成片数量
- 按条目累计「一共剪了多少视频」
- 窗口可锁定位置，并钉在**桌面壁纸/图标层**（不浮在其他应用之上）
- 支持中文 / 英文多语言版本分别计数
- 台账落盘为 `state.json`，可导出月报

## 目录结构

```
src/
  main.js        主进程：窗口创建、Z 序钉位、配置持久化
  preload.js     预加载脚本，暴露安全 IPC 接口
  app.js         渲染层逻辑：截图识别、计数、统计展示
  index.html     界面结构
  style.css      界面样式
  helper.ps1     原生辅助脚本：Z 序钉位 / 窗口位置读写
  icon.png       应用图标
scripts/
  make-shortcut-com.py  用 ctypes 生成桌面快捷方式
  final-verify.py       端到端验证脚本
```

## 开发

```bash
npm install
npm start        # 开发模式
```

## 打包

```bash
npm run build
```

产物为便携单文件 `成片计数仪-<version>.exe`。

> 打包需要 electron-builder 缓存（winCodeSign / nsis / nsis-resources）。
> 若网络不通，可手动下载后解压到 `%LOCALAPPDATA%\electron-builder\Cache\` 对应目录。

## 使用说明

见 [使用说明.md](./使用说明.md)。
