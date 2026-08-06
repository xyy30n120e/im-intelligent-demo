import { create } from 'zustand';
import { AICard, AICardFileMeta, ScheduleItem, TodoItem, aiCards, scheduleItems, todoItems } from '../data/aiMock';
import { useStore } from './useStore';

export interface CategoryCounts {
  ai: number;
  schedule: number;
  todo: number;
  approval: number;
  request: number;
}

const emptyCounts = (): CategoryCounts => ({ ai: 0, schedule: 0, todo: 0, approval: 0, request: 0 });

// 接收人列表；若无接收人则回退为当前账号（兼容历史 mock 数据）
function recipientIds(recipients?: string[]): string[] {
  if (recipients && recipients.length > 0) return recipients;
  return [useStore.getState().currentUserId];
}

// 仅给接收人列表里每个账号累加对应分类角标，并点亮其 AI 圆点
function withUserBump(
  badgeCounts: Record<string, CategoryCounts>,
  aiNavBadge: Record<string, number>,
  userIds: string[],
  category: keyof CategoryCounts
): { badgeCounts: Record<string, CategoryCounts>; aiNavBadge: Record<string, number> } {
  const nextBadge = { ...badgeCounts };
  const nextNav = { ...aiNavBadge };
  userIds.forEach((uid) => {
    const cur = nextBadge[uid] || emptyCounts();
    nextBadge[uid] = { ...cur, [category]: (cur[category] || 0) + 1 };
    nextNav[uid] = 1;
  });
  return { badgeCounts: nextBadge, aiNavBadge: nextNav };
}

export type AITabType = 'ai' | 'schedule' | 'todo' | 'approval' | 'request' | null;

interface AIState {
  activeAITab: AITabType;
  aiCards: AICard[];
  scheduleItems: ScheduleItem[];
  todoItems: TodoItem[];
  selectedCardId: string | null;
  selectedScheduleId: string | null;
 selectedTodoId: string | null;
  editingTodoId: string | null;
  editingScheduleId: string | null;
  highlightScheduleId: string | null;
  highlightScheduleDate: string | null;
  badgeCounts: Record<string, CategoryCounts>;
  aiNavBadge: Record<string, number>;
  reviewVersion: number;
  firstReuploadedMsgId: string | null;
  /** 跳转到需求标签并自动打开某需求的编辑弹窗（来自 AI 卡片的「查看详情」） */
  requestEditId: string | null;
  /** 低置信度意图：等待用户手动确认加入哪个 Tab */
  pendingIntents: PendingIntent[];
  /**
   * 每个会话「当前最新/正在补充」的 AI 卡片引用，用于上下文续写合并。
   * key = conversationId；value 记录卡片 id、类型、已抽取字段与最后活跃时间。
   * 当同会话后续消息被判定为「对同一事项的补充/修改」时，直接更新这张卡片而非新建。
   */
  activeCardByConv: Record<string, { id: string; type: 'schedule' | 'todo' | 'request'; summary: string; extracted: Record<string, any>; at: number }>;

  setActiveCard: (convId: string, card: { id: string; type: 'schedule' | 'todo' | 'request'; summary: string; extracted: Record<string, any> }) => void;
  clearActiveCard: (convId: string) => void;
  /** 就地合并日程字段（不重建时间，除非显式传入 time） */
  patchSchedule: (id: string, data: Partial<Pick<ScheduleItem, 'event' | 'location' | 'participants' | 'detail' | 'time' | 'status'>>) => void;
  /** 就地合并待办字段（含接收人 recipients，用于改派时把对应待办转移给新处理人） */
  patchTodo: (id: string, data: Partial<Pick<TodoItem, 'task' | 'deadline' | 'detail' | 'completed' | 'recipients'>>) => void;

