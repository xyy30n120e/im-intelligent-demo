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
const SCHEDULE_RE = /开会|碰一下|见面|讨论|评审|汇报|会议(?!室)|沟通|洽谈|碰头|对齐|同步|商议|站会|复盘|早会|例会|晨会|周会|月会|年会|碰面/;
const TODO_KEYWORDS = ['提交', '报告', '准备', '整理', '跟进', '完成', '撰写', '写'];
const REQUEST_KEYWORDS = ['希望', '支持', '添加', '功能', '需求', '问题', '请', '需要', '建议', '申请', '怎么', '如何', '能不能', '能否', '期望', '想要', '要求', '实现', '开发', '优化', '改进', '增加', '集成', '方案', '帮忙', '协助', '截图', '鸿蒙'];

// 日期片段正则：匹配「M月D日 / M.D / M/D / M-D」。
// 关键：用前后向断言排除「版本号」（如 10.2.6 / 1.2.3）——避免把三段式版本号误判成「10月2日」。
//   前导 (?<!\d\.)  → 第一个数字前不能是「数字.」（如 10.2 里的 2 前是 .，则 2.6 不算日期）
//   后向 (?!\.\d)   → 第二个数字后不能是「.数字」（如 10.2 里的 2 后是 .6，则 10.2 不算日期）
// 单独出现的「10.2」仍按日期处理（保持兼容），仅嵌在更长版本号里才排除。
const DATE_FRAG_RE = /(?<!\d\.)(\d{1,2})\s*[月/.\-]\s*(\d{1,2})(?!\.\d)\s*[日号]?/;

// ── 去重状态 ──
// 仅用于防「同一条消息被重复提交」（手抖双击 / 重入），窗口很短；
// 内容不同的消息即使类型相同也必须各自落卡，不能互相吞掉。
const DEDUP_WINDOW_MS = 3000; // 3秒窗口内「完全相同的消息」才去重

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
 * - 仅当「类型相同 且 内容完全相同」并处于极短窗口内，才判定为重复提交 → 去重
 * - 内容不同的同类型消息（如连续安排两场会议）必须各自生成卡片，不得去重
 */
