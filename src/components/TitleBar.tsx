import React from 'react';

const TitleBar: React.FC = () => {
  const handleMinimize = () => window.electronAPI?.minimize();
  const handleMaximize = () => window.electronAPI?.maximize();
  const handleClose = () => window.electronAPI?.close();

  return (
    <div className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-4 drag-region select-none">
      <div className="flex items-center gap-2 pl-4">
        <i className="far fa-comment-dots" style={{ color: '#1e3a8a', fontSize: '19px', marginRight: '8px', opacity: 0.85 }}></i>
        <span className="text-base font-bold text-gray-800">第一现场 IM</span>
      </div>
      <div className="flex items-center gap-1 no-drag">
        <button
          onClick={handleMinimize}
          className="w-11 h-11 flex items-center justify-center hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="1" y="5.5" width="10" height="1" rx="0.5" fill="currentColor"/>
          </svg>
        </button>
        <button
          onClick={handleMaximize}
          className="w-11 h-11 flex items-center justify-center hover:bg-gray-100 rounded-lg transition-colors text-gray-500"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <rect x="2" y="2" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.2" fill="none"/>
          </svg>
        </button>
        <button
          onClick={handleClose}
          className="w-11 h-11 flex items-center justify-center hover:bg-red-500 hover:text-white rounded-lg transition-colors text-gray-500"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default TitleBar;
