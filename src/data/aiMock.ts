import type { FileKindKey } from './mockData';

export interface AIMessage {
  id: string;
  sender: string;
  time: string;
  content: string;
}

export interface AICardFileMeta {
  name: string;
  size: number;
  category: 'text' | 'image' | 'doc';
  fileType: string;
  /** WPS 风格图标类型（按扩展名映射） */
  kind: FileKindKey;
  /** 展示用中文类型名，如 "PDF 文档" */
  label: string;
  /** 文本文件读取出的完整内容（仅 text 类有，用于预览） */
  content?: string;
  /** 文本文件读取出的内容片段（仅 text 类有） */
  snippet?: string;
  /** 图片 / PDF 预览的 dataURL（image 或 pdf 类有） */
  dataUrl?: string;
  /** 该文件自身的 AI 概要（由大模型生成或文本前 200 字兜底），显示在附件条目下方 */
  summary?: string;
}

export interface AICard {
  id: string;
  type: 'todo' | 'schedule' | 'notification' | 'request' | 'file';
  source: string;
  /** 需求提出人（request 卡片专用，缺省回退 source） */
  applicant?: string;
  time: string;
  task?: string;
  deadline?: string;
  completed?: boolean;
  event?: string;
  summary?: string;
  /** 需求/问题描述（request 卡片专用，表格中展示） */
  description?: string;
  /** 上线版本（request 卡片专用，如 10.1.2（4月2日）） */
  version?: string;
  /** 需求/问题类型（request 卡片专用）：仅 需求(feature) / Bug(bug) */
  issueType?: 'bug' | 'feature';
  /** 备注（request 卡片专用） */
  remark?: string;
  /** 状态：日程类用 confirmed/pending；需求类用 resolved(已解决)/following(跟进中) */
  status?: 'confirmed' | 'pending' | 'resolved' | 'following';
  location?: string;
  participants?: string;
  sourceConversationId?: string;
  sourceMessageId?: string;
  /** 卡片内展示的时间（日程的会议时间/待办不适用） */
  eventTime?: string;
  messages: AIMessage[];
  disabled?: boolean;
  priority?: 'high' | 'medium' | 'low';
  /** 接收该卡片的 userId 列表；为空/未定义表示对所有人可见（兼容历史 mock 数据） */
  recipients?: string[];
  /** 文件卡片 / 附件的元信息列表 */
  fileMetas?: AICardFileMeta[];
  /** 上传文件的内容概要（由大模型生成或文本前 200 字兜底），已不再于卡片正文展示；文件原文通过点击附件弹窗预览 */
  fileSummary?: string;
  /** 静默卡片：仅出现在需求表格中，不在 AI 助手主列表生成 AI 卡片（用于预置的示例需求） */
  silent?: boolean;
}

export interface ScheduleItem {
  id: string;
  time: string;
  event: string;
  location: string;
  source: string;
  status: 'confirmed' | 'pending';
  detail?: string;
  participants?: string;
  /** 接收该日程的 userId 列表；为空/未定义表示对所有人可见 */
  recipients?: string[];
  /** 日程附件（与 AI 卡片 fileMetas 同结构，可手动上传或由 AI 卡片一键导入） */
  attachments?: AICardFileMeta[];
}

export interface TodoItem {
  id: string;
  task: string;
  deadline: string;
  source: string;
  completed: boolean;
  detail?: string;
  /** 接收该待办的 userId 列表；为空/未定义表示对所有人可见 */
  recipients?: string[];
  /** 来自聊天时记录来源会话与消息，便于从待办跳回原消息 */
  sourceConversationId?: string;
  sourceMessageId?: string;
}

