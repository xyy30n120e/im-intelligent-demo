// 事项流转系统 — 数据层（移植自 demo.html v7）
// 仅放类型 / 常量 / 纯函数 / 种子数据，不含 React 与 store 副作用。

export type ItemStatus =
  | 'dispatched'
  | 'progress'
  | 'overdue'
  | 'done'
  | 'revoked'
  | 'cancelled'
  | 'pending_cancel';

export const STATUS = {
  DISPATCHED: 'dispatched',
  PROGRESS: 'progress',
  OVERDUE: 'overdue',
  DONE: 'done',
  REVOKED: 'revoked',
  CANCELLED: 'cancelled',
  PENDING_CANCEL: 'pending_cancel',
} as const;

export const TERMINAL: ItemStatus[] = [STATUS.DONE, STATUS.CANCELLED, STATUS.REVOKED];
export const NEAR_OVERDUE_DAYS = 3;

export const CATEGORIES = ['IT运维', '行政事务', '合规检查', '项目协作', '财务事务'];

export const COLORS = {
  primary: '#3B82F6',
  primaryDark: '#2563EB',
  progress: '#8B5CF6',
  warning: '#F59E0B',
  overdue: '#EF4444',
  done: '#10B981',
  cancel: '#9CA3AF',
  gray: '#6B7280',
};

// 状态 → 展示标签（单一来源）
export const STATUS_TEXT: Record<ItemStatus, string> = {
  dispatched: '待认领',
  progress: '进行中',
  overdue: '已逾期',
  done: '已完成',
  cancelled: '已作废',
  revoked: '已撤销',
  pending_cancel: '待作废',
};

// 状态跃迁白名单（非法跃迁直接拦截）
export const TRANSITIONS: Record<ItemStatus, ItemStatus[]> = {
  dispatched: [STATUS.PROGRESS, STATUS.OVERDUE, STATUS.REVOKED, STATUS.PENDING_CANCEL, STATUS.CANCELLED],
  progress: [STATUS.DONE, STATUS.OVERDUE, STATUS.DISPATCHED, STATUS.REVOKED, STATUS.PENDING_CANCEL, STATUS.CANCELLED],
  overdue: [STATUS.DONE, STATUS.PROGRESS, STATUS.DISPATCHED, STATUS.REVOKED, STATUS.PENDING_CANCEL, STATUS.CANCELLED],
  pending_cancel: [STATUS.CANCELLED],
  done: [],
  cancelled: [],
  revoked: [],
};

export interface Person {
  name: string;
  dept: string;
  avatar: string;
  color: string;
  superior: string;
}

export interface TimelineEntry {
  actor: string;
  action: string;
  time: string; // MM-DD
  type: string; // '' | 'done' | 'warning' | 'overdue'
}

export interface Evidence {
  icon: string;
}

export interface ApprovalItem {
  id: number;
  title: string;
  category: string;
  content: string;
  status: ItemStatus;
  assignee: string;
  collaborators: string[];
  creator: string;
  cc: string[];
  deadline: string; // YYYY-MM-DD
  createdDate: string; // YYYY-MM-DD
  urgeCount: number;
  evidence: Evidence[];
  collabEvidence: Record<string, boolean>;
  timeline: TimelineEntry[];
  manager: string;
  version: number;
  prevStatus?: ItemStatus;
  cancelApplicant?: string;
  cancelReason?: string;
  pendingDeadline?: string;
  pendingDeadlineApplicant?: string;
  pendingDeadlineReason?: string;
}

// 审批人员与 app 账户一一对应：c1=陈总 / c2=王雪瑶 / c3=李明轩 / c4=张三
export const peopleData: Person[] = [
  { name: '陈总', dept: '管理层', avatar: '陈', color: '#10B981', superior: '' },
  { name: '王雪瑶', dept: '市场部', avatar: '王', color: '#EC4899', superior: '陈总' },
  { name: '李明轩', dept: '技术部', avatar: '李', color: '#3B82F6', superior: '陈总' },
  { name: '张三', dept: 'IT运维部', avatar: '张', color: '#F97316', superior: '陈总' },
];

export const users = {
  manager: { name: '陈总', dept: '管理层' },
  employee: { name: '张三', dept: 'IT运维部' },
};

export type RoleKey = 'manager' | 'employee';

