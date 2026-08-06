/**
 * 把一条「已识别的意图」落地为 AI 卡片 + 对应 Tab 的数据（日程/待办/需求）。
 *
 * 该逻辑从 RightPanel.handleSend 中抽离出来，供两条路径复用：
 *   1) 高置信度（>=80%）：自动调用；
 *   2) 低置信度（<80%）：用户在「待确认」选择条上手动选择目标类型后调用。
 */
import { useAIStore } from '../store/aiStore';
import { generateItemId, NAME_TO_ID, buildScheduleTime, summarizeFileContent, normalizeScheduleTitle } from './aiService';
import { AICard } from '../data/aiMock';

export type IntentType = 'schedule' | 'todo' | 'request';

export interface ApplyIntentOptions {
  type: IntentType;
  /** LLM 抽取出的字段（schedule/todo/request 的混合结构） */
  extracted: Record<string, any>;
  /** 原始聊天文本，用于 @提及 路由 */
  msgText: string;
  recipients: string[];
  /** 已整理好的附件结构（与 AICard.fileMetas 一致） */
  attachedList: any[];
  now: string;
  convId: string;
  convName: string;
  userMsgId: string;
  /** 提出该需求的真人（消息发送者），作为卡片「创建人」 */
  senderName: string;
}

export async function applyIntent(opts: ApplyIntentOptions): Promise<void> {
  const { type, extracted, msgText, recipients, attachedList, now, convId, convName, userMsgId } = opts;
  const cardId = generateItemId();
  const store = useAIStore.getState();

  // 为每个文本文件生成其自身的 AI 概要（写入 meta.summary，卡片中按文件分别展示）
  for (const m of (attachedList || []) as any[]) {
    if (m && m.category === 'text' && m.content) {
      try {
        const s = await summarizeFileContent(m);
        if (s) m.summary = s;
      } catch { /* 概要失败不影响附件展示 */ }
    }
  }
  // 卡片级 fileSummary 取首个有概要的文件（兼容旧字段）
  let fileSummary: string | undefined;
  const firstWithSummary = (attachedList || []).find((m: any) => m.summary);
  if (firstWithSummary) fileSummary = firstWithSummary.summary;

  if (type === 'schedule') {
    const sData = extracted || {};
    const eventTime = buildScheduleTime(sData, msgText);
    const card: AICard = {
      id: cardId,
      type: 'schedule',
      source: convName,
      event: normalizeScheduleTitle(msgText, sData.event),
      time: now,
      eventTime: eventTime,
      location: sData.location || '',
      participants: sData.participants || '',
      status: 'pending',
      sourceConversationId: convId,
      sourceMessageId: userMsgId,
      messages: [],
      recipients,
      fileMetas: attachedList,
      fileSummary,
    };
    store.addAiCard(card);
    store.addScheduleItem({
      id: cardId,
      time: eventTime,
      event: normalizeScheduleTitle(msgText, sData.event),
      location: sData.location || '',
      participants: sData.participants || '',
      source: convName,
      status: 'pending',
      detail: '',
      recipients,
    });
    store.setActiveCard(convId, { id: cardId, type: 'schedule', summary: normalizeScheduleTitle(msgText, sData.event), extracted: sData });
    return;
  }

  if (type === 'todo') {
    const tData = extracted || {};
    const card: AICard = {
      id: cardId,
      type: 'todo',
      source: convName,
      task: tData.task || msgText,
      deadline: '',
      time: now,
      sourceConversationId: convId,
      sourceMessageId: userMsgId,
      messages: [],
      recipients,
      fileMetas: attachedList,
      fileSummary,
    };
    store.addAiCard(card);
    store.addTodoItem({
      id: cardId,
      task: tData.task || msgText,
      deadline: '',
      source: convName,
      completed: false,
      detail: tData.detail || '',
      recipients,
      sourceConversationId: convId,
      sourceMessageId: userMsgId,
    });
    store.setActiveCard(convId, { id: cardId, type: 'todo', summary: tData.task || msgText, extracted: tData });
    return;
  }

  // request
  const rData = extracted || {};
  const reqText = rData.description || msgText;
  const reqDesc = rData.description || msgText;
  const mentions = [...msgText.matchAll(/@([^\s@]+)/g)].map((m) => m[1]);
  const specific = mentions.filter((n) => n !== '所有人' && NAME_TO_ID[n]);

  const makeReqCard = (pid: string, id: string): AICard => ({
    id,
    type: 'request',
    source: convName,
    applicant: opts.senderName,
    event: reqText,
    task: reqText,
    summary: reqDesc,
    description: reqDesc,
    issueType: rData.issueType || 'feature',
    version: rData.version,
    time: now,
    status: 'following',
    sourceConversationId: convId,
    sourceMessageId: userMsgId,
    messages: [],
    recipients: [pid],
    fileMetas: attachedList,
    fileSummary,
  });

  let firstReqId: string | null = null;
  if (specific.length > 0) {
    specific.forEach((name) => {
      const pid = NAME_TO_ID[name];
      if (!pid) return;
      const perCardId = generateItemId();
      const perCard = makeReqCard(pid, perCardId);
      store.addAiCard(perCard);
      store.addTodoItem({
        id: perCardId,
        task: '需求跟进：' + reqText,
        deadline: '',
        source: convName,
        completed: false,
        detail: reqDesc,
        recipients: [pid],
        sourceConversationId: convId,
        sourceMessageId: userMsgId,
      });
      if (!firstReqId) firstReqId = perCardId;
    });
  } else {
    const zhangsanId = 'c4';
    const reqCardId = generateItemId();
    const reqCard = makeReqCard(zhangsanId, reqCardId);
    store.addAiCard(reqCard);
    store.addTodoItem({
      id: reqCardId,
      task: '需求跟进：' + (reqText.length > 36 ? reqText.substring(0, 36) + '…' : reqText),
      deadline: '',
      source: convName,
      completed: false,
      detail: reqDesc,
      recipients: [zhangsanId],
      sourceConversationId: convId,
      sourceMessageId: userMsgId,
    });
    firstReqId = reqCardId;
  }
  if (firstReqId) {
    store.setActiveCard(convId, { id: firstReqId, type: 'request', summary: reqText, extracted: rData });
  }
}