export const aiCards: AICard[] = [
  {
    id: 'ai-2',
    type: 'schedule',
    source: '新媒体成长研习小组',
    event: '季度规划会议',
    summary: '周四15:00 小会议室 - 季度规划会议',
    status: 'confirmed',
    location: '3楼会议室',
    participants: '王雪瑶、李明轩、陈总',
    time: '8月3日 10:46',
    eventTime: '7月2日 周四 15:00',
    sourceConversationId: '1',
    sourceMessageId: 'm1',
    priority: 'high',
    messages: [
      { id: 'ai-m8', sender: '陈总', time: '7月1日 09:00', content: '周四下午开会讨论年度规划，大家预留时间' },
      { id: 'ai-m9', sender: '王雪瑶', time: '7月1日 09:05', content: '收到，具体几点？' },
      { id: 'ai-m10', sender: '陈总', time: '7月1日 09:10', content: '下午15:00，在3楼小会议室' },
      { id: 'ai-m11', sender: '李明轩', time: '7月1日 09:15', content: '好的，我准备一下' },
      { id: 'ai-m12', sender: '陈总', time: '7月1日 09:20', content: '请大家提前准备上周的运营数据和下季度计划' },
    ],
  },
  {
    id: 'ai-1',
    type: 'todo',
    source: '新媒体成长研习小组',
    time: '7月1日 10:46',
    task: '准备上周运营数据',
    deadline: '7月2日 周四 15:00',
    completed: true,
    sourceConversationId: '1',
    sourceMessageId: 'm5',
    priority: 'high',
    messages: [
      { id: 'ai-m1', sender: '陈总', time: '7月1日 10:46', content: '@王雪瑶 @李明轩 年度规划PPT需要周四前完成' },
      { id: 'ai-m2', sender: '王雪瑶', time: '7月1日 10:32', content: '好的，我正在整理数据部分' },
      { id: 'ai-m3', sender: '李明轩', time: '7月1日 10:34', content: '我负责的运营数据分析已经差不多了' },
      { id: 'ai-m4', sender: '陈总', time: '7月1日 10:36', content: '周四下午15:00开会前完成终稿，大家加油' },
      { id: 'ai-m5', sender: '陈总', time: '7月1日 10:38', content: 'PPT模板我已经上传到共享盘了' },
      { id: 'ai-m6', sender: '王雪瑶', time: '7月1日 10:40', content: '收到，我去下载模板' },
      { id: 'ai-m7', sender: '李明轩', time: '7月1日 10:42', content: '好的，我准备一下' },
    ],
  },
  {
    id: 'ai-req-default-bug',
    type: 'request',
    silent: true,
    source: '技术反馈群',
    task: '【网页端】群聊内@成员时，显示app昵称而非群备注',
    description: '【网页端】群聊内@成员时，显示app昵称而非群备注',
    issueType: 'bug',
    version: '10.2.3',
    status: 'resolved',
    priority: 'medium',
    time: '8月3日 14:20',
    applicant: '行总',
    recipients: ['c2', 'c1'],
    sourceConversationId: '6',
    sourceMessageId: 'r-bug',
    messages: [],
  },
  {
    id: 'ai-req-default-feature',
    type: 'request',
    silent: true,
    source: '产品需求评审群',
    task: '【安卓】创建群聊页面添加好友搜索框，支持搜索选择好友',
    description: '【安卓】创建群聊页面添加好友搜索框，支持搜索选择好友',
    issueType: 'feature',
    version: '10.2.3',
    status: 'resolved',
    priority: 'medium',
    time: '8月3日 14:25',
    applicant: '王雪瑶',
    recipients: ['c2', 'c1'],
    sourceConversationId: '3',
    sourceMessageId: 'r-feature',
    messages: [],
  },
];

export const scheduleItems: ScheduleItem[] = [];

export const todoItems: TodoItem[] = [
  { id: 't1', task: '准备上周运营数据', deadline: '7月2日 周四 15:00', source: '新媒体成长研习小组', completed: true, detail: '准备上周运营数据的终稿，包括数据分析、目标设定、预算规划等部分。模板已上传至共享盘。' },
];
