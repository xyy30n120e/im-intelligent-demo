// @ts-nocheck
import React, { useMemo, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAIStore } from "../store/aiStore";
import { useStore } from "../store/useStore";
import { AICard, AICardFileMeta, TodoItem } from "../data/aiMock";
import { getMessages, updateMessage, addMessage, generateMessageId, getCurrentTime, resolveFileKind } from "../data/mockData";
import { FileIcon } from "./FileIcon";
import { FilePreviewModal } from "./FilePreviewModal";
import { DeleteButton } from "./DeleteButton";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import AiPinnedReminder from "./AiPinnedReminder";
import ApprovalPanel from "./ApprovalPanel";
import { useApprovalStore } from "../store/approvalStore";
import { STATUS, STATUS_TEXT, getAllSubordinates, getMyRole, isTerminal } from "../data/approvalData";

// 各 AI 子标签标题下显示的简介（与左侧 AiMiddleBar 的 desc 保持一致）
const AI_TAB_INTRO: Record<string, string> = {
  ai: "智能会议 · 待办提醒 · 自动摘要",
  schedule: "智能排期 · 会议管理 · 提醒",
  todo: "任务管理 · 优先级 · 进度跟踪",
  request: "需求池 · 优先级排序 · 迭代规划",
  approval: "流程审批 · 待办处理 · 记录追踪",
};

// ?? ?? ??
function parseCardTime(t) {
  const m = t.match(/^(\d+)?(\d+)?\s+(\d+):(\d+)/);
  if (!m) return 0;
  const [, month, day, hour, min] = m.map(Number);
  return (month * 30 + day) * 1440 + hour * 60 + min;
}

function sortByTimeAsc(a, b) {
  return parseCardTime(a.time) - parseCardTime(b.time);
}

// 把参与者字符串规范为中文逗号（，）分隔，兼容英文逗号/顿号/空格/分号等混用
function normalizeParticipants(p?: string): string {
  if (!p) return "";
  return p
    .split(/[，,、;；\s/]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("，");
}

// 解析待办截止时间（支持 "7月2日 周四 15:00" / "7月2日 全天" 等），无法解析返回 null
function parseDeadline(dl?: string): Date | null {
  if (!dl) return null;
  const md = dl.match(/(\d{1,2})月(\d{1,2})日/);
  if (!md) return null;
  const month = parseInt(md[1], 10) - 1;
  const day = parseInt(md[2], 10);
  const now = new Date();
  const year = now.getFullYear();
  let hour = 0, minute = 0;
  const tm = dl.match(/(\d{1,2}):(\d{2})/);
  if (tm) { hour = parseInt(tm[1], 10); minute = parseInt(tm[2], 10); }
  else if (/全天/.test(dl)) { hour = 23; minute = 59; }
  return new Date(year, month, day, hour, minute, 0);
}

// 待办排序：未完成的在上、已完成的沉底；同组内按截止时间升序（逾期最前），无截止时间的排最后
function sortTodosForView(items) {
  const now = Date.now();
  return [...items].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    const da = parseDeadline(a.deadline);
    const db = parseDeadline(b.deadline);
    if (!!da !== !!db) return da ? -1 : 1;
    if (da && db) return da.getTime() - db.getTime();
    return 0;
  });
}

// 解析任意格式截止时间：审批用 YYYY-MM-DD（或 ISO），个人待办用 "7月2日 周四 15:00"；无法解析返回 null
function parseAnyDeadline(dl?: string): Date | null {
  if (!dl) return null;
  const iso = dl.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10), 23, 59, 0);
  }
  return parseDeadline(dl);
}

// 审批状态 → 待处理卡片配色（fg=边框/文字，bg=淡背景）
const AP_STATUS_COLOR: Record<string, { fg: string; bg: string }> = {
  dispatched:     { fg: "#2563EB", bg: "rgba(59,130,246,0.08)" },
  progress:       { fg: "#7C3AED", bg: "rgba(139,92,246,0.08)" },
  overdue:        { fg: "#DC2626", bg: "rgba(239,68,68,0.08)" },
  pending_cancel: { fg: "#D97706", bg: "rgba(245,158,11,0.10)" },
  done:           { fg: "#059669", bg: "rgba(16,185,129,0.08)" },
  cancelled:      { fg: "#6B7280", bg: "rgba(156,163,175,0.10)" },
  revoked:        { fg: "#6B7280", bg: "rgba(156,163,175,0.10)" },
};

// 从审批事项中筛出「需要当前用户处理」的条目，作为统一待处理入口的审批卡片
// - 执行者：我是责任人/协作人且在途（待认领/进行中/逾期）
// - 管理者：管辖范围内在途 + 待作废（待认领/进行中/逾期/待作废）
function getApprovalTodosForUser(items, userName, role) {
  if (!items || !userName) return [];
  return items
    .filter((it) => {
      const mr = getMyRole(it, role, userName);
      if (role === "manager") {
        return mr === "manager" && !isTerminal(it.status) && it.status !== "done";
      }
      return (mr === "assignee" || mr === "collaborator") && !isTerminal(it.status);
    })
    .map((it) => ({
      id: it.id,
      title: it.title,
      deadline: it.deadline,
      status: it.status,
      category: it.category,
    }));
}


// 判断某条 AI 数据（卡片/日程/待办）是否对当前账号可见：
// 未设置 recipients（历史 mock 数据）时对所有账号可见；否则仅对 recipients 内的账号可见。
function visibleTo(userId, item) {
  return !item.recipients || item.recipients.includes(userId);
}

// ?? KeyValueRow ??
const KeyValueRow = ({ icon, label, value }) => (
  <div className="flex items-center gap-3 py-1.5">
    <span className="text-sm text-primary-500 flex-shrink-0">{icon}</span>
    <span className="text-xs text-gray-500 w-[36px] flex-shrink-0">{label}</span>
    <span className="text-sm text-gray-800">{value}</span>
  </div>
);


// ?? AI ???? ??
// 各类型卡片主题：颜色不同但视觉语言统一（柔和渐变背景 + 左侧色条 + 同色系图标徽章 + 同色系强调文字）
const CARD_THEME = {
  schedule:     { bg: "bg-gradient-to-r from-sky-50/80 to-blue-50/40",      bar: "border-l-4 border-l-sky-400",     badge: "bg-sky-100 text-sky-600",     accent: "text-sky-600 hover:text-sky-700",      sumBg: "bg-sky-50/60",     sumBar: "border-l-2 border-sky-300",     sumText: "text-sky-500" },
  todo:         { bg: "bg-gradient-to-r from-emerald-50/80 to-teal-50/40", bar: "border-l-4 border-l-emerald-400", badge: "bg-emerald-100 text-emerald-600", accent: "text-emerald-600 hover:text-emerald-700", sumBg: "bg-emerald-50/60", sumBar: "border-l-2 border-emerald-300", sumText: "text-emerald-500" },
  request:      { bg: "bg-gradient-to-r from-violet-50/80 to-fuchsia-50/40", bar: "border-l-4 border-l-violet-400", badge: "bg-violet-100 text-violet-600", accent: "text-violet-600 hover:text-violet-700",  sumBg: "bg-violet-50/60", sumBar: "border-l-2 border-violet-300", sumText: "text-violet-500" },
  notification: { bg: "bg-gradient-to-r from-amber-50/80 to-orange-50/40",  bar: "border-l-4 border-l-amber-400",  badge: "bg-amber-100 text-amber-600",  accent: "text-amber-600 hover:text-amber-700",   sumBg: "bg-amber-50/60",  sumBar: "border-l-2 border-amber-300",  sumText: "text-amber-500" },
  file:         { bg: "bg-gradient-to-r from-cyan-50/80 to-sky-50/40",      bar: "border-l-4 border-l-cyan-400",    badge: "bg-cyan-100 text-cyan-600",    accent: "text-cyan-600 hover:text-cyan-700",     sumBg: "bg-cyan-50/60",   sumBar: "border-l-2 border-cyan-300",    sumText: "text-cyan-500" },
};

