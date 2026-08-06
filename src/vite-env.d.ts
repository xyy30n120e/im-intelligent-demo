/// <reference types="vite/client" />

interface Window {
  electronAPI?: {
    minimize: () => void;
    maximize: () => void;
    close: () => void;
  };
}

interface ImportMetaEnv {
  /** 通用大模型 API Key（OpenAI 兼容接口）。不填则回退到本地关键词 mock。默认接入 DeepSeek。 */
  readonly VITE_LLM_API_KEY?: string;
  /** 可选：自定义接口 base_url（如 https://api.deepseek.com 或 https://api.hunyuan.cloud.tencent.com/v1）。默认走 vite dev proxy /api/llm。 */
  readonly VITE_LLM_BASE_URL?: string;
  /** 可选：模型名（默认 deepseek-chat）。 */
  readonly VITE_LLM_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
