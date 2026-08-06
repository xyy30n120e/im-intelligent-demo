import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAIStore } from '../store/aiStore';
import { accounts } from '../data/mockData';

const LeftBar: React.FC = () => {
  const [showAccountMenu, setShowAccountMenu] = React.useState(false);
  const accountMenuRef = React.useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const currentUserId = useStore((s) => s.currentUserId);
  const setCurrentUserId = useStore((s) => s.setCurrentUserId);
  const aiNavBadge = useAIStore((s) => s.aiNavBadge);
  const clearAiNavBadge = useAIStore((s) => s.clearAiNavBadge);

  const isAiPage = location.pathname === '/ai';

  // \u70b9\u51fb\u5916\u90e8\u5173\u95ed\u8d26\u53f7\u5207\u6362\u83dc\u5355
  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target as Node)) {
        setShowAccountMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="w-16 bg-[#f7f8fa] border-r border-gray-200 flex flex-col items-center py-3 gap-1">
      {/* 用户头像 */}
      <div className="relative">
        <button
          onClick={() => setShowAccountMenu(!showAccountMenu)}
          className="w-10 h-10 rounded-full bg-primary-500 flex items-center justify-center text-white text-base font-bold cursor-pointer mb-2 ring-2 ring-white shadow-sm">
          {accounts.find(a => a.id === currentUserId)?.name.charAt(0) || "?"}
        </button>
        {showAccountMenu && (
          <div ref={accountMenuRef} className="absolute left-full ml-2 top-0 bg-white rounded-xl shadow-xl border border-gray-200 py-1 w-28 z-50">
            {accounts.map(acc => (
              <button
                key={acc.id}
                onClick={() => {
                  setCurrentUserId(acc.id);
                  setShowAccountMenu(false);
                }}
                className={"w-full px-3 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2 " + (acc.id === currentUserId ? "bg-primary-50 font-medium text-primary-700" : "text-gray-700")}>
                <span className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-600 ring-1 ring-white">{acc.name.charAt(0)}</span>
                <span className="whitespace-nowrap">{acc.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>






      {/* 聊天 */}
      <button
        onClick={() => {
          setActiveTab('chat');
          navigate('/');
        }}
        className={`h-13 w-12 flex items-center justify-center rounded-lg transition-colors ${
          activeTab === 'chat' && !isAiPage
            ? 'bg-sidebar-active text-primary-600'
            : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'
        }`}
        style={{ height: '52px' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>

      {/* 联系人 */}
      <button
        onClick={() => {
          setActiveTab('contacts');
          navigate('/');
        }}
        className={`h-13 w-12 flex items-center justify-center rounded-lg transition-colors ${
          activeTab === 'contacts' && !isAiPage
            ? 'bg-sidebar-active text-primary-600'
            : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'
        }`}
        style={{ height: '52px' }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
          <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </button>

      {/* AI */}
      <button
        onClick={() => {
          clearAiNavBadge();
          useAIStore.getState().setAITab('ai');
          navigate('/ai');
        }}
        className={`h-13 w-[52px] flex items-center justify-center rounded-lg transition-colors ${
          isAiPage
            ? 'bg-sidebar-active text-primary-600'
            : 'text-gray-400 hover:bg-gray-200 hover:text-gray-600'
        }`}
        style={{ height: '52px' }}
      >
        <div className="relative">
          <span className="px-2 py-1 bg-gradient-to-r from-purple-400 to-pink-400 text-white text-xs rounded-full font-medium">
            AI
          </span>
          {(aiNavBadge[currentUserId] || 0) > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full" />
          )}
        </div>
      </button>



      {/* 设置 */}
      <button className="mt-auto w-10 h-10 flex items-center justify-center rounded-lg transition-colors text-gray-400 hover:bg-gray-200 hover:text-gray-600" title="设置">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m3.08 3.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m3.08-3.08l4.24-4.24M19.78 19.78l-4.24-4.24m-3.08-3.08l-4.24-4.24"/>
        </svg>
      </button>
    </div>
  );
};

export default LeftBar;

