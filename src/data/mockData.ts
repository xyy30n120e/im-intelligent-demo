export type FileCategory = 'text' | 'image' | 'doc';

export type FileKindKey =
  | 'word' | 'text' | 'code' | 'image' | 'excel' | 'ppt' | 'pdf' | 'default';

export interface FileKindInfo {
  category: FileCategory;
  /** WPS 风格图标类型（按扩展名映射，不同类型不同图标） */
  kind: FileKindKey;
  /** 展示用中文类型名，如 "PDF 文档" */
  label: string;
}

// 扩展名（小写，含点）→ 文件类型信息
const FILE_KIND_MAP: Record<string, FileKindInfo> = {
  // ── 文本 / 代码类 ──
  '.txt':   { category: 'text', kind: 'word', label: '文本文件' },
  '.md':    { category: 'text', kind: 'word', label: 'Markdown' },
  '.markdown': { category: 'text', kind: 'word', label: 'Markdown' },
  '.csv':   { category: 'text', kind: 'excel', label: 'CSV 表格' },
  '.json':  { category: 'text', kind: 'code', label: 'JSON' },
  '.log':   { category: 'text', kind: 'text', label: '日志文件' },
  '.yml':   { category: 'text', kind: 'text', label: 'YAML' },
  '.yaml':  { category: 'text', kind: 'text', label: 'YAML' },
  '.xml':   { category: 'text', kind: 'code', label: 'XML' },
  '.html':  { category: 'text', kind: 'code', label: 'HTML' },
  '.htm':   { category: 'text', kind: 'code', label: 'HTML' },
  '.js':    { category: 'text', kind: 'code', label: 'JS 代码' },
  '.jsx':   { category: 'text', kind: 'code', label: 'JSX 代码' },
  '.ts':    { category: 'text', kind: 'code', label: 'TS 代码' },
  '.tsx':   { category: 'text', kind: 'code', label: 'TSX 代码' },
  '.css':   { category: 'text', kind: 'code', label: 'CSS' },
  '.py':    { category: 'text', kind: 'code', label: 'Python 代码' },
  // ── 图片类 ──
  '.png':   { category: 'image', kind: 'image', label: 'PNG 图片' },
  '.jpg':   { category: 'image', kind: 'image', label: 'JPG 图片' },
  '.jpeg':  { category: 'image', kind: 'image', label: 'JPG 图片' },
  '.gif':   { category: 'image', kind: 'image', label: 'GIF 图片' },
  '.webp':  { category: 'image', kind: 'image', label: 'WebP 图片' },
  // ── 文档类 ──
  '.pdf':   { category: 'doc', kind: 'pdf', label: 'PDF 文档' },
  '.doc':   { category: 'doc', kind: 'word', label: 'Word 文档' },
  '.docx':  { category: 'doc', kind: 'word', label: 'Word 文档' },
  '.xls':   { category: 'doc', kind: 'excel', label: 'Excel 表格' },
  '.xlsx':  { category: 'doc', kind: 'excel', label: 'Excel 表格' },
  '.ppt':   { category: 'doc', kind: 'ppt', label: 'PPT 演示' },
  '.pptx':  { category: 'doc', kind: 'ppt', label: 'PPT 演示' },
};

/** 根据文件名 + MIME 推断文件类型（图标 / 分类 / 中文名） */
export function resolveFileKind(fileName: string, mime: string): FileKindInfo {
  const ext = '.' + (fileName.split('.').pop() || '').toLowerCase();
  const mapped = FILE_KIND_MAP[ext];
  if (mapped) return mapped;
  if (mime.startsWith('image/')) return { category: 'image', kind: 'image', label: '图片' };
  if (mime.startsWith('text/')) return { category: 'text', kind: 'text', label: '文本文件' };
  if (mime === 'application/pdf') return { category: 'doc', kind: 'pdf', label: 'PDF 文档' };
  return { category: 'doc', kind: 'default', label: '文件' };
}

export interface FileMeta {
  name: string;
  size: number;
  fileType: string;
  category: FileCategory;
  /** WPS 风格图标类型（按扩展名映射） */
  kind: FileKindKey;
  /** 展示用中文类型名，如 "PDF 文档" */
  label: string;
  /** 文本文件读取出的内容（仅 text 类有） */
  content?: string;
  /** 图片预览的 dataURL（仅 image 类有） */
  dataUrl?: string;
}

export interface Message {
  id: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  type: 'text' | 'image' | 'video' | 'card' | 'file';
  isMe: boolean;
  fileMetas?: FileMeta[];
}

export interface Conversation {
  id: string;
  name: string;
  avatar: string;
  lastMessage: string;
  time: string;
  unread: number;
  /** 群成员 userId 列表，用于「@所有人 / 无@时全员接收」的 AI 卡片路由 */
  members: string[];
}

export interface Contact {
  id: string;
  name: string;
  avatar: string;
  status: 'online' | 'offline' | 'away';
  /** 头衔 / 职务 */
  title: string;
  /** 电话 */
  phone: string;
  /** 邮箱 */
  email: string;
  /** 个人简介 */
  bio: string;
}