  setAITab: (tab: AITabType) => void;
  openRequestEdit: (id: string) => void;
  closeRequestEdit: () => void;
  selectCard: (id: string | null) => void;
  selectSchedule: (id: string) => void;
  selectTodo: (id: string) => void;
  clearAiNavBadge: () => void;
 getSelectedCard: () => AICard | undefined;
 getSelectedSchedule: () => ScheduleItem | undefined;
 getSelectedTodo: () => TodoItem | undefined;
 deleteSchedule: (id: string) => void;
 toggleTodoStatus: (id: string) => void;
  deleteTodo: (id: string) => void;
  updateTodo: (id: string, data: { task: string; deadline: string; detail?: string }) => void;
 updateSchedule: (id: string, data: { title: string; location: string; allDay: boolean; startDate: Date; endDate: Date; participants?: string; notes?: string; attachments?: AICardFileMeta[] }) => void;
  navigateToScheduleView: (eventId: string, dateStr: string) => void;
  navigateToTodoView: (todoId: string) => void;
  openTodoEditor: (todoId: string) => void;
  closeTodoEditor: () => void;
  openScheduleEditor: (id: string) => void;
  closeScheduleEditor: () => void;
  addAiCard: (card: AICard) => void;
  updateAICard: (id: string, data: Partial<AICard>) => void;
  deleteAICard: (id: string) => void;
  addPendingIntent: (item: PendingIntent) => void;
  removePendingIntent: (id: string) => void;
  addScheduleItem: (item: ScheduleItem) => void;
  addTodoItem: (item: TodoItem) => void;
  incrementReviewVersion: () => void;
  setFirstReuploadedMsgId: (id: string | null) => void;
}

/** 低置信度意图：等待用户手动确认要加入哪个 Tab */
export interface PendingIntent {
  id: string;
  /** 原始聊天文本 */
  rawText: string;
  /** 模型预测的类型（仅供参考，用户可改选） */
  predicted: 'schedule' | 'todo' | 'request';
  /** 模型抽取出的字段（schedule/todo/request 混合结构） */
  extracted: Record<string, any>;
  recipients: string[];
  fileMetas: any[];
  time: string;
  convId: string;
  convName: string;
  userMsgId: string;
  confidence: number;
  /** 待确认模式：predict=普通低置信度意图选择；ambiguous=不确定是更新旧卡片还是新建 */
  mode?: 'predict' | 'ambiguous';
  /** ambiguous 模式时，要更新的目标卡片 id */
  updateTargetId?: string;
  /** ambiguous 模式时，上一张卡片的摘要（用于展示） */
  lastCardSummary?: string;
}

