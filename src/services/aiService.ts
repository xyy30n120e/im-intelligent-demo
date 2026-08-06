import { accounts, contacts } from '../data/mockData';
import { analyzeWithLLM, hasLLMKey, downgradeTentative, chatWithLLM } from './llmClient';
import { useAIStore } from '../store/aiStore';

export interface ParsedSchedule {
  type: 'schedule';
  event: string;
  date: string;
  time: string;
  location?: string;
  participants?: string;
}

export interface ParsedTodo {
  type: 'todo';
  task: string;
  deadline: string;
  detail?: string;
}

export interface ParsedRequest {
  type: 'request';
  content: string;
  /** 需求/问题类型：仅 需求(feature) / Bug(bug) */
  issueType?: 'bug' | 'feature';
  /** 需求/问题描述 */
  description?: string;
  /** 上线版本，如 10.1.2（4月2日） */
  version?: string;
}

export type ParsedResult = ParsedSchedule | ParsedTodo | ParsedRequest;

// ── 关键词配置 ──
// 注意：用正则而非 includes，因为「会议」会误命中「会议室」（补充地点的续写消息），
// 故对「会议」加负向先行断言 (?!室)，避免把「地点在1218会议室」判成新日程。
const SCHEDULE_RE = /开会|碰一下|见面|讨论|评审|汇报|会议(?!室)/;
const TODO_KEYWORDS = ['提交', '报告', '准备'];
const REQUEST_KEYWORDS = ['希望', '支持', '添加', '功能', '需求', '问题', '请', '需要', '建议', '申请', '怎么', '如何', '能不能', '能否', '期望', '想要', '要求', '实现', '开发', '优化', '改进', '增加', '集成', '方案', '帮忙', '协助', '截图', '鸿蒙'];

// ── 去重状态 ──
const DEDUP_WINDOW_MS = 30000; // 30秒窗口内相同类型去重

interface DedupEntry {
  type: 'schedule' | 'todo' | 'request';
  contentHash: string;
  timestamp: number;
}

let lastIntent: DedupEntry | null = null;

/**
 * 计算简单内容哈希，用于判断两条消息是否相似
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return str.substring(0, 15) + '_' + hash.toString(36);
}

/**
 * 检查是否应该被去重
 * - 同一类型在时间窗口内重复触发 → 去重
 */
function shouldDedup(currentType: 'schedule' | 'todo' | 'request', content: string): boolean {
  if (!lastIntent) return false;

  // 过期检测：超过窗口时间则重置
  if (Date.now() - lastIntent.timestamp > DEDUP_WINDOW_MS) {
    lastIntent = null;
    return false;
  }

  // 同一类型在窗口内再次触发 → 去重
  if (lastIntent.type === currentType) {
    return true;
  }

  return false;
}

/**
 * 记录当前意图用于后续去重
 */
function recordIntent(type: 'schedule' | 'todo' | 'request', content: string): void {
  lastIntent = {
    type,
    contentHash: simpleHash(content),
    timestamp: Date.now(),
  };
}

/**
 * 判断一句话属于哪种意图类型（单句多关键词按优先级取最高）
 * 优先级：日程 > 待办 > 需求
 */
function classifyIntent(input: string): 'schedule' | 'todo' | 'request' | null {
  const trimmed = input.trim();

  const hasScheduleKeyword = SCHEDULE_RE.test(trimmed);
  const hasTodoKeyword = TODO_KEYWORDS.some(k => trimmed.includes(k));
  const hasRequestKeyword = REQUEST_KEYWORDS.some(k => trimmed.includes(k));

  // 优先级：日程 > 待办 > 需求
  if (hasScheduleKeyword) return 'schedule';
  if (hasTodoKeyword) return 'todo';
  if (hasRequestKeyword) return 'request';

  return null;
}

/**
 * 纯 Mock 解析用户输入（日程/待办）
 * 不使用 API，仅基于关键词匹配
 */
export function parseWithAI(userInput: string): ParsedResult {
  return mockParse(userInput);
}

