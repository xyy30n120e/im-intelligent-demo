import React, { useMemo, useState } from 'react';
import { useAIStore } from '../store/aiStore';
import { useStore } from '../store/useStore';
import { isToday } from '../services/aiService';

type Accent = 'blue' | 'green' | 'purple';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// 把 "8月3日 10:46" / "8月3日" / "今天 10:46" / "2026年8月3日 周四 15:00"
// 转成 "XXXX年X月X日 星期X 时间"（今日概览日程/待办副文本用）
function formatFullDate(s?: string): string {
  if (!s) return '';
  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let day = now.getDate();
  let rest = s;
  const ymd = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (ymd) {
    year = parseInt(ymd[1], 10);
    month = parseInt(ymd[2], 10);
    day = parseInt(ymd[3], 10);
    rest = s.slice((ymd.index ?? 0) + ymd[0].length).trim();
  } else {
    const md = s.match(/(\d{1,2})月(\d{1,2})日/);
    if (md) {
      month = parseInt(md[1], 10);
      day = parseInt(md[2], 10);
      rest = s.slice((md.index ?? 0) + md[0].length).trim();
      const ym = s.match(/(\d{4})年/);
      if (ym) year = parseInt(ym[1], 10);
    } else if (s.includes('今天')) {
      rest = s.replace('今天', '').trim();
    } else {
      return s;
    }
  }
  const wd = WEEKDAYS[new Date(year, month - 1, day).getDay()];
  // 去掉 rest 里已有的「周X/星期X」，避免重复（数据里常自带星期）
  rest = rest.replace(/^(星期|周)[一二三四五六日]\s*/, '').trim();
  return rest ? `${year}年${month}月${day}日 星期${wd} ${rest}` : `${year}年${month}月${day}日 星期${wd}`;
}

