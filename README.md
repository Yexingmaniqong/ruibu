# RUIBU · 笔记 / 日记 / 思维导图

一个**纯本地**的笔记应用：笔记里可以图文自由穿插，一条笔记能展开成思维导图，日记按天自动归档，还接了 DeepSeek 做 AI 问答（问答结果可以选中后写回笔记）。

零构建链、零第三方框架、离线可用；同一套代码可以当**网页**、装成 **PWA**、打成 **Android APK**、或者跑成 **Windows 桌面版**。

> 个人项目，自用为主。没有账号体系，没有云端同步，所有数据都存在你自己的设备里。

---

## 功能

**笔记**

- 图文混排：文字块里可以夹图片（行内图），图片也能单独成块，一行四个的网格
- 长按拖动图片：拖到文字中间会显示绿色插入线；拖到两张图中间可以插入；拖到某张图正中间则两张互换
- 标签：输入 `#标签名` 再按空格，自动变成蓝色标签块；工具条的 `#` 可以选已有标签
- 公式：支持 `$$…$$`、`$…$`，以及**裸写的 LaTeX**（直接写 `\dfrac{dy}{dx}` 就会排版），内置离线 KaTeX
- 轻量标记：`**粗体**`、`- 列表`、`1. 列表`
- 右键 / 长按笔记卡片可以直接删除、加图、设为日记

**日记**

- 侧栏「日记」：最近 14 天日期条 + 按天分组的时间线
- 日记笔记不显示画布入口，保持轻量

**思维导图**

- 每条笔记都可以创建画布；也可以在「关系画布」里把多条笔记连成一张大图
- 自研无限画布：拖动 / 双指缩放 / 从边缘圆点拖出箭头 / 缩放旋转手柄
- 导出兼容 Obsidian 的 `.canvas` 格式

**AI 问答（DeepSeek）**

- 侧栏「AI 问答」，多轮对话，历史本地保存
- 回答可以整条「加到笔记」，也可以**选中一段**再加到指定笔记
- 支持给 AI 发图片（是否可用取决于模型是否支持视觉）

**其它**

- 纯本地存储（IndexedDB），无账号、无追踪、无遥测
- PWA：可安装、离线可用
- 导入/导出：JSON 备份、`.canvas`、flomo 导出文件

---

## 三种用法

### 1. 网页 / PWA

```bash
# 任选一种静态服务器
python -m http.server 8899
# 或
node sync-server.js 8899
```

浏览器打开 `http://127.0.0.1:8899`。手机在同一 Wi-Fi 下访问 `http://<电脑IP>:8899`，
用浏览器菜单「添加到主屏幕」即可当 App 用（PWA 安装需要 HTTPS 或 localhost）。

### 2. Android APK

`Releases` 里下载 `RUIBU-*.apk`，传到手机安装（需要允许「未知来源」）。

APK 内部自带一个只监听 `127.0.0.1` 的极简 HTTP 服务，网页本体从 APK 的 `assets/` 提供，
所以 IndexedDB、Service Worker、离线缓存都正常工作，不依赖任何外部服务器。

### 3. Windows 桌面版

`Releases` 里下载 `RUIBU-*-win64.zip`，解压后双击 `RUIBU.exe`；
或双击 `安装到本机.cmd` 装到 `%LOCALAPPDATA%\Programs\RUIBU` 并创建快捷方式。

桌面版本质是 Electron 套壳 + 主进程里起同一个本地服务。

---

## 配置 AI

1. 去 <https://platform.deepseek.com> 申请 API Key（`sk-…`）
2. 打开应用 → 设置 → AI（DeepSeek）→ 填入 Key → 保存 → 测试连接

API Key 只保存在**本机浏览器 localStorage**，不会写进笔记数据，也不会上传。
提问时由本机服务转发到 `api.deepseek.com`（网页直连会被跨域拦掉）。

---

## 数据与隐私

- 所有笔记、图片、画布都存在本地 IndexedDB；桌面版/安卓版另有自己的数据目录
- **没有**多端同步、没有云端账号，数据不会离开你的设备
- 仓库里不带任何用户数据：`sync-data.json`（本地服务的数据文件）已被 `.gitignore` 忽略
- 唯一的对外请求是：你自己配了 Key 时的 DeepSeek 问答

---

## 目录结构

```
.
├── index.html          单页应用骨架 + 内联 SVG 图标
├── css/style.css       全部样式（flomo 风格 · 三端自适应）
├── js/
│   ├── app.js          路由与视图：笔记流 / 日记 / 笔记详情 / 编辑条 / AI 面板
│   ├── canvas.js       自研无限画布引擎（DOM 节点 + SVG 连线）
│   ├── render.js       轻量富文本渲染（公式 / 粗体 / 标签 / 列表）
│   ├── store.js        数据层：笔记 / 画布 / 图片压缩 / 导入导出
│   ├── db.js           IndexedDB 封装
│   ├── ai.js           DeepSeek 客户端（本地代理 + 直连兜底）
│   └── ui.js           弹层 / 确认框 / toast / 选择器
├── vendor/katex/       离线 KaTeX（js + css + 字体）
├── sw.js               Service Worker（代码网络优先，离线回退）
├── sync-server.js      零依赖 Node 本地服务：托管页面 + AI 代理
├── manifest.json       PWA 清单
└── icon*.png/svg       应用图标
```

---

## 本地开发

没有构建步骤，改完刷新即可。唯一的坑是 Service Worker 缓存：

- `sw.js` 对 html/css/js 是**网络优先**，正常情况下刷新就能拿到新代码
- 如果界面没变，用设置页的「清除缓存并重新载入」，或 `Ctrl + Shift + R`

`sync-server.js` 除了托管静态文件，还提供 `POST /api/ai` 把请求转发给 DeepSeek
（浏览器直连 `api.deepseek.com` 会被 CORS 拦掉）。

---

## 已知限制

- 没有云端同步（这是有意的取舍：不要账号、不要服务器）
- AI 问答需要自备 DeepSeek API Key，且是否支持图片取决于模型
- Windows / APK 包未做代码签名，系统会提示「未知发布者」
- 公式渲染依赖 KaTeX，体积约 550KB（已内置，不联网）

---

## License

MIT