function mockParse(input: string): ParsedResult {
  const trimmed = input.trim();
  const intent = classifyIntent(trimmed);

  const dateMatch = trimmed.match(/(今天|明天|后天|下周[一二三四五六日]?|周[一二三四五六日]|(?:\d+)[月][\d]+[日号])/);
  const timeMatch = trimmed.match(/(\d{1,2})[：:点](\d{0,2})/);

  if (intent === 'schedule') {
    return {
      type: 'schedule' as const,
      event: trimmed.substring(0, 30),
      date: resolveDate(dateMatch?.[1] || '今天'),
      time: timeMatch ? `${timeMatch[1]}:${timeMatch[2] || '00'}` : '',
      location: '',
      participants: '',
    };
  }

  // 默认按待办处理
  return {
    type: 'todo' as const,
    task: trimmed.length > 30 ? trimmed.substring(0, 30) + '...' : trimmed,
    deadline: dateMatch?.[1] ? resolveDate(dateMatch[1]) : '',
    detail: '',
  };
}

export function generateItemId(): string {
  return 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

export function getCurrentTimeStr(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return `${month}月${day}日 ${hours}:${minutes}`;
}

export function getTodayDateStr(): string {
  const now = new Date();
  return `${now.getMonth() + 1}月${now.getDate()}日`;
}

/** 判断时间字符串（支持 "M月D日" / "M-D" / "今天"）是否为系统当日 */
export function isToday(timeStr?: string): boolean {
  if (!timeStr) return false;
  const t = timeStr.trim();
  if (t === "今天" || t === "今日") return true;
  const m = t.match(/(\d{1,2})月(\d{1,2})[日号]/) || t.match(/(\d{1,2})-(\d{1,2})/);
  if (!m) return false;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const now = new Date();
  return now.getMonth() + 1 === month && now.getDate() === day;
}

// ── Chat 意图分析 ──

export interface ChatIntent {
  hasIntent: boolean;
  type: 'schedule' | 'todo' | 'request' | null;
  data: ParsedSchedule | ParsedTodo | ParsedRequest | null;
  /** 模型对该意图判断的置信度 0~1（无 LLM Key 时回退 mock 默认给 0.95） */
  confidence?: number;
  reviewData?: { title: string } | null;
  /**
   * 当前消息是否是对「已有卡片」的补充/修改（同一事项续写）。
   * true 时调用方应合并进 updateTargetId 对应的卡片，而非新建。
   */
  isUpdate?: boolean;
  /** isUpdate 为 true 时，要更新的目标卡片 id */
  updateTargetId?: string;
}

/**
 * 分析聊天消息，判断是否包含日程/待办/需求意图。
 * 若配置了 LLM API Key，则调用真实大模型做意图识别并返回置信度；
 * 否则回退到本地 mock 关键词识别（默认置信度 0.95，保持原有自动落卡行为）。
 *
 * 上下文续写：传入 convId 时，会自动带上「当前会话最新一张 AI 卡片」与最近对话历史，
 * 让模型判断当前消息是否是对已有卡片的补充/修改（isUpdate）。无 Key 时由本地
 * mockContinuation 做同样的续写合并，保证两种模式行为一致。
 *
 * @param convId   会话 id（用于定位上下文草稿卡片）
 * @param history  最近对话历史（role/content），可选
 */
export async function analyzeChatMessage(
  message: string,
  conversationName: string,
  convId?: string,
  history?: { role: 'user' | 'assistant'; content: string }[]
): Promise<ChatIntent> {
  let result: ChatIntent;
  let source = 'mock';

  // 当前会话已有的「草稿卡片」引用（用于上下文续写合并）
  const lastCard = convId ? useAIStore.getState().activeCardByConv[convId] : undefined;

  if (hasLLMKey()) {
    try {
      const llm = await analyzeWithLLM(message, conversationName, {
        history: history && history.length ? history : undefined,
        lastCard: lastCard
          ? { type: lastCard.type, summary: lastCard.summary, extracted: lastCard.extracted }
          : undefined,
      });
      source = 'llm';
      const type = llm.intent === 'none' ? null : (llm.intent as ChatIntent['type']);
      const isUpdate = !!llm.isUpdate && !!lastCard && llm.intent !== 'none';
      result = {
        hasIntent: llm.intent !== 'none' || isUpdate,
        type: type ?? (isUpdate && lastCard ? lastCard.type : null),
        data: (llm.extracted || null) as ParsedSchedule | ParsedTodo | ParsedRequest | null,
        confidence: llm.confidence,
        isUpdate,
        updateTargetId: isUpdate ? lastCard!.id : undefined,
      };
    } catch (e) {
      console.warn('[意图识别] 调用 LLM 失败，回退 mock：', e);
      source = 'mock(fallback)';
      const mock = mockChatAnalysis(message, conversationName);
      result = { ...mock, confidence: 0.95 };
    }
  } else {
    const mock = mockChatAnalysis(message, conversationName);
    result = { ...mock, confidence: 0.95 };
  }

  // 无 Key / LLM 失败回退后，尝试本地 mock 续写合并
  if (!result.hasIntent && lastCard && (Date.now() - lastCard.at) < 15 * 60 * 1000) {
    const cont = mockContinuation(message, lastCard);
    if (cont) {
      result = {
        hasIntent: true,
        type: lastCard.type,
        data: cont.merged as any,
        confidence: 0.95,
        isUpdate: true,
        updateTargetId: lastCard.id,
      };
      source = 'mock(continuation)';
    }
  }

  console.log(
    `[意图识别] source=${source}`,
    result.hasIntent
      ? `intent=${result.type}${result.isUpdate ? '(update)' : ''} confidence=${result.confidence}`
      : 'no-intent',
    `| "${message}"`
  );

  // 去重检查：同类型在窗口内重复则忽略（续写合并 isUpdate 直接跳过，避免误伤）
  if (result.hasIntent && result.type && !result.isUpdate) {
    if (shouldDedup(result.type, message)) {
      console.log(
        `[去重] 忽略重复意图: type=${result.type}, message="${message.substring(0, 20)}..."`
      );
      return { hasIntent: false, type: null, data: null, confidence: result.confidence };
    }
    recordIntent(result.type, message);
  } else if (result.hasIntent && result.type) {
    // 续写合并也记录一次，避免后续被当成全新意图误去重
    recordIntent(result.type, message);
  }

  // 未敲定/提议语气统一降权（LLM 与本地 mock 共用），确保进入「待确认」而非自动落卡
  if (result.hasIntent && result.type) {
    const down = downgradeTentative(message, {
      intent: result.type,
      confidence: result.confidence ?? 0,
      extracted: (result.data as any) || {},
    });
    result.confidence = down.confidence;
  }

  return result;
}

/**
 * 本地 mock 续写合并：当最新消息本身不构成新意图、但明显是在补充当前会话已有的
 * 草稿卡片时，提取补充字段并合并进去。支持日程的地点/参与人/时间变更，
 * 以及待办/需求的补充说明。
 */
function mockContinuation(
  text: string,
  lastCard: { type: 'schedule' | 'todo' | 'request'; extracted: Record<string, any> }
): { merged: Record<string, any> } | null {
  const t = text.trim();
  if (!t) return null;

  if (lastCard.type === 'schedule') {
    const merged = { ...lastCard.extracted };
    let changed = false;
    const loc = extractLocation(t);
    if (loc) { merged.location = loc; changed = true; }
    const parts = extractParticipants(t);
    if (parts) { merged.participants = parts; changed = true; }
    const dt = extractScheduleDateTime(t);
    if (dt.date) { merged.date = dt.date; changed = true; }
    if (dt.time) { merged.time = dt.time; changed = true; }
    return changed ? { merged } : null;
  }

  if (lastCard.type === 'todo' || lastCard.type === 'request') {
    const merged = { ...lastCard.extracted };
    const prev = merged.detail || '';
    merged.detail = prev ? `${prev}；${t}` : t;
    return { merged };
  }

  return null;
}

/** 抽取地点：地点在1218会议室 / 1218号会议室 / 会议室A / 3楼房间 */
function extractLocation(text: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/地点[是为在:：]?\s*([^\s,，。;；]+)/))) return m[1];
  if ((m = text.match(/([A-Za-z0-9\-]+)\s*号?\s*会议室/))) return `${m[1]}号会议室`;
  if ((m = text.match(/会议室\s*([A-Za-z0-9\-]+)/))) return `会议室${m[1]}`;
  if ((m = text.match(/([A-Za-z0-9\-]+)\s*号?\s*房间/))) return `${m[1]}号房间`;
  if ((m = text.match(/([A-Za-z0-9\-]+)\s*号?\s*室\b/))) return `${m[1]}室`;
  if (text.includes('会议室') || text.includes('房间') || text.includes('室')) {
    const cleaned = text.replace(/^(地点|在|是|为)\s*/, '').replace(/[。；;，,]$/, '');
    if (cleaned.length > 0 && cleaned.length <= 24) return cleaned;
  }
  return null;
}

