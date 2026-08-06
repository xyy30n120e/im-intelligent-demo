import React from 'react';
import { useAIStore, AITabType } from '../store/aiStore';
import { useStore } from '../store/useStore';

type TabDef = {
  key: Exclude<AITabType, null>;
  faIcon: string;
  iconClass: string;
  label: string;
  desc: string;
};

const TabButton: React.FC<{
  tab: TabDef;
  badge: number;
  isActive: boolean;
  onClick: () => void;
}> = ({ tab, badge, isActive, onClick }) => (
  <div
    onClick={onClick}
    className={`sub-tag-item ${isActive ? 'active' : ''}`}
  >
    <div className={`sub-icon ${tab.iconClass}`}>
      <i className={tab.faIcon}></i>
    </div>
    <div className="sub-info">
      <div className="sub-name">{tab.label}</div>
      <div className="sub-desc">{tab.desc}</div>
    </div>
    {badge > 0 && (
      <span className="sub-badge">{badge > 99 ? '99+' : badge}</span>
    )}
    <div className="sub-arrow"><i className="fas fa-chevron-right"></i></div>
  </div>
);

const AiMiddleBar: React.FC = () => {
  const activeAITab = useAIStore((s) => s.activeAITab);
  const badgeCounts = useAIStore((s) => s.badgeCounts);
  const setAITab = useAIStore((s) => s.setAITab);
  const currentUserId = useStore((s) => s.currentUserId);
  const myBadge = badgeCounts[currentUserId] || { ai: 0, schedule: 0, todo: 0, approval: 0, request: 0 };

  const tabs: TabDef[] = [
    { key: 'ai', faIcon: 'fas fa-robot', iconClass: 'purple', label: 'AI 助手', desc: '智能会议 · 待办提醒 · 自动摘要' },
    { key: 'schedule', faIcon: 'fas fa-calendar-alt', iconClass: 'green', label: '日程', desc: '智能排期 · 会议管理 · 提醒' },
    { key: 'todo', faIcon: 'fas fa-list-check', iconClass: 'orange', label: '待办', desc: '我的任务 · 待我审批 · 统一待办' },
    { key: 'request', faIcon: 'fas fa-clipboard-list', iconClass: 'blue', label: '需求', desc: '需求池 · 优先级排序 · 迭代规划' },
    { key: 'approval', faIcon: 'fas fa-file-signature', iconClass: 'pink', label: '审批', desc: '流程审批 · 待办处理 · 记录追踪' },
  ];

  return (
    <div className="w-[260px] bg-white border-r border-gray-200 flex flex-col">
      {/* 头部：参考范本 middle-header */}
      <div className="middle-header">
        <h3>AI 功能</h3>
        <span className="header-action"><i className="fas fa-cog"></i> 管理</span>
      </div>

      {/* Tab 列表：参考范本 sub-tag-item */}
      <div className="middle-list">
        {tabs.map((tab) => (
          <TabButton
            key={tab.key}
            tab={tab}
            badge={myBadge[tab.key] || 0}
            isActive={activeAITab === tab.key}
            onClick={() => setAITab(tab.key)}
          />
        ))}
      </div>
    </div>
  );
};

export default AiMiddleBar;