function shouldDedup(currentType: 'schedule' | 'todo' | 'request', content: string): boolean {
  if (!lastIntent) return false;

  // 过期检测：超过窗口时间则重置
  if (Date.now() - lastIntent.timestamp > DEDUP_WINDOW_MS) {
    lastIntent = null;
    return false;
  }

  // 必须类型与内容都相同才算重复提交（此前仅比类型，会把内容不同的消息误吞）
  if (lastIntent.type === currentType && lastIntent.contentHash === simpleHash(content)) {
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

  const dateMatch = trimmed.match(/(今天|今晚|明天|明晚|后天|下周[一二三四五六日]?|周[一二三四五六日]|(?:\d+)[月][\d]+[日号])/);
  const timeMatch = trimmed.match(/(\d{1,2})[：:点](\d{0,2})/);

  if (intent === 'schedule') {
    const loc = extractLocation(trimmed);
    const parts = extractParticipants(trimmed);
    return {
      type: 'schedule' as const,
      event: '',
      date: resolveDate(dateMatch?.[1] || '今天'),
      time: timeMatch ? `${timeMatch[1]}:${timeMatch[2] || '00'}` : '',
      location: loc || '',
      participants: parts || '',
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
  /**
   * 当 AI 无法确定当前消息是「新建」还是「更新上一张卡片」时标记为 true。
   * 此时调用方应弹出选择条让用户决定：更新上一张 / 新建卡片 / 忽略。
   */
  ambiguous?: boolean;
  /** ambiguous 为 true 时，上一张卡片的摘要（用于展示） */
  lastCardSummary?: string;
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
      let isUpdate = !!llm.isUpdate && !!lastCard && llm.intent !== 'none';
      let mergedData: Record<string, any> | null = null;
      if (lastCard) {
        const cont = mockContinuation(message, lastCard);
        if (isUpdate && !cont) {
          // 降级：LLM 说更新，但本地抽不到任何补充字段 → 视为误合并
          isUpdate = false;
        } else if (!isUpdate && cont) {
          // 升级：本地确证是续写补充（抽到了字段变更），但 LLM 没判 isUpdate → 强制合并，
          // 避免把「时间改到11:00 / 地点改到1218」这类明确修改误判成新建卡片
          isUpdate = true;
          mergedData = cont.merged;
        }
      }
      // 新建（非续写合并）时，对模型抽取的字段做上下文隔离剪枝：只保留当前消息本身
      // 能抽到的字段，避免从同会话上一张卡片「顺手代入」未提及的地点/参与人/时间等
      const finalData: Record<string, any> | null =
        !isUpdate && llm.extracted
          ? pruneExtractedForNew(message, llm.extracted as Record<string, any>)
          : (mergedData ?? llm.extracted ?? null);
      result = {
        hasIntent: llm.intent !== 'none' || isUpdate,
        type: type ?? (isUpdate && lastCard ? lastCard.type : null),
        data: finalData as ParsedSchedule | ParsedTodo | ParsedRequest | null,
        confidence: llm.confidence,
        isUpdate,
        updateTargetId: isUpdate ? lastCard!.id : undefined,
      };
      // LLM 判断不是 isUpdate，但消息看起来仍可能是在补充/修改上一张卡片 → 进入用户确认
      if (!result.hasIntent && lastCard && isAmbiguousUpdate(message, lastCard)) {
        result = {
          ...result,
          ambiguous: true,
          type: lastCard.type,
          updateTargetId: lastCard.id,
          lastCardSummary: lastCard.summary,
        };
      }
      // 大模型调用成功：清掉任何历史提示
      useAIStore.getState().setLlmNotice(null);
    } catch (e) {
      console.warn('[意图识别] 调用 LLM 失败，回退 mock：', e);
      const msg = e instanceof Error ? e.message : String(e);
      useAIStore.getState().setLlmNotice(`大模型调用失败，已回退本地解析：${msg}`);
      source = 'mock(fallback)';
      const mock = mockChatAnalysis(message, conversationName);
      result = { ...mock, confidence: 0.95 };
    }
  } else {
    useAIStore.getState().setLlmNotice('未配置 VITE_LLM_API_KEY，当前使用本地规则解析（非大模型）');
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
    } else if (isAmbiguousUpdate(message, lastCard)) {
      // 本地无法确定是续写，但消息又带有补充/修改信号 → 交给用户选择
      result = {
        ...result,
        ambiguous: true,
        type: lastCard.type,
        updateTargetId: lastCard.id,
        lastCardSummary: lastCard.summary,
      };
      source = 'mock(ambiguous)';
    }
  }

  console.log(
    `[意图识别] source=${source}`,
    result.hasIntent
      ? `intent=${result.type}${result.isUpdate ? '(update)' : ''} confidence=${result.confidence}`
      : result.ambiguous
      ? `ambiguous(${result.type}) lastCard=${result.lastCardSummary}`
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

/** 明确「补充/修改」信号词：只有在消息里出现这些词，才认为是在续写已有卡片 */
const SUPPLEMENT_SIGNALS =
  /(地点|位置|参与|参加|出席|参会|加上|加个|还有|另外|补充|说明|备注|即[是为:：]|也就是|也[就是]|改[到在]|提前|推迟|换成|调整|挪|增加|追[加]|再[加备])/;

/** 附和/确认/闲聊：不应并入已有卡片 */
const ACK_WORDS =
  /^(好|可以|行|收到|嗯|嗯嗯|好的|OK|ok|没问题|同意|明白|了解|👍|谢谢|辛苦|哈哈|是的|对|没错|可以[的]?|行[的]?)\s*[。.!！?？~～]*$/i;

/** 全新意图关键词（高优先级）：出现时当作新事项，不续写旧卡片 */
const NEW_INTENT_RE =
  /(开会|碰一下|见面|讨论|评审|汇报|会议(?!室)|沟通|洽谈|碰头|对齐|同步|商议|站会|复盘|早会|例会|晨会|周会|月会|年会|碰面|提交|报告|准备|希望|支持|添加|功能|需求|问题|请|需要|建议|申请|怎么|如何|能不能|能否|期望|想要|要求|实现|开发|优化|改进|增加|集成|方案|帮忙|协助|截图)/;

/**
 * 本地 mock 续写合并（精准版）：仅当最新消息明确在「补充/修改」当前会话已有的草稿卡片，
 * 且确实抽到字段变更时才合并；附和/确认/闲聊、全新事项、无补充信号的一律不合并。
 * - schedule：地点/参与人/时间/日期变更才算续写
 * - todo/request：仅当含明确补充信号时才把消息追加到 detail
 */
function mockContinuation(
  text: string,
  lastCard: { type: 'schedule' | 'todo' | 'request'; extracted: Record<string, any> }
): { merged: Record<string, any> } | null {
  const t = text.trim();
  if (!t) return null;

  // 1) 附和/确认/闲聊（好/可以/收到/嗯/👍 等）→ 不并入
  if (ACK_WORDS.test(t)) return null;
  // 2) 全新意图关键词（开会/提交/需求…）→ 当作新事项，不续写
  if (NEW_INTENT_RE.test(t)) return null;
  // 3) 无明确补充信号 → 不续写
  if (!SUPPLEMENT_SIGNALS.test(t)) return null;

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

/**
 * 判断一段文本（通常是「文件说明」）是否明确表达了一个全新的事项意图，
 * 足以让一次文件发送新建一张 AI 卡片。
 * - 仅当文本含日程/待办/需求类关键词时才返回 true；
 * - 纯附和/确认（好/收到/👍）返回 false；
 * - 「材料」「会议纪要」这类仅作文件标签的文本返回 false，应挂到上一张卡片。
 */
export function isExplicitNewIntent(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (ACK_WORDS.test(t)) return false;
  return classifyIntent(t) !== null;
}

// ── 不确定是否为上下文续写的兜底检测 ──

const REFERS_BACK_RE = /(这个|那个|它|刚才|上面|上一个|之前|的会|的日程|的待办|的需求)/;
const TIME_TOKEN_RE = /(\d{1,2})[：:点](\d{0,2})/;
const DATE_TOKEN_RE = /(今天|明天|后天|下周[一二三四五六日]?|周[一二三四五六日])/;
const LOCATION_TOKEN_RE = /会议室|房间|地点|位置/;
const PARTICIPANT_TOKEN_RE = /@|参加|出席|参会|一起|参与|加上/;

/**
 * 判断一条消息「可能」是在补充/修改上一张卡片，但 AI 又不够确定。
 * 用于触发「让用户选择：更新上一张 / 新建卡片」的兜底确认条。
 *
 * 判定逻辑：
 * - 有上一张卡片且在 30 分钟内；
 * - 不是纯附和/确认/闲聊；
 * - 包含补充信号词（改到/提前/地点/参与/加上…）或指向上一张卡片（它/刚才/那个…）；
 * - 或包含时间/日期/地点/参与人 token（这些字段很可能是对旧卡片的修改）；
 * - 但若消息本身是强新意图（如「明天下午开会」「提交报告」）且无补充信号，则不触发。
 */
export function isAmbiguousUpdate(
  text: string,
  lastCard?: { type: 'schedule' | 'todo' | 'request'; extracted: Record<string, any>; at: number }
): boolean {
  if (!lastCard) return false;
  const t = text.trim();
  if (!t) return false;
  if (ACK_WORDS.test(t)) return false;
  // 超过 30 分钟不再兜底询问，避免陈年卡片被误关联
  if (Date.now() - lastCard.at > 30 * 60 * 1000) return false;

  const hasStrongNewIntent = classifyIntent(t) !== null;
  const hasUpdateSignal = SUPPLEMENT_SIGNALS.test(t) || REFERS_BACK_RE.test(t);
  const hasFieldToken =
    TIME_TOKEN_RE.test(t) ||
    DATE_TOKEN_RE.test(t) ||
    LOCATION_TOKEN_RE.test(t) ||
    PARTICIPANT_TOKEN_RE.test(t);

  // 强新意图且无补充信号 → 用户显然在聊一件新事，不要问
  if (hasStrongNewIntent && !hasUpdateSignal) return false;

  return hasUpdateSignal || hasFieldToken;
}

/** 抽取地点：地点在1218会议室 / 1218号会议室 / 3楼会议室 / B201 / 会议室A / X号楼 */
export function extractLocation(text: string): string | null {
  let m: RegExpMatchArray | null;
  if ((m = text.match(/地点[是为在:：]?\s*([^\s,，。;；]+)/))) return m[1];
  if ((m = text.match(/([A-Za-z0-9\-]+)\s*号?\s*会议室/))) return `${m[1]}号会议室`; // 1218会议室
  if ((m = text.match(/([A-Za-z0-9\-]+)\s*楼\s*会议室/))) return `${m[1]}楼会议室`; // 3楼会议室
  if ((m = text.match(/([A-Za-z0-9\-]+)\s*号楼/))) return `${m[1]}号楼`; // 2号楼
  if ((m = text.match(/会议室\s*([A-Za-z0-9\-]+)/))) return `会议室${m[1]}`; // 会议室A
  if ((m = text.match(/([A-Za-z0-9\-]+)\s*座\s*\d{0,4}/))) return m[0]; // A座501 / B座
  if ((m = text.match(/([A-Za-z0-9\-]+)\s*号?\s*房间/))) return `${m[1]}号房间`;
  if ((m = text.match(/([A-Za-z0-9\-]+)\s*号?\s*室\b/))) return `${m[1]}室`;
  // 字母+数字房间号（如 B201 / A305），作为独立 token 出现（前后为逗号/空格/起止）
  if ((m = text.match(/(?:^|[\s，,；;、])([A-Za-z]\d{2,4})(?:[\s，,；;、]|$)/))) return m[1];
  if (text.includes('会议室') || text.includes('房间') || text.includes('室')) {
    const cleaned = text.replace(/^(地点|在|是|为)\s*/, '').replace(/[。；;，,]$/, '');
    if (cleaned.length > 0 && cleaned.length <= 24) return cleaned;
  }
  return null;
}

/** 抽取参与人：@提及 或 「参加/出席/一起 + 名字」 */
export function extractParticipants(text: string): string | null {
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
 * 判断「标题/主题类字段」是否来自当前消息本身：
 * 先直接子串匹配；再去掉常见的「关于/召开/会议/评审/讨论…」前缀后缀后取核心词匹配。
 * 用于新建卡片时，防止模型把上一张草稿卡片的标题/主题「顺手代入」。
 */
function eventCore(s: string): string {
  return s
    .replace(/^(关于|召开|开|举办|组织|主持|进行|开展)\s*/, '')
    .replace(/(会议|评审会|评审|讨论会|讨论|沟通会|沟通|汇报会|汇报|碰头会|碰头|例会|洽谈会|洽谈|协商会|协商|磋商会|磋商|会)$/, '')
    .trim();
}
function isFieldFromText(value: string, text: string): boolean {
  if (!value) return false;
  if (text.includes(value)) return true;
  const core = eventCore(value);
  return core.length >= 2 && text.includes(core);
}

/**
 * 新建（isUpdate=false）时，对模型抽取的字段做「上下文隔离」剪枝：
 * 只保留当前消息文本本身能抽到/提及的字段，其余（尤其 location/participants/date/time/event）
 * 一律清空，避免模型从同会话上一张草稿卡片「顺手代入」未提及的字段。
 *
 * 例：
 * - 「周四10:00开会」没提地点 → location 清空；没提参与人 → participants 清空；
 *   仅保留从文本抽到的 date(周四) / time(10:00)。
 * - 「明天下午开会」没提参与人 → participants 清空；没提主题 → event 清空（回退为「会议」）。
 * - 「周五15:00开会」上一张是"关于运营"的会议 → 新卡 event 不会继承"运营"，应为默认"会议"。
 * 这样新会议不会被错误地填上上一张会议的地点/参与人/标题。
 */
function pruneExtractedForNew(
  text: string,
  extracted: Record<string, any>
): Record<string, any> {
  const out = { ...extracted };
  const hasDate = /(今天|明天|后天|下周[一二三四五六日]?|周[一二三四五六日]|(?<!\d\.)\d{1,2}\s*[月/.\-]\s*\d{1,2}(?!\.\d)\s*[日号]?)/.test(text);
  const hasTime = TIME_TOKEN_RE.test(text);
  const hasLoc = extractLocation(text) !== null;
  const hasPart = extractParticipants(text) !== null;
  if ('location' in out && !hasLoc) out.location = '';
  if ('participants' in out && !hasPart) out.participants = '';
  if ('date' in out && !hasDate) out.date = '';
  if ('time' in out && !hasTime) out.time = '';
  // 标题/主题类字段：当前消息中并未出现该标题（说明是从上一张卡片继承来的）→ 清空
  for (const k of ['event', 'task', 'content', 'description', 'summary']) {
    if (k in out && out[k] && typeof out[k] === 'string' && !isFieldFromText(out[k], text)) {
      out[k] = '';
    }
  }
  return out;
}

/**
 * 从消息文本中抽取「会议主题/内容」（去掉「的」、会议类型后缀后，作为「关于XX」的 XX）。
 * 支持多种说法：
 * - 关于XX：           「关于运营」/「关于鸿蒙适配的评审会」→ 运营 / 鸿蒙适配
 * - 讨论/聊聊/沟通XX：  「讨论营销方案」「聊聊下个版本规划」→ 营销方案 / 下个版本规划
 * - XX + 会议类型后缀： 「鸿蒙适配评审会」「版本规划沟通会」→ 鸿蒙适配 / 版本规划
 * 抽不到返回 null（由调用方回退为模型/规则标题或「会议」）。
 */
function cleanTopic(s: string): string {
  let t = (s || '').trim();
  // 去掉开头的语气/方式修饰（聊一下、咱们、线上/线下…），避免混入标题
  t = t.replace(/^(一下|一聊|聊聊|咱们|我们|大家|简单|稍微|线上|线下|远程|视频|电话|口头)/, '');
  // 去掉结尾的「的」（避免「鸿蒙适配的」→ 生成「关于鸿蒙适配的的会议」）
  t = t.replace(/的$/, '');
  // 去掉残留的会议类型 / 动词后缀（注意：方案/规划/事项 属主题内容，不能删）
  t = t.replace(
    /(开会|会议|评审会|评审|讨论会|讨论|沟通会|沟通|汇报会|汇报|洽谈会|洽谈|碰头会|碰头|例会|磋商会|磋商|协商会|协商|总结|计划|安排)$/,
    ''
  );
  // 再清一次结尾的「的」
  t = t.replace(/的$/, '');
  return t;
}

function extractMeetingTopic(text: string): string | null {
  // 1) 关于 / 有关 XX（可带「的评审会」等后缀）；排除「点」避免把时间点当主题
  let m = text.match(/关于\s*([^\s，。；、,.;：:点]{1,12})/);
  if (m) {
    const t = cleanTopic(m[1]);
    if (t.length >= 2) return t;
  }
  // 2) 讨论 / 聊聊 / 沟通 / 同步 / 聊 XX（到逗号/句号/结束）
  m = text.match(/(?:讨论|聊聊|沟通|研究|商讨|商量|谈一谈|谈谈|聊一聊|同步|聊)\s*([^\s，。；、,.;：:点]{1,15})/);
  if (m) {
    const t = cleanTopic(m[1]);
    if (t.length >= 2) return t;
  }
  // 3) XX + 会议类型后缀（鸿蒙适配评审会 → 鸿蒙适配；迭代站会 → 迭代）
  m = text.match(/([^\s，。；、,.;：:点]{1,12})(?:评审会|评审|讨论会|讨论|沟通会|沟通|汇报会|汇报|碰头会|碰头|例会|洽谈会|洽谈|磋商会|磋商|协商会|协商|站会|早会|晨会|周会|月会|年会|复盘会|复盘)/);
  if (m) {
    const t = cleanTopic(m[1]);
    if (t.length >= 2) return t;
  }
  return null;
}

/**
 * 规范化日程卡片标题：当用户在消息中明确提到会议主题/内容时，
 * 标题统一格式化为「关于XX的会议」，覆盖多种表述（关于X / 讨论X / X评审会 等）。
 * 例：
 * - 「周五15:00开会，关于运营」→「关于运营的会议」
 * - 「关于鸿蒙适配的评审会」→「关于鸿蒙适配的会议」（不再多一个「的」）
 * - 「开会讨论营销方案」→「关于营销方案的会议」
 * - 「周五15:00开会」（无主题）→ 回退为模型/规则抽取的标题，都没有则「会议」
 */
export function normalizeScheduleTitle(text: string, fallbackEvent?: string): string {
  const topic = extractMeetingTopic(text);
  if (topic && topic.length >= 2) return `关于${topic}的会议`;
  const fb = (fallbackEvent || '').trim();
  return fb || '会议';
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

  if (dateStr === '今天' || dateStr === '今晚') {
    return fmt(today);
  }
  if (dateStr === '明天' || dateStr === '明晚') {
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

/**
 * 按时段修饰词修正小时：12 小时制（如「下午2点」「早上9点」）需要转成 24 小时。
 * - 优先看 rawTime 自身是否带「下午/晚上/上午」；
 * - rawTime 没有时，回退到原始消息文本，并在该时间数字「就近」的左侧上下文里找修饰词，
 *   避免「上午10点，下午3点」这类多时间点被错误统一加上 12。
 * h >= 12 视为已是 24 小时制，直接返回。
 */
function applyAmPm(h: number, rawTime: string, messageText?: string): number {
  if (h >= 12) return h;
  if (/[下晚傍]/u.test(rawTime)) return h + 12;
  if (/[上早]/u.test(rawTime) && h === 12) return 0;
  if (messageText) {
    const tokenRe = new RegExp(`(\\D{0,5})${h}\\s*[：:点]`);
    const mm = messageText.match(tokenRe);
    const before = mm ? mm[1] : messageText;
    if (/[下晚傍]/.test(before)) return h + 12;
    if (/[上早]/.test(before) && h === 12) return 0;
  }
  return h;
}

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
    const md = rawDate.match(DATE_FRAG_RE);
    if (md) {
      dateStr = `${parseInt(md[1], 10)}月${parseInt(md[2], 10)}日`;
    } else if (rawDate && /[今明后周下]/u.test(rawDate)) {
      dateStr = resolveDate(rawDate.trim());
    } else if (rawTime && /[今明后周下]/u.test(rawTime)) {
      // 日期被写在 time 字段里（如示例 "周三下午15:00"）→ 从 time 串解析日期
      dateStr = resolveDate(rawTime.trim());
    } else if (messageText) {
      // LLM 未抽出日期时，从原始消息文本兜底（如「周四下午开会」→ 本周四）
      const mdMsg = messageText.match(DATE_FRAG_RE);
      const relMsg = messageText.match(/(今天|今晚|明天|明晚|后天|下周[一二三四五六日]?|周[一二三四五六日])/);
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
    h = applyAmPm(h, rawTime, messageText);
    timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  } else if (NOW_WORDS.test(ctx) && datePlain === today) {
    // 时间是「现在」且日期为今天：写入当前时刻，而不是落下日期-only
    // （日期-only 会被日历解析成 00:00 → 误判为「全天」，导致时间不显示）
    const now = new Date();
    timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  } else if (!timeStr && messageText) {
    // LLM 未抽出时间时，仅当用户明确说了具体钟点（如「3点」「15:00」）才补时间；
    // 只说「下午/上午/中午」而不给具体钟点 → 不臆造默认时间，仅显示日期（如「周四」）
    const hmMsg = messageText.match(/(\d{1,2})\s*[：:点]\s*(\d{0,2})/);
    if (hmMsg) {
      let h = parseInt(hmMsg[1], 10);
      const m = parseInt(hmMsg[2] || '0', 10);
      // rawTime 传空，仅靠 messageText 就近判断（避免多时间点被全局「下午」误加 12）
      h = applyAmPm(h, '', messageText);
      timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }
  }

  return timeStr ? `${dateStr} ${timeStr}` : dateStr;
}

/**
 * 归一化「待办截止时间」：把模型/规则抽取出的相对日期（"下周一"、"周五"、"今天"、
 * "8月10日"，或带钟点如"下周一 15:00"）统一转成日历能识别的 "M月D日 周X [HH:MM]"。
 * 与 buildScheduleTime 共用同一套日期/时间归一逻辑，保证待办与日程显示格式一致。
 *
 * - 优先用抽取出的 deadline 字段；
 * - 若 deadline 为空但消息本身含相对日期（如「周五前交」），则从消息文本兜底；
 * - 完全没有时间信息 → 返回空串（不臆造默认时间）。
 */
export function buildTodoDeadline(
  extracted: Record<string, any> | null | undefined,
  messageText?: string
): string {
  const e = extracted || {};
  let raw = e.deadline ? String(e.deadline) : '';
  if (!raw && messageText) {
    const relMsg = messageText.match(
      /(今天|明天|后天|下周[一二三四五六日]?|周[一二三四五六日]|(?<!\d\.)\d{1,2}\s*[月/.\-]\s*\d{1,2}(?!\.\d)\s*[日号]?)/
    );
    if (relMsg) raw = relMsg[1];
  }
  if (!raw) return '';

  // 把 deadline 中的钟点（如 "15:00"/"15点"）拆出来，日期部分交给 buildScheduleTime 归一
  const tm = raw.match(/(\d{1,2})\s*[：:点]\s*(\d{0,2})/);
  const datePart = raw.replace(tm?.[0] || '', '').trim();
  return buildScheduleTime({ date: datePart || raw, time: tm ? tm[0] : '' }, messageText);
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
export function mockChatAnalysis(message: string, _conversationName: string): ChatIntent {
  const trimmed = message.trim();
  const intent = classifyIntent(trimmed);

  if (intent === null) {
    return { hasIntent: false, type: null, data: null };
  }

  const dateMatch = trimmed.match(/(今天|今晚|明天|明晚|后天|下周[一二三四五六日]?|周[一二三四五六日]|(?:\d+)[月][\d]+[日号])/);
  const timeMatch = trimmed.match(/(\d{1,2})[：:点](\d{0,2})/);

  if (intent === 'schedule') {
    // 标题交给 normalizeScheduleTitle 从消息文本生成（支持「关于X/讨论X/X评审会」等多种主题），
    // 这里 event 留空，避免把整句话当成标题；地点/参与人用与续写合并一致的抽取器，
    // 保证「未配大模型 Key」的纯本地模式下也能识别 1218会议室 / @提及 人。
    const loc = extractLocation(trimmed);
    const parts = extractParticipants(trimmed);
    return {
      hasIntent: true,
      type: 'schedule',
      data: {
        type: 'schedule',
        event: '',
        date: resolveDate(dateMatch?.[1] || '今天'),
        time: timeMatch ? `${timeMatch[1]}:${timeMatch[2] || '00'}` : '',
        location: loc || '',
        participants: parts || '',
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
/**
 * 提取消息里 @ 提及的具体人名（排除 @所有人）。用于「负责人」展示与指派判断。
 */
export function mentionNames(content: string): string[] {
  return [...content.matchAll(/@([^\s@]+)/g)]
    .map((m) => m[1])
    .filter((n) => n && n !== '所有人');
}

/**
 * 计算一条 AI 卡片 / 日程 / 待办 的接收人（userId 列表）。
 *
 * 规则：
 * - 无 @ 提及，或包含「@所有人」 → 群内所有成员都能收到（含发送者）。
 * - 指定 @某人（如「@小王」）→ 仅被 @人收到，**发送者不收**。
 *   例：用户A给用户B发送待办并@B，只有B收到 AI 卡片，A 不会收到。
 *
 * @param content    用户发送的消息文本
 * @param memberIds  当前群组的成员 userId 列表
 * @param senderId   发送者（当前账号）userId
 */
export function computeRecipients(content: string, memberIds: string[], senderId: string): string[] {
  const mentions = [...content.matchAll(/@([^\s@]+)/g)].map((m) => m[1]);
  const hasAll = mentions.includes('所有人');

  // 无 @ 或 @所有人 → 全员（含发送者）
  if (hasAll || mentions.length === 0) {
    return memberIds.length ? [...memberIds] : [senderId];
  }

  // 指定 @某人 → 仅被 @人收到，发送者不收
  const ids = new Set<string>();
  mentions.forEach((name) => {
    const id = NAME_TO_ID[name];
    if (id) ids.add(id);
  });

  // 提及存在但没有解析到任何有效成员（如 @了不存在的人）→ 退化为全员（含发送者）
  if (ids.size === 0) {
    return memberIds.length ? [...memberIds] : [senderId];
  }

  return [...ids];
}