export const useAIStore = create<AIState>((set, get) => ({
  activeAITab: 'ai',
  aiCards: aiCards,
  scheduleItems: scheduleItems,
  todoItems: todoItems,
  selectedCardId: null,
  selectedScheduleId: null,
 selectedTodoId: null,
  editingTodoId: null,
  editingScheduleId: null,
  highlightScheduleId: null,
  highlightScheduleDate: null,
  reviewVersion: 0,
  firstReuploadedMsgId: null,
  requestEditId: null,
  pendingIntents: [],
  activeCardByConv: {},
  badgeCounts: {},
  aiNavBadge: {},

  setAITab: (tab) => {
    const uid = useStore.getState().currentUserId;
    const state = get();
    const cur = state.badgeCounts[uid] || emptyCounts();
    const nextUser = { ...cur, [tab as string]: 0 };
    const nextAll = { ...state.badgeCounts, [uid]: nextUser };
    const nextNav = { ...state.aiNavBadge, [uid]: Object.values(nextUser).some((v: number) => v > 0) ? 1 : 0 };
    set({
      activeAITab: tab,
     selectedCardId: null,
     selectedScheduleId: null,
     selectedTodoId: null,
      highlightScheduleId: null,
      highlightScheduleDate: null,
      badgeCounts: nextAll,
      aiNavBadge: nextNav,
    });
  },
  clearAiNavBadge: () => {
    const uid = useStore.getState().currentUserId;
    const state = get();
    const cur = state.badgeCounts[uid] || emptyCounts();
    const anyBadge = Object.values(cur).some(v => v > 0) ? 1 : 0;
    set({ aiNavBadge: { ...state.aiNavBadge, [uid]: anyBadge } });
  },

  openRequestEdit: (id) => {
    const uid = useStore.getState().currentUserId;
    const state = get();
    const cur = state.badgeCounts[uid] || emptyCounts();
    const nextUser = { ...cur, request: 0 };
    const nextAll = { ...state.badgeCounts, [uid]: nextUser };
    const nextNav = { ...state.aiNavBadge, [uid]: Object.values(nextUser).some((v: number) => v > 0) ? 1 : 0 };
    set({
      activeAITab: 'request',
      requestEditId: id,
      selectedCardId: null,
      selectedScheduleId: null,
      selectedTodoId: null,
      highlightScheduleId: null,
      highlightScheduleDate: null,
      badgeCounts: nextAll,
      aiNavBadge: nextNav,
    });
  },
  closeRequestEdit: () => set({ requestEditId: null }),

  selectCard: (id) => {
    set({ selectedCardId: id });
  },

  selectSchedule: (id) => {
    set({ selectedScheduleId: id });
  },

  selectTodo: (id) => {
    set({ selectedTodoId: id });
  },

  getSelectedCard: () => {
    const state = get();
    return state.aiCards.find(c => c.id === state.selectedCardId);
  },

  getSelectedSchedule: () => {
    const state = get();
    return state.scheduleItems.find(s => s.id === state.selectedScheduleId);
  },

  getSelectedTodo: () => {
    const state = get();
    return state.todoItems.find(t => t.id === state.selectedTodoId);
  },
  toggleTodoStatus: (id) => {
    const state = get();
    const updated = state.todoItems.map(t =>
      t.id === id ? { ...t, completed: !t.completed } : t
    );
   set({ todoItems: updated });
 },
  deleteTodo: (id) => {
    const state = get();
    const uid = useStore.getState().currentUserId;
    // 仅移除待办条目；AI 助手中的对应卡片保留，不做置灰/删除
    const updated = state.todoItems.filter(t => t.id !== id);
    const cur = state.badgeCounts[uid] || emptyCounts();
    const nextUser = { ...cur, todo: Math.max(0, (cur.todo || 0) - 1) };
    const nextAll = { ...state.badgeCounts, [uid]: nextUser };
    const nextNav = { ...state.aiNavBadge, [uid]: Object.values(nextUser).some((v: number) => v > 0) ? 1 : 0 };
    set({
      todoItems: updated,
      badgeCounts: nextAll,
      aiNavBadge: nextNav,
    });
  },
  updateTodo: (id, data) => {
    const state = get();
    const updated = state.todoItems.map(t =>
      t.id === id ? { ...t, task: data.task, deadline: data.deadline, detail: data.detail ?? t.detail } : t
    );
    set({ todoItems: updated });
  },
 deleteSchedule: (id) => {
   const state = get();
   const uid = useStore.getState().currentUserId;
  const updatedSchedule = state.scheduleItems.filter(s => s.id !== id);
   const updatedCards = state.aiCards.map(c =>
     c.id === id && c.type === 'schedule' ? { ...c, disabled: true } : c
   );
   const cur = state.badgeCounts[uid] || emptyCounts();
   const nextUser = { ...cur, schedule: Math.max(0, (cur.schedule || 0) - 1) };
   const nextAll = { ...state.badgeCounts, [uid]: nextUser };
   const nextNav = { ...state.aiNavBadge, [uid]: Object.values(nextUser).some((v: number) => v > 0) ? 1 : 0 };
   set({
     scheduleItems: updatedSchedule,
     aiCards: updatedCards,
     badgeCounts: nextAll,
     aiNavBadge: nextNav,
   });
 },
  updateSchedule: (id, data) => {
    const state = get();
    const fmt = (d: Date) => {
      const m = d.getMonth() + 1;
      const day = d.getDate();
      return `${m}月${day}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };
    const timeStr = data.allDay
      ? `${data.startDate.getMonth() + 1}月${data.startDate.getDate()}日 全天`
      : fmt(data.startDate);

    const exists = state.scheduleItems.some(s => s.id === id);
    let updatedSchedule: ScheduleItem[];
    if (exists) {
      updatedSchedule = state.scheduleItems.map(s =>
        s.id === id ? { ...s, event: data.title, location: data.location, time: timeStr, detail: data.notes, participants: data.participants, attachments: data.attachments } : s
      );
    } else {
      // AI 生成的日程通常没有独立 scheduleItem，这里 upsert 一条，使附件等改动可持久化
      const card = state.aiCards.find(c => c.id === id && c.type === 'schedule');
      const newItem: ScheduleItem = {
        id,
        time: timeStr,
        event: data.title,
        location: data.location,
        source: card?.source || '手动添加',
        status: (card?.status === 'confirmed' ? 'confirmed' : 'pending'),
        detail: data.notes,
        participants: data.participants,
        recipients: card?.recipients,
        attachments: data.attachments,
      };
      updatedSchedule = [...state.scheduleItems, newItem];
    }
    const updatedCards = state.aiCards.map(c =>
      c.id === id && c.type === 'schedule'
        ? { ...c, event: data.title, location: data.location, eventTime: timeStr, fileMetas: data.attachments }
        : c
    );
   set({ scheduleItems: updatedSchedule, aiCards: updatedCards });
  },
  addScheduleItem: (item) => {
    const state = get();
    const uids = recipientIds(item.recipients);
    const { badgeCounts, aiNavBadge } = withUserBump(state.badgeCounts, state.aiNavBadge, uids, 'schedule');
    set({
      scheduleItems: [...state.scheduleItems, item],
      badgeCounts,
      aiNavBadge,
    });
  },
  addTodoItem: (item) => {
    const state = get();
    const uids = recipientIds(item.recipients);
    const { badgeCounts, aiNavBadge } = withUserBump(state.badgeCounts, state.aiNavBadge, uids, 'todo');
    const updated = [...state.todoItems, item];
    set({
      todoItems: updated,
      badgeCounts,
      aiNavBadge,
    });
  },
  navigateToScheduleView: (eventId, dateStr) => {
    set({
      activeAITab: 'schedule',
      highlightScheduleId: eventId,
      highlightScheduleDate: dateStr,
      selectedCardId: null,
      selectedTodoId: null,
    });
  },
  navigateToTodoView: (todoId) => {
    set({
      activeAITab: 'todo',
      selectedTodoId: todoId,
      selectedCardId: null,
      selectedScheduleId: null,
      highlightScheduleId: null,
      highlightScheduleDate: null,
    });
  },
  openTodoEditor: (todoId) => {
    set({
      activeAITab: 'todo',
      selectedTodoId: todoId,
      editingTodoId: todoId,
      selectedCardId: null,
      selectedScheduleId: null,
      highlightScheduleId: null,
      highlightScheduleDate: null,
    });
  },
  closeTodoEditor: () => set({ editingTodoId: null }),
  openScheduleEditor: (id) => {
    set({
      activeAITab: 'schedule',
      editingScheduleId: id,
      selectedCardId: null,
      selectedTodoId: null,
      highlightScheduleId: null,
      highlightScheduleDate: null,
    });
  },
  closeScheduleEditor: () => set({ editingScheduleId: null }),

  setActiveCard: (convId, card) => {
    set((state) => ({
      activeCardByConv: {
        ...state.activeCardByConv,
        [convId]: { ...card, at: Date.now() },
      },
    }));
  },
  clearActiveCard: (convId) => {
    set((state) => {
      const next = { ...state.activeCardByConv };
      delete next[convId];
      return { activeCardByConv: next };
    });
  },
  patchSchedule: (id, data) => {
    const state = get();
    const updatedSchedule = state.scheduleItems.map((s) =>
      s.id === id ? { ...s, ...data } : s
    );
    const updatedCards = state.aiCards.map((c) => {
      if (c.id === id && c.type === 'schedule') {
        const patch: Partial<AICard> = {};
        if (data.event !== undefined) patch.event = data.event;
        if (data.location !== undefined) patch.location = data.location;
        if (data.participants !== undefined) patch.participants = data.participants;
        if (data.time !== undefined) (patch as any).eventTime = data.time;
        return { ...c, ...patch };
      }
      return c;
    });
    set({ scheduleItems: updatedSchedule, aiCards: updatedCards });
  },
  patchTodo: (id, data) => {
    const state = get();
    const updatedTodo = state.todoItems.map((t) =>
      t.id === id ? { ...t, ...data } : t
    );
    const updatedCards = state.aiCards.map((c) => {
      if (c.id === id && (c.type === 'todo' || c.type === 'request')) {
        const patch: Partial<AICard> = {};
        if (data.task !== undefined) patch.task = data.task;
        if (data.deadline !== undefined) patch.deadline = data.deadline;
        return { ...c, ...patch };
      }
      return c;
    });
    set({ todoItems: updatedTodo, aiCards: updatedCards });
  },

  addAiCard: (card: AICard) => {
    const state = get();
    const uids = recipientIds(card.recipients);
    const { badgeCounts, aiNavBadge } = withUserBump(state.badgeCounts, state.aiNavBadge, uids, 'ai');
    set({
      aiCards: [...state.aiCards, card],
      badgeCounts,
      aiNavBadge,
    });
  },
  updateAICard: (id, data) => {
    set((state) => ({
      aiCards: state.aiCards.map((c) => (c.id === id ? { ...c, ...data } : c)),
    }));
  },
  deleteAICard: (id) => {
    set((state) => ({
      aiCards: state.aiCards.filter((c) => c.id !== id),
    }));
  },
  addPendingIntent: (item) => {
    set((state) => ({ pendingIntents: [...state.pendingIntents, item] }));
  },
  removePendingIntent: (id) => {
    set((state) => ({ pendingIntents: state.pendingIntents.filter((p) => p.id !== id) }));
  },
  incrementReviewVersion: () => {
    set((state) => ({ reviewVersion: state.reviewVersion + 1 }));
  },
  setFirstReuploadedMsgId: (id) => {
    set({ firstReuploadedMsgId: id });
  },
}));