const Section: React.FC<{ title: string; count: number; accent: Accent; children: React.ReactNode }> = ({
  title,
  count,
  accent,
  children,
}) => {
  if (count === 0) return null;
  const head = accent === 'blue' ? 'text-blue-600' : accent === 'green' ? 'text-green-600' : 'text-purple-600';
  return (
    <div>
      <div className={`text-xs font-medium ${head} mb-1`}>
        {title} · {count}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
};

const Tag: React.FC<{ text: string }> = ({ text }) => {
  return <span className={`text-[10px] leading-none px-1.5 py-0.5 rounded bg-gray-100 text-gray-500`}>{text}</span>;
};

const Row: React.FC<{
  accent: Accent;
  label: string;
  sub?: string;
  group?: string;
  onClick: () => void;
}> = ({ accent, label, sub, group, onClick }) => {
  const dot = accent === 'blue' ? 'bg-blue-500' : accent === 'green' ? 'bg-green-500' : 'bg-purple-500';
  return (
    <div
      onClick={onClick}
      className="flex items-start gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer"
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dot} flex-shrink-0 mt-1.5`} />
      <div className="flex-1 min-w-0">
        <div className="text-sm text-gray-700 truncate">{label}</div>
        {group && (
          <div className="flex items-center gap-1 mt-0.5 flex-wrap">
            <Tag text={group} />
          </div>
        )}
      </div>
      {sub && <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">{sub}</span>}
      <span className="text-gray-300 flex-shrink-0 mt-0.5">›</span>
    </div>
  );
};

const AiPinnedReminder: React.FC = () => {
  const aiCards = useAIStore((s) => s.aiCards);
  const scheduleItems = useAIStore((s) => s.scheduleItems);
  const todoItems = useAIStore((s) => s.todoItems);
  const openScheduleEditor = useAIStore((s) => s.openScheduleEditor);
  const openTodoEditor = useAIStore((s) => s.openTodoEditor);
  const openRequestEdit = useAIStore((s) => s.openRequestEdit);

  const closedDate = useStore((s) => s.pinnedReminderClosedDate);
  const dismiss = useStore((s) => s.dismissPinnedReminder);
  const currentUserId = useStore((s) => s.currentUserId);
  const badgeCounts = useAIStore((s) => s.badgeCounts);
  const approvalCount = badgeCounts?.[currentUserId]?.approval || 0;

  const [expanded, setExpanded] = useState(false);

  const todayStr = `${new Date().getMonth() + 1}月${new Date().getDate()}日`;

  // 全局总览：展示全部群的今日内容
  // 日程来自两处：① AI 对话生成的日程卡片（aiCards）；② 用户手动添加的日程（scheduleItems）
  // 注意：AI 生成日程时会同时写入 aiCards 与 scheduleItems（同 id），若两套都显示就会出现「两条一模一样」，
  // 因此按 id 去重——aiCards 优先，scheduleItems 中与之同 id 的跳过，仅保留手动添加的日程。
  const schedules = useMemo(() => {
    const list: { id: string; label: string; time: string; source: string; open: () => void }[] = [];
    const aiCardIds = new Set<string>();
    aiCards.forEach((c) => {
      if (c.type === 'schedule' && !c.disabled && isToday(c.eventTime || c.time)) {
        aiCardIds.add(c.id);
        list.push({
          id: c.id,
          label: c.event || c.task || '未命名日程',
          time: c.eventTime || c.time || '',
          source: c.source,
          open: () => openScheduleEditor(c.id),
        });
      }
    });
    scheduleItems.forEach((it) => {
      if (aiCardIds.has(it.id)) return; // 该日程已来自 aiCards，避免重复
      if (isToday(it.time)) {
        list.push({
          id: it.id,
          label: it.event,
          time: it.time,
          source: it.source,
          open: () => openScheduleEditor(it.id),
        });
      }
    });
    return list;
  }, [aiCards, scheduleItems, openScheduleEditor]);
  const todos = useMemo(
    () => todoItems.filter((t) => !t.completed && isToday(t.deadline)),
    [todoItems]
  );
  // 需求/Bug：仅显示「指派给我的」（处理人包含当前用户），不按日期过滤
  const requests = useMemo(
    () => aiCards.filter((c) => c.type === 'request' && !c.disabled && !!c.recipients && c.recipients.includes(currentUserId)),
    [aiCards, currentUserId]
  );

  // 当天已手动关闭则不再展示
  if (closedDate === todayStr) return null;

  const total = schedules.length + todos.length + requests.length;

  return (
    <div className="ai-overview-bar flex-shrink-0">
      <div className="ai-overview-bar__main">
        <div className="ai-overview-stats">
          <div className="overview-item schedule">
            <i className="overview-icon fas fa-calendar-alt"></i>
            <span className="ov-count">{schedules.length}</span>
            <span className="ov-label">日程</span>
          </div>
          <div className="overview-item todo">
            <i className="overview-icon fas fa-list-check"></i>
            <span className="ov-count">{todos.length}</span>
            <span className="ov-label">待办</span>
          </div>
          <div className="overview-item requirement">
            <i className="overview-icon fas fa-clipboard-list"></i>
            <span className="ov-count">{requests.length}</span>
            <span className="ov-label">需求</span>
          </div>
          <div className="overview-item approval">
            <i className="overview-icon fas fa-file-signature"></i>
            <span className="ov-count">{approvalCount}</span>
            <span className="ov-label">审批</span>
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="ai-overview-btn"
        >
          {expanded ? '收起' : '查看'}
        </button>
      </div>

      {expanded && (
        <div className="ai-overview-detail">
          {total === 0 ? (
            <div className="text-sm text-gray-400 px-2 py-1.5">今日暂无日程、待办或需求</div>
          ) : (
            <>
              <Section title="日程" count={schedules.length} accent="blue">
                {schedules.map((s) => (
                  <Row
                    key={s.id}
                    accent="blue"
                    label={s.label}
                    sub={formatFullDate(s.time)}
                    group={s.source}
                    onClick={s.open}
                  />
                ))}
              </Section>
              <Section title="待办" count={todos.length} accent="green">
                {todos.map((t) => (
                  <Row
                    key={t.id}
                    accent="green"
                    label={t.task}
                    sub={formatFullDate(t.deadline)}
                    group={t.source}
                    onClick={() => openTodoEditor(t.id)}
                  />
                ))}
              </Section>
              <Section title="需求" count={requests.length} accent="purple">
                {requests.map((c) => (
                  <Row
                    key={c.id}
                    accent="purple"
                    label={c.task || c.summary || c.description || '需求'}
                    group={c.source}
                    onClick={() => openRequestEdit(c.id)}
                  />
                ))}
              </Section>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default AiPinnedReminder;
