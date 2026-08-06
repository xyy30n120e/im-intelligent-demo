/**
 * 通用大模型客户端（OpenAI 兼容接口）。
 *
 * 默认接入 DeepSeek：https://api.deepseek.com
 * 任何兼容 OpenAI /chat/completions 协议的厂商（DeepSeek、腾讯混元、通义、智谱等）都可直接通过
 * 环境变量切换，无需改动代码逻辑。
 *
 * 通过 response_format=json_object 拿到结构化意图识别结果：
 *   { intent: "schedule"|"todo"|"request"|"none", confidence: 0~1, extracted: {...} }
 *
 * 没有配置 API Key 时，调用方（aiService.analyzeChatMessage）会自动回退到本地 mock，
 * 因此本文件不依赖 mock，保持单向依赖。
 *
 * 环境变量：
 *   VITE_LLM_API_KEY   必填（启用真实模型）
 *   VITE_LLM_BASE_URL  可选，真实接口 base（含 /v1 与否取决于厂商）；dev 下默认走 /api/llm 代理
 *   VITE_LLM_MODEL     可选，模型名（默认 deepseek-chat）
 * dev 环境走 vite proxy /api/llm 转发，避开浏览器 CORS。
 */

export type LLMIntentType = 'schedule' | 'todo' | 'request' | 'none';

export interface LLMIntentResult {
  intent: LLMIntentType;
  confidence: number;
  extracted: Record<string, any>;
  /**
   * 当前消息是否是「对已有草稿卡片的补充/修改」（同一事项，只新增或变更字段）。
   * true 时，调用方应把本次抽取结果合并进 updateTargetId 对应的卡片，而非新建。
   */
  isUpdate?: boolean;
}

/** 提供给大模型的上下文：最近对话历史 + 当前会话最新一张草稿卡片 */
export interface LLMHistoryMsg {
  role: 'user' | 'assistant';
  content: string;
}
export interface LLMLastCard {
  type: 'schedule' | 'todo' | 'request';
  summary: string;
  extracted: Record<string, any>;
}
export interface LLMContext {
  history?: LLMHistoryMsg[];
  lastCard?: LLMLastCard;
}

const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_BASE = 'https://api.deepseek.com';

function getConfig() {
  const apiKey = (import.meta.env.VITE_LLM_API_KEY as string | undefined)?.trim();
  const realBase =
    (import.meta.env.VITE_LLM_BASE_URL as string | undefined)?.trim() || DEFAULT_BASE;
  const model =
    (import.meta.env.VITE_LLM_MODEL as string | undefined)?.trim() || DEFAULT_MODEL;
  // dev 走本地代理避开 CORS；生产直接请求真实 base
  const baseUrl = import.meta.env.DEV ? '/api/llm' : realBase;
  return { apiKey, baseUrl, model };
}

export function hasLLMKey(): boolean {
  const key = (import.meta.env.VITE_LLM_API_KEY as string | undefined)?.trim();
  return !!key && key.length > 0;
}

const SYSTEM_PROMPT = `你是企业 IM（即时通讯）里的意图识别助手。给定一条聊天消息（可能附带「最近对话历史」和「已存在的草稿卡片」），判断它是否属于以下三类可执行的办公意图之一，并抽取关键字段。

类别定义：
- schedule（日程）：约定在未来某个时间做某事，如开会、面试、评审、见面、培训等。
- todo（待办）：需要完成的一项任务，如提交报告、准备材料、跟进某事项等。
- request（需求）：对产品/功能/系统的诉求、反馈或缺陷，如希望增加某功能、某页面崩溃、某操作失败等。

请只输出一个 JSON 对象（不要包含任何解释文字、不要使用 Markdown 代码块），结构如下：
{
  "intent": "schedule" | "todo" | "request" | "none",
  "isUpdate": true 或 false，表示当前消息是否是在「补充/修改已存在草稿卡片的同一件事」。请严格遵循：1) 只有当当前消息明确在给同一件事补充信息（如补充地点、参与人、改时间/改地点，或追加说明），并且你能从中抽取到至少一个要新增或变更的字段（location/participants/time/date 等）时，才给 isUpdate=true；此时 intent 设为与草稿相同的类别，extracted 返回「合并后」的完整字段（保留草稿已有字段，用新信息覆盖或补充）。2) 若当前消息是全新、不同的事项，或只是附和/确认/闲聊/表情/客套（如「好」「可以」「收到」「嗯」「👍」），isUpdate 必须为 false，并按实际情况判断 intent（可能是 none 或新建类别）。3) 仅因为「系统提供了草稿卡片」就给 isUpdate=true 是错误的——必须基于消息内容本身确有补充行为才可为 true。4) 若未提供草稿卡片，isUpdate 固定为 false。
  "confidence": 0.0 到 1.0 之间的小数，表示你对该判断的把握程度。仅当你相当确定事项已经敲定/成立时才给 >=0.8；不确定或消息含歧义时给较低值（如 0.4~0.7）；纯闲聊/问候/无 actionable 信息时给 "none" 且 confidence 可任意。
  重要：如果消息只是提议、商量、征求同意或尚未敲定（含「要不」「不如」「行不行」「可以吗」「好吗」「行吗」「建议」「提议」「考虑」「商量」「讨论」「请示」「待定」「暂定」「还没定」「未定」「大概」「可能」「或许」「大家觉得」「你们看」等），说明该事项尚未确认，应给较低 confidence（0.4~0.7），使其进入待确认流程由用户手动决定，而不是直接自动落卡。
  "extracted": {
    "event": "日程标题/事件名（schedule 时必填）",
    "date": "日期，格式尽量为 \"M月D日 周X\"，未知则留空字符串",
    "time": "时间，格式为 \"HH:MM\"，未知则留空字符串",
    "location": "地点，未知则留空字符串",
    "participants": "参与人，多个用中文逗号（，）分隔，未知则留空字符串",
    "task": "待办内容摘要（todo 时必填）",
    "deadline": "截止日期，格式同 date，未知则留空字符串",
    "detail": "补充说明（todo 时可选）",
    "description": "需求/问题的完整描述（request 时必填）",
    "issueType": "bug" 或 "feature"（命中崩溃/闪退/报错/异常/失败/无法/打不开/进不去 等词判为 bug，否则 feature）,
    "version": "相关上线版本号，如 \"10.1.2\"，未知则留空字符串
  }
}

注意：
- 仅当 intent 为 none 时，extracted 可留空对象 {}。
- 日期/时间尽量从原文推断；推断不出就留空字符串，不要编造。
- 全部使用中文。`;