/** 抽取参与人：@提及 或 「参加/出席/一起 + 名字」 */
function extractParticipants(text: string): string | null {
  const ats = [...text.matchAll(/@([^\s@]+)/g)].map((m) => m[1]);
  if (ats.length) return ats.join('，');
  const m = text.match(/(?:参加|出席|参会|与会|一起|参与)[人者]?[是为:：]?\s*([^\s,，。;；]+)/);
  if (m) return m[1];
  return null;
}

/** 抽取日期/时间变更（改到/改在/提前/推迟 + 时间或相对日期） */
function extractScheduleDateTime(text: string): { date: string; time: string } {
  const out = { date: '', time: '' };
  if (!/(改|提前|推迟|换成|调[整到]?|挪)/.test(text)) return out;
  const dt = text.match(/(今天|明天|后天|下周[一二三四五六日]?|周[一二三四五六日])/);
  if (dt) out.date = dt[1];
  const tm = text.match(/(\d{1,2})[：:点](\d{0,2})/);
  if (tm) out.time = `${tm[1]}:${tm[2] || '00'}`;
  return out;
}

/**
 * 转换相对日期为实际日期（"今天"→ "7月27日"）
 */
function resolveDate(dateStr: string): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];

  const fmt = (d: Date) => {
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + weekdayNames[d.getDay()];
  };

  if (dateStr === '今天') {
    return fmt(today);
  }
  if (dateStr === '明天') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return fmt(d);
  }
  if (dateStr === '后天') {
    const d = new Date(today);
    d.setDate(d.getDate() + 2);
    return fmt(d);
  }

  // 星期几: 周一 to 周日
  const weekdayMatch = dateStr.match(/周([一二三四五六日])/);
  if (weekdayMatch) {
    const weekdayMap: Record<string, number> = { '日': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    const targetDay = weekdayMap[weekdayMatch[1]];
    if (targetDay !== undefined) {
      const currentDay = today.getDay();
      let diff = targetDay - currentDay;
      if (diff < 0) diff += 7;
      const d = new Date(today);
      d.setDate(d.getDate() + diff);
      return fmt(d);
    }
  }

  // 下周几
  const nextWeekMatch = dateStr.match(/下周([一二三四五六日])/);
  if (nextWeekMatch) {
    const weekdayMap: Record<string, number> = { '日': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6 };
    const targetDay = weekdayMap[nextWeekMatch[1]];
    if (targetDay !== undefined) {
      const currentDay = today.getDay();
      let diff = targetDay - currentDay + 7;
      const d = new Date(today);
      d.setDate(d.getDate() + diff);
      return fmt(d);
    }
  }

  // 已经是 X月X日 格式，追加星期
  if (/\d+月\d+日/.test(dateStr)) {
    const m = dateStr.match(/(\d+)月(\d+)日/);
    if (m) {
      const d = new Date(today.getFullYear(), parseInt(m[1]) - 1, parseInt(m[2]));
      return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + weekdayNames[d.getDay()];
    }
    return dateStr;
  }

  // 默认返回今天
  return fmt(today);
}

