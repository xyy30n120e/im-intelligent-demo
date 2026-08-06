import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig(({ mode }) => {
  // 读取 .env，用于动态设置 dev proxy 转发目标
  const env = loadEnv(mode, process.cwd(), '')
  const llmTarget = env.VITE_LLM_BASE_URL || 'https://api.deepseek.com'

  return {
    plugins: [react()],
    base: './',
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        // 开发期把大模型请求代理到真实 base，避开浏览器 CORS；生产环境需走后端代理并隐藏 Key
        '/api/llm': {
          target: llmTarget,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/llm/, ''),
        },
      },
    },
  }
})
