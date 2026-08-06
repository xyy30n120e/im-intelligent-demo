import type { FileKindKey } from '../data/mockData';

// WPS 风格配色：文字蓝 / 表格绿 / 演示橙 / PDF 红 / 代码深灰 / 图片青 / 默认灰
const KIND_COLOR: Record<FileKindKey, string> = {
  word: '#2B7FE3',
  text: '#3D8BD4',
  code: '#2D3A4B',
  image: '#00B0A8',
  excel: '#1FA463',
  ppt: '#F5651A',
  pdf: '#E64340',
  default: '#9AA5B1',
};

function Glyph({ kind }: { kind: FileKindKey }) {
  switch (kind) {
    case 'excel':
      return (
        <g stroke="white" strokeWidth="1" fill="none">
          <rect x="6.3" y="11.3" width="11.4" height="9.4" rx="1" />
          <line x1="10.3" y1="11.3" x2="10.3" y2="20.7" />
          <line x1="14" y1="11.3" x2="14" y2="20.7" />
          <line x1="6.3" y1="15.1" x2="17.7" y2="15.1" />
          <line x1="6.3" y1="17.9" x2="17.7" y2="17.9" />
        </g>
      );
    case 'ppt':
      return (
        <>
          <rect x="5.8" y="10.2" width="12.4" height="10.4" rx="1" fill="white" />
          <text x="12" y="18.4" textAnchor="middle" fontSize="8" fontWeight={700} fill={KIND_COLOR.ppt} fontFamily="Arial, sans-serif">
            P
          </text>
        </>
      );
    case 'pdf':
      return (
        <text x="12" y="17.4" textAnchor="middle" fontSize="5" fontWeight={700} fill="white" fontFamily="Arial, sans-serif">
          PDF
        </text>
      );
    case 'image':
      return (
        <>
          <rect x="6.3" y="10.8" width="11.4" height="10.4" rx="1" fill="white" />
          <circle cx="9.6" cy="13.8" r="1.2" fill={KIND_COLOR.image} />
          <path d="M6.6 20 L10.8 16 L13.3 18.4 L15.3 16.6 L17.4 20 Z" fill={KIND_COLOR.image} />
        </>
      );
    case 'code':
      return (
        <text x="12" y="17.4" textAnchor="middle" fontSize="5.2" fontWeight={700} fill="white" fontFamily="monospace">
          {'</>'}
        </text>
      );
    case 'word':
    case 'text':
    case 'default':
    default:
      return (
        <g fill="white">
          <rect x="7" y="12.5" width="10" height="1.6" rx="0.8" />
          <rect x="7" y="15.3" width="10" height="1.6" rx="0.8" />
          <rect x="7" y="18.1" width="6" height="1.6" rx="0.8" />
        </g>
      );
  }
}

export function FileIcon({ kind, size = 28 }: { kind: FileKindKey; size?: number }) {
  const color = KIND_COLOR[kind];
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="flex-shrink-0">
      <path d="M13 2 L20 9 V19 A2 2 0 0 1 18 21 H6 A2 2 0 0 1 4 19 V5 A2 2 0 0 1 6 3 H13 Z" fill={color} />
      <path d="M13 2 L20 9 H13 Z" fill="rgba(0,0,0,0.18)" />
      <Glyph kind={kind} />
    </svg>
  );
}
