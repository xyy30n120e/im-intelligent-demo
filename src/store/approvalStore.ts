// 事项流转系统 — 状态与动作层（移植自 demo.html v7）
import { create } from 'zustand';
import { useStore } from './useStore';
import {
  ApprovalItem,
  ItemStatus,
  RoleKey,
  STATUS,
  TimelineEntry,
  applyTransition,
  buildSeedItems,
  getManagerOf,
  refreshOverdueStatus,
} from '../data/approvalData';

// 陈总(c1) 为审批管理者；其余账号（王雪瑶/李明轩/张三）均为执行者
const MANAGER_ID = 'c1';

export type ApprovalView =
  | 'itemlist'
  | 'workbench'
  | 'todo'
  | 'create'
  | 'detail'
  | 'overdue'
  | 'dashboard'
  | 'admin';

export interface NewItemForm {
  category: string;
  title: string;
  content: string;
  deadline: string;
  assignee: string;
  collabs: string[];
  cc: string[];
}

interface ApprovalState {
  items: ApprovalItem[];
  currentRole: RoleKey;
  currentUserId: string;
  currentUserName: string;
  currentView: ApprovalView;
  selectedId: number | null;
  detailSource: ApprovalView;
  todoFilter: ItemStatus | '' ;
  itemlistCat: string;
  itemlistAssignee: string;
  dashCat: string;
  dashAssignee: string;
  toast: string;
  /** 待审批/已处理的本地分组（审批 tab 内部用） */
  approvalTab: 'pending' | 'processed';

  currentUser: () => string;
  switchRole: (r: RoleKey) => void;
  syncAccount: () => void;
  setView: (v: ApprovalView) => void;
  selectItem: (id: number, src: ApprovalView) => void;
  setTodoFilter: (f: ItemStatus | '') => void;
  setItemlistFilter: (cat: string, assignee: string) => void;
  setDashFilter: (cat: string, assignee: string) => void;
  setApprovalTab: (t: 'pending' | 'processed') => void;
  refresh: () => void;
  setToast: (m: string) => void;

  urge: (id: number) => void;
  reassign: (id: number, target: string, reason: string, notifyOriginal: boolean) => void;
  forceCancel: (id: number, reason: string) => void;
  uploadEvidence: (id: number, type: string) => void;
  deleteEvidence: (id: number, idx: number) => void;
  complete: (id: number, note: string) => void;
  returnItem: (id: number, reason: string, detail: string) => void;
  claim: (id: number) => void;
  adjustApply: (id: number, newDate: string, reason: string) => void;
  revoke: (id: number) => void;
  cancelApply: (id: number, reason: string) => void;
  approveCancel: (id: number) => void;
  rejectCancel: (id: number) => void;
  approveAdjust: (id: number) => void;
  rejectAdjust: (id: number) => void;
  transfer: (id: number, target: string) => void;
  addItem: (form: NewItemForm) => void;
}

function addTimeline(item: ApprovalItem, actor: string, action: string, type = ''): ApprovalItem {
  const entry: TimelineEntry = {
    actor,
    action,
    time: (() => {
      const d = new Date();
      return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })(),
    type,
  };
  return { ...item, timeline: [...item.timeline, entry] };
}