/* ===================== 日期工具 ===================== */
export function fmtISO(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function todayStr(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return fmtISO(d);
}
export function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return fmtISO(d);
}
export function fmtDate(iso?: string): string {
  if (!iso) return '';
  const p = iso.split('-');
  return p[1] + '-' + p[2];
}
export function getOverdueDays(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.floor((t.getTime() - d.getTime()) / 86400000);
}
export function getDaysUntil(iso: string): number {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  const t = new Date();
  t.setHours(0, 0, 0, 0);
  return Math.floor((d.getTime() - t.getTime()) / 86400000);
}
export function getDeadlineUrgency(deadline: string, status: ItemStatus): 'overdue' | 'urgent' | 'warning' | 'normal' {
  if (status === STATUS.OVERDUE) return 'overdue';
  if (status === STATUS.DONE || status === STATUS.CANCELLED || status === STATUS.REVOKED) return 'normal';
  const d = getDaysUntil(deadline);
  if (d < 0) return 'overdue';
  if (d <= 1) return 'urgent';
  if (d <= NEAR_OVERDUE_DAYS) return 'warning';
  return 'normal';
}

/* ===================== 状态辅助 ===================== */
export function statusText(s: ItemStatus): string {
  return STATUS_TEXT[s] || s;
}
export function isTerminal(s: ItemStatus): boolean {
  return TERMINAL.indexOf(s) >= 0;
}
export function isResolved(s: ItemStatus): boolean {
  return isTerminal(s) || s === STATUS.PENDING_CANCEL;
}
export function isActiveExec(mr: string, s: ItemStatus): boolean {
  return (mr === 'assignee' || mr === 'collaborator') && !isResolved(s);
}
export function isPersonManager(name: string): boolean {
  return peopleData.some((p) => p.superior === name);
}
export function getManagerOf(name: string): string {
  const p = peopleData.find((pp) => pp.name === name);
  return p ? p.superior : '';
}
export function getDirectSubordinates(name: string): Person[] {
  return peopleData.filter((p) => p.superior === name);
}
export function getAllSubordinates(name: string): string[] {
  const direct = getDirectSubordinates(name);
  const all = direct.map((d) => d.name);
  direct.forEach((d) => {
    all.push(...getAllSubordinates(d.name));
  });
  return all;
}
export type MyRole = 'manager' | 'creator' | 'assignee' | 'collaborator' | 'viewer';
export function getMyRole(item: ApprovalItem, role: RoleKey, userName: string): MyRole {
  if (role === 'manager') {
    const subs = getAllSubordinates(userName);
    if (item.manager === userName || subs.indexOf(item.assignee) >= 0) return 'manager';
    return 'viewer';
  }
  if (item.creator === userName) return 'creator';
  if (item.assignee === userName) return 'assignee';
  if (item.collaborators && item.collaborators.indexOf(userName) >= 0) return 'collaborator';
  return 'viewer';
}

/* ===================== 状态机（纯函数） ===================== */
export function isValidTransition(from: ItemStatus, to: ItemStatus): boolean {
  if (from === to) return true;
  const allowed = TRANSITIONS[from];
  return !!(allowed && allowed.indexOf(to) >= 0);
}

/**
 * 所有状态变更的唯一入口（纯函数，不修改入参）。
 * to='__restore__' 用于驳回作废恢复 prevStatus。
 */
export function applyTransition(
  item: ApprovalItem,
  to: ItemStatus | '__restore__'
): { ok: boolean; item?: ApprovalItem; error?: string } {
  if (to === '__restore__') {
    if (item.status !== STATUS.PENDING_CANCEL || !item.prevStatus) {
      return { ok: false, error: '无法恢复：缺少原状态' };
    }
    const next: ApprovalItem = { ...item, status: item.prevStatus };
    delete next.prevStatus;
    next.version = (next.version || 0) + 1;
    return { ok: true, item: next };
  }
  if (item.status === to) return { ok: true, item };
  if (!isValidTransition(item.status, to)) {
    return { ok: false, error: `状态变更不合法：${statusText(item.status)} → ${statusText(to)}` };
  }
  if (to === STATUS.PENDING_CANCEL) {
    const next: ApprovalItem = { ...item, status: to, prevStatus: item.status };
    next.version = (next.version || 0) + 1;
    return { ok: true, item: next };
  }
  const next: ApprovalItem = { ...item, status: to, version: (item.version || 0) + 1 };
  return { ok: true, item: next };
}

/* ===================== 种子数据（相对日期） ===================== */
function tl(actor: string, action: string, daysFromToday: number, type = ''): TimelineEntry {
  return { actor, action, time: fmtDate(addDays(todayStr(), daysFromToday)), type };
}

interface SeedSpec {
  id: number;
  title: string;
  category: string;
  content: string;
  status: ItemStatus;
  assignee: string;
  collaborators: string[];
  creator: string;
  cc: string[];
  dl: number; // deadline 偏移（负=过去→逾期）
  cd: number; // createdDate 偏移（负=过去）
  evidence?: Evidence[];
  collabEvidence?: Record<string, boolean>;
  urgeCount?: number;
  timeline: { actor: string; action: string; daysFromToday: number; type?: string }[];
}