function extractJson(content: string): any | null {
  if (!content) return null;
  let s = content.trim();
  // 去掉可能的 ```json ... ``` 包裹
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function normalize(raw: any): LLMIntentResult {
  const intent: LLMIntentType =
    raw && typeof raw.intent === 'string' && ['schedule', 'todo', 'request', 'none'].includes(raw.intent)
      ? raw.intent
      : 'none';
  let confidence = 0;
  const c = raw?.confidence;
  if (typeof c === 'number') confidence = Math.min(1, Math.max(0, c));
  else if (typeof c === 'string') confidence = Math.min(1, Math.max(0, parseFloat(c) || 0));
  const extracted = raw && typeof raw.extracted === 'object' && raw.extracted ? raw.extracted : {};
  const isUpdate = raw && typeof raw.isUpdate === 'boolean' ? raw.isUpdate : false;
  return { intent, confidence, extracted, isUpdate };
}

// 未敲定的提议/商量语气：强制压低置信度，确保进入「待确认」流程（不依赖模型自觉）
const TENTATIVE_PATTERNS = [
  /要不/, /不如/, /行不行/, /可以吗/, /好吗/, /行吗/, /可以不?/, /是否/,
  /建议/, /提议/, /考虑/, /商量/, /讨论/, /请示/, /征询/,
  /待定/, /暂定/, /还没?定/, /未定/, /大概/, /可能/, /或许/,
  /大家觉得/, /你们看/, /看看大家/,
];

export function downgradeTentative(text: string, result: LLMIntentResult): LLMIntentResult {
  if (result.intent === 'none') return result;
  const isTentative = TENTATIVE_PATTERNS.some((re) => re.test(text));
  // 命中提议/未敲定语气，且模型仍给高分时，强制压到 0.6（低于自动落卡阈值 0.8）
  if (isTentative && result.confidence >= 0.8) {
    result.confidence = 0.6;
  }
  return result;
}

async function callOnce(
  baseUrl: string,
  model: string,
  apiKey: string,
  useJsonMode: boolean,
  text: string,
  conversationName: string
): Promise<any> {
  const body: any = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `会话：${conversationName}\n${text}` },
    ],
    temperature: 0.2,
  };
  if (useJsonMode) body.response_format = { type: 'json_object' };

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  const parsed = extractJson(content);
  if (!parsed) throw new Error('LLM 返回无法解析为 JSON');
  return parsed;
}

/**
 * 把历史对话 + 草稿卡片 + 当前消息拼成一段用户 prompt，供模型结合上下文判断。
 */
function buildContextPrompt(
  text: string,
  conversationName: string,
  ctx?: LLMContext
): string {
  let s = '';
  if (ctx?.history && ctx.history.length > 0) {
    // 只取最近 6 条，避免过长历史噪声干扰当前意图判断
    const recent = ctx.history.slice(-6);
    s += '最近对话历史（仅供背景参考，最新一条在最后）：\n';
    s += recent
      .map((h, i) => `${i + 1}. ${h.role === 'user' ? '用户' : '对方'}：${h.content}`)
      .join('\n');
    s += '\n';
  }
  if (ctx?.lastCard) {
    s += `已存在的草稿卡片（如当前消息明显在补充/修改它，再考虑 isUpdate）：\n类型：${ctx.lastCard.type}\n摘要：${ctx.lastCard.summary}\n已有字段：${JSON.stringify(ctx.lastCard.extracted)}\n`;
  }
  s += `当前新消息：${text}`;
  return s;
}

/**
 * 调用大模型做意图识别。返回结构化结果。
 * 若 response_format=json_object 不被支持，会回退到普通模式再解析。
 * @param context 可选：最近对话历史 + 当前会话最新草稿卡片，用于上下文续写合并判断。
 */
export async function analyzeWithLLM(
  text: string,
  conversationName: string,
  context?: LLMContext
): Promise<LLMIntentResult> {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) {
    return { intent: 'none', confidence: 0, extracted: {} };
  }

  const userPrompt = buildContextPrompt(text, conversationName, context);

  let raw: any;
  try {
    raw = await callOnce(baseUrl, model, apiKey, true, userPrompt, conversationName);
  } catch (e) {
    // 某些模型/网关不支持 response_format，再试一次不带它
    raw = await callOnce(baseUrl, model, apiKey, false, userPrompt, conversationName);
  }
  return normalize(raw);
}

/**
 * 通用对话补全（不要求 JSON 输出）。用于文档摘要、改写等自由文本任务。
 * 未配置 API Key 时返回空字符串，由调用方决定兜底逻辑。
 */
export async function chatWithLLM(system: string, user: string): Promise<string> {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) return '';
  const body: any = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.3,
  };
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`LLM API ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content || '';
}
