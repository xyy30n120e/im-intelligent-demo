# IM 演示项目（im-intelligent-demo）

基于 **Electron + React** 的桌面端 IM 工具演示，内置 AI 智能卡片能力。

## 简介

- 多会话聊天
- **AI 智能卡片**：可读取日程 / 待办，并支持需求一键写入
- 演示内置多账户切换（陈总 / 王雪瑶 / 李明轩 / 张三）

> ⚠️ 当前版本中，审批模块仍在开发中，尚未包含完整审批流。

## 技术栈

| 类别 | 选型 |
|------|------|
| 框架 | Electron 33 + React 19 + TypeScript |
| 构建 | Vite 6 |
| 状态管理 | Zustand 5 |
| 样式 | Tailwind CSS 3 |
| 打包 | electron-builder |

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置大模型（可选）

复制环境变量模板并填入密钥：

```bash
cp .env.example .env
```

编辑 `.env`：

```env
# 默认接入 DeepSeek，填入你的 API Key
# https://platform.deepseek.com/api_keys
VITE_LLM_API_KEY=你的Key

# 可选：自定义接口地址与模型（不填则用默认值）
# VITE_LLM_BASE_URL=https://api.deepseek.com
# VITE_LLM_MODEL=deepseek-chat
```

> 不填 `VITE_LLM_API_KEY` 时，AI 意图识别会自动回退到本地关键词 mock，应用仍可正常运行。

### 3. 启动开发模式

带桌面窗口运行：

```bash
npm run electron:dev
```

仅做网页调试（浏览器打开 http://localhost:5173）：

```bash
npm run dev
```

### 4. 打包为桌面应用

```bash
npm run electron:build
```

## 目录结构（简化）

```
src/
  components/   # 界面组件（聊天面板、AI 卡片、日程/待办等）
  store/        # Zustand 状态
  services/     # AI 意图识别等逻辑
  data/         # 演示数据（mock）
electron/       # Electron 主进程
```

## 安全提示

- `.env` 包含大模型密钥，**请勿提交上传**。本项目 `.gitignore` 已排除 `.env`、`dist/` 等。
- 由于前端项目会把 `VITE_` 前缀变量内联进打包产物，`dist/` 切勿发布到公开可下载处。