const AiCardBubble = ({ card, linkedCard, onViewSource, onViewLinked, onViewDetail }) => {
  const theme = CARD_THEME[card.type] || CARD_THEME.schedule;
  const isTodo = card.type === "todo";
  const isNotification = card.type === "notification";
  const isRequest = card.type === "request";
  const isFile = card.type === "file";
  const [previewFile, setPreviewFile] = React.useState<AICardFileMeta | null>(null);
  const renderFileItem = (meta: AICardFileMeta, key: number) => {
    // 该文件自身的 AI 概要，显示在附件条目下方
    const summaryNode = meta.summary ? (
      <div className={"mt-1.5 text-xs text-gray-600 leading-relaxed " + theme.sumBg + " rounded-lg px-3 py-2 " + theme.sumBar}>
        <span className={theme.sumText + " font-medium"}>AI 概要：</span>{meta.summary}
      </div>
    ) : null;
    if (meta.category === 'image' && meta.dataUrl) {
      return (
        <div key={key} className="space-y-1">
          <img src={meta.dataUrl} alt={meta.name} className="w-full max-h-48 object-cover rounded-lg border border-gray-200 cursor-pointer" onClick={() => setPreviewFile(meta)} title="点击预览" />
          {summaryNode}
        </div>
      );
    }
    return (
      <div key={key} className="space-y-1">
        <div className="flex items-center gap-2 text-sm text-gray-500 cursor-pointer" onClick={() => setPreviewFile(meta)} title="点击预览文本内容">
          <FileIcon kind={meta.kind} size={22} />
          <span>{meta.name}</span>
        </div>
        {summaryNode}
      </div>
    );
  };
  const title = isNotification ? "AI通知" : isTodo ? card.task : isRequest ? (card.task || card.event) : isFile ? (card.fileMetas?.[0]?.name || "文件") : card.event;
  const notificationReuploaded = isNotification ? (() => {
    try { return JSON.parse(card.summary || "{}").reuploaded === true; } catch { return false; }
  })() : false;
  const cardTypeClass = card.type === 'request' ? 'requirement' : card.type === 'notification' ? 'notification' : card.type === 'file' ? 'file' : card.type;
  const cardCls = "ai-card " + (card.disabled ? "ai-card--disabled" : "ai-card--" + cardTypeClass);
  return (
    <>
      <div className={"rounded-xl overflow-hidden border border-gray-200 transition-all duration-200 " + cardCls + " " + (
        card.disabled
          ? "bg-gray-50 opacity-60 border-l-4 border-l-gray-300"
          : theme.bg + " " + theme.bar
      )}>
      {/* 卡片头部 */}
      <div className="px-7 py-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2.5">
            <span className={"w-8 h-8 rounded-lg flex items-center justify-center text-base card-icon"}>
              <i className={"fas " + (isNotification ? "fa-bell" : isTodo ? "fa-list-check" : isRequest ? "fa-clipboard-list" : isFile ? "fa-file" : "fa-calendar-alt")}></i>
            </span>
            <div>
              <div className="text-sm font-semibold text-gray-900 card-title">{title}</div>
              <span className="text-xs text-gray-400">
                {card.disabled ? "已删除" : isNotification ? "AI通知" : isTodo ? "AI待办" : isRequest ? "AI需求" : isFile ? "AI文件" : "AI日程"}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {!card.disabled && !isNotification && !isFile && onViewDetail && (
              <button onClick={(e) => { e.stopPropagation(); onViewDetail(); }}
                className="card-view-detail whitespace-nowrap">
                查看详情 →
              </button>
            )}
          </div>
        </div>

        {/* 卡片内容 */}
        {isNotification ? (
          (() => {
            try {
              const d = JSON.parse(card.summary || "{}");
              const fields = d.fields || [];
              const items = d.items || [];
              return (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    {fields.map((f, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm">
                        <span className="text-gray-500">{f.label}</span>
                        <span className="text-gray-800 font-medium">{f.value}</span>
                      </div>
                    ))}
                  </div>
                  {items.length > 0 && (
                    <>
                      <div className="border-t border-gray-100"></div>
                      <div className="text-sm text-gray-500 font-medium">需要修改的视频：</div>
                      <div className="space-y-2">
                        {items.map((item, i) => (
                          <div key={i} className="flex items-center gap-3 px-3 py-2.5 bg-gray-50 rounded-lg">
                            <span className="text-sm font-bold text-gray-300 w-5">{i + 1}</span>
                            <div className="w-8 h-8 rounded bg-gray-600 flex items-center justify-center flex-shrink-0">
                              <svg className="w-3 h-3 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                                <polygon points="8,5 19,12 8,19"/>
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-700 truncate">{item.name}</div>
                              <div className="text-xs text-red-500">{item.reason}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            } catch { return null; }
          })()
        ) : isTodo ? (
          <div className="space-y-2">
            <div className="flex items-center gap-3 py-2">
              <span className="text-sm text-gray-500 w-24 flex-shrink-0">⏰ 截止时间</span>
              <span className="text-sm text-gray-800 font-medium">{card.deadline || '未设置'}</span>
            </div>
          </div>
        ) : isRequest ? (
          <div className="py-2 text-sm text-gray-600 whitespace-pre-wrap">{card.summary || card.task || card.event}</div>
        ) : isFile ? (
          <div className="py-2 space-y-2">
            {(card.fileMetas || []).map((meta, i) => renderFileItem(meta, i))}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500 w-20 flex-shrink-0">🕐 时间</span>
              <span className="text-sm text-gray-800 font-medium">{card.eventTime || card.time}</span>
            </div>
            {card.location && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-20 flex-shrink-0">📍 地点</span>
                <span className="text-sm text-gray-800 font-medium">{card.location}</span>
              </div>
            )}
            {card.participants && (
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-500 w-20 flex-shrink-0">👥 参与人</span>
                <span className="text-sm text-gray-800 font-medium">{normalizeParticipants(card.participants)}</span>
              </div>
            )}
          </div>
        )}

        {/* 附件（非文件卡片附带的附件）：仅展示文件条目，正文内容点击弹窗预览 */}
        {card.fileMetas && card.fileMetas.length > 0 && !isFile && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="text-xs text-gray-400 mb-2">📎 附件</div>
            <div className="space-y-2">
              {card.fileMetas.map((meta, i) => renderFileItem(meta, i))}
            </div>
          </div>
        )}
      </div>

      {/* 卡片底部 */}
      {!card.disabled && (
        <div className="flex items-center justify-end px-7 py-3 border-t border-gray-100">
          {isNotification && !notificationReuploaded ? (
            <button onClick={(e) => { e.stopPropagation(); onViewSource(); }}
              className={"text-sm " + theme.accent + " font-medium"}>
              ⬆️ 重新上传
            </button>
          ) : isNotification && notificationReuploaded ? (
            <span className="text-sm text-emerald-600 font-medium">已重新上传</span>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onViewSource(); }}
              className="text-sm text-gray-500 hover:text-gray-700">
              🔗 查看原文
            </button>
          )}
        </div>
      )}
      </div>
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </>
  );
};


// ?? AI ???? ??
const AiDetail = () => {
  const navigate = useNavigate();
  const navigateToMessage = useStore((s) => s.navigateToMessage);
  const selectedCardId = useAIStore((s) => s.selectedCardId);
  const aiCards = useAIStore((s) => s.aiCards);
  const selectCard = useAIStore((s) => s.selectCard);
  const openScheduleEditor = useAIStore((s) => s.openScheduleEditor);
  const openTodoEditor = useAIStore((s) => s.openTodoEditor);
  const storeTodoItems = useAIStore((s) => s.todoItems);
  const openRequestEdit = useAIStore((s) => s.openRequestEdit);
  const incrementReviewVersion = useAIStore((s) => s.incrementReviewVersion);
  const setFirstReuploadedMsgId = useAIStore((s) => s.setFirstReuploadedMsgId);

  const card = aiCards.find((c) => c.id === selectedCardId);

  const currentUserId = useStore((s) => s.currentUserId);
  const isVisibleToMe = (item) => !item.recipients || item.recipients.includes(currentUserId);

  const handleViewSource = (c) => {
    if (c.type === "notification") {
      if (c.sourceConversationId) {
        let rejectedVideos = [];
        try {
          const d = JSON.parse(c.summary || "{}");
          rejectedVideos = d.items || [];
        } catch {}

        let originalVideos = [];
        let g5LockedVideos = [];
        let existingHistory = [];
        try {
          const g5Content = getMessages("2").find((m) => m.id === "g5");
          if (g5Content) {
            const g5Data = JSON.parse(g5Content.content);
            originalVideos = g5Data.videos || [];
            g5LockedVideos = g5Data.lockedVideos || [];
            existingHistory = g5Data.history || [];
          }
        } catch {}

        const stripReupload = (name) => name.replace(/^重新上传：/, "");
        const rejectedNames = new Set(rejectedVideos.map((v) => stripReupload(v.name)));
        const newVideos = originalVideos.map((v) => {
          const stripped = stripReupload(v.name);
          if (g5LockedVideos.includes(stripped)) return { name: stripped };
          return { name: rejectedNames.has(stripped) ? "?????" + stripped : v.name };
        });

        let firstVideoMsgId = "";
        rejectedVideos.forEach((video, idx) => {
          const msgId = generateMessageId();
          if (idx === 0) firstVideoMsgId = msgId;
          addMessage(c.sourceConversationId, {
            id: msgId, senderId: "c2", senderName: "???",
            content: "?????" + video.name, timestamp: getCurrentTime(),
            type: "video", isMe: true,
          });
        });

        const textMsgId = generateMessageId();
        addMessage(c.sourceConversationId, {
          id: textMsgId, senderId: "c2", senderName: "???",
          content: "????????????????", timestamp: getCurrentTime(),
          type: "text", isMe: true,
        });

        const updatedSummary = JSON.stringify({ ...JSON.parse(c.summary || "{}"), reuploaded: true });
        useAIStore.setState((state) => ({
          aiCards: state.aiCards.map((ac) => ac.id === c.id ? { ...ac, summary: updatedSummary } : ac),
        }));

        const convState = useStore.getState();
        useStore.setState({
          conversations: convState.conversations.map((conv) =>
            conv.id === c.sourceConversationId
              ? { ...conv, lastMessage: "????????????????????", time: getCurrentTime() }
              : conv
          ),
        });

        navigateToMessage(c.sourceConversationId, firstVideoMsgId || textMsgId);
        navigate("/");

        updateMessage("2", "g5", {
          content: JSON.stringify({
            title: "AI????",
            fields: [
              { label: "??", value: "????" },
              { label: "???", value: "???" },
              { label: "???", value: "???" },
              { label: "????", value: "??????????" },
            ],
            videos: newVideos, history: existingHistory, lockedVideos: g5LockedVideos,
          }),
          senderName: "AI??",
        });

        if (firstVideoMsgId) setFirstReuploadedMsgId(firstVideoMsgId);
        incrementReviewVersion();
        const uid = useStore.getState().currentUserId;
        useAIStore.setState((state) => {
          const cur = state.badgeCounts[uid] || { ai: 0, schedule: 0, todo: 0, approval: 0 };
          const nextUser = { ...cur, approval: (cur.approval || 0) + 1 };
          return {
            badgeCounts: { ...state.badgeCounts, [uid]: nextUser },
            aiNavBadge: { ...state.aiNavBadge, [uid]: 1 },
          };
        });
      }
      return;
    }
    if (c.sourceConversationId && c.sourceMessageId) {
      navigateToMessage(c.sourceConversationId, c.sourceMessageId);
      navigate("/");
    }
  };

  const sortedCards = useMemo(
    () => aiCards
      .filter(isVisibleToMe)
      // 预置示例需求(silent)只在需求表格中呈现，不在 AI 助手主列表生成 AI 卡片；
      // 仅新识别/手动新增的需求会显示在此处。
      .filter((c) => !(c.type === "request" && c.silent))
      // aiCards 按生成顺序追加（addAiCard 推到末尾），反转后即「最新生成在最上面」
      .slice().reverse(),
    [aiCards, currentUserId]
  );
  const getLinkedCard = (c) => aiCards.find((o) => o.source === c.source && o.type !== c.type);

  const handleViewDetail = (c) => {
    if (c.disabled) return;
    if (c.type === "schedule") {
      // 直接跳转到日程 tab 并打开对应日程的编辑弹窗
      openScheduleEditor(c.id);
    } else if (c.type === "todo") {
      // 直接跳转到待办 tab 并打开对应待办的编辑弹窗
      const todo = storeTodoItems.find((t) => t.task === c.task);
      if (todo) openTodoEditor(todo.id);
    } else if (c.type === "request") {
      // 直接跳转到需求 tab 并打开对应需求的编辑弹窗
      openRequestEdit(c.id);
    }
  };

  return (
    <div className="flex-1 bg-white flex flex-col">
      {/* 头部 */}
      <div className="h-14 border-b border-gray-200 flex items-center gap-3 px-5 flex-shrink-0 justify-between">
        <div className="flex items-center gap-3">
          {selectedCardId && (
            <button onClick={() => selectCard(null)}
              className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-500 -ml-1">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5"/><path d="m12 19-7-7 7-7"/></svg>
            </button>
          )}
          <h2 className="ai-panel-title">AI 助手</h2>
        </div>
        <span className="ai-panel-sub">{AI_TAB_INTRO.ai}</span>
      </div>

      {/* 今日全景置顶条（全局，标注当前群/我相关） */}
      <AiPinnedReminder />

      {/* 卡片列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {!selectedCardId ? (
          <>
            {sortedCards.length === 0 ? (
              <div className="flex items-center justify-center h-full text-gray-400 text-sm">暂无AI卡片</div>
            ) : (
              <div className="space-y-4">
                {sortedCards.map((c) => (
                  <div key={c.id} className="w-full">
                    <AiCardBubble
                      card={c}
                      linkedCard={getLinkedCard(c)}
                      onViewSource={() => handleViewSource(c)}
                      onViewDetail={() => handleViewDetail(c)}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>

    </div>
  );
};

// 审批 tab 已改为 ApprovalPanel 完整实现（见 ApprovalPanel.tsx）



// ?? CalendarHeader ??
const CalendarHeader = ({ currentDate, viewMode, onPrev, onNext, onToday, onViewChange, onAddEvent }) => {
  const fmt = (d) => {
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    return y + "年" + m + "月";
  };
  return (
      <div className="h-16 border-b border-gray-200 flex items-center justify-between px-6 flex-shrink-0 bg-gradient-to-r from-indigo-50/50 to-purple-50/30 cal-header">
      <div className="flex items-center gap-4 cal-nav">
        <button onClick={onPrev} className="w-9 h-9 flex items-center justify-center hover:bg-indigo-100 rounded-lg text-indigo-600 transition-colors font-semibold">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m15 18-6-6 6-6"/></svg>
        </button>
        <span className="text-lg font-bold text-gray-900 min-w-[200px] text-center cal-title">{viewMode === "day" ? currentDate.getFullYear() + "年" + (currentDate.getMonth() + 1) + "月" + currentDate.getDate() + "日 星期" + ["日", "一", "二", "三", "四", "五", "六"][currentDate.getDay()] : fmt(currentDate)}</span>
        <button onClick={onNext} className="w-9 h-9 flex items-center justify-center hover:bg-indigo-100 rounded-lg text-indigo-600 transition-colors font-semibold">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="m9 18 6-6-6-6"/></svg>
        </button>
        <button onClick={onToday} className="px-4 h-8 text-xs font-bold rounded-lg hover:shadow-md transition-all ml-2 cal-btn-today">回到今天</button>
      </div>
      <div className="flex items-center gap-3 cal-actions">
          <button onClick={onAddEvent}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors font-bold text-xl shadow-sm cal-btn-new">+</button>
          <div className="flex items-center gap-1.5 rounded-lg p-1 cal-toggle">
          {["day", "week", "month"].map((m) => (
          <button key={m} onClick={() => onViewChange(m)}
            className={"cal-toggle-btn " + (viewMode === m ? "active" : "")}>
            {{ day: "日视图", week: "周视图", month: "月视图" }[m]}
          </button>
        ))}
          </div>
      </div>
    </div>
  );
};

// ?? EditEventDialog ??
const EditEventDialog = ({ event, onSave, onDelete, onClose, dialogTitle = "编辑日程", aiCardFileMetas }: { event: any; onSave: (data: any) => void; onDelete?: () => void; onClose: () => void; dialogTitle?: string; aiCardFileMetas?: AICardFileMeta[] }) => {
  const [title, setTitle] = React.useState(event.title || "");
  const [location, setLocation] = React.useState(event.location || "");
  const [participants, setParticipants] = React.useState(event.participants || "");
  const [notes, setNotes] = React.useState(event.detail || "");
  const [attachments, setAttachments] = React.useState<AICardFileMeta[]>(() => {
    const base = Array.isArray(event.attachments) ? event.attachments : [];
    const ai = Array.isArray(aiCardFileMetas) ? aiCardFileMetas : [];
    const seen = new Set(base.map((a) => a.name));
    return [...base, ...ai.filter((m) => !seen.has(m.name))];
  });
  const [titleError, setTitleError] = React.useState(false);
  const [previewFile, setPreviewFile] = React.useState<AICardFileMeta | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [allDay, setAllDay] = React.useState(event.allDay || false);
  const [startDate, setStartDate] = React.useState(event.date || new Date());
  const [startHour, setStartHour] = React.useState(event.hour ?? 9);
  const [startMin, setStartMin] = React.useState(event.minute ?? 0);
  const handleMonthChange = (newMonth) => {
    const y = startDate.getFullYear();
    const d = Math.min(startDate.getDate(), new Date(y, newMonth, 0).getDate());
    setStartDate(new Date(y, newMonth - 1, d));
  };
  const handleDayChange = (newDay) => {
    setStartDate(new Date(startDate.getFullYear(), startDate.getMonth(), newDay));
  };
  // ?? ?? ??（FileReader ???）
  const readFileAs = (file: File): Promise<{ content?: string; dataUrl?: string }> =>
    new Promise((resolve) => {
      const kind = resolveFileKind(file.name, file.type);
      if (kind.category === 'image' || kind.category === 'doc') {
        const r = new FileReader();
        r.onload = () => resolve({ dataUrl: r.result as string });
        r.readAsDataURL(file);
      } else if (kind.category === 'text') {
        const r = new FileReader();
        r.onload = () => resolve({ content: r.result as string });
        r.readAsText(file);
      } else {
        resolve({});
      }
    });
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const kind = resolveFileKind(file.name, file.type);
    const { content, dataUrl } = await readFileAs(file);
    const meta: AICardFileMeta = {
      name: file.name,
      size: file.size,
      fileType: file.type || (kind.category === 'text' ? 'text/plain' : kind.category === 'image' ? 'image/*' : 'application/octet-stream'),
      category: kind.category,
      kind: kind.kind,
      label: kind.label,
      content: kind.category === 'text' ? content : undefined,
      snippet: kind.category === 'text' ? (content || '').slice(0, 300) : undefined,
      dataUrl,
    };
    setAttachments((prev) => [...prev, meta]);
  };
  const handleSave = () => {
    if (!title.trim()) { setTitleError(true); return; }
    setTitleError(false);
    const sd = new Date(startDate);
    if (!allDay) { sd.setHours(startHour, startMin, 0, 0); }
    onSave({ title: title.trim(), location: location.trim(), allDay, startDate: sd, endDate: sd, participants: participants.trim(), notes: notes.trim(), attachments });
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-[380px] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">{dialogTitle}</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        {/* Fields */}
        <div className="px-6 py-4 space-y-4">
          {/* 事件名称 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">事件名称<span className="text-red-500 ml-0.5">*</span></label>
            <input type="text" value={title} onChange={(e) => { setTitle(e.target.value); setTitleError(false); }}
              placeholder="输入事件名称"
              className={"event-field " + (titleError ? "event-field--error" : "")} />
            {titleError && <p className="text-xs text-red-500 mt-1.5">请先填写事件名称再保存</p>}
          </div>
          {/* 时间 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">时间</label>
            <div className="flex items-center gap-2">
              <select value={startDate.getMonth() + 1} onChange={(e) => handleMonthChange(parseInt(e.target.value))}
                className="w-[60px] h-10 px-1 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all">
                {Array.from({length: 12}, (_, i) => i + 1).map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}月</option>)}
              </select>
              <select value={startDate.getDate()} onChange={(e) => handleDayChange(parseInt(e.target.value))}
                className="w-[60px] h-10 px-1 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all">
                {Array.from({length: 31}, (_, i) => i + 1).map(d => <option key={d} value={d}>{String(d).padStart(2, "0")}日</option>)}
              </select>
              <select value={allDay ? 0 : startHour} onChange={(e) => setStartHour(parseInt(e.target.value))}
                className={"w-[60px] h-10 px-1 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 text-center focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all " + (allDay ? "opacity-40 cursor-not-allowed" : "")}
                disabled={allDay}>
                {allDay ? <option value={0}>00</option> : Array.from({length: 24}, (_, i) => i).map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}</option>)}
              </select>
              <span className={"text-gray-400 font-medium " + (allDay ? "opacity-40" : "")}>:</span>
              <select value={allDay ? 0 : startMin} onChange={(e) => setStartMin(parseInt(e.target.value))}
                className={"w-[60px] h-10 px-1 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 text-center focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all " + (allDay ? "opacity-40 cursor-not-allowed" : "")}
                disabled={allDay}>
                {allDay ? <option value={0}>00</option> : Array.from({length: 60}, (_, i) => i).map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap cursor-pointer ml-1">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-2 border-gray-300 text-indigo-600 cursor-pointer" />
                全天
              </label>
            </div>
          </div>
          {/* 地点 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">地点</label>
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)}
              placeholder="输入地点信息"
              className="event-field" />
          </div>
          {/* 参与人 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">参与人</label>
            <input type="text" value={participants} onChange={(e) => setParticipants(e.target.value)}
              placeholder="输入参与人，多个用逗号分隔"
              className="event-field" />
          </div>
          {/* 备注 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">备注</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="输入备注信息"
              rows={3}
              className="event-field resize-none" />
          </div>
          {/* 附件 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-600">附件</label>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => fileInputRef.current?.click()}
                  className="text-xs font-medium text-indigo-600 hover:text-indigo-700">上传文件</button>
              </div>
            </div>
            {attachments.length === 0 ? (
              <div className="text-xs text-gray-400 py-2">暂无附件</div>
            ) : (
              <div className="space-y-2">
                {attachments.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg group">
                    <FileIcon kind={f.kind} size={22} />
                    <span className="text-sm text-gray-700 truncate flex-1 cursor-pointer hover:text-indigo-600" onClick={() => setPreviewFile(f)} title="点击预览">{f.name}</span>
                    <button type="button" onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                      className="w-5 h-5 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors">×</button>
                  </div>
                ))}
              </div>
            )}
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
          </div>
        </div>
        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100">
          {onDelete && (
            <DeleteButton onClick={onDelete}>删除</DeleteButton>
          )}
          <div className="flex-1" />
          <button onClick={handleSave}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg hover:shadow-lg transition-all">
            保存
          </button>
        </div>
      </div>
      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
};
// ?? DayView ??
const DayView = ({ date, events, onEventClick }) => {
  const dayEvents = events.filter((ev) => ev.date && ev.date.toDateString() === date.toDateString());
  const allDayEvents = dayEvents.filter(ev => ev.allDay || ev.hour == null);
  const timedEvents = dayEvents.filter(ev => !ev.allDay && ev.hour != null);
  const hours = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
  return (
    <div className="flex-1 overflow-y-auto cal-dayview px-4 py-4">
      {allDayEvents.length > 0 && (
        <div className="sticky top-0 bg-white z-10 px-5 py-1.5 border-b border-gray-100 cal-allday-bar">
          <div className="space-y-1">
            {allDayEvents.map(ev => (
              <div key={ev.id} onClick={() => onEventClick(ev)}
                className="flex items-center gap-2 rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-1.5 cursor-pointer text-xs hover:shadow-sm transition-all cal-allday">
                <span className="text-indigo-600 font-medium flex-shrink-0">全天</span>
                <span className="text-gray-700 truncate">{ev.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {/* 时间轴 */}
      <div className="px-5 cal-timeline">
        {hours.map(hour => {
          const hourEvents = timedEvents.filter(ev => ev.hour === hour);
          return (
            <div key={hour} className="flex border-t border-gray-100 cal-timerow" style={{ minHeight: "56px" }}>
              <div className="w-20 flex-shrink-0 text-right pr-3 pt-0 text-xs text-gray-400 font-medium leading-none relative cal-time-label" style={{ top: "-6px" }}>
                {hour > 0 ? String(hour).padStart(2, "0") + ":00" : ""}
              </div>
              <div className="flex-1 ml-0 flex flex-col p-px gap-px cal-slot">
                  {hourEvents.map(ev => (
                    <div key={ev.id} onClick={() => onEventClick(ev)}
                      className="flex-1 flex items-center rounded-md bg-gradient-to-r from-indigo-100 to-purple-100 border border-indigo-200 px-2 cursor-pointer hover:shadow-sm transition-all text-xs overflow-hidden cal-event">
                      <div className="font-semibold text-indigo-700 truncate text-sm cal-event-title">{ev.title}</div>
                      <div className="text-gray-600 font-medium truncate text-xs ml-auto cal-event-time">{String(ev.hour).padStart(2, "0")}:{String(ev.minute ?? 0).padStart(2, "0")}</div>
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ?? WeekView ??
const WeekView = ({ startOfWeek, events, onEventClick }) => {
  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(startOfWeek);
    d.setDate(d.getDate() + i);
    days.push(d);
  }
  const getEventsForDay = (d) => events.filter((ev) => {
    if (!ev.date) return false;
    const ed = ev.date;
    return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth() && ed.getDate() === d.getDate();
  });
  const today = new Date();
  const isTodayDate = today.toDateString() === new Date().toDateString();
  const hours = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
  return (
    <div className="flex-1 overflow-y-auto cal-week px-4 py-4">
      <div className="grid min-w-max" style={{ gridTemplateColumns: "56px repeat(7, minmax(100px, 1fr))" }}>
        {/* 表头 - 左上角 */}
        <div className="sticky top-0 z-20 bg-white border-r border-b border-gray-200 cal-week-corner" />
        {/* 表头 - 7天 */}
        {days.map((d, i) => {
          const isToday = d.toDateString() === today.toDateString();
          const dayEvts = getEventsForDay(d);
          const allDayEvts = dayEvts.filter(ev => ev.allDay || ev.hour == null);
          return (
            <div key={i} className={"sticky top-0 z-20 px-2 pt-2 pb-1 text-center border-b border-r border-gray-200 cal-week-day " + (isToday ? "bg-indigo-50" : "bg-white")}>
              <div className={"text-xs font-semibold cal-day-name " + (isToday ? "text-indigo-600" : "text-gray-500")}>{weekDays[(i + 1) % 7]}</div>
              <div className={"text-base font-bold cal-day-num " + (isToday ? "text-indigo-600" : "text-gray-800")}>{d.getDate()}</div>
              {allDayEvts.map(ev => (
                <div key={ev.id} onClick={() => onEventClick(ev)}
                  className="text-xs bg-indigo-100 text-indigo-700 font-semibold rounded px-1 py-0.5 truncate cursor-pointer hover:shadow-sm transition-all border border-indigo-200 mt-1 cal-event">
                  {ev.title}
                </div>
              ))}
            </div>
          );
        })}
        {/* 24小时行 */}
        {hours.map(hour => [
          <div key={"tl-" + hour} className="border-r border-b border-gray-100 relative cal-week-timecell" style={{ height: "56px" }}>
            <div className="absolute right-[7px] top-0 -translate-y-1/2 text-xs text-gray-400 font-medium pr-1 leading-none cal-time-label">
              {hour > 0 ? String(hour).padStart(2, "0") + ":00" : ""}
            </div>
          </div>,
          ...days.map((d, dayIdx) => {
            const dayEvts = getEventsForDay(d);
            const hourEvts = dayEvts.filter(ev => !ev.allDay && ev.hour != null && ev.hour === hour);
            const isToday = d.toDateString() === today.toDateString();
                        return (
              <div key={"dc-" + dayIdx + "-" + hour} className="border-r border-b border-gray-100 relative cal-week-cell" style={{ height: "56px" }}>
                <div className="flex flex-col h-full p-px gap-px">
                  {hourEvts.map(ev => (
                    <div key={ev.id} onClick={() => onEventClick(ev)}
                      className="flex-1 flex items-center bg-gradient-to-r from-indigo-100 to-purple-100 border border-indigo-200 rounded px-1 cursor-pointer hover:shadow-sm transition-all overflow-hidden cal-event">
                      <span className="font-semibold text-indigo-700 truncate text-xs cal-event-title">{ev.title}</span>
                      <span className="text-gray-600 font-medium flex-shrink-0 text-xs ml-auto cal-event-time">{String(ev.hour).padStart(2, "0")}:{String(ev.minute ?? 0).padStart(2, "0")}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          }),
        ])}
      </div>
    </div>
  );
};
// ?? MonthView ??
const MonthView = ({ year, month, events, onEventClick }) => {
  const weekDays = ["日", "一", "二", "三", "四", "五", "六"];
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days = [];
  for (let i = 0; i < firstDay; i++) days.push(null);
  for (let i = 1; i <= daysInMonth; i++) days.push(new Date(year, month, i));
  const getEventsForDay = (d) => events.filter((ev) => {
    if (!ev.date) return false;
    const ed = ev.date;
    return ed.getFullYear() === d.getFullYear() && ed.getMonth() === d.getMonth() && ed.getDate() === d.getDate();
  });
  const today = new Date();
  return (
    <div className="flex-1 flex flex-col p-5 cal-month">
      <div className="grid grid-cols-7 gap-1 mb-1 cal-weekday-row">
        {weekDays.map((d) => (
          <div key={d} className="bg-white p-2 text-center text-xs text-gray-500 font-bold rounded-lg cal-weekday">{d}</div>
        ))}
      </div>
      <div className="flex-1 grid grid-cols-7 gap-1 bg-gray-100 rounded-xl overflow-hidden p-1 cal-grid" style={{ gridAutoRows: "minmax(75px, 1fr)" }}>
        {days.map((d, i) => (
          <div key={i} className={"bg-white p-2 rounded-lg h-full flex flex-col transition-all cal-day " + (d && d.toDateString() === today.toDateString() ? "bg-indigo-50/60 border border-indigo-200/60 today" : "")}>
            {d && (
              <>
                <div className={"text-xs font-bold mb-1 cal-day-num " + (d.toDateString() === today.toDateString() ? "text-indigo-600" : "text-gray-600")}>{d.getDate()}</div>
                <div className="flex-1 flex flex-col gap-px min-h-0">
                  {getEventsForDay(d).slice(0, 2).map((ev) => (
                    <div key={ev.id} onClick={() => onEventClick(ev)}
                      className="flex-1 flex items-center bg-gradient-to-r from-indigo-100 to-purple-100 border border-indigo-200 rounded px-1 cursor-pointer hover:shadow-sm transition-all overflow-hidden cal-event">
                      <span className="font-semibold text-indigo-700 truncate text-xs cal-event-title">{ev.title}</span>
                      <span className="text-gray-600 font-medium flex-shrink-0 text-xs ml-auto cal-event-time">{String(ev.hour).padStart(2, "0")}:{String(ev.minute ?? 0).padStart(2, "0")}</span>
                    </div>
                  ))}
                  {getEventsForDay(d).length > 2 && (
                    <div className="text-xs text-indigo-600 font-semibold px-1 cal-more">+{getEventsForDay(d).length - 2}</div>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};


// ?? parseScheduleTime ??
function parseScheduleTime(t, refDate) {
  const m = t.match(/(\d+)月(\d+)日\s*(?:周[一二三四五六日]\s*)?(\d+):(\d+)/);
  if (!m) {
    const m2 = t.match(/(\d+)月(\d+)日/);
    if (!m2) return null;
    const ref = refDate || new Date();
    return { date: new Date(ref.getFullYear(), parseInt(m2[1]) - 1, parseInt(m2[2])), hour: 0, minute: 0 };
  }
  const ref = refDate || new Date();
  return { date: new Date(ref.getFullYear(), parseInt(m[1]) - 1, parseInt(m[2])), hour: parseInt(m[3]), minute: parseInt(m[4]) };
}

// ?? ScheduleDetail ??
const ScheduleDetail = () => {
  const [viewMode, setViewMode] = React.useState("week");
  const [currentDate, setCurrentDate] = React.useState(new Date());
  const [editingEvent, setEditingEvent] = React.useState(null);
  const [deleteConfirmEvent, setDeleteConfirmEvent] = React.useState(null);
  const [showNewDialog, setShowNewDialog] = React.useState(false);
  const scheduleItems = useAIStore((s) => s.scheduleItems);
  const aiCards2 = useAIStore((s) => s.aiCards);
  const deleteSchedule = useAIStore((s) => s.deleteSchedule);
  const updateSchedule = useAIStore((s) => s.updateSchedule);
  const addScheduleItem = useAIStore((s) => s.addScheduleItem);
  const highlightScheduleId = useAIStore((s) => s.highlightScheduleId);
  const highlightScheduleDate = useAIStore((s) => s.highlightScheduleDate);
  const editingScheduleId = useAIStore((s) => s.editingScheduleId);
  const closeScheduleEditor = useAIStore((s) => s.closeScheduleEditor);
  const scheduleRefDate = React.useMemo(() => new Date(), []);
  const currentUserId = useStore((s) => s.currentUserId);

  const events = React.useMemo(() => {
    const result = [];
    const seenIds = new Set();
    scheduleItems.filter((item) => visibleTo(currentUserId, item)).forEach((item) => {
      const isAllDay = item.time.includes("全天");
      if (isAllDay) {
        const dm = item.time.match(/(\d+)月(\d+)日/);
        if (dm) result.push({ id: item.id, title: item.event, location: item.location, date: new Date(scheduleRefDate.getFullYear(), parseInt(dm[1]) - 1, parseInt(dm[2])), hour: 0, minute: 0, source: item.source, allDay: true, participants: item.participants || "", detail: item.detail || "", attachments: item.attachments || [] });
      } else {
        const parsed = parseScheduleTime(item.time, scheduleRefDate);
        if (parsed) result.push({ id: item.id, title: item.event, location: item.location, date: parsed.date, hour: parsed.hour, minute: parsed.minute, source: item.source, allDay: parsed.hour === 0 && parsed.minute === 0, participants: item.participants || "", detail: item.detail || "", attachments: item.attachments || [] });
      }
      seenIds.add(item.id);
    });
    aiCards2.filter((c) => c.type === "schedule" && !c.disabled && visibleTo(currentUserId, c)).forEach((card) => {
        if (seenIds.has(card.id)) return;
      const timeStr = card.eventTime || card.time;
      if (timeStr.includes("全天")) {
        const dm = timeStr.match(/(\d+)月(\d+)日/);
        if (dm) result.push({ id: card.id, title: card.event, location: card.location || "", date: new Date(scheduleRefDate.getFullYear(), parseInt(dm[1]) - 1, parseInt(dm[2])), hour: 0, minute: 0, source: card.source, allDay: true, participants: card.participants || "", detail: "", attachments: [] });
      } else {
        const parsed = parseScheduleTime(timeStr, scheduleRefDate);
        if (parsed) result.push({ id: card.id, title: card.event, location: card.location || "", date: parsed.date, hour: parsed.hour, minute: parsed.minute, source: card.source, allDay: parsed.hour === 0 && parsed.minute === 0, participants: card.participants || "", detail: "", attachments: [] });
      }
    });
    return result;
  }, [scheduleItems, aiCards2, viewMode, currentUserId]);
  const eventsRef = React.useRef([]);
  eventsRef.current = events;

  const navigate = (dir) => {
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (viewMode === "day") d.setDate(d.getDate() + dir);
      else if (viewMode === "week") d.setDate(d.getDate() + dir * 7);
      else d.setMonth(d.getMonth() + dir);
      return d;
    });
  };

  React.useEffect(() => { setCurrentDate(new Date()); useAIStore.setState({ highlightScheduleId: null, highlightScheduleDate: null }); }, []);
  const goToday = () => setCurrentDate(new Date());
  const handleEventClick = (ev) => setEditingEvent(ev);

  const handleAddEvent = (data) => {
    const id = "schedule_" + Date.now();
    const fmt = (d) => { const m = d.getMonth() + 1; const day = d.getDate(); return m + "月" + day + "日 " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); };
    const timeStr = data.allDay ? (data.startDate.getMonth() + 1) + "月" + data.startDate.getDate() + "日 全天" : fmt(data.startDate);
    addScheduleItem({ id, time: timeStr, event: data.title, location: data.location || "", source: "手动添加", status: "pending", detail: data.notes || "", participants: data.participants || "", attachments: data.attachments || [] });
    setShowNewDialog(false);
  };

  const handleSaveEvent = (data) => {
    if (!editingEvent) return;
    updateSchedule(editingEvent.id, data);
    setEditingEvent(null);
  };

  const handleDeleteEvent = () => {
    if (!editingEvent) return;
    setDeleteConfirmEvent(editingEvent);
  };

  const weekStart = React.useMemo(() => {
    const d = new Date(currentDate);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    return d;
  }, [currentDate]);

  useEffect(() => {
    if (highlightScheduleDate && highlightScheduleId) {
      const parts = highlightScheduleDate.split("-");
      const d = new Date(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
      setViewMode("week");
      setCurrentDate(d);
      const ev = eventsRef.current.find((e) => e.id === highlightScheduleId);
      if (ev) setEditingEvent(ev);
    }
    useAIStore.setState({ highlightScheduleId: null, highlightScheduleDate: null });
  }, [highlightScheduleDate, highlightScheduleId]);

  // 从 AI 卡片「查看详情」跳转过来时，自动打开对应日程的编辑弹窗（跳过中间详情界面），
  // 并把背景切到「该日程所在那一周」的周视图
  React.useEffect(() => {
    if (editingScheduleId) {
      const ev = eventsRef.current.find((e) => e.id === editingScheduleId);
      if (ev) {
        setViewMode("week");
        setCurrentDate(new Date(ev.date));
        setEditingEvent(ev);
      }
      closeScheduleEditor();
    }
  }, [editingScheduleId, closeScheduleEditor]);

  return (
    <div className="flex-1 bg-white flex flex-col rounded-[20px] border border-gray-200 shadow-sm overflow-hidden">
      <CalendarHeader currentDate={currentDate} viewMode={viewMode}
        onPrev={() => navigate(-1)} onNext={() => navigate(1)} onToday={goToday} onViewChange={setViewMode} onAddEvent={() => setShowNewDialog(true)} />
      {viewMode === "day" && <DayView date={currentDate} events={events} onEventClick={handleEventClick} />}
      {viewMode === "week" && <WeekView startOfWeek={weekStart} events={events} onEventClick={handleEventClick} />}
      {viewMode === "month" && <MonthView year={currentDate.getFullYear()} month={currentDate.getMonth()} events={events} onEventClick={handleEventClick} />}
      {showNewDialog && <EditEventDialog event={{ title: "", location: "", hour: new Date().getHours(), minute: 0, allDay: false, date: new Date() }} onSave={handleAddEvent} onClose={() => setShowNewDialog(false)} dialogTitle="新建日程" />}
      {editingEvent && <EditEventDialog event={editingEvent} aiCardFileMetas={aiCards2.find(c => c.id === editingEvent.id && c.type === 'schedule')?.fileMetas} onSave={handleSaveEvent} onDelete={handleDeleteEvent} onClose={() => setEditingEvent(null)} />}
      <ConfirmDeleteDialog
        open={!!deleteConfirmEvent}
        title="确认删除该日程？"
        message="删除后该日程将无法恢复，请确认是否继续。"
        onCancel={() => setDeleteConfirmEvent(null)}
        onConfirm={() => { if (deleteConfirmEvent) { deleteSchedule(deleteConfirmEvent.id); setEditingEvent(null); } setDeleteConfirmEvent(null); }}
      />
    </div>
  );
};

// ?? EditTodoDialog ??
const EditTodoDialog2 = ({ item, onSave, onClose, onDelete }) => {
  const [task, setTask] = React.useState(item.task);
  const [detail, setDetail] = React.useState(item.detail ?? "");
  const [deadlineEnabled, setDeadlineEnabled] = React.useState(!!item.deadline);
  const [allDay, setAllDay] = React.useState(false);
  const [startDate, setStartDate] = React.useState(() => {
    const d = new Date();
    if (item.deadline) {
      const m = item.deadline.match(/(\d+)月(\d+)日/);
      if (m) d.setMonth(parseInt(m[1]) - 1, parseInt(m[2]));
    }
    return d;
  });
  const [startHour, setStartHour] = React.useState(() => {
    const tm = item.deadline?.match(/(\d{1,2}):(\d{2})/);
    return tm ? parseInt(tm[1], 10) : 9;
  });
  const [startMin, setStartMin] = React.useState(() => {
    const tm = item.deadline?.match(/(\d{1,2}):(\d{2})/);
    return tm ? parseInt(tm[2], 10) : 0;
  });

  const handleMonthChange = (newMonth) => {
    const y = startDate.getFullYear();
    const d = Math.min(startDate.getDate(), new Date(y, newMonth, 0).getDate());
    setStartDate(new Date(y, newMonth - 1, d));
  };
  const handleDayChange = (newDay) => {
    setStartDate(new Date(startDate.getFullYear(), startDate.getMonth(), newDay));
  };

  const handleSave2 = () => {
    if (!task.trim()) return;
    if (!deadlineEnabled) {
      onSave({ task: task.trim(), deadline: '', detail: detail.trim() });
      onClose();
      return;
    }
    const sd = new Date(startDate);
    if (!allDay) { sd.setHours(startHour, startMin, 0, 0); }
    const fmt = (d) => { const m = d.getMonth() + 1; const day = d.getDate(); return m + '\u6708' + day + '\u65e5 ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
    const timeStr = allDay ? (startDate.getMonth() + 1) + '\u6708' + startDate.getDate() + '\u65e5 \u5168\u5929' : fmt(sd);
    onSave({ task: task.trim(), deadline: timeStr, detail: detail.trim() });
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-[380px] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100">
          <h3 className="text-lg font-bold text-gray-900">编辑待办</h3>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        {/* Fields */}
        <div className="px-6 py-4 space-y-4">
          {/* 任务名称 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">任务名称</label>
            <input type="text" value={task} onChange={(e) => setTask(e.target.value)}
              placeholder="输入任务名称"
              className="w-full h-10 px-3 bg-gray-50 rounded-lg text-sm text-gray-700 placeholder-gray-400 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all" />
          </div>
          {/* 截止时间 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-600">截止时间</label>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer whitespace-nowrap">
                <input type="checkbox" checked={deadlineEnabled} onChange={(e) => setDeadlineEnabled(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-2 border-gray-300 text-indigo-600 cursor-pointer" />
                设置截止时间
              </label>
            </div>
            <div className={"flex items-center gap-1.5 flex-nowrap " + (deadlineEnabled ? "" : "opacity-40 pointer-events-none")}>
              <select value={startDate.getMonth() + 1} onChange={(e) => handleMonthChange(parseInt(e.target.value))}
                className="w-[60px] h-10 px-1 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all">
                {Array.from({length: 12}, (_, i) => i + 1).map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}月</option>)}
              </select>
              <select value={startDate.getDate()} onChange={(e) => handleDayChange(parseInt(e.target.value))}
                className="w-[60px] h-10 px-1 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all">
                {Array.from({length: 31}, (_, i) => i + 1).map(d => <option key={d} value={d}>{String(d).padStart(2, "0")}日</option>)}
              </select>
              <select value={allDay ? 0 : startHour} onChange={(e) => setStartHour(parseInt(e.target.value))}
                className={"w-[60px] h-10 px-1 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 text-center focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all " + (allDay ? "opacity-40 cursor-not-allowed" : "")}
                disabled={allDay}>
                {allDay ? <option value={0}>00</option> : Array.from({length: 24}, (_, i) => i).map(h => <option key={h} value={h}>{String(h).padStart(2, "0")}</option>)}
              </select>
              <span className={"text-gray-400 font-medium " + (allDay ? "opacity-40" : "")}>:</span>
              <select value={allDay ? 0 : startMin} onChange={(e) => setStartMin(parseInt(e.target.value))}
                className={"w-[60px] h-10 px-1 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 text-center focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all " + (allDay ? "opacity-40 cursor-not-allowed" : "")}
                disabled={allDay}>
                {allDay ? <option value={0}>00</option> : Array.from({length: 60}, (_, i) => i).map(m => <option key={m} value={m}>{String(m).padStart(2, "0")}</option>)}
              </select>
              <label className="flex items-center gap-1.5 text-xs text-gray-500 whitespace-nowrap cursor-pointer ml-1">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-2 border-gray-300 text-indigo-600 cursor-pointer" />
                全天
              </label>
            </div>
          </div>
          {/* 备注 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">备注</label>
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)}
              placeholder="输入备注信息"
              rows={3}
              className="w-full px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700 placeholder-gray-400 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all resize-none" />
          </div>
        </div>
        {/* Footer */}
        <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-100">
          {onDelete && <DeleteButton onClick={onDelete}>删除</DeleteButton>}
          <div className="flex-1" />
          <button onClick={handleSave2}
            className="px-6 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg hover:shadow-lg transition-all">
            保存
          </button>
        </div>
      </div>
    </div>
  );
};

// ?? TodoDetail ??
const TodoDetail = () => {
  const todoItems = useAIStore((s) => s.todoItems);
  const currentUserId = useStore((s) => s.currentUserId);
  const navigateToMessage = useStore((s) => s.navigateToMessage);
  const selectedTodoId = useAIStore((s) => s.selectedTodoId);
  const editingTodoId = useAIStore((s) => s.editingTodoId);
  const closeTodoEditor = useAIStore((s) => s.closeTodoEditor);
  const toggleTodoStatus = useAIStore((s) => s.toggleTodoStatus);
  const deleteTodo = useAIStore((s) => s.deleteTodo);
  const addTodoItem = useAIStore((s) => s.addTodoItem);
  const updateTodo = useAIStore((s) => s.updateTodo);
  const setAITab = useAIStore((s) => s.setAITab);
  // 审批数据（统一待处理入口）：随当前登录人同步
  const approvalItems = useApprovalStore((s) => s.items);
  const approvalRole = useApprovalStore((s) => s.currentRole);
  const approvalUserName = useApprovalStore((s) => s.currentUserName);
  const approvalSelectItem = useApprovalStore((s) => s.selectItem);
  const syncAccount = useApprovalStore((s) => s.syncAccount);
  const [editingTodo, setEditingTodo] = React.useState(null);
  const [deleteConfirmTodo, setDeleteConfirmTodo] = React.useState(null);
  const [creatingTodo, setCreatingTodo] = React.useState(null);

  // 切换账户时同步审批登录人，保证待处理数据随当前账号更新
  React.useEffect(() => { syncAccount(); }, [currentUserId, syncAccount]);

  // 从 AI 卡片点击「查看详情」跳转过来时，自动打开对应待办的编辑弹窗
  React.useEffect(() => {
    if (editingTodoId) {
      const t = useAIStore.getState().todoItems.find((x) => x.id === editingTodoId);
      if (t) setEditingTodo(t);
      closeTodoEditor();
    }
  }, [editingTodoId, closeTodoEditor]);

  const handleAddTodo = (data) => {
    const id = 'todo_' + Date.now();
    addTodoItem({ id, task: data.task, deadline: data.deadline || '', source: '\u624b\u52a8\u6dfb\u52a0', completed: false, detail: data.detail || '' });
    setCreatingTodo(null);
  };
  const [filter, setFilter] = React.useState("all");

  // 个人待办：按筛选（全部/进行中/已完成）
  const todoVisible = todoItems.filter((item) => visibleTo(currentUserId, item));
  const todoFiltered = todoVisible.filter((item) => {
    if (filter === "active") return !item.completed;
    if (filter === "completed") return item.completed;
    return true;
  });

  // 审批待处理：需要我处理的事项（"已完成"视图下不显示审批）
  const approvalTodos = getApprovalTodosForUser(approvalItems, approvalUserName, approvalRole);
  const showApprovals = filter !== "completed";

  // 统一为「行」结构，按紧急度排序（逾期在前、已完成沉底）
  const nowTs = Date.now();
  const rows = [
    ...todoFiltered.map((t) => ({
      kind: "todo",
      id: t.id,
      title: t.task,
      completed: t.completed,
      deadline: t.deadline,
      deadlineDate: parseAnyDeadline(t.deadline),
      raw: t,
    })),
    ...(showApprovals
      ? approvalTodos.map((it) => ({
          kind: "approval",
          id: "ap_" + it.id,
          title: it.title,
          completed: false,
          deadline: it.deadline,
          deadlineDate: parseAnyDeadline(it.deadline),
          statusKey: it.status,
          statusLabel: STATUS_TEXT[it.status] || it.status,
          category: it.category,
          raw: it,
        }))
      : []),
  ];

  const isRowOverdue = (r) => {
    if (r.kind === "todo") return !r.completed && !!r.deadlineDate && r.deadlineDate.getTime() < nowTs;
    return (
      r.statusKey === "overdue" ||
      (!!r.deadlineDate && r.deadlineDate.getTime() < nowTs && r.statusKey !== "done" && r.statusKey !== "cancelled" && r.statusKey !== "revoked")
    );
  };
  const isRowDueSoon = (r) => {
    if (r.kind !== "todo") return false;
    return !!r.deadlineDate && r.deadlineDate.getTime() >= nowTs && r.deadlineDate.getTime() - nowTs <= 24 * 3600 * 1000;
  };

  const sortedRows = rows.slice().sort((a, b) => {
    const aDone = a.kind === "todo" && a.completed;
    const bDone = b.kind === "todo" && b.completed;
    if (aDone !== bDone) return aDone ? 1 : -1;
    const ao = isRowOverdue(a), bo = isRowOverdue(b);
    if (ao !== bo) return ao ? -1 : 1;
    const da = a.deadlineDate, db = b.deadlineDate;
    if (!!da !== !!db) return da ? -1 : 1;
    if (da && db) return da.getTime() - db.getTime();
    return 0;
  });

  // 红点计数：未完成个人任务 + 待处理审批
  const todoActive = todoVisible.filter((t) => !t.completed).length;
  const activeCount = todoActive + approvalTodos.length;

  if (todoItems.length === 0 && approvalTodos.length === 0) {
    return (
      <div className="flex-1 bg-white flex items-center justify-center">
        <div className="text-center text-gray-400">
          <span className="text-4xl">{"✅"}</span>
          <p className="text-sm mt-3">{"所有待办都已完成啦！"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white flex flex-col">
      {/* 头部：标题 + 未完成红点 + 新增 */}
      <div className="h-14 border-b border-gray-200 flex items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <h2 className="ai-panel-title">{"待办"}</h2>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => setCreatingTodo({ task: "", deadline: "", detail: "" })}
            className="w-7 h-7 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-500 hover:text-gray-700 transition-colors">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
          <span className="text-xs text-gray-400">{activeCount} {"项待办"}</span>
        </div>
      </div>

      {/* 筛选 */}
      <div className="flex gap-2 px-5 py-2.5 border-b border-gray-100">
        {["all", "active", "completed"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={"px-3 py-1 text-xs rounded-full font-medium transition-colors " + (filter === f ? "bg-primary-500 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200")}>
            {{ all: "全部", active: "进行中", completed: "已完成" }[f]}
          </button>
        ))}
      </div>

      {/* 列表（统一待处理：个人待办 + 待我处理的审批） */}
      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
        {sortedRows.map((row) => {
          // —— 审批待处理项：点击前往审批详情 ——
          if (row.kind === "approval") {
            const sc = AP_STATUS_COLOR[row.statusKey] || AP_STATUS_COLOR.dispatched;
            const overdue = isRowOverdue(row);
            return (
              <div key={row.id}
                onClick={() => { setAITab("approval"); approvalSelectItem(row.raw.id, "todo"); }}
                className="group rounded-xl border transition-all cursor-pointer border-l-4 hover:shadow-sm"
                style={{ borderColor: sc.fg, background: sc.bg }}>
                <div className="p-3.5">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 text-sm">{"📋"}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="text-base font-medium text-gray-800">{row.title}</div>
                        <span className="px-1.5 py-0.5 rounded text-[11px] font-medium" style={{ color: sc.fg, background: "rgba(255,255,255,.65)" }}>{row.statusLabel}</span>
                      </div>
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                        <span>{"审批 · " + (row.category || "事项")}</span>
                        {row.deadline && (
                          <span className={overdue ? "text-red-500 font-medium" : ""}>{"⏰ 截止 " + row.deadline}{overdue && " · 已逾期"}</span>
                        )}
                        <span className="text-indigo-500 font-medium">{"前往处理 ›"}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          }
          // —— 个人待办项 ——
          const item = row.raw;
          const isFollowUp = item.task.startsWith('需求跟进：');
          const overdue = isRowOverdue(row);
          const dueSoon = isRowDueSoon(row);
          const canJump = !!item.sourceConversationId && !!item.sourceMessageId;
          const borderCls = item.completed
            ? "border-gray-200 bg-gray-50/60 hover:border-gray-300"
            : overdue
              ? "border-red-300 bg-red-50/50 hover:border-red-400 border-l-4 border-l-red-500"
              : dueSoon
                ? "border-amber-300 bg-amber-50/50 hover:border-amber-400 border-l-4 border-l-amber-400"
                : isFollowUp
                  ? "border-violet-200 bg-violet-50/50 hover:border-violet-300 border-l-4 border-l-violet-400"
                  : "border-blue-100 bg-blue-50/40 hover:border-blue-200 border-l-4 border-l-blue-400";
          return (
          <div key={item.id}
            onClick={() => setEditingTodo(item)}
            className={"group rounded-xl border transition-all cursor-pointer " + (
              selectedTodoId === item.id ? "border-primary-200 bg-primary-50/30 shadow-sm" : borderCls
            )}>
            <div className="p-4">
              <div className="flex items-start gap-3">
                <button onClick={(e) => { e.stopPropagation(); toggleTodoStatus(item.id); }}
                  className={"w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5 " + (item.completed ? "bg-green-500 border-green-500" : "border-gray-300 hover:border-primary-400")}>
                  {item.completed && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                  )}
                </button>
                <div className="min-w-0 flex-1">
                    <div className="flex items-start gap-2">
                    <div className={"text-base font-medium " + (item.completed ? "text-gray-400 line-through" : "text-gray-800")}>{item.task}</div>
                  </div>
                  <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-1.5 text-xs">
                    {item.deadline && (
                      <span className={overdue ? "text-red-500 font-medium" : dueSoon ? "text-amber-500 font-medium" : "text-gray-400"}>
                        {"⏰"} {item.deadline}{overdue && " · 已逾期"}
                      </span>
                    )}
                    {item.source && (
                      canJump ? (
                        <button
                          onClick={(e) => { e.stopPropagation(); navigateToMessage(item.sourceConversationId, item.sourceMessageId); }}
                          className="text-indigo-500 hover:text-indigo-700 hover:underline"
                          title="跳转到原消息"
                        >{"📍 来自：" + item.source}</button>
                      ) : (
                        <span className="text-gray-400">{"📍 来自：" + item.source}</span>
                      )
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
        })}
        {sortedRows.length === 0 && (
          <div className="text-center text-gray-400 py-10">
            <p className="text-sm">{filter === "completed" ? "暂无已完成的待办" : "暂无进行中的待办"}</p>
          </div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {creatingTodo && <EditTodoDialog2 item={creatingTodo} onSave={handleAddTodo} onClose={() => setCreatingTodo(null)} />}
      {editingTodo && <EditTodoDialog2 item={editingTodo} onSave={(data) => { updateTodo(editingTodo.id, data); setEditingTodo(null); }} onClose={() => setEditingTodo(null)} onDelete={() => setDeleteConfirmTodo(editingTodo)} />}
      <ConfirmDeleteDialog
        open={!!deleteConfirmTodo}
        title="确认删除该待办？"
        message="删除后该待办将无法恢复，请确认是否继续。"
        onCancel={() => setDeleteConfirmTodo(null)}
        onConfirm={() => { if (deleteConfirmTodo) { deleteTodo(deleteConfirmTodo.id); setEditingTodo(null); } setDeleteConfirmTodo(null); }}
      />
    </div>
  );
};

// ?? 需求汇总表格（类似企业微信的审批/需求表格） ??
const requestStatusMeta = (s?: string) => {
  switch (s) {
    case "resolved":
      return { label: "已解决", cls: "bg-green-50 text-green-600" };
    case "following":
    default:
      return { label: "跟进中", cls: "bg-blue-50 text-blue-600" };
  }
};
const requestPriorityMeta = (p?: string) =>
  p === "high"
    ? { label: "高", cls: "bg-red-50 text-red-600" }
    : p === "medium"
    ? { label: "中", cls: "bg-orange-50 text-orange-600" }
    : p === "low"
    ? { label: "低", cls: "bg-blue-50 text-blue-600" }
    : { label: "未设置", cls: "bg-gray-100 text-gray-400" };
const requestIssueTypeMeta = (t?: string) => {
  switch (t) {
    case "bug":
      return { label: "Bug", cls: "bg-red-50 text-red-600 border-red-100" };
    case "feature":
    default:
      return { label: "需求", cls: "bg-indigo-50 text-indigo-600 border-indigo-100" };
  }
};

export interface RequestFormValues {
  description: string;
  issueType: 'bug' | 'feature';
  status: 'resolved' | 'following';
  version?: string;
  priority: 'high' | 'medium' | 'low' | '';
  remark?: string;
  /** 处理人（单次仅能指派一人），对应 AICard.recipients */
  assignee?: string;
}

// 新增 / 编辑共用的需求表单弹窗：card 为 null 时表示新增
const RequestFormDialog = ({ card, onSubmit, onCancel, onDelete }: { card: AICard | null; onSubmit: (vals: RequestFormValues) => void; onCancel: () => void; onDelete?: () => void }) => {
  const isAdd = !card;
  const accounts = useStore((s) => s.accounts);
  const currentUserId = useStore((s) => s.currentUserId);
  const [description, setDescription] = React.useState(card?.description || card?.summary || card?.task || "");
  const [issueType, setIssueType] = React.useState<'bug' | 'feature'>(card?.issueType || "feature");
  const [status, setStatus] = React.useState<'resolved' | 'following'>(card?.status === "resolved" ? "resolved" : "following");
  const [version, setVersion] = React.useState(card?.version || "");
  const [priority, setPriority] = React.useState<'' | 'high' | 'medium' | 'low'>(card?.priority || "");
  const [remark, setRemark] = React.useState(card?.remark || "");
  // 处理人：编辑时取原值（数组第一项），新增时默认指派给当前用户（使其出现在今日全景）
  const [assignee, setAssignee] = React.useState<string>(card?.recipients && card.recipients.length > 0 ? card.recipients[0] : currentUserId);
  const [descError, setDescError] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);

  const selectAssignee = (id: string) => {
    setAssignee(id);
  };

  const handleSave = () => {
    if (!description.trim()) {
      setDescError(true);
      return;
    }
    onSubmit({
      description: description.trim(),
      issueType,
      status,
      version: version.trim() || undefined,
      priority,
      remark: remark.trim() || undefined,
      assignee,
    });
  };

  return (
    <>
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-bold text-gray-900">{isAdd ? "添加需求记录" : "编辑需求"}</h3>
          <button onClick={onCancel} className="w-8 h-8 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-500 text-sm">✕</button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {/* 需求/问题描述 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">需求/问题描述 <span className="text-red-500">*</span></label>
            <textarea value={description} onChange={(e) => { setDescription(e.target.value); setDescError(false); }}
              placeholder="输入需求或问题的详细描述"
              rows={4}
              className={"w-full px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700 placeholder-gray-400 outline-none border resize-none transition-all " + (descError ? "border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-500" : "border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500")} />
            {descError && <div className="text-xs text-red-500 mt-1">请填写需求/问题描述</div>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* 类型 */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">类型</label>
              <select value={issueType} onChange={(e) => setIssueType(e.target.value as 'bug' | 'feature')}
                className="w-full h-10 px-3 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
                <option value="feature">需求</option>
                <option value="bug">Bug</option>
              </select>
            </div>
            {/* 状态 */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">状态</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as 'resolved' | 'following')}
                className="w-full h-10 px-3 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
                <option value="following">跟进中</option>
                <option value="resolved">已解决</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {/* 上线版本 */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">上线版本</label>
              <input type="text" value={version} onChange={(e) => setVersion(e.target.value)}
                placeholder="如 10.1.2（4月2日）"
                className="w-full h-10 px-3 bg-gray-50 rounded-lg text-sm text-gray-700 placeholder-gray-400 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
            </div>
            {/* 优先级 */}
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">优先级</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as '' | 'high' | 'medium' | 'low')}
                className="w-full h-10 px-3 bg-gray-50 rounded-lg text-sm text-gray-700 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500">
                <option value="">未设置（请选择）</option>
                <option value="high">高</option>
                <option value="medium">中</option>
                <option value="low">低</option>
              </select>
            </div>
          </div>

          {/* 处理人（指派） */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">处理人（单次仅可指派一人）</label>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setAssignee("")}
                className={"px-3 py-1.5 rounded-full text-xs font-medium border transition-colors " + (assignee ? "bg-gray-50 text-gray-600 border-gray-200 hover:border-indigo-400" : "bg-indigo-600 text-white border-indigo-600")}>
                未指派
              </button>
              {accounts.map((a) => {
                const active = assignee === a.id;
                return (
                  <button type="button" key={a.id} onClick={() => selectAssignee(a.id)}
                    className={"px-3 py-1.5 rounded-full text-xs font-medium border transition-colors " + (active ? "bg-indigo-600 text-white border-indigo-600" : "bg-gray-50 text-gray-600 border-gray-200 hover:border-indigo-400")}>
                    {a.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 备注 */}
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">备注</label>
            <textarea value={remark} onChange={(e) => setRemark(e.target.value)}
              placeholder="补充说明、进展、风险等（选填）"
              rows={2}
              className="w-full px-3 py-2 bg-gray-50 rounded-lg text-sm text-gray-700 placeholder-gray-400 outline-none border border-gray-200 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 resize-none" />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white px-5 py-4 border-t border-gray-100 flex justify-between items-center">
          {/* 编辑模式下提供删除入口（带二次确认）；新增模式下保留取消 */}
          {isAdd ? (
            <button onClick={onCancel} className="px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">取消</button>
          ) : (
            <DeleteButton onClick={() => setShowDeleteConfirm(true)}>删除</DeleteButton>
          )}
          <button onClick={handleSave} className="px-6 py-2 text-sm font-semibold text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg hover:shadow-lg transition-all">{isAdd ? "添加" : "保存"}</button>
        </div>
      </div>
    </div>

      {/* 删除二次确认弹窗（与外层弹窗同级，避免冒泡触发 onCancel） */}
      <ConfirmDeleteDialog
        open={showDeleteConfirm}
        title="删除该需求？"
        message="删除后该需求将无法恢复，请确认是否继续。"
        onCancel={() => setShowDeleteConfirm(false)}
        onConfirm={() => { setShowDeleteConfirm(false); onDelete && onDelete(); }}
      />
    </>
  );
};

const RequestTable = () => {
  const accounts = useStore((s) => s.accounts);
  const aiCards = useAIStore((s) => s.aiCards);
  const updateAICard = useAIStore((s) => s.updateAICard);
  const addAiCard = useAIStore((s) => s.addAiCard);
  const requestEditId = useAIStore((s) => s.requestEditId);
  const closeRequestEdit = useAIStore((s) => s.closeRequestEdit);

  // 各字段筛选状态（序号不参与筛选）
  const [filterType, setFilterType] = React.useState<"all" | "feature" | "bug">("all");
  const [filterStatus, setFilterStatus] = React.useState<"all" | "following" | "resolved">("all");
  const [filterPriority, setFilterPriority] = React.useState<"all" | "high" | "medium" | "low">("all");
  const [filterVersion, setFilterVersion] = React.useState<string>("all");
  const [search, setSearch] = React.useState(""); // 模糊搜索：需求/问题描述、备注等所有文本填写信息

  const [editing, setEditing] = React.useState<AICard | null>(null);
  const [adding, setAdding] = React.useState(false);

  // 从 AI 助手主列表「查看详情」跳转过来时，自动打开对应需求的编辑弹窗（跳过中间详情界面）
  React.useEffect(() => {
    if (requestEditId) {
      const target = aiCards.find((c) => c.id === requestEditId && c.type === "request");
      if (target) {
        setEditing(target);
        setAdding(false);
      }
      closeRequestEdit();
    }
  }, [requestEditId, aiCards, closeRequestEdit]);

  // 需求汇总（团队视图）：展示全部需求卡片，便于任何人查看与重新指派；删除（disabled）的隐藏
  const allRequests = useMemo(
    () => aiCards.filter((c) => c.type === "request" && !c.disabled),
    [aiCards]
  );

  // 上线版本选项（去重）
  const versionOptions = useMemo(() => {
    const set = new Set<string>();
    allRequests.forEach((c) => { if (c.version) set.add(c.version); });
    return Array.from(set);
  }, [allRequests]);

  // 卡片全部可搜索文本（需求/问题描述 + 备注 + 版本 + 提出人/来源等）
  const toSearchText = (c: AICard) =>
    [c.description, c.summary, c.task, c.event, c.remark, c.version, c.applicant, c.source]
      .filter((x) => typeof x === "string" && x)
      .join(" ")
      .toLowerCase();

  const requests = useMemo(() => {
    const kw = search.trim().toLowerCase();
    return allRequests
      .filter((c) => filterType === "all" || c.issueType === filterType)
      .filter((c) => filterStatus === "all" || c.status === filterStatus)
      .filter((c) => filterPriority === "all" || c.priority === filterPriority)
      .filter((c) => filterVersion === "all" || (c.version || "") === filterVersion)
      .filter((c) => !kw || toSearchText(c).includes(kw))
      .sort(sortByTimeAsc);
  }, [allRequests, filterType, filterStatus, filterPriority, filterVersion, search]);

  const handleSubmit = (vals: RequestFormValues) => {
    if (editing) {
      updateAICard(editing.id, {
        description: vals.description,
        issueType: vals.issueType,
        status: vals.status,
        version: vals.version,
        priority: vals.priority || undefined,
        remark: vals.remark,
        recipients: vals.assignee ? [vals.assignee] : undefined,
      });
      setEditing(null);
    } else {
      const now = new Date();
      const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
      const timeStr = `${now.getMonth() + 1}月${now.getDate()}日 ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const newCard: AICard = {
        id: "ai-req-" + Date.now(),
        type: "request",
        silent: true,
        source: "手动添加",
        applicant: "我",
        time: timeStr,
        task: vals.description.slice(0, 24),
        description: vals.description,
        issueType: vals.issueType,
        status: vals.status,
        version: vals.version,
        priority: vals.priority || undefined,
        remark: vals.remark,
        recipients: vals.assignee ? [vals.assignee] : undefined,
        messages: [],
      };
      addAiCard(newCard);
      setAdding(false);
    }
  };

  const resetFilters = () => {
    setFilterType("all"); setFilterStatus("all"); setFilterPriority("all");
    setFilterVersion("all"); setSearch("");
  };

  const selectCls = "h-8 px-2 bg-gray-50 rounded-lg text-xs text-gray-600 outline-none border border-gray-200 focus:border-indigo-500";

  return (
    <div className="flex-1 bg-white flex flex-col">
      <div className="h-14 border-b border-gray-200 flex items-center justify-between px-5 flex-shrink-0">
        <h2 className="ai-panel-title">需求</h2>
        <div className="flex items-center gap-3">
          <button onClick={() => setAdding(true)}
            className="px-3 py-1.5 text-xs font-medium text-white bg-gradient-to-r from-indigo-600 to-violet-600 rounded-lg hover:shadow-lg transition-all">+ 添加记录</button>
        </div>
      </div>

      {/* 筛选区：类型 / 状态 / 优先级 / 上线版本 可筛选；搜索框覆盖需求/问题描述、备注等所有文本填写信息 */}
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索需求/问题描述、备注等…"
          className="h-8 px-3 bg-gray-50 rounded-lg text-xs text-gray-700 placeholder-gray-400 outline-none border border-gray-200 focus:border-indigo-500 w-44"
        />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value as "all" | "feature" | "bug")} className={selectCls}>
          <option value="all">全部类型</option>
          <option value="feature">需求</option>
          <option value="bug">Bug</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as "all" | "following" | "resolved")} className={selectCls}>
          <option value="all">全部状态</option>
          <option value="following">跟进中</option>
          <option value="resolved">已解决</option>
        </select>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value as "all" | "high" | "medium" | "low")} className={selectCls}>
          <option value="all">全部优先级</option>
          <option value="high">高</option>
          <option value="medium">中</option>
          <option value="low">低</option>
        </select>
        <select value={filterVersion} onChange={(e) => setFilterVersion(e.target.value)} className={selectCls}>
          <option value="all">全部版本</option>
          {versionOptions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <button onClick={resetFilters} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">重置</button>
        <span className="text-xs text-gray-400 ml-auto">共 {requests.length} 条</span>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {requests.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">暂无符合条件的需求</div>
        ) : (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-xs">
                  <th className="text-left font-medium px-4 py-3 w-12">序号</th>
                  <th className="text-left font-medium px-4 py-3 w-20">类型</th>
                  <th className="text-left font-medium px-4 py-3">需求/问题描述</th>
                  <th className="text-left font-medium px-4 py-3 w-24">状态</th>
                  <th className="text-left font-medium px-4 py-3 w-28">上线版本</th>
                  <th className="text-left font-medium px-4 py-3 w-16">优先级</th>
                  <th className="text-left font-medium px-4 py-3 w-24">创建人</th>
                  <th className="text-left font-medium px-4 py-3 w-28">处理人</th>
                  <th className="text-left font-medium px-4 py-3">备注</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((r, idx) => {
                  const sm = requestStatusMeta(r.status);
                  const pm = requestPriorityMeta(r.priority);
                  const im = requestIssueTypeMeta(r.issueType);
                  const desc = r.description || r.summary || r.task || r.event || "";
                  const assigneeName = (r.recipients && r.recipients[0] && accounts.find((a) => a.id === r.recipients![0])?.name) || "";
                  return (
                    <tr key={r.id} onClick={() => setEditing(r)}
                      className="border-t border-gray-100 hover:bg-indigo-50/50 cursor-pointer transition-colors">
                      <td className="px-4 py-3 text-gray-400 text-xs">{idx + 1}</td>
                      <td className="px-4 py-3"><span className={"px-1.5 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap " + im.cls}>{im.label}</span></td>
                      <td className="px-4 py-3"><span className="text-gray-800 leading-relaxed line-clamp-2">{desc}</span></td>
                      <td className="px-4 py-3"><span className={"px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap " + sm.cls}>{sm.label}</span></td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{r.version || "-"}</td>
                      <td className="px-4 py-3"><span className={"px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap " + pm.cls}>{pm.label}</span></td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{r.applicant ? <span className="line-clamp-1">{r.applicant}</span> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs">{assigneeName ? <span className="line-clamp-1">{assigneeName}</span> : <span className="text-gray-300">未指派</span>}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{r.remark ? <span className="line-clamp-1">{r.remark}</span> : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <RequestFormDialog
          card={editing}
          onSubmit={handleSubmit}
          onCancel={() => setEditing(null)}
          onDelete={() => { updateAICard(editing.id, { disabled: true }); setEditing(null); }}
        />
      )}
      {adding && (
        <RequestFormDialog
          card={null}
          onSubmit={handleSubmit}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
};

// ?? Main AiRightPanel ??
const AiRightPanel = () => {
  const activeAITab = useAIStore((s) => s.activeAITab);
  switch (activeAITab) {
    case "ai": return <AiDetail />;
    case "schedule": return <ScheduleDetail />;
    case "todo": return <TodoDetail />;
    case "approval": return <ApprovalPanel />;
    case "request": return <RequestTable />;
    default: return <div className="flex-1 bg-white" />;
  }
};

export default AiRightPanel;














