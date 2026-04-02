# AI 学习收容仓（Electron + React + TypeScript）

一个本地桌面学习助手：支持文件导入预览、流式 AI 问答、文件拖拽分析、语音识别输入。

## 功能概览

- 多文件导入与预览
  - 文本：`txt` / `md`
  - 文档：`docx` / `pdf`
  - 图片：`png` / `jpg` / `jpeg` / `gif` / `webp` / `bmp` / `svg`
  - 媒体：`mp3` / `wav` / `ogg` / `aac` / `flac` / `mp4` / `webm` / `mov` / `mkv`
- AI 问答
  - 普通问答
  - 流式问答（支持中断）
  - 拖拽多个文件到 AI 区域后进行联动分析
- 语音输入
  - 前端录音（MediaRecorder）
  - 调用 ASR 识别后自动回填输入框

## 技术栈

- Electron
- React 18 + TypeScript
- Vite
- `mammoth`（DOCX 转 HTML）

## 目录结构

- `electron/main.ts`：主进程，负责文件读取、AI/ASR/TTS 调用、IPC
- `electron/preload.ts`：安全暴露 `window.appAPI`
- `src/App.tsx`：当前主界面与交互逻辑
- `src/vite-env.d.ts`：渲染层类型声明

## 环境要求

- Node.js 18+
- npm 9+
- Windows / macOS / Linux

## 快速开始

1) 安装依赖

```bash
cd app
npm install
```

2) 配置环境变量

在 `app` 目录下创建 `.env`（可从 `.env.example` 复制）：

```bash
cp .env.example .env
```

至少要填写：

- `ARK_API_KEY=你的密钥`

3) 启动开发

```bash
npm run dev
```

4) 构建打包

```bash
npm run build
```

## 环境变量说明

见 `app/.env.example`。

常用项：

- `ARK_API_KEY`：必填，豆包/方舟 API Key
- `ARK_CHAT_MODEL`：聊天模型
- `ARK_ASR_MODEL`：语音识别模型
- `ARK_TTS_MODEL`：语音合成模型
- `ARK_TTS_VOICE`：音色
- `ARK_CHAT_ENDPOINT` / `ARK_ASR_ENDPOINT` / `ARK_TTS_ENDPOINT`：可选自定义端点

## 常见问题

### 1) 提示未检测到 ARK_API_KEY

请检查：

- `app/.env` 文件是否存在
- `ARK_API_KEY` 是否填写且无多余空格
- 修改后是否重启 Electron 应用

### 2) 语音按钮点击后失败

可能原因：

- 未授予麦克风权限
- 设备无可用输入音频
- 网络或 ASR 模型配置异常

### 3) 流式回答中断后无响应

已支持“停止生成”，中断后可直接再次输入并发送。
若偶发异常，建议重新发起一轮请求。

## 安全说明

- 渲染层仅通过 `window.appAPI` 调用白名单 IPC。
- 不再暴露通用 `ipcRenderer`，降低误用与注入风险。

## 当前版本状态

当前已完成 Day 1 主链路收口：

- IPC 接口对齐
- 语音输入闭环
- 流式中断与状态一致性

后续建议继续按根目录 `2天收口计划.md` 执行 Day 2 项。