/**
 * 把 LLM 抽取出的 date/time（格式不稳定，可能是 "M月D日 周X"、"2026-07-31"、
 * "7/31"、"周四"、"今天"，time 可能是 "15:00"、"15点"、"下午3点"、""）归一为
 * 日历解析器能识别的 "M月D日 HH:MM"（无时间则返回 "M月D日"）。
 * 这样无论模型返回什么写法，生成的日程都能在周/日/月视图里正确渲染。
 */
/** 表示「现在/立刻/马上」等即时语义的关键词 */
const NOW_WORDS = /(现在|立刻|立即|马上|立马|这就|当下|此刻|这会儿|这阵子)/;

export function buildScheduleTime(
  extracted: Record<string, any> | null | undefined,
  messageText?: string
): string {
  const e = extracted || {};
  const rawDate = e.date ? String(e.date) : '';
  const rawTime = e.time ? String(e.time) : '';
  // 把原始消息文本也纳入「现在」判定（例如用户直接说「现在开会」）
  const ctx = `${messageText || ''} ${rawDate} ${rawTime}`;

  // ── 日期归一 ──
  let dateStr: string;
  // 优先匹配 4 位年份的 ISO 写法（避免把 2026-07-31 误拆成 26月7日）
  const iso = rawDate.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    dateStr = `${parseInt(iso[2], 10)}月${parseInt(iso[3], 10)}日`;
  } else {
    const md = rawDate.match(/(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*[日号]?/);
    if (md) {
      dateStr = `${parseInt(md[1], 10)}月${parseInt(md[2], 10)}日`;
    } else if (rawDate && /[今明后周下]/u.test(rawDate)) {
      dateStr = resolveDate(rawDate.trim());
    } else if (messageText) {
      // LLM 未抽出日期时，从原始消息文本兜底（如「周四下午开会」→ 本周四）
      const mdMsg = messageText.match(/(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*[日号]?/);
      const relMsg = messageText.match(/(今天|明天|后天|下周[一二三四五六日]?|周[一二三四五六日])/);
      if (mdMsg) {
        dateStr = `${parseInt(mdMsg[1], 10)}月${parseInt(mdMsg[2], 10)}日`;
      } else if (relMsg) {
        dateStr = resolveDate(relMsg[1]);
      } else {
        dateStr = resolveDate('今天');
      }
    } else {
      dateStr = resolveDate('今天');
    }
  }

  // 去掉「周X」尾巴，便于与「今天」比较
  const datePlain = dateStr.replace(/\s*周[一二三四五六日]\s*$/, '');
  const today = (() => {
    const d = new Date();
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  })();

  // ── 时间归一 ──
  let timeStr = '';
  const hm = rawTime.match(/(\d{1,2})\s*[:：点]\s*(\d{0,2})/);
  if (hm) {
    let h = parseInt(hm[1], 10);
    const m = parseInt(hm[2] || '0', 10);
    if (/[下晚傍]午/u.test(rawTime) && h < 12) h += 12;
    if (/[上早]午/u.test(rawTime) && h === 12) h = 0;
    timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  } else if (NOW_WORDS.test(ctx) && datePlain === today) {
    // 时间是「现在」且日期为今天：写入当前时刻，而不是落下日期-only
    // （日期-only 会被日历解析成 00:00 → 误判为「全天」，导致时间不显示）
    const now = new Date();
    timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  } else if (!timeStr && messageText) {
    // LLM 未抽出时间时，从原始消息兜底时段（如「下午」「晚上8点」）
    const hmMsg = messageText.match(/(\d{1,2})\s*[：:点]\s*(\d{0,2})/);
    if (hmMsg) {
      let h = parseInt(hmMsg[1], 10);
      const m = parseInt(hmMsg[2] || '0', 10);
      if (/[下晚傍]午/u.test(messageText) && h < 12) h += 12;
      if (/[上早]午/u.test(messageText) && h === 12) h = 0;
      timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    } else if (/[下晚傍]午/u.test(messageText)) {
      timeStr = '15:00';
    } else if (/[上早]午/u.test(messageText)) {
      timeStr = '09:00';
    } else if (/中午|午间/u.test(messageText)) {
      timeStr = '12:00';
    }
  }

  return timeStr ? `${dateStr} ${timeStr}` : dateStr;
}

/**
 * 生成上传文件的「内容概要」：
 * - 配了 LLM Key 且文件为可读取文本时，调用大模型用 2~3 句话概括核心内容；
 * - 未配 Key（或文本为空）时，用原文前 200 字作为概要兜底；
 * - 非文本 / 无内容（如图片、PDF 仅含 dataUrl）返回 null，调用方不渲染概要。
 */
export async function summarizeFileContent(meta: {
  name?: string;
  content?: string;
}): Promise<string | null> {
  const text = (meta.content || '').trim();
  if (!text) return null;

  // 无 Key：直接用前 200 字兜底
  if (!hasLLMKey()) {
    return text.slice(0, 200) + (text.length > 200 ? '…' : '');
  }

  try {
    const sys =
      '你是一个文档摘要助手。请用简体中文，用 2~3 句话概括下面文档的核心内容、关键信息和主要结论，不超过 120 字。只输出摘要本身，不要解释、不要使用 Markdown 代码块。';
    const user = `文件名：${meta.name || '未命名文档'}\n\n文档内容：\n${text.slice(0, 6000)}`;
    const out = (await chatWithLLM(sys, user)).trim();
    const clean = out.slice(0, 300);
    return clean || text.slice(0, 200) + (text.length > 200 ? '…' : '');
  } catch {
    return text.slice(0, 200) + (text.length > 200 ? '…' : '');
  }
}

/**
 * Mock 聊天意图分析
 * 关键词分类 + 优先级去重 + 连续消息去重
 */
function mockChatAnalysis(message: string, _conversationName: string): ChatIntent {
  const trimmed = message.trim();
  const intent = classifyIntent(trimmed);

  if (intent === null) {
    return { hasIntent: false, type: null, data: null };
  }

  const dateMatch = trimmed.match(/(今天|明天|后天|下周[一二三四五六日]?|周[一二三四五六日]|(?:\d+)[月][\d]+[日号])/);
  const timeMatch = trimmed.match(/(\d{1,2})[：:点](\d{0,2})/);

  if (intent === 'schedule') {
    return {
      hasIntent: true,
      type: 'schedule',
      data: {
        type: 'schedule',
        event: trimmed.substring(0, 30),
        date: resolveDate(dateMatch?.[1] || '今天'),
        time: timeMatch ? `${timeMatch[1]}:${timeMatch[2] || '00'}` : '',
        location: '',
        participants: '',
      },
    };
  }

  if (intent === 'request') {
    // 简单规则提取需求/问题类型：命中 bug 关键词 → Bug，其余视为需求
    let issueType: ParsedRequest['issueType'] = 'feature';
    if (/bug|崩溃|闪退|报错|异常|失败|无法|不能|打不开|进不去|重启|卡住/.test(trimmed)) {
      issueType = 'bug';
    }

    // 尝试提取上线版本：x.x.x（月日） 或 x.x.x
    const versionMatch = trimmed.match(/(\d+\.\d+(?:\.\d+)?(?:\s*[（(]\d{1,2}月\d{1,2}日[)）])?)/);

    // 生成标题与描述：标题取前 24 字，描述用完整内容
    const title = trimmed.length > 24 ? trimmed.substring(0, 24) + '…' : trimmed;

    return {
      hasIntent: true,
      type: 'request',
      data: {
        type: 'request',
        content: title,
        issueType,
        description: trimmed,
        version: versionMatch ? versionMatch[1] : undefined,
      },
    };
  }

  // todo
  return {
    hasIntent: true,
    type: 'todo',
    data: {
      type: 'todo',
      task: trimmed,
      deadline: dateMatch?.[1] ? resolveDate(dateMatch[1]) : '',
      detail: '',
    },
  };
}

/**
 * 手动重置去重状态（用于切换对话等场景）
 */
export function resetDedupState(): void {
  lastIntent = null;
}

// ── @ 提及 → 接收人路由 ──

// 姓名 → userId 映射（基于 accounts / contacts）
export const NAME_TO_ID: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  [...accounts, ...contacts].forEach((u) => {
    if (u && u.name) m[u.name] = u.id;
  });
  return m;
})();