const SEED: SeedSpec[] = [
  {
    id: 1,
    title: 'IT系统升级部署',
    category: 'IT运维',
    content: '完成生产环境服务器升级，包括数据库迁移和接口兼容性测试。',
    status: STATUS.PROGRESS,
    assignee: '张三',
    collaborators: ['王雪瑶'],
    creator: '陈总',
    cc: [],
    dl: 2,
    cd: -3,
    evidence: [{ icon: '📊' }, { icon: '🖥️' }],
    collabEvidence: { 王雪瑶: true },
    timeline: [
      { actor: '陈总', action: '创建了事项', daysFromToday: -3 },
      { actor: '陈总', action: '提交分发，推送至张三、王雪瑶', daysFromToday: -3 },
      { actor: '张三', action: '认领了事项', daysFromToday: -3, type: 'done' },
      { actor: '王雪瑶', action: '上传了佐证材料（2个文件）', daysFromToday: 0, type: 'warning' },
    ],
  },
  {
    id: 2,
    title: '季度合规检查报告',
    category: '合规检查',
    content: '完成季度合规检查并提交报告。',
    status: STATUS.OVERDUE,
    assignee: '王雪瑶',
    collaborators: [],
    creator: '陈总',
    cc: [],
    dl: -16,
    cd: -30,
    urgeCount: 1,
    timeline: [
      { actor: '陈总', action: '创建了事项', daysFromToday: -30 },
      { actor: '陈总', action: '提交分发', daysFromToday: -30 },
      { actor: '管理者', action: '催办了该事项（第1次）', daysFromToday: -28, type: 'warning' },
    ],
  },
  {
    id: 3,
    title: '部门搬迁协调',
    category: '行政事务',
    content: '协调部门搬迁相关事宜。',
    status: STATUS.DISPATCHED,
    assignee: '李明轩',
    collaborators: [],
    creator: '陈总',
    cc: [],
    dl: 3,
    cd: -4,
    timeline: [
      { actor: '陈总', action: '创建了事项', daysFromToday: -4 },
      { actor: '陈总', action: '提交分发，推送至李明轩', daysFromToday: -4 },
    ],
  },
  {
    id: 4,
    title: '月度财务审核',
    category: '财务事务',
    content: '完成月度财务审核工作。',
    status: STATUS.DONE,
    assignee: '王雪瑶',
    collaborators: [],
    creator: '陈总',
    cc: [],
    dl: -22,
    cd: -40,
    evidence: [{ icon: '📄' }],
    timeline: [
      { actor: '陈总', action: '创建了事项', daysFromToday: -40 },
      { actor: '王雪瑶', action: '认领了事项', daysFromToday: -40, type: 'done' },
      { actor: '王雪瑶', action: '上传了佐证材料', daysFromToday: -32, type: 'warning' },
      { actor: '王雪瑶', action: '标记完成', daysFromToday: -30, type: 'done' },
    ],
  },
  {
    id: 5,
    title: '安全漏洞修复',
    category: 'IT运维',
    content: '修复生产环境安全漏洞CVE-2026-1234。',
    status: STATUS.PROGRESS,
    assignee: '张三',
    collaborators: ['李明轩'],
    creator: '陈总',
    cc: [],
    dl: 5,
    cd: -6,
    timeline: [
      { actor: '陈总', action: '创建了事项', daysFromToday: -6 },
      { actor: '陈总', action: '提交分发，推送至张三、李明轩', daysFromToday: -6 },
    ],
  },
];

export function buildSeedItems(): ApprovalItem[] {
  const t = todayStr();
  return SEED.map((s) => {
    const createdDate = addDays(t, s.cd);
    const deadline = addDays(t, s.dl);
    const timeline = s.timeline.map((e) => tl(e.actor, e.action, e.daysFromToday, e.type || ''));
    const assigneeP = peopleData.find((p) => p.name === s.assignee);
    return {
      id: s.id,
      title: s.title,
      category: s.category,
      content: s.content,
      status: s.status,
      assignee: s.assignee,
      collaborators: s.collaborators,
      creator: s.creator,
      cc: s.cc,
      deadline,
      createdDate,
      urgeCount: s.urgeCount || 0,
      evidence: s.evidence || [],
      collabEvidence: s.collabEvidence || {},
      timeline,
      manager: assigneeP ? assigneeP.superior : '',
      version: 1,
    } as ApprovalItem;
  });
}

/** 过期自动翻转：把超过截止日且在途的事项翻为 overdue（幂等）。 */
export function refreshOverdueStatus(items: ApprovalItem[]): ApprovalItem[] {
  const t = todayStr();
  return items.map((it) => {
    if ((it.status === STATUS.DISPATCHED || it.status === STATUS.PROGRESS) && it.deadline < t) {
      const timeline = [
        ...it.timeline,
        { actor: '系统', action: '自动标记逾期', time: fmtDate(t), type: 'overdue' },
      ];
      return { ...it, status: STATUS.OVERDUE, version: (it.version || 0) + 1, timeline };
    }
    return it;
  });
}
