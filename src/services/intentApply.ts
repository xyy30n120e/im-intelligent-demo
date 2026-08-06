/**
 * 把一条「已识别的意图」落地为 AI 卡片 + 对应 Tab 的数据（日程/待办/需求）。
 *
 * 该逻辑从 RightPanel.handleSend 中抽离出来，供两条路径复用：
 *   1) 高置信度（>=80%）：自动调用；
 *   2) 低置信度（<80%）：用户在「待确认」选择条上手动选择目标类型后调用。
 */
import { useAIStore } from '../store/aiStore';
import { generateItemId, NAME_TO_ID, buildScheduleTime, summarizeFileContent } from './aiService';
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
      event: sData.event || '会议',
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
      event: sData.event || '会议',
      location: sData.location || '',
      participants: sData.participants || '',
      source: convName,
      status: 'pending',
      detail: '',
      recipients,
    });
    store.setActiveCard(convId, { id: cardId, type: 'schedule', summary: sData.event || '会议', extracted: sData });
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
