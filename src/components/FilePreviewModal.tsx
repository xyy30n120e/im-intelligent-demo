import { useEffect } from 'react';
import type { AICardFileMeta } from '../data/aiMock';
import { formatSize } from '../data/mockData';
import { FileIcon } from './FileIcon';

export function FilePreviewModal({ file, onClose }: { file: AICardFileMeta | null; onClose: () => void }) {
  useEffect(() => {
    if (!file) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [file, onClose]);

  if (!file) return null;

  const { category, kind, label, name, size, content, snippet, dataUrl } = file;
  // word / excel / ppt / pdf 统一内联预览（与 PDF 相同方式）
  const canEmbed = category === 'doc' && !!dataUrl;
  const textContent = content || snippet;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-3xl max-h-[70vh] bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
          <FileIcon kind={kind} size={36} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900 truncate">{name}</div>
            <div className="text-xs text-gray-400">{label} · {formatSize(size)}</div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            title="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-auto bg-gray-50">
          {category === 'image' && dataUrl ? (
            <div className="flex items-center justify-center p-4">
              <img src={dataUrl} alt={name} className="max-w-full max-h-[52vh] object-contain rounded-lg" />
            </div>
          ) : canEmbed ? (
            <iframe src={dataUrl} title={name} className="w-full h-[52vh] border-0" />
          ) : category === 'text' && textContent ? (
            <pre className="p-5 text-sm text-gray-700 whitespace-pre-wrap break-words font-sans leading-relaxed">
              {textContent}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center h-full min-h-[40vh] text-center px-6">
              <FileIcon kind={kind} size={72} />
              <div className="mt-4 text-base font-medium text-gray-700">{name}</div>
              <div className="mt-1 text-sm text-gray-400">{label} · {formatSize(size)}</div>
              <div className="mt-4 text-sm text-gray-400 max-w-xs">
                该文件类型暂不支持在线预览，请在 WPS / Office 中打开查看。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
