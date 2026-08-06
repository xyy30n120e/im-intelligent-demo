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

const SYSTEM_PROMPT = `你是企业 IM 消息解析助手。

任务：
从一条聊天消息中抽取实体，判断其意图类型，并输出 JSON。

意图类型（intent 字段）：
- calendar：约定在未来某时间做某事，如开会、评审、面试、培训、见面等
- todo：需要完成的一项任务，如提交报告、准备材料、跟进某事项
- request：对产品/功能/系统的诉求、反馈或缺陷，如希望增加某功能、某页面崩溃、某操作失败
- none：闲聊、问候、无 actionable 信息

把所有抽取到的实体放进一个 data 对象里（未提及或不确定一律填 null，不要编造，也不要沿用上一条消息的字段）：

calendar：
  data.title        事件名称（如「营销会议」），可留 null
  data.date        日期（如「周三」「7月31日」），可留 null
  data.time        时间（如「15:00」或「周三下午15:00」等自然写法），可留 null
  data.location    地点（如「1218会议室」），可留 null
  data.participants 参与人数组（见下方格式），可留 null

todo：
  data.title        任务内容摘要（如「整理营销方案」）
  data.deadline     截止时间（如「下周一」「周五」「8月10日」），可留 null
  data.assignee     被指派的人（姓名，如「小王」），可留 null；若消息用 @某人 来指派，也填该姓名
  data.detail       补充说明，可留 null

request：
  data.description  需求/问题的完整描述
  data.issueType   "bug" 或 "feature"
  data.version     上线版本号（如「10.1.2」），可留 null

participants 数组元素格式：
  - 全体：  {"type":"all"}
  - 具体人：{"type":"user","name":"姓名"}

规则：
- 只提取当前消息中已有的信息，绝不编造。
- 不确定或消息未提及的字段填 null（不是空字符串）。
- 新建意图时，字段只能来自当前这条消息，不得继承上一条消息未提及的内容。
- 若当前消息是在补充/修改前面已提到的同一件事（如给会议补地点、改时间、加参与人），isUpdate 设为 true；否则 false。
- 必须只返回 JSON，不要任何解释文字，不要使用 Markdown 代码块。

输出 JSON 示例（todo）：
{
  "intent": "todo",
  "isUpdate": false,
  "confidence": 0.95,
  "data": {
    "title": "整理营销方案",
    "deadline": "下周一",
    "assignee": "小王"
  }
}

输出 JSON 示例（calendar）：
{
  "intent": "calendar",
  "isUpdate": false,
  "confidence": 0.95,
  "data": {
    "title": "营销会议",
    "date": "周三",
    "time": "15:00",
    "location": "1218会议室",
    "participants": [{"type":"all"}]
  }
}`

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

/**
 * 把结构化 participants 数组转成内部字符串格式（与现有 @提及 路由兼容）：
 * - {"type":"all"}             → "@所有人"
 * - {"type":"user","name":"X"} → "@X"
 * 多个用中文逗号连接并去重。
 */
function participantsToStr(parts: any): string {
  if (!Array.isArray(parts)) return '';
  const names = new Set<string>();
  for (const p of parts) {
    if (!p || typeof p !== 'object') continue;
    if (p.type === 'all') names.add('@所有人');
    else if (p.type === 'user' && typeof p.name === 'string' && p.name) names.add('@' + p.name);
  }
  return [...names].join('，');
}

function normalize(raw: any): LLMIntentResult {
  const rawIntent =
    raw && typeof raw.intent === 'string' && ['calendar', 'schedule', 'todo', 'request', 'none'].includes(raw.intent)
      ? raw.intent
      : 'none';
  // 对外统一：calendar 记作 schedule，保持下游类型不变
  const intent: LLMIntentType = rawIntent === 'calendar' ? 'schedule' : (rawIntent as LLMIntentType);

  let confidence = 0;
  const c = raw?.confidence;
  if (typeof c === 'number') confidence = Math.min(1, Math.max(0, c));
  else if (typeof c === 'string') confidence = Math.min(1, Math.max(0, parseFloat(c) || 0));

  const isUpdate = raw && typeof raw.isUpdate === 'boolean' ? raw.isUpdate : false;

  // 实体抽取结果 → 内部 extracted 结构（null / 空 → 空字符串，保持下游 prune 逻辑可用）
  // 兼容两种 JSON 写法：嵌套 data（参考用户给定格式）与旧版扁平写法
  const src =
    raw && typeof raw === 'object' && raw.data && typeof raw.data === 'object'
      ? raw.data
      : (raw && typeof raw === 'object' ? raw : {});
  const str = (k: string): string => (src[k] != null && src[k] !== '' ? String(src[k]) : '');
  const issueType = src.issueType === 'bug' ? 'bug' : src.issueType === 'feature' ? 'feature' : '';
  const extracted: Record<string, any> = {
    event: str('title') || str('event'),
    date: str('date'),
    time: str('time'),
    location: str('location'),
    participants: participantsToStr(src.participants),
    // todo 优先用 task，退化为 title（模型可能返回 data.title）
    task: str('task') || str('title'),
    // todo 截止时间
    deadline: str('deadline'),
    // todo 被指派的人（姓名）
    assignee: str('assignee'),
    detail: str('detail'),
    description: str('description'),
    issueType,
    version: str('version'),
    content: str('content') || str('title') || str('description') || str('task'),
  };
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
  text: string
): Promise<any> {
  const body: any = {
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: text },
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
 * 调用大模型做意图识别。返回结构化结果。
 * 若 response_format=json_object 不被支持，会回退到普通模式再解析。
 * @param context 可选：当前会话最新草稿卡片，用于上下文续写合并（isUpdate）判断。
 */
export async function analyzeWithLLM(
  text: string,
  _conversationName: string,
  context?: LLMContext
): Promise<LLMIntentResult> {
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) {
    return { intent: 'none', confidence: 0, extracted: {} };
  }

  // 直接把用户原消息交给大模型做实体抽取；若当前会话已有一张草稿卡片，
  // 仅附一段「背景参考」用于判断 isUpdate（新建时不得继承其字段，由 prompt 规则约束）。
  let userPrompt = text;
  const lastCard = context?.lastCard;
  if (lastCard) {
    userPrompt +=
      `\n\n（背景参考：当前会话已存在一张草稿卡片，类型=${lastCard.type}，摘要=${lastCard.summary}，` +
      `已有字段=${JSON.stringify(lastCard.extracted)}。` +
      `若本条消息是在补充/修改它，请把 isUpdate 设为 true 并返回要合并的字段；否则按新建处理，且不得继承它的字段。）`;
  }

  let raw: any;
  try {
    raw = await callOnce(baseUrl, model, apiKey, true, userPrompt);
  } catch (e) {
    // 某些模型/网关不支持 response_format，再试一次不带它
    raw = await callOnce(baseUrl, model, apiKey, false, userPrompt);
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