export const conversations: Conversation[] = [
  {
    id: '1',
    name: '新媒体成长研习小组',
    avatar: '',
    lastMessage: '王雪瑶：收到',
    time: '7月1日10:47',
    unread: 0,
    members: ['c1', 'c2', 'c4', 'c3'],
  },
  {
    id: '2',
    name: '视频审核群',
    avatar: '',
    lastMessage: 'AI助手：已为你生成AI审核卡片',
    time: '7月10日14:32',
    unread: 0,
    members: ['c2', 'c4', 'c3'],
  },
];

export const contacts: Contact[] = [
  {
    id: 'c1',
    name: '陈总',
    avatar: '',
    status: 'online',
    title: '首席执行官 (CEO)',
    phone: '+86 138 0011 2233',
    email: 'chenzong@nexus.com',
    bio: '公司战略与整体业务负责人，关注新媒体增长与品牌长期价值。',
  },
  {
    id: 'c2',
    name: '王雪瑶',
    avatar: '',
    status: 'online',
    title: '新媒体运营总监',
    phone: '+86 138 0022 3344',
    email: 'xueyao.wang@nexus.com',
    bio: '8 年内容运营经验，擅长短视频选题策划与矩阵账号增长。',
  },
  {
    id: 'c4',
    name: '张三',
    avatar: '',
    status: 'online',
    title: '产品设计师',
    phone: '+86 138 0033 4455',
    email: 'san.zhang@nexus.com',
    bio: '负责产品视觉与交互设计，主导设计系统从 0 到 1 的搭建。',
  },
  {
    id: 'c3',
    name: '李明轩',
    avatar: '',
    status: 'online',
    title: '前端开发工程师',
    phone: '+86 138 0044 5566',
    email: 'mingxuan.li@nexus.com',
    bio: '专注 Web 前端工程化与性能优化，热爱开源与新技术探索。',
  },
];

export const currentUser = { id: 'c2', name: '王雪瑶' };

export const accounts = [
  { id: 'c1', name: '陈总' },
  { id: 'c2', name: '王雪瑶' },
  { id: 'c4', name: '张三' },
  { id: 'c3', name: '李明轩' },
];

const messageData: Record<string, Message[]> = {
  '1': [
    { id: 'm1', senderId: 'u1', senderName: '陈总', content: '@王雪瑶 @李明轩 周四下午15：00开会', timestamp: '7月1日10:36', type: 'text', isMe: false },
    { id: 'm2', senderId: 'u2', senderName: '王雪瑶', content: '好的，我准备一下', timestamp: '7月1日10:38', type: 'text', isMe: true },
    { id: 'm3', senderId: 'u3', senderName: '李明轩', content: '好的，收到', timestamp: '7月1日10:40', type: 'text', isMe: false },
    { id: 'm4', senderId: 'u1', senderName: '陈总', content: '会议地点在3楼会议室', timestamp: '7月1日10:42', type: 'text', isMe: false },
    { id: 'm5', senderId: 'u1', senderName: '陈总', content: '请大家提前准备上周的运营数据', timestamp: '7月1日10:43', type: 'text', isMe: false },
    { id: 'm6', senderId: 'u3', senderName: '李明轩', content: '好的，我准备一下', timestamp: '7月1日10:45', type: 'text', isMe: false },
    { id: 'm7', senderId: 'u2', senderName: '王雪瑶', content: '收到', timestamp: '7月1日10:47', type: 'text', isMe: true },
  ],
  '2': [
    { id: 'g1', senderId: 'c2', senderName: '王雪瑶', content: '视频1 - 活动现场剪辑', timestamp: '7月10日14:20', type: 'video', isMe: true },
    { id: 'g2', senderId: 'c2', senderName: '王雪瑶', content: '视频2 - 采访片段', timestamp: '7月10日14:22', type: 'video', isMe: true },
    { id: 'g3', senderId: 'c2', senderName: '王雪瑶', content: '视频3 - 花絮集锦', timestamp: '7月10日14:25', type: 'video', isMe: true },
    { id: 'g4', senderId: 'c2', senderName: '王雪瑶', content: '@外新媒体李明轩 请一审', timestamp: '7月10日14:30', type: 'text', isMe: true },
    { id: 'g5', senderId: 'ai', senderName: 'AI助手', content: JSON.stringify({
      title: 'AI任务识别',
      fields: [
        { label: '任务', value: '视频审核' },
        { label: '申请人', value: '王雪瑶' },
        { label: '审核人', value: '李明轩' },
        { label: '当前环节', value: '待一审' }
      ],
      videos: [
        { name: '视频1 - 活动现场剪辑' },
        { name: '视频2 - 采访片段' },
        { name: '视频3 - 花絮集锦' }
      ]
    }), timestamp: '7月10日14:32', type: 'card', isMe: false },
  ],
};

export function getMessages(conversationId: string): Message[] {
  return messageData[conversationId] || [];
}

export function updateMessage(conversationId: string, messageId: string, updates: Partial<Message>): void {
  const msgs = messageData[conversationId];
  if (!msgs) return;
  const idx = msgs.findIndex(m => m.id === messageId);
  if (idx === -1) return;
  msgs[idx] = { ...msgs[idx], ...updates };
}

export function addMessage(conversationId: string, message: Message): void {
  if (!messageData[conversationId]) {
    messageData[conversationId] = [];
  }
  messageData[conversationId].push(message);
}

export function generateMessageId(): string {
  return 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
}

export function getCurrentTime(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return month + '月' + day + '日 ' + hours + ':' + minutes;
}

export function formatSize(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}



