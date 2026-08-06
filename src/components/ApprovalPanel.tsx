import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useApprovalStore, ApprovalView, NewItemForm } from '../store/approvalStore';
import { useStore } from '../store/useStore';
import {
  ApprovalItem,
  ItemStatus,
  CATEGORIES,
  STATUS,
  STATUS_TEXT,
  TERMINAL,
  COLORS,
  Person,
  MyRole,
  peopleData,
  getMyRole,
  getManagerOf,
  getDirectSubordinates,
  getAllSubordinates,
  isResolved,
  isActiveExec,
  statusText,
  fmtDate,
  getDeadlineUrgency,
  getOverdueDays,
  getDaysUntil,
  todayStr,
  addDays,
} from '../data/approvalData';

const STATUS_COLOR: Record<ItemStatus, { fg: string; bg: string }> = {
  dispatched: { fg: '#60A5FA', bg: 'rgba(59,130,246,.15)' },
  progress: { fg: '#A78BFA', bg: 'rgba(139,92,246,.15)' },
  overdue: { fg: '#F87171', bg: 'rgba(239,68,68,.15)' },
  done: { fg: '#34D399', bg: 'rgba(16,185,129,.15)' },
  cancelled: { fg: '#9CA3AF', bg: 'rgba(156,163,175,.15)' },
  revoked: { fg: '#9CA3AF', bg: 'rgba(156,163,175,.15)' },
  pending_cancel: { fg: '#FBBF24', bg: 'rgba(245,158,11,.15)' },
};

const NAV: { key: ApprovalView; label: string }[] = [
  { key: 'itemlist', label: '事项明细' },
  { key: 'workbench', label: '工作台' },
  { key: 'todo', label: '待办' },
  { key: 'create', label: '新建' },
  { key: 'overdue', label: '逾期' },
  { key: 'dashboard', label: '看板' },
  { key: 'admin', label: '后台' },
];

/* ============ 选择器 ============ */
function getManaged(items: ApprovalItem[], userName: string, cat: string, assignee: string) {
  const subNames = getAllSubordinates(userName);
  return items.filter((it) => {
    if (subNames.indexOf(it.assignee) < 0 && it.manager !== userName) return false;
    if (cat && it.category !== cat) return false;
    if (assignee && it.assignee !== assignee) return false;
    return true;
  });
}
function getMyItems(items: ApprovalItem[], userName: string) {
  return items.filter((it) => it.assignee === userName || (it.collaborators && it.collaborators.indexOf(userName) >= 0));
}
function getOverdue(items: ApprovalItem[], userName: string, role: 'manager' | 'employee') {
  const list = role === 'manager' ? getManaged(items, userName, '', '') : getMyItems(items, userName);
  return list.filter((i) => i.status === STATUS.OVERDUE);
}
function sortByStatusThenDeadline(items: ApprovalItem[]) {
  return items.slice().sort((a, b) => {
    const ad = isResolved(a.status);
    const bd = isResolved(b.status);
    if (ad && !bd) return 1;
    if (!ad && bd) return -1;
    return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
  });
}
function countStatus(items: ApprovalItem[], s: ItemStatus) {
  return items.filter((i) => i.status === s).length;
}

/* ============ 小组件 ============ */
function StatusTag({ s }: { s: ItemStatus }) {
  const c = STATUS_COLOR[s];
  return (
    <span className="ap-status-tag" style={{ color: c.fg, background: c.bg }}>
      {STATUS_TEXT[s]}
    </span>
  );
}

function RoleTag({ mr }: { mr: MyRole }) {
  const map: Record<MyRole, { t: string; cls: string }> = {
    creator: { t: '发出', cls: 'role-creator' },
    assignee: { t: '接收', cls: 'role-assignee' },
    collaborator: { t: '协作', cls: 'role-collab' },
    manager: { t: '管理', cls: 'role-mgr' },
    viewer: { t: '查看', cls: 'role-viewer' },
  };
  const m = map[mr];
  return <span className={`ap-role-tag ${m.cls}`}>{m.t}</span>;
}

function ItemCard({ item, userName, onOpen }: { item: ApprovalItem; userName: string; onOpen: () => void }) {
  const mr = getMyRole(item, useApprovalStore.getState().currentRole, userName);
  const ug = getDeadlineUrgency(item.deadline, item.status);
  let dt: string;
  if (item.status === STATUS.OVERDUE) dt = `逾期${getOverdueDays(item.deadline)}天（应完成 ${fmtDate(item.deadline)}）`;
  else {
    dt = `截止 ${fmtDate(item.deadline)}`;
    if (ug === 'urgent') dt += '（明天到期）';
    else if (ug === 'warning') dt += '（即将到期）';
  }
  const titleCls = item.status === STATUS.DONE ? 'ap-item-title done' : item.status === STATUS.CANCELLED || item.status === STATUS.REVOKED ? 'ap-item-title cancelled' : mr === 'creator' && item.assignee !== userName ? 'ap-item-title gray' : 'ap-item-title';
  return (
    <div className={`ap-item-card status-${item.status}`} onClick={onOpen}>
      <div className="ap-item-header">
        <div className={titleCls}>{item.title}</div>
        <RoleTag mr={mr} />
        <StatusTag s={item.status} />
      </div>
      <div className="ap-item-meta">
        <span>📋 {item.category}</span>
        <span>👤 {item.assignee}</span>
        <span className={`ap-deadline ${ug === 'overdue' ? 'overdue' : ug === 'urgent' ? 'urgent' : ug === 'warning' ? 'warning' : ''}`}>📅 {dt}</span>
      </div>
    </div>
  );
}