export interface ApplyUpdateOptions {
  /** 要更新的已有卡片 id */
  targetId: string;
  /** 卡片类型 */
  type: IntentType;
  /** 本次消息抽取/合并出的字段 */
  extracted: Record<string, any>;
  /** 原始聊天文本，用于时间归一化和补充说明 */
  msgText: string;
  /** 要追加到卡片的附件 */
  attachedList?: any[];
  /** 消息发送时间 */
  now?: string;
  /** 当前会话 id，用于刷新 activeCard */
  convId: string;
}

/**
 * 把一条「已识别为更新」的消息合并进已有卡片，并追加附件。
 * 供 RightPanel.handleSend 的 isUpdate 分支和「待确认」选择条的「更新上一张」使用。
 */
export function applyUpdateToCard(opts: ApplyUpdateOptions): void {
  const { targetId, type, extracted, msgText, attachedList, convId } = opts;
  const store = useAIStore.getState();
  const card = store.aiCards.find((c) => c.id === targetId);
  if (!card) return;

  if (type === 'schedule') {
    const eventTime = buildScheduleTime(extracted, msgText);
    const spatch: any = {};
    if (extracted.event !== undefined) spatch.event = extracted.event;
    if (extracted.location !== undefined) spatch.location = extracted.location;
    if (extracted.participants !== undefined) spatch.participants = extracted.participants;
    if (eventTime) spatch.time = eventTime;
    store.patchSchedule(targetId, spatch);
  } else if (type === 'todo') {
    const tpatch: any = {};
    if (extracted.task !== undefined) tpatch.task = extracted.task;
    if (extracted.deadline !== undefined) tpatch.deadline = extracted.deadline;
    if (extracted.detail !== undefined) {
      tpatch.detail = extracted.detail;
    } else if (msgText) {
      const prev = (card as any).detail || '';
      tpatch.detail = prev ? `${prev}；${msgText}` : msgText;
    }
    store.patchTodo(targetId, tpatch);
  } else if (type === 'request') {
    store.updateAICard(targetId, {
      summary: extracted.content || extracted.description || (card as any).summary || msgText,
      description: extracted.description || extracted.content || (card as any).description || msgText,
      detail: extracted.detail || '',
    } as Partial<AICard>);
  }

  if (attachedList && attachedList.length) {
    const existing = card.fileMetas || [];
    store.updateAICard(targetId, { fileMetas: [...existing, ...attachedList] });
  }

  // 刷新当前会话的活动卡片引用，便于后续消息继续续写
  store.setActiveCard(convId, {
    id: targetId,
    type,
    summary: (card as any).event || (card as any).task || (card as any).summary || msgText,
    extracted: { ...((card as any).extracted || {}), ...extracted },
  });
}