/**
 * 根据消息内容中的 @ 提及，计算该条 AI 卡片 / 日程 / 待办 的接收人（userId 列表）。
 *
 * 规则：
 * - 无 @ 提及，或包含「@所有人」 → 群内所有成员都能收到
 * - 指定 @某人 → 仅被 @人和发送者收到
 *
 * @param content    用户发送的消息文本
 * @param memberIds  当前群组的成员 userId 列表
 * @param senderId   发送者（当前账号）userId
 */
export function computeRecipients(content: string, memberIds: string[], senderId: string): string[] {
  const mentions = [...content.matchAll(/@([^\s@]+)/g)].map((m) => m[1]);
  const hasAll = mentions.includes('所有人');

  // 无 @ 或 @所有人 → 全员
  if (hasAll || mentions.length === 0) {
    return memberIds.length ? [...memberIds] : [senderId];
  }

  const ids = new Set<string>([senderId]);
  mentions.forEach((name) => {
    const id = NAME_TO_ID[name];
    if (id) ids.add(id);
  });

  // 提及存在但没有解析到任何有效成员（如 @了不存在的人）→ 退化为全员
  if (ids.size === 1 && !memberIds.includes(senderId)) {
    return memberIds.length ? [...memberIds] : [senderId];
  }

  return [...ids];
}