function Toast({ msg }: { msg: string }) {
  const [show, setShow] = useState(msg);
  useEffect(() => {
    setShow(msg);
    if (!msg) return;
    const t = setTimeout(() => setShow(''), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  if (!show) return null;
  return <div className="ap-toast">{show}</div>;
}

/* ============ 弹窗 ============ */
interface ModalState {
  type:
    | 'urge'
    | 'reassign'
    | 'forceCancel'
    | 'upload'
    | 'complete'
    | 'return'
    | 'adjust'
    | 'revoke'
    | 'cancelApply'
    | 'transfer'
    | null;
  id: number | null;
}

function Modal({ title, desc, children, onCancel, onConfirm, confirmText = '确认', danger = false }: {
  title: string;
  desc?: string;
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmText?: string;
  danger?: boolean;
}) {
  return (
    <div className="ap-modal-overlay" onClick={onCancel}>
      <div className="ap-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ap-modal-title">{title}</div>
        {desc && <div className="ap-modal-desc">{desc}</div>}
        {children}
        <div className="ap-modal-actions">
          <button className="ap-btn ap-btn-secondary" onClick={onCancel}>取消</button>
          <button className={`ap-btn ${danger ? 'ap-btn-danger' : 'ap-btn-primary'}`} onClick={onConfirm}>{confirmText}</button>
        </div>
      </div>
    </div>
  );
}

/* ============ 各视图 ============ */
function ItemListView({ user }: { user: string }) {
  const items = useApprovalStore((s) => s.items);
  const role = useApprovalStore((s) => s.currentRole);
  const cat = useApprovalStore((s) => s.itemlistCat);
  const assignee = useApprovalStore((s) => s.itemlistAssignee);
  const setFilter = useApprovalStore((s) => s.setItemlistFilter);
  const selectItem = useApprovalStore((s) => s.selectItem);
  const refresh = useApprovalStore((s) => s.refresh);

  useEffect(() => { refresh(); }, [refresh]);

  if (role !== 'manager') {
    const my = sortByStatusThenDeadline(getMyItems(items, user));
    return (
      <div className="ap-pad">
        <div className="ap-filters">
          <select className="ap-select" value={cat} onChange={(e) => setFilter(e.target.value, assignee)}>
            <option value="">全部类别</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {my.length === 0 ? <Empty icon="🔍" text="暂无事项" /> : my.map((it) => <ItemCard key={it.id} item={it} userName={user} onOpen={() => selectItem(it.id, 'itemlist')} />)}
      </div>
    );
  }
  const f = getManaged(items, user, cat, assignee);
  const directNames = getDirectSubordinates(user).map((p) => p.name);
  const allSub = getAllSubordinates(user);
  const direct = f.filter((it) => directNames.indexOf(it.assignee) >= 0);
  const managed = f.filter((it) => allSub.indexOf(it.assignee) < 0 && it.manager === user);
  const indirect = f.filter((it) => directNames.indexOf(it.assignee) < 0 && allSub.indexOf(it.assignee) >= 0);
  return (
    <div className="ap-pad">
      <div className="ap-filters">
        <select className="ap-select" value={cat} onChange={(e) => setFilter(e.target.value, assignee)}>
          <option value="">全部类别</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="ap-select" value={assignee} onChange={(e) => setFilter(cat, e.target.value)}>
          <option value="">全部责任人</option>
          {peopleData.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
      </div>
      {f.length === 0 ? <Empty icon="🔍" text="无匹配事项" /> : (
        <>
          <Group label="直接下属" items={sortByStatusThenDeadline(direct)} user={user} onOpen={selectItem} />
          <Group label="间接下属" items={sortByStatusThenDeadline(indirect)} user={user} onOpen={selectItem} />
          <Group label="📌 我直管·转交" items={sortByStatusThenDeadline(managed)} user={user} onOpen={selectItem} />
        </>
      )}
    </div>
  );
}
function Group({ label, items, user, onOpen }: { label: string; items: ApprovalItem[]; user: string; onOpen: (id: number, src: ApprovalView) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="ap-group">
      <div className="ap-group-label">{label}（{items.length}）</div>
      {items.map((it) => <ItemCard key={it.id} item={it} userName={user} onOpen={() => onOpen(it.id, 'itemlist')} />)}
    </div>
  );
}

function WorkbenchView({ user }: { user: string }) {
  const items = useApprovalStore((s) => s.items);
  const role = useApprovalStore((s) => s.currentRole);
  const setView = useApprovalStore((s) => s.setView);
  const setTodoFilter = useApprovalStore((s) => s.setTodoFilter);
  const goTodo = (f: ItemStatus | '') => { setTodoFilter(f); setView('todo'); };
  const my = getMyItems(items, user);
  const oc = countStatus(my, STATUS.OVERDUE);
  const uc = my.filter((i) => { if (isResolved(i.status)) return false; const d = getDaysUntil(i.deadline); return d >= 0 && d <= 3; }).length;
  const pc = countStatus(my, STATUS.DISPATCHED);
  const banners: React.ReactNode[] = [];
  if (oc > 0) banners.push(<div key="o" className="ap-banner ap-banner-red" onClick={() => setView('overdue')}>⚠ 您有 {oc} 项事项已逾期 ›</div>);
  if (uc > 0) banners.push(<div key="u" className="ap-banner ap-banner-amber" onClick={() => goTodo('warning' as any)}>⏰ 您有 {uc} 项事项即将逾期 ›</div>);
  if (pc > 0) banners.push(<div key="p" className="ap-banner ap-banner-blue" onClick={() => goTodo(STATUS.DISPATCHED)}>您有 {pc} 项事项待认领 ›</div>);
  return (
    <div className="ap-pad">
      {banners}
      <div className="ap-stat-row">
        <StatCard num={pc} color={COLORS.primary} label="待认领" onClick={() => goTodo(STATUS.DISPATCHED)} />
        <StatCard num={countStatus(my, STATUS.PROGRESS)} color={COLORS.progress} label="进行中" onClick={() => goTodo(STATUS.PROGRESS)} />
        <StatCard num={oc} color={COLORS.overdue} label="已逾期" onClick={() => setView('overdue')} />
        <StatCard num={countStatus(my, STATUS.DONE)} color={COLORS.done} label="已完成" onClick={() => goTodo(STATUS.DONE)} />
      </div>
      <div className="ap-section-title">我的事项</div>
      {sortByStatusThenDeadline(my).map((it) => <ItemCard key={it.id} item={it} userName={user} onOpen={() => useApprovalStore.getState().selectItem(it.id, 'workbench')} />)}
    </div>
  );
}
function StatCard({ num, color, label, onClick }: { num: number | string; color: string; label: string; onClick?: () => void }) {
  return (
    <div className="ap-stat-card" style={{ borderColor: color + '40' }} onClick={onClick}>
      <div className="ap-stat-num" style={{ color }}>{num}</div>
      <div className="ap-stat-label">{label}</div>
    </div>
  );
}

function TodoView({ user }: { user: string }) {
  const items = useApprovalStore((s) => s.items);
  const role = useApprovalStore((s) => s.currentRole);
  const filter = useApprovalStore((s) => s.todoFilter);
  const setFilter = useApprovalStore((s) => s.setTodoFilter);
  const selectItem = useApprovalStore((s) => s.selectItem);
  let my = getMyItems(items, user);
  if (filter === STATUS.DONE) my = my.filter((i) => i.status === STATUS.DONE);
  else if (filter) my = my.filter((i) => i.status === filter);
  else my = my.filter((i) => !isResolved(i.status));
  my = sortByStatusThenDeadline(my);
  const tabs: { k: ItemStatus | ''; t: string }[] = [
    { k: '', t: '进行中' },
    { k: STATUS.DISPATCHED, t: '待认领' },
    { k: STATUS.PROGRESS, t: '处理中' },
    { k: STATUS.OVERDUE, t: '逾期' },
    { k: STATUS.DONE, t: '已完成' },
  ];
  return (
    <div className="ap-pad">
      <div className="ap-todo-tabs">
        {tabs.map((t) => (
          <button key={t.k} className={`ap-todo-tab ${filter === t.k ? 'active' : ''}`} onClick={() => setFilter(t.k)}>{t.t}</button>
        ))}
      </div>
      {my.length === 0 ? <Empty icon="📭" text="暂无事项" /> : my.map((it) => <ItemCard key={it.id} item={it} userName={user} onOpen={() => selectItem(it.id, 'todo')} />)}
    </div>
  );
}

function CreateView() {
  const addItem = useApprovalStore((s) => s.addItem);
  const [category, setCategory] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [deadline, setDeadline] = useState('');
  const [assignee, setAssignee] = useState('');
  const [collabs, setCollabs] = useState<string[]>([]);
  const [cc, setCc] = useState<string[]>([]);

  const toggle = (arr: string[], set: (v: string[]) => void, n: string) => {
    set(arr.indexOf(n) >= 0 ? arr.filter((x) => x !== n) : [...arr, n]);
  };
  const submit = () => {
    const form: NewItemForm = { category, title, content, deadline, assignee, collabs, cc };
    addItem(form);
  };
  return (
    <div className="ap-pad">
      <div className="ap-form">
        <label className="ap-field-label">类别 *</label>
        <select className="ap-input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">请选择</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <label className="ap-field-label">标题 *</label>
        <input className="ap-input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="事项标题" />

        <label className="ap-field-label">内容 *</label>
        <textarea className="ap-textarea" value={content} onChange={(e) => setContent(e.target.value)} placeholder="事项内容说明" />

        <label className="ap-field-label">截止日期 *</label>
        <input className="ap-input" type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} />

        <label className="ap-field-label">责任人 *</label>
        <select className="ap-input" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">请选择</option>
          {peopleData.map((p) => <option key={p.name} value={p.name}>{p.name} · {p.dept}</option>)}
        </select>

        <label className="ap-field-label">协作人（多选）</label>
        <div className="ap-chip-row">
          {peopleData.map((p) => (
            <span key={p.name} className={`ap-chip ${collabs.indexOf(p.name) >= 0 ? 'on' : ''}`} style={{ borderColor: p.color + '60', color: collabs.indexOf(p.name) >= 0 ? '#fff' : p.color, background: collabs.indexOf(p.name) >= 0 ? p.color : 'transparent' }} onClick={() => toggle(collabs, setCollabs, p.name)}>{p.name}</span>
          ))}
        </div>

        <label className="ap-field-label">抄送人（多选）</label>
        <div className="ap-chip-row">
          {peopleData.map((p) => (
            <span key={p.name} className={`ap-chip ${cc.indexOf(p.name) >= 0 ? 'on' : ''}`} style={{ borderColor: p.color + '60', color: cc.indexOf(p.name) >= 0 ? '#fff' : p.color, background: cc.indexOf(p.name) >= 0 ? p.color : 'transparent' }} onClick={() => toggle(cc, setCc, p.name)}>{p.name}</span>
          ))}
        </div>

        <button className="ap-btn ap-btn-primary ap-submit" onClick={submit}>提交分发</button>
      </div>
    </div>
  );
}

function OverdueView({ user }: { user: string }) {
  const items = useApprovalStore((s) => s.items);
  const role = useApprovalStore((s) => s.currentRole);
  const selectItem = useApprovalStore((s) => s.selectItem);
  const oi = getOverdue(items, user, role);
  return (
    <div className="ap-pad">
      {oi.length === 0 ? <Empty icon="✅" text="暂无逾期事项" /> : (
        <>
          <div className="ap-banner ap-banner-red">⚠ 您有 {oi.length} 项事项已逾期</div>
          <div className="ap-pad-inner">
            {oi.map((it) => <ItemCard key={it.id} item={it} userName={user} onOpen={() => selectItem(it.id, 'overdue')} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Empty({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="ap-empty">
      <div className="ap-empty-icon">{icon}</div>
      <div className="ap-empty-text">{text}</div>
    </div>
  );
}

function DashboardView({ user }: { user: string }) {
  const items = useApprovalStore((s) => s.items);
  const cat = useApprovalStore((s) => s.dashCat);
  const assignee = useApprovalStore((s) => s.dashAssignee);
  const setFilter = useApprovalStore((s) => s.setDashFilter);
  const f = getManaged(items, user, cat, assignee);
  const t = f.length, p = countStatus(f, STATUS.PROGRESS), o = countStatus(f, STATUS.OVERDUE), d = countStatus(f, STATUS.DONE);
  const rate = t > 0 ? Math.round((d / t) * 100) : 0;
  const today = todayStr();
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, -6 + i));
  const nd = days.map((day) => f.filter((i) => i.createdDate === day).length);
  const dd = days.map((day) => f.filter((i) => i.deadline === day).length);
  return (
    <div className="ap-pad">
      <div className="ap-filters">
        <select className="ap-select" value={cat} onChange={(e) => setFilter(e.target.value, assignee)}>
          <option value="">全部类别</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="ap-select" value={assignee} onChange={(e) => setFilter(cat, e.target.value)}>
          <option value="">全部责任人</option>
          {peopleData.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
        </select>
      </div>
      <div className="ap-stat-row">
        <StatCard num={t} color={COLORS.primary} label="总数" />
        <StatCard num={p} color={COLORS.progress} label="进行中" />
        <StatCard num={o} color={COLORS.overdue} label="已逾期" />
        <StatCard num={rate + '%'} color={COLORS.done} label="完成率" />
      </div>
      <div className="ap-chart-card">
        <div className="ap-chart-title">近 7 日趋势</div>
        <TrendChart labels={days.map((d) => fmtDate(d))} nd={nd} dd={dd} />
      </div>
      <div className="ap-chart-card">
        <div className="ap-chart-title">状态分布</div>
        <StatusChart d={countStatus(f, STATUS.DISPATCHED)} p={countStatus(f, STATUS.PROGRESS)} o={countStatus(f, STATUS.OVERDUE)} dn={countStatus(f, STATUS.DONE)} />
      </div>
      <div className="ap-section-title">下属进度</div>
      {renderEmployeeProgress(f, user)}
    </div>
  );
}

function TrendChart({ labels, nd, dd }: { labels: string[]; nd: number[]; dd: number[] }) {
  const W = 300, H = 120, pad = 20;
  const max = Math.max(1, ...nd, ...dd);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (labels.length - 1);
  const y = (v: number) => H - pad - (v * (H - 2 * pad)) / max;
  const line = (arr: number[]) => arr.map((v, i) => `${x(i)},${y(v)}`).join(' ');
  return (
    <svg className="ap-chart" viewBox={`0 0 ${W} ${H}`}>
      <polyline points={line(nd)} fill="none" stroke={COLORS.primary} strokeWidth="2" />
      <polyline points={line(dd)} fill="none" stroke={COLORS.warning} strokeWidth="2" />
      {labels.map((l, i) => <text key={i} x={x(i)} y={H - 4} fontSize="8" fill="#94A3B8" textAnchor="middle">{l}</text>)}
    </svg>
  );
}
function StatusChart({ d, p, o, dn }: { d: number; p: number; o: number; dn: number }) {
  const data = [
    { l: '待认领', v: d, c: COLORS.primary },
    { l: '进行中', v: p, c: COLORS.progress },
    { l: '已逾期', v: o, c: COLORS.overdue },
    { l: '已完成', v: dn, c: COLORS.done },
  ];
  const max = Math.max(1, ...data.map((x) => x.v));
  return (
    <div className="ap-bar-wrap">
      {data.map((x) => (
        <div key={x.l} className="ap-bar-row">
          <span className="ap-bar-label">{x.l}</span>
          <div className="ap-bar-track"><div className="ap-bar-fill" style={{ width: `${(x.v / max) * 100}%`, background: x.c }} /></div>
          <span className="ap-bar-val">{x.v}</span>
        </div>
      ))}
    </div>
  );
}
function renderEmployeeProgress(f: ApprovalItem[], mgrName: string) {
  const em: Record<string, { name: string; inProgress: number; completed: number; overdue: number; total: number }> = {};
  f.forEach((it) => {
    if (!em[it.assignee]) em[it.assignee] = { name: it.assignee, inProgress: 0, completed: 0, overdue: 0, total: 0 };
    em[it.assignee].total++;
    if (it.status === STATUS.PROGRESS) em[it.assignee].inProgress++;
    if (it.status === STATUS.DONE) em[it.assignee].completed++;
    if (it.status === STATUS.OVERDUE) em[it.assignee].overdue++;
  });
  const list = Object.values(em);
  if (list.length === 0) return <div className="ap-empty-text">无匹配数据</div>;
  const directNames = getDirectSubordinates(mgrName).map((p) => p.name);
  const render = (arr: typeof list, label: string, indirect: boolean) => arr.length === 0 ? null : (
    <div className="ap-group">
      <div className="ap-group-label">{label}</div>
      {arr.map((e) => {
        const p = peopleData.find((pp) => pp.name === e.name) || { avatar: e.name[0], color: '#6B7280', dept: '' } as Person;
        const r = e.total > 0 ? Math.round((e.completed / e.total) * 100) : 0;
        const bc = r >= 60 ? COLORS.done : r >= 30 ? COLORS.warning : COLORS.overdue;
        return (
          <div key={e.name} className={`ap-emp-row ${indirect ? 'indirect' : ''}`}>
            <div className="ap-emp-avatar" style={{ background: p.color }}>{p.avatar}</div>
            <div className="ap-emp-info">
              <div className="ap-emp-name">{e.name} · {p.dept}</div>
              <div className="ap-emp-bar"><div className="ap-emp-bar-fill" style={{ width: `${r}%`, background: bc }} /></div>
              <div className="ap-emp-stats">进行 {e.inProgress} · 完成 {e.completed} · 逾期 {e.overdue}</div>
            </div>
            <div className="ap-emp-count" style={{ color: bc }}>{r}%</div>
          </div>
        );
      })}
    </div>
  );
  return (
    <>
      {render(list.filter((e) => directNames.indexOf(e.name) >= 0), '直接下属', false)}
      {render(list.filter((e) => directNames.indexOf(e.name) < 0), '间接下属', true)}
    </>
  );
}

/* ============ 详情 + 动作 ============ */
function DetailView({ user }: { user: string }) {
  const selectedId = useApprovalStore((s) => s.selectedId);
  const items = useApprovalStore((s) => s.items);
  const role = useApprovalStore((s) => s.currentRole);
  const setView = useApprovalStore((s) => s.setView);
  const [modal, setModal] = useState<ModalState>({ type: null, id: null });
  const [form, setForm] = useState<Record<string, string>>({});
  const item = items.find((i) => i.id === selectedId) || null;

  if (!item) return <div className="ap-pad"><Empty icon="❓" text="事项不存在" /></div>;
  const mr = getMyRole(item, role, user);

  const close = () => setModal({ type: null, id: null });
  const setF = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const doAction = (fn: () => void) => { fn(); close(); };

  return (
    <div className="ap-pad">
      <button className="ap-back" onClick={() => setView(useApprovalStore.getState().detailSource)}>‹ 返回</button>

      {/* 头部状态 */}
      <div className="ap-detail-status-bar">
        <StatusTag s={item.status} />
        <div className={`ap-detail-deadline ${item.status === STATUS.OVERDUE ? 'overdue' : ''}`}>
          {item.status === STATUS.OVERDUE ? `逾期${getOverdueDays(item.deadline)}天（应完成 ${fmtDate(item.deadline)}）` : `截止：${fmtDate(item.deadline)}`}
        </div>
      </div>

      {/* 信息 */}
      <div className="ap-detail-section">
        <div className="ap-section-title">事项信息</div>
        <Row label="类别" value={item.category} />
        <Row label="标题" value={item.title} />
        <Row label="责任人" value={item.assignee} />
        <Row label="协作人" value={item.collaborators.length > 0 ? item.collaborators.join('、') : '无'} />
        <Row label="录入者" value={item.creator} />
        <Row label="管理者" value={item.manager || '未设置'} />
        {item.cc.length > 0 && <Row label="抄送人" value={item.cc.join('、')} />}
        <Row label="截止日期" value={fmtDate(item.deadline)} />
        <div className="ap-detail-row" style={{ flexDirection: 'column', gap: 4 }}>
          <span className="ap-row-label">内容</span>
          <span className="ap-detail-content">{item.content}</span>
        </div>
      </div>

      {/* 操作轨迹 */}
      <div className="ap-detail-section">
        <div className="ap-section-title">操作轨迹 {item.urgeCount > 0 && <span className="ap-urge-badge">已催办 {item.urgeCount} 次</span>}</div>
        <div className="ap-timeline">
          {item.timeline.map((t, i) => (
            <div key={i} className="ap-tl-item">
              <div className={`ap-tl-dot ${t.type || ''}`} />
              <div className="ap-tl-text"><b>{t.actor}</b> {t.action}</div>
              <div className="ap-tl-time">{t.time}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 佐证 */}
      {mr !== 'manager' && (
        <div className="ap-detail-section">
          <div className="ap-section-title">佐证材料</div>
          <div className="ap-evidence-grid">
            {item.evidence.map((e, idx) => (
              <div key={idx} className="ap-evidence-item">
                {e.icon}
                {isActiveExec(mr, item.status) && <div className="ap-evidence-del" onClick={() => useApprovalStore.getState().deleteEvidence(item.id, idx)}>×</div>}
              </div>
            ))}
            {isActiveExec(mr, item.status) && <div className="ap-evidence-upload" onClick={() => setModal({ type: 'upload', id: item.id })}>+</div>}
          </div>
          {item.collaborators.length > 0 && (
            <div className="ap-collab-ev">
              <div className="ap-collab-ev-title">协作人佐证状态：</div>
              {item.collaborators.map((n) => (
                <span key={n} className={`ap-collab-ev-item ${item.collabEvidence[n] ? 'done' : 'pending'}`}>{n} {item.collabEvidence[n] ? '✓ 已传' : '○ 未传'}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 审批横幅（待审批申请） */}
      {item.status === STATUS.PENDING_CANCEL && (
        <Banner title="作废申请待审批" desc={`${item.cancelApplicant || '申请人'} 申请作废${item.cancelReason ? '，原因：' + item.cancelReason : ''}`} />
      )}
      {item.pendingDeadline && mr === 'manager' && (
        <Banner title="截止调整申请待审批" desc={`${item.pendingDeadlineApplicant || '申请人'} 申请将截止从 ${fmtDate(item.deadline)} 调整至 ${fmtDate(item.pendingDeadline)}${item.pendingDeadlineReason ? '，原因：' + item.pendingDeadlineReason : ''}`} />
      )}

      {/* 动作 */}
      <DetailActions mr={mr} item={item} user={user} onModal={setModal} setForm={setForm} />

      {/* 弹窗 */}
      {modal.type && modal.id !== null && (
        <ActionModal type={modal.type} id={modal.id} form={form} setF={setF} close={close} doAction={doAction} />
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="ap-detail-row">
      <span className="ap-row-label">{label}</span>
      <span className="ap-row-value">{value}</span>
    </div>
  );
}
function Banner({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="ap-approval-banner">
      <div className="ap-ab-title">{title}</div>
      <div className="ap-ab-desc">{desc}</div>
    </div>
  );
}

function DetailActions({ mr, item, user, onModal, setForm }: { mr: MyRole; item: ApprovalItem; user: string; onModal: (m: ModalState) => void; setForm: (f: (p: any) => any) => void }) {
  const store = useApprovalStore.getState();
  const B = (cls: string, txt: string, fn: () => void) => <button className={`ap-btn ${cls}`} onClick={fn}>{txt}</button>;
  const ended = isResolved(item.status);
  const hasPD = !!item.pendingDeadline;

  if (item.status === STATUS.PENDING_CANCEL) {
    if (mr === 'manager') return <div className="ap-actions">{B('ap-btn-danger', '通过作废', () => store.approveCancel(item.id))}{B('ap-btn-secondary', '驳回', () => store.rejectCancel(item.id))}</div>;
    return <Banner title="作废申请审批中" desc="管理者审批中，请耐心等待" />;
  }
  if (hasPD && mr === 'manager') return <div className="ap-actions">{B('ap-btn-primary', '通过调整', () => store.approveAdjust(item.id))}{B('ap-btn-secondary', '驳回', () => store.rejectAdjust(item.id))}</div>;
  if (ended) return mr === 'creator' ? <div className="ap-creator-hint">📌 此事项已结束</div> : <></>;

  if (mr === 'manager') {
    const hasJurisdiction = item.manager === user || getAllSubordinates(user).indexOf(item.assignee) >= 0;
    if (!hasJurisdiction) return <></>;
    return (
      <div className="ap-actions">
        {B('ap-btn-warning', `⚡ 催办${item.urgeCount > 0 ? '(' + item.urgeCount + ')' : ''}`, () => onModal({ type: 'urge', id: item.id }))}
        {B('ap-btn-secondary', '改派', () => onModal({ type: 'reassign', id: item.id }))}
        {B('ap-btn-danger', '强制作废', () => onModal({ type: 'forceCancel', id: item.id }))}
        <button className="ap-btn ap-btn-secondary" onClick={() => onModal({ type: 'transfer', id: item.id })}>⇄ 转交</button>
      </div>
    );
  }
  if (mr === 'assignee') {
    if (item.status === STATUS.DISPATCHED) return <div className="ap-actions">{B('ap-btn-primary', '✋ 认领', () => store.claim(item.id))}{B('ap-btn-secondary', '上传佐证', () => onModal({ type: 'upload', id: item.id }))}{B('ap-btn-secondary', '退回', () => onModal({ type: 'return', id: item.id }))}{B('ap-btn-danger', '申请作废', () => onModal({ type: 'cancelApply', id: item.id }))}</div>;
    return (
      <div className="ap-actions">
        {B('ap-btn-secondary', '申请调整截止', () => onModal({ type: 'adjust', id: item.id }))}
        {B('ap-btn-secondary', '上传佐证', () => onModal({ type: 'upload', id: item.id }))}
        {B('ap-btn-success', '标记完成', () => onModal({ type: 'complete', id: item.id }))}
        {B('ap-btn-secondary', '退回', () => onModal({ type: 'return', id: item.id }))}
        {B('ap-btn-danger', '申请作废', () => onModal({ type: 'cancelApply', id: item.id }))}
      </div>
    );
  }
  if (mr === 'collaborator') return <div className="ap-actions">{B('ap-btn-secondary', '上传佐证', () => onModal({ type: 'upload', id: item.id }))}{B('ap-btn-success', '标记完成', () => onModal({ type: 'complete', id: item.id }))}{B('ap-btn-danger', '申请作废', () => onModal({ type: 'cancelApply', id: item.id }))}</div>;
  if (mr === 'creator' && item.status === STATUS.DISPATCHED) return <div className="ap-actions">{B('ap-btn-secondary', '撤销事项', () => onModal({ type: 'revoke', id: item.id }))}</div>;
  if (mr === 'creator') return <div className="ap-creator-hint">📌 您是录入者，可关注事项进度</div>;
  return <></>;
}

function ActionModal({ type, id, form, setF, close, doAction }: { type: NonNullable<ModalState['type']>; id: number; form: Record<string, string>; setF: (k: string, v: string) => void; close: () => void; doAction: (fn: () => void) => void; }) {
  const store = useApprovalStore.getState();
  const reasonOptions = ['工作量不匹配', '能力不匹配', '岗位调动', '长期无响应', '其他'];
  const returnOptions = ['时间冲突', '非本人职责', '信息不足', '其他'];
  const peopleExcept = (exclude: string[]) => peopleData.filter((p) => exclude.indexOf(p.name) < 0);

  switch (type) {
    case 'urge':
      return <Modal title="⚡ 催办确认" desc={`将向责任人发送催办提醒，并记录在操作轨迹中${form.urge ? '' : ''}`} onCancel={close} onConfirm={() => doAction(() => store.urge(id))} confirmText="确认催办" />;
    case 'reassign':
      return (
        <Modal title="改派事项" desc="改派将直接生效" onCancel={close} onConfirm={() => doAction(() => store.reassign(id, form.target || '', form.reason || '', true))} confirmText="确认改派">
          <select className="ap-input" value={form.target || ''} onChange={(e) => setF('target', e.target.value)}>
            <option value="">选择新责任人</option>
            {peopleExcept([store.items.find((i) => i.id === id)?.assignee || '', store.currentUserName]).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
          <div className="ap-reason-options">
            {reasonOptions.map((r) => <div key={r} className={`ap-reason-opt ${form.reason === r ? 'sel' : ''}`} onClick={() => setF('reason', r)}>{r}</div>)}
          </div>
        </Modal>
      );
    case 'forceCancel':
      return <Modal title="⚠ 强制作废" desc="确认作废事项？此操作不可撤销。" danger onCancel={close} onConfirm={() => doAction(() => store.forceCancel(id, form.reason || ''))} confirmText="确认作废">
        <textarea className="ap-textarea" placeholder="作废原因（必填）" value={form.reason || ''} onChange={(e) => setF('reason', e.target.value)} />
      </Modal>;
    case 'upload':
      return <Modal title="上传佐证材料" desc="请选择上传方式" onCancel={close} onConfirm={close} confirmText="关闭">
        <div className="ap-reason-options">
          {['📷 拍照', '🖼️ 相册', '📄 文件'].map((t) => <div key={t} className="ap-reason-opt" onClick={() => doAction(() => store.uploadEvidence(id, t))}>{t}</div>)}
        </div>
      </Modal>;
    case 'complete':
      return <Modal title="✅ 标记完成" desc="确认标记事项为已完成？" onCancel={close} onConfirm={() => doAction(() => store.complete(id, form.note || ''))} confirmText="确认完成">
        <textarea className="ap-textarea" placeholder="完成说明（选填）" value={form.note || ''} onChange={(e) => setF('note', e.target.value)} />
      </Modal>;
    case 'return':
      return <Modal title="退回事项" desc="退回后事项将回到待认领状态" onCancel={close} onConfirm={() => doAction(() => store.returnItem(id, form.reason || '', form.detail || ''))} confirmText="确认退回">
        <div className="ap-reason-options">
          {returnOptions.map((r) => <div key={r} className={`ap-reason-opt ${form.reason === r ? 'sel' : ''}`} onClick={() => setF('reason', r)}>{r}</div>)}
        </div>
        <textarea className="ap-textarea" placeholder="详细原因（必填）" value={form.detail || ''} onChange={(e) => setF('detail', e.target.value)} />
      </Modal>;
    case 'adjust':
      return <Modal title="申请调整截止日期" desc="调整需管理者审批" onCancel={close} onConfirm={() => doAction(() => store.adjustApply(id, form.date || '', form.reason || ''))} confirmText="提交申请">
        <input className="ap-input" type="date" value={form.date || ''} onChange={(e) => setF('date', e.target.value)} />
        <textarea className="ap-textarea" placeholder="调整原因（必填）" value={form.reason || ''} onChange={(e) => setF('reason', e.target.value)} />
      </Modal>;
    case 'revoke':
      return <Modal title="撤销事项" desc="确认撤销？撤销后责任人将收到通知。" onCancel={close} onConfirm={() => doAction(() => store.revoke(id))} confirmText="确认撤销" />;
    case 'cancelApply':
      return <Modal title="申请作废" desc="申请需管理者审批" danger onCancel={close} onConfirm={() => doAction(() => store.cancelApply(id, form.reason || ''))} confirmText="提交申请">
        <textarea className="ap-textarea" placeholder="作废原因（必填）" value={form.reason || ''} onChange={(e) => setF('reason', e.target.value)} />
      </Modal>;
    case 'transfer':
      return (
        <Modal title="⇄ 转交管理权" desc="转交后您将不再管理此事项" onCancel={close} onConfirm={() => doAction(() => store.transfer(id, form.target || ''))} confirmText="确认转交">
          <select className="ap-input" value={form.target || ''} onChange={(e) => setF('target', e.target.value)}>
            <option value="">选择新管理者</option>
            {peopleExcept([store.items.find((i) => i.id === id)?.manager || '', store.currentUserName]).map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}
          </select>
        </Modal>
      );
    default:
      return null;
  }
}

/* ============ 后台 ============ */
function AdminView() {
  const [tab, setTab] = useState<'roster' | 'dept' | 'audit' | 'resign'>('roster');
  const roster = peopleData.map((p) => ({ ...p, phone: '138' + String(10000000 + Math.abs(p.name.charCodeAt(0) * 131) % 90000000), isManager: p.superior !== '' && peopleData.some((x) => x.superior === p.name) }));
  const depts = [
    { name: '管理层', lead: '赵六', count: 2 },
    { name: 'IT运维部', lead: '张三', count: 3 },
    { name: '行政部', lead: '孙七', count: 1 },
    { name: '测试部', lead: '王五', count: 1 },
    { name: '财务部', lead: '周八', count: 1 },
  ];
  const [pendingReg, setPendingReg] = useState([{ name: '钱十', phone: '13800001111', applyTime: '07-20 14:30' }, { name: '孙十一', phone: '13800002222', applyTime: '07-21 09:15' }]);
  const [resigning, setResigning] = useState([{ name: '吴九', dept: 'IT运维部', inFlight: 1 }]);

  const approveReg = (i: number) => setPendingReg((r) => r.filter((_, idx) => idx !== i));
  const rejectReg = (i: number) => setPendingReg((r) => r.filter((_, idx) => idx !== i));
  const batchReassign = (i: number) => {
    const r = resigning[i];
    const po = peopleData.filter((p) => p.name !== r.name && p.dept === r.dept);
    const target = po.length > 0 ? po[0].name : '张三';
    useApprovalStore.setState((s) => ({ items: s.items.map((it) => it.assignee === r.name ? { ...it, assignee: target, manager: getManagerOf(target), version: (it.version || 0) + 1 } : it) }));
    setResigning((x) => x.filter((_, idx) => idx !== i));
  };

  return (
    <div className="ap-pad">
      <div className="ap-admin-tabs">
        {(['roster', 'dept', 'audit', 'resign'] as const).map((t) => (
          <div key={t} className={`ap-admin-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{t === 'roster' ? '花名册' : t === 'dept' ? '部门' : t === 'audit' ? '注册审核' : '离职改派'}</div>
        ))}
      </div>
      {tab === 'roster' && (
        <table className="ap-admin-table">
          <thead><tr><th>姓名</th><th>手机号</th><th>部门</th><th>直接上级</th><th>角色</th></tr></thead>
          <tbody>{roster.map((r) => <tr key={r.name}><td>{r.name}</td><td>{r.phone}</td><td>{r.dept}</td><td>{r.superior || '—'}</td><td>{r.isManager ? <span className="ap-adm-tag mgr">管理者</span> : <span className="ap-adm-tag emp">员工</span>}</td></tr>)}</tbody>
        </table>
      )}
      {tab === 'dept' && (
        <table className="ap-admin-table">
          <thead><tr><th>部门</th><th>负责人</th><th>人数</th></tr></thead>
          <tbody>{depts.map((d) => <tr key={d.name}><td>{d.name}</td><td>{d.lead}</td><td>{d.count} 人</td></tr>)}</tbody>
        </table>
      )}
      {tab === 'audit' && (
        pendingReg.length === 0 ? <Empty icon="✅" text="暂无待审核申请" /> :
        <table className="ap-admin-table">
          <thead><tr><th>姓名</th><th>手机号</th><th>申请时间</th><th>操作</th></tr></thead>
          <tbody>{pendingReg.map((r, i) => <tr key={r.name}><td>{r.name}</td><td>{r.phone}</td><td>{r.applyTime}</td><td><button className="ap-adm-btn" onClick={() => approveReg(i)}>通过</button> <button className="ap-adm-btn danger" onClick={() => rejectReg(i)}>驳回</button></td></tr>)}</tbody>
        </table>
      )}
      {tab === 'resign' && (
        resigning.length === 0 ? <Empty icon="✅" text="暂无离职待处理" /> :
        <table className="ap-admin-table">
          <thead><tr><th>姓名</th><th>部门</th><th>在途事项</th><th>操作</th></tr></thead>
          <tbody>{resigning.map((r, i) => <tr key={r.name}><td>{r.name}</td><td>{r.dept}</td><td>{r.inFlight} 项</td><td><button className="ap-adm-btn" onClick={() => batchReassign(i)}>批量改派</button></td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

/* ============ 主面板 ============ */
export default function ApprovalPanel() {
  const currentUserId = useStore((s) => s.currentUserId);
  const role = useApprovalStore((s) => s.currentRole);
  const user = useApprovalStore((s) => s.currentUserName);
  const view = useApprovalStore((s) => s.currentView);
  const setView = useApprovalStore((s) => s.setView);
  const toast = useApprovalStore((s) => s.toast);
  const setToast = useApprovalStore((s) => s.setToast);
  const refresh = useApprovalStore((s) => s.refresh);
  const syncAccount = useApprovalStore((s) => s.syncAccount);

  useEffect(() => { syncAccount(); }, [currentUserId, syncAccount]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 2600); return () => clearTimeout(t); } }, [toast, setToast]);

  const renderView = () => {
    switch (view) {
      case 'itemlist': return <ItemListView user={user} />;
      case 'workbench': return <WorkbenchView user={user} />;
      case 'todo': return <TodoView user={user} />;
      case 'create': return <CreateView />;
      case 'detail': return <DetailView user={user} />;
      case 'overdue': return <OverdueView user={user} />;
      case 'dashboard': return <DashboardView user={user} />;
      case 'admin': return <AdminView />;
      default: return <ItemListView user={user} />;
    }
  };

  return (
    <div className="flex-1 bg-white flex flex-col ap-root">
      <div className="ap-header">
        <h2 className="ai-panel-title">审批</h2>
        <div className="ap-role-switch">
          <span className="ap-role-static">{user} · {role === 'manager' ? '管理者视角' : '执行者视角'}</span>
        </div>
      </div>
      <div className="ap-nav">
        {NAV.map((n) => (
          <button key={n.key} className={`ap-nav-btn ${view === n.key ? 'active' : ''}`} onClick={() => setView(n.key)}>{n.label}</button>
        ))}
      </div>
      <div className="ap-content flex-1 overflow-y-auto">{renderView()}</div>
      {toast && <Toast msg={toast} />}
    </div>
  );
}