export const useApprovalStore = create<ApprovalState>((set, get) => {
  const doTransition = (
    id: number,
    to: ItemStatus | '__restore__',
    tlActor: string,
    tlAction: string,
    tlType = ''
  ): ApprovalItem | null => {
    const item = get().items.find((i) => i.id === id);
    if (!item) return null;
    const res = applyTransition(item, to);
    if (!res.ok || !res.item) {
      if (res.error) set({ toast: res.error });
      return null;
    }
    let updated = res.item;
    if (tlAction) updated = addTimeline(updated, tlActor, tlAction, tlType);
    set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)) }));
    return updated;
  };

  const me = () => get().currentUserName;

  const appInit = useStore.getState();
  const initAcc = appInit.accounts.find((a) => a.id === appInit.currentUserId);
  const initName = initAcc ? initAcc.name : '陈总';
  const initRole: RoleKey = appInit.currentUserId === MANAGER_ID ? 'manager' : 'employee';

  return {
    items: buildSeedItems(),
    currentRole: initRole,
    currentUserId: appInit.currentUserId,
    currentUserName: initName,
    currentView: 'itemlist',
    selectedId: null,
    detailSource: 'itemlist',
    todoFilter: '',
    itemlistCat: '',
    itemlistAssignee: '',
    dashCat: '',
    dashAssignee: '',
    toast: '',
    approvalTab: 'pending',

    currentUser: me,

    switchRole: (r) => set({ currentRole: r, selectedId: null }),
    syncAccount: () => {
      const st = useStore.getState();
      const acc = st.accounts.find((a) => a.id === st.currentUserId);
      const name = acc ? acc.name : '陈总';
      const role: RoleKey = st.currentUserId === MANAGER_ID ? 'manager' : 'employee';
      set({ currentUserId: st.currentUserId, currentUserName: name, currentRole: role, selectedId: null });
    },
    setView: (v) => set({ currentView: v }),
    selectItem: (id, src) => set({ selectedId: id, detailSource: src, currentView: 'detail' }),
    setTodoFilter: (f) => set({ todoFilter: f }),
    setItemlistFilter: (cat, assignee) => set({ itemlistCat: cat, itemlistAssignee: assignee }),
    setDashFilter: (cat, assignee) => set({ dashCat: cat, dashAssignee: assignee }),
    setApprovalTab: (t) => set({ approvalTab: t }),
    refresh: () => set((s) => ({ items: refreshOverdueStatus(s.items) })),
    setToast: (m) => set({ toast: m }),

    urge: (id) => {
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      const updated = addTimeline(
        { ...item, urgeCount: item.urgeCount + 1 },
        me(),
        `催办了该事项（第${item.urgeCount + 1}次）`,
        'warning'
      );
      set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)), toast: `已发送催办提醒给${item.assignee}` }));
    },

    reassign: (id, target, reason, notifyOriginal) => {
      const item = get().items.find((i) => i.id === id);
      if (!item || !target || !reason) {
        set({ toast: '请选择新责任人与改派原因' });
        return;
      }
      const updated = doTransition(
        id,
        STATUS.DISPATCHED,
        '管理者',
        `改派事项：${item.assignee} → ${target}（${reason}）`,
        'warning'
      );
      if (!updated) return;
      const finalItem = { ...updated, assignee: target, manager: getManagerOf(target) };
      set((s) => ({
        items: s.items.map((i) => (i.id === id ? finalItem : i)),
        toast: `已改派给${target}`,
      }));
    },

    forceCancel: (id, reason) => {
      if (!reason) {
        set({ toast: '请填写作废原因' });
        return;
      }
      const ok = doTransition(id, STATUS.CANCELLED, '管理者', `强制作废（原因：${reason}）`, 'overdue');
      if (ok) set({ toast: '已强制作废' });
    },

    uploadEvidence: (id, type) => {
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      if (item.evidence.length >= 5) {
        set({ toast: '最多上传5个文件' });
        return;
      }
      const icon = type.indexOf('📷') >= 0 ? '📷' : type.indexOf('🖼️') >= 0 ? '🖼️' : '📄';
      let updated: ApprovalItem = { ...item, evidence: [...item.evidence, { icon }] };
      const un = me();
      if (item.collabEvidence && item.collaborators.indexOf(un) >= 0) {
        updated = { ...updated, collabEvidence: { ...item.collabEvidence, [un]: true } };
      }
      updated = addTimeline(updated, un, '上传了佐证材料', 'warning');
      set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)), toast: '佐证材料已上传' }));
    },

    deleteEvidence: (id, idx) => {
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      const evidence = item.evidence.filter((_, i) => i !== idx);
      const updated = { ...item, evidence, version: (item.version || 0) + 1 };
      set((s) => ({ items: s.items.map((i) => (i.id === id ? updated : i)), toast: '已删除' }));
    },

    complete: (id, note) => {
      const ok = doTransition(
        id,
        STATUS.DONE,
        me(),
        `标记完成${note ? `（说明：${note}）` : ''}`,
        'done'
      );
      if (ok) set({ toast: '已标记完成' });
    },

    returnItem: (id, reason, detail) => {
      if (!reason || !detail) {
        set({ toast: '请选择退回原因并填写详细原因' });
        return;
      }
      const ok = doTransition(id, STATUS.DISPATCHED, me(), `退回事项（原因：${reason} - ${detail}）`, 'warning');
      if (ok) set({ toast: '已退回事项' });
    },

    claim: (id) => {
      const ok = doTransition(id, STATUS.PROGRESS, me(), '认领了事项', 'done');
      if (ok) set({ toast: `已认领，开始处理「${get().items.find((i) => i.id === id)?.title}」` });
    },

    adjustApply: (id, newDate, reason) => {
      if (!newDate || !reason) {
        set({ toast: '请选择新日期并填写调整原因' });
        return;
      }
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      const updated = addTimeline(
        { ...item, pendingDeadline: newDate, pendingDeadlineApplicant: me(), pendingDeadlineReason: reason },
        me(),
        `申请调整截止日期：${item.deadline} → ${newDate}（原因：${reason}）`,
        'warning'
      );
      set((s) => ({
        items: s.items.map((i) => (i.id === id ? { ...updated, version: (updated.version || 0) + 1 } : i)),
        toast: '调整申请已提交，等待管理者审批',
      }));
    },

    revoke: (id) => {
      const ok = doTransition(id, STATUS.REVOKED, me(), '撤销了事项', 'overdue');
      if (ok) set({ toast: '已撤销事项' });
    },

    cancelApply: (id, reason) => {
      if (!reason) {
        set({ toast: '请填写作废原因' });
        return;
      }
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      const updated = doTransition(
        id,
        STATUS.PENDING_CANCEL,
        me(),
        `申请作废（原因：${reason}）`,
        'warning'
      );
      if (!updated) return;
      const finalItem: ApprovalItem = { ...updated, cancelApplicant: me(), cancelReason: reason };
      set((s) => ({ items: s.items.map((i) => (i.id === id ? finalItem : i)), toast: '作废申请已提交，等待管理者审批' }));
    },

    approveCancel: (id) => {
      const ok = doTransition(id, STATUS.CANCELLED, '管理者', '批准作废申请', 'overdue');
      if (!ok) return;
      const item = get().items.find((i) => i.id === id);
      if (item) {
        const finalItem: ApprovalItem = { ...item, cancelApplicant: undefined, cancelReason: undefined, prevStatus: undefined };
        set((s) => ({ items: s.items.map((i) => (i.id === id ? finalItem : i)), toast: '已批准作废' }));
      }
    },

    rejectCancel: (id) => {
      const ok = doTransition(id, '__restore__', '管理者', '驳回作废申请', '');
      if (!ok) return;
      const item = get().items.find((i) => i.id === id);
      if (item) {
        const finalItem: ApprovalItem = { ...item, cancelApplicant: undefined, cancelReason: undefined, prevStatus: undefined };
        set((s) => ({ items: s.items.map((i) => (i.id === id ? finalItem : i)), toast: '已驳回作废申请' }));
      }
    },

    approveAdjust: (id) => {
      const item = get().items.find((i) => i.id === id);
      if (!item || !item.pendingDeadline) return;
      const od = item.deadline;
      const updated = addTimeline(
        { ...item, deadline: item.pendingDeadline },
        '管理者',
        `批准截止调整：${od} → ${item.pendingDeadline}`,
        ''
      );
      const finalItem: ApprovalItem = {
        ...updated,
        version: (updated.version || 0) + 1,
        pendingDeadline: undefined,
        pendingDeadlineApplicant: undefined,
        pendingDeadlineReason: undefined,
      };
      set((s) => ({ items: s.items.map((i) => (i.id === id ? finalItem : i)), toast: '已批准截止调整' }));
    },

    rejectAdjust: (id) => {
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      const updated = addTimeline(item, '管理者', '驳回截止调整申请', '');
      const finalItem: ApprovalItem = {
        ...updated,
        version: (updated.version || 0) + 1,
        pendingDeadline: undefined,
        pendingDeadlineApplicant: undefined,
        pendingDeadlineReason: undefined,
      };
      set((s) => ({ items: s.items.map((i) => (i.id === id ? finalItem : i)), toast: '已驳回截止调整' }));
    },

    transfer: (id, target) => {
      if (!target) {
        set({ toast: '请选择新管理者' });
        return;
      }
      const item = get().items.find((i) => i.id === id);
      if (!item) return;
      const updated = addTimeline(
        { ...item, manager: target },
        me(),
        `转交管理权：${item.manager} → ${target}`,
        ''
      );
      set((s) => ({
        items: s.items.map((i) => (i.id === id ? { ...updated, version: (updated.version || 0) + 1 } : i)),
        toast: `管理权已转交给${target}`,
      }));
    },

    addItem: (form) => {
      if (!form.category || !form.title.trim() || !form.content.trim() || !form.deadline || !form.assignee) {
        set({ toast: '请完整填写类别、标题、内容、截止日期与责任人' });
        return;
      }
      const t = (() => {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      })();
      const maxId = get().items.reduce((m, i) => Math.max(m, i.id), 0);
      const collabEvidence: Record<string, boolean> = {};
      form.collabs.forEach((n) => (collabEvidence[n] = false));
      const newItem: ApprovalItem = {
        id: maxId + 1,
        title: form.title.trim(),
        category: form.category,
        content: form.content.trim(),
        status: STATUS.DISPATCHED,
        assignee: form.assignee,
        collaborators: form.collabs.slice(),
        creator: me(),
        cc: form.cc.slice(),
        deadline: form.deadline,
        createdDate: t,
        urgeCount: 0,
        evidence: [],
        collabEvidence,
        timeline: [
          { actor: me(), action: '创建了事项', time: t.slice(5), type: '' },
          {
            actor: me(),
            action: `提交分发，推送至${form.assignee}${form.collabs.length > 0 ? '、' + form.collabs.join('、') : ''}`,
            time: t.slice(5),
            type: '',
          },
        ],
        manager: getManagerOf(form.assignee),
        version: 1,
      };
      set((s) => ({ items: [...s.items, newItem], toast: '事项已提交分发', currentView: get().currentRole === 'manager' ? 'itemlist' : 'todo' }));
    },
  };
});
