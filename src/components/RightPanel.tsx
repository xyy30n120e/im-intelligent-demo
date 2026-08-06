import React, { useRef, useEffect } from 'react';
import { useStore } from '../store/useStore';
import { Message, FileMeta, formatSize, resolveFileKind } from '../data/mockData';
import { FileIcon } from './FileIcon';
import { FilePreviewModal } from './FilePreviewModal';
import { useAIStore } from '../store/aiStore';
import { analyzeChatMessage, generateItemId, getCurrentTimeStr, computeRecipients, NAME_TO_ID, buildScheduleTime, summarizeFileContent } from '../services/aiService';
import { IntentConfirmBar } from './IntentConfirmBar';
import { AICard } from '../data/aiMock';
import { addMessage, generateMessageId, getCurrentTime, contacts, type Contact } from '../data/mockData';

interface CardData {
  title: string;
  fields: { label: string; value: string }[];
  videos: { name: string }[];
}

// ── AI 审核卡片 ──
const ReviewCard: React.FC<{ data: CardData }> = ({ data }) => {
  return (
    <div className="w-[400px] rounded-2xl shadow-[0_2px_8px_rgba(0,0,0,0.06)] overflow-hidden border border-purple-100 bg-purple-50/30">
      {/* 卡片头部 */}
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-2">
        <div className="flex items-center justify-center flex-shrink-0 text-lg" style={{ width: "22px", height: "22px" }}>
          🤖
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-base font-semibold text-gray-900 leading-snug">{data.title}</span>
            <span className="text-[11px] font-medium text-purple-500 bg-purple-50 px-2 py-0.5 rounded whitespace-nowrap">AI识别</span>
          </div>
        </div>
      </div>

      {/* 字段列表 */}
      <div className="px-4 pt-1 pb-2.5 space-y-2">
        {data.fields.map((field, idx) => (
          <div key={idx} className="flex items-center gap-1.5 text-[13px]">
            <span className="flex-shrink-0 text-[11px]">
              {idx === 0 ? '📋' : idx === 1 ? '👤' : idx === 2 ? '👤' : '🔄'}
            </span>
            <span className="text-gray-400 flex-shrink-0">{field.label}：</span>
            <span className="text-gray-700 font-medium">{field.value}</span>
          </div>
        ))}
      </div>

      {/* 分割装饰线 */}
      <div className="mx-4 border-t border-dashed border-purple-100/60"></div>

      {/* 视频列表 */}
      <div className="px-4 py-2.5 space-y-1.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[11px] text-gray-400">📎</span>
          <span className="text-[11px] text-gray-400">关联视频</span>
        </div>
        {data.videos.map((video, idx) => (
          <div key={idx} className="flex items-center gap-3 rounded-lg px-3 py-2 border border-purple-100/40 bg-white/50">
            <div className="w-10 h-10 rounded-lg bg-gray-700 flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="8,5 19,12 8,19"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-gray-700 truncate font-medium">{video.name}</div>
              <div className="text-[11px] text-gray-400">视频文件</div>
            </div>
          </div>
        ))}
      </div>

      {/* 卡片底部 - 来源信息 */}
      <div className="flex items-center justify-end px-4 py-2 border-t border-purple-100/40">
        <span className="text-[10px] text-purple-400 flex items-center gap-1">
          <span>🤖</span>
          <span>AI 自动识别 · 视频审核</span>
        </span>
      </div>
    </div>
  );
};

const MessageBubble: React.FC<{ message: Message; isHighlighted?: boolean; currentUserId: string; currentUserName: string; onPreviewFile: (f: FileMeta) => void }> = ({ message, isHighlighted, currentUserId, currentUserName, onPreviewFile }) => {
  const isMe = message.senderId === currentUserId || message.senderName === currentUserName;
  const renderContent = () => {
    if (message.fileMetas && message.fileMetas.length > 0) {
      const caption = message.content && !message.fileMetas.some((f) => f.name === message.content)
        ? message.content
        : null;
      return (
        <div className="flex flex-col gap-2 w-[260px]">
          {message.fileMetas.map((f, i) => (
            f.category === 'image' && f.dataUrl ? (
              <img
                key={i}
                src={f.dataUrl}
                alt={f.name}
                className="w-full h-40 object-cover rounded-lg border border-gray-200 cursor-pointer hover:border-indigo-300 transition-colors"
                onClick={() => onPreviewFile(f)}
                title="点击预览"
              />
            ) : (
              <div
                key={i}
                className="flex items-center gap-3 p-3 bg-white/70 rounded-lg border border-gray-200/60 cursor-pointer hover:border-indigo-300 transition-colors"
                onClick={() => onPreviewFile(f)}
                title="点击预览"
              >
                <FileIcon kind={f.kind} size={32} />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm truncate font-medium ${isMe ? 'text-gray-900' : 'text-gray-800'}`}>{f.name}</div>
                  <div className={`text-xs ${isMe ? 'text-gray-400' : 'text-gray-400'}`}>{formatSize(f.size)}</div>
                </div>
              </div>
            )
          ))}
          {caption && <p className={`text-sm whitespace-pre-wrap ${isMe ? 'text-white' : 'text-gray-600'}`}>{caption}</p>}
        </div>
      );
    }
    if (message.type === 'image') {
      return (
        <div className="w-48 h-32 bg-gray-200 rounded-lg flex items-center justify-center">
          <div className="text-center">
            <svg className="w-8 h-8 text-gray-400 mx-auto mb-1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <path d="m21 15-5-5L5 21"/>
            </svg>
            <span className="text-xs text-gray-400">图片</span>
          </div>
        </div>
      );
    }
    if (message.type === 'video') {
      return (
        <div className="w-48 h-32 bg-gray-700 rounded-lg flex items-center justify-center relative">
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-12 h-12 bg-black/50 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-white ml-0.5" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="8,5 19,12 8,19"/>
              </svg>
            </div>
          </div>
          <span className="text-xs text-gray-400 absolute bottom-2">视频</span>
        </div>
      );
    }
    if (message.type === 'card') {
      try {
        const cardData: CardData = JSON.parse(message.content);
        return <ReviewCard data={cardData} />;
      } catch {
        return <p className="text-sm text-gray-500">卡片数据加载失败</p>;
      }
    }
    return <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>;
  };

  return (
    <div className={`flex gap-3 mb-5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-xs font-bold flex-shrink-0">
        {message.senderName === 'AI助手' ? (
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-400 to-pink-400 flex items-center justify-center text-white text-[9px] font-bold">
            AI
          </div>
        ) : (
          isMe ? currentUserName.charAt(0) : message.senderName.charAt(0)
        )}
      </div>
      {message.type === 'card' ? (
        <div className={`flex-1 ${isHighlighted ? 'highlighted-message' : ''}`}>
          <div className="text-xs text-gray-400 mb-1">AI助手 {message.timestamp}</div>
          <div>{renderContent()}</div>
        </div>
      ) : (
        <div className={`flex-1 min-w-0 flex flex-col ${isMe ? 'items-end' : 'items-start'} ${isHighlighted ? 'highlighted-message' : ''}`}>
          <div className={`text-xs text-gray-400 mb-1 ${isMe ? 'text-right' : 'text-left'}`}>
            {message.senderName !== '我' ? message.senderName : ''} {message.timestamp}
          </div>
          <div className={`w-fit max-w-[70%] px-3 py-2 ${isMe ? 'message-bubble-sent' : 'message-bubble-received'}`}>
            {renderContent()}
          </div>
        </div>
      )}
    </div>
  );
};

const RightPanel: React.FC = () => {
  const activeTab = useStore((s) => s.activeTab);
  const messages = useStore((s) => s.messages);
  const selectedConversationId = useStore((s) => s.selectedConversationId);
  const conversations = useStore((s) => s.conversations);
  const highlightedMessageId = useStore((s) => s.highlightedMessageId);
  const clearHighlight = useStore((s) => s.clearHighlight);
  const sendMessage = useStore((s) => s.sendMessage);
  const sendFileMessage = useStore((s) => s.sendFileMessage);
  const currentUserId = useStore((s) => s.currentUserId);
  const accounts = useStore((s) => s.accounts);
  const currentUserName = accounts.find((a) => a.id === currentUserId)?.name || '我';
  const selectedContactId = useStore((s) => s.selectedContactId);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const [inputText, setInputText] = React.useState('');
  const [showAtMenu, setShowAtMenu] = React.useState(false);
  const [atFilter, setAtFilter] = React.useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewFile, setPreviewFile] = React.useState<FileMeta | null>(null);
  const [pendingFiles, setPendingFiles] = React.useState<FileMeta[]>([]);

  const currentConv = conversations.find(c => c.id === selectedConversationId);

  useEffect(() => {
    if (highlightedMessageId) {
      const el = messageRefs.current[highlightedMessageId];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      const timer = setTimeout(() => {
        clearHighlight();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [highlightedMessageId]);



  useEffect(() => {
    if (!highlightedMessageId) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async (files: FileMeta[] = []) => {
    const msgText = inputText.trim();
    if (!msgText && files.length === 0) return;

    const convId = selectedConversationId;
    const userMsgId = files.length > 0
      ? (sendFileMessage(files, msgText) || '')
      : (sendMessage(msgText) || '');
    setInputText('');

    if (convId && currentConv) {
      const memberIds = currentConv.members && currentConv.members.length
        ? currentConv.members
        : accounts.map((a) => a.id);
      const recipients = computeRecipients(msgText, memberIds, currentUserId);
      const now = getCurrentTimeStr();

      // 把附件整理成卡片可挂载的结构（支持多个文件）；同时为「每个文本文件」生成其自身的 AI 概要
      const attachedList = await Promise.all(files.map(async (f) => {
        const base: any = {
          name: f.name,
          size: f.size,
          category: f.category,
          fileType: f.fileType,
          kind: f.kind,
          label: f.label,
          content: f.category === 'text' ? f.content : undefined,
          snippet: f.category === 'text' ? (f.content || '').slice(0, 300) : undefined,
          dataUrl: f.dataUrl,
        };
        if (base.category === 'text' && base.content) {
          try {
            const s = await summarizeFileContent(base);
            if (s) base.summary = s;
          } catch { /* 概要失败不影响附件展示 */ }
        }
        return base;
      }));

      // 卡片级 fileSummary 取首个有概要的文件（兼容旧字段，仍可能用于其它视图）
      let fileSummary: string | undefined;
      const firstWithSummary = attachedList.find((m) => m.summary);
      if (firstWithSummary) fileSummary = firstWithSummary.summary;

      // 构造最近对话历史（排除刚发出的这条），供大模型结合上下文判断「续写合并」
      const freshMsgs = useStore.getState().messages;
      const history = freshMsgs
        .slice(0, -1)
        .slice(-6)
        .map((m) => ({
          role: (m.senderId === currentUserId ? 'user' : 'assistant') as 'user' | 'assistant',
          content: m.content,
        }));

      const intent = await analyzeChatMessage(msgText, currentConv.name, convId, history);
      if (!intent.hasIntent || !intent.type) return;

      const confidence = intent.confidence ?? 0;

      // 上下文续写合并：本消息是对已有卡片的补充/修改 → 更新原卡片，而不是新建一张
      if (intent.isUpdate && intent.updateTargetId) {
        const targetId = intent.updateTargetId;
        const merged = (intent.data as any) || {};
        const aStore = useAIStore.getState();
        if (intent.type === 'schedule') {
          const eventTime = buildScheduleTime(merged, msgText);
          const spatch: any = {};
          if (merged.event) spatch.event = merged.event;
          if (merged.location) spatch.location = merged.location;
          if (merged.participants) spatch.participants = merged.participants;
          if (eventTime) spatch.time = eventTime;
          aStore.patchSchedule(targetId, spatch);
        } else if (intent.type === 'todo') {
          const tpatch: any = {};
          if (merged.task) tpatch.task = merged.task;
          if (merged.deadline) tpatch.deadline = merged.deadline;
          if (merged.detail) tpatch.detail = merged.detail;
          aStore.patchTodo(targetId, tpatch);
        } else if (intent.type === 'request') {
          aStore.updateAICard(targetId, {
            summary: merged.content || '',
            description: merged.description || '',
            detail: merged.detail || '',
          } as any);
        }
        // 刷新活动卡片引用（合并后的字段），便于后续消息继续续写
        useAIStore.getState().setActiveCard(convId, {
          id: targetId,
          type: intent.type,
          summary: merged.event || merged.task || merged.content || '',
          extracted: merged,
        });
        return;
      }

      if (confidence < 0.8) {
        // 低置信度：推入待确认队列，由用户在「待确认」选择条上手动决定加入哪个 Tab
        useAIStore.getState().addPendingIntent({
          id: generateItemId(),
          rawText: msgText,
          predicted: intent.type,
          extracted: (intent.data as any) || {},
          recipients,
          fileMetas: attachedList,
          time: now,
          convId,
          convName: currentConv.name,
          userMsgId,
          confidence,
        });
        return;
      }

      if (intent.hasIntent && intent.type) {
        const cardId = generateItemId();
        let createdCardId: string | null = null;
        let createdSummary = '';
        const createdType = intent.type;
        if (intent.type === 'schedule') {
          const sData = intent.data as any;
          const eventTime = buildScheduleTime(sData, msgText);
          const card: AICard = {
            id: cardId,
            type: 'schedule',
            source: currentConv.name,
            event: sData.event || "会议",
            time: now,
            eventTime: eventTime,
            location: sData.location || '',
            participants: sData.participants || '',
            status: 'pending',
            sourceConversationId: convId,
            sourceMessageId: userMsgId,
            messages: [],
            recipients,
            fileMetas: attachedList,
            fileSummary,
          };
          useAIStore.getState().addAiCard(card);
          useAIStore.getState().addScheduleItem({
            id: cardId,
            time: eventTime,
            event: sData.event || "会议",
            location: sData.location || '',
            participants: sData.participants || '',
            source: currentConv.name,
            status: 'pending',
            detail: '',
            recipients,
          });
          createdCardId = cardId;
          createdSummary = sData.event || '会议';
        } else if (intent.type === 'todo') {
          const tData = intent.data as any;
          const card: AICard = {
            id: cardId,
            type: 'todo',
            source: currentConv.name,
            task: tData.task,
            deadline: '',
            time: now,
            sourceConversationId: convId,
            sourceMessageId: userMsgId,
            messages: [],
            recipients,
            fileMetas: attachedList,
            fileSummary,
          };
          useAIStore.getState().addAiCard(card);
          useAIStore.getState().addTodoItem({
            id: cardId,
            task: tData.task,
            deadline: '',
            source: currentConv.name,
            completed: false,
            detail: tData.detail || '',
            recipients,
            sourceConversationId: convId,
            sourceMessageId: userMsgId,
          });
          createdCardId = cardId;
          createdSummary = tData.task;
        } else if (intent.type === 'request') {
          const rData = intent.data as any;
          const reqText = rData.content || msgText;
          const reqDesc = rData.description || msgText;
          const mentions = [...msgText.matchAll(/@([^\s@]+)/g)].map((m) => m[1]);
          const specific = mentions.filter((n) => n !== '所有人' && NAME_TO_ID[n]);
          const makeReqCard = (pid: string, id: string): AICard => ({
            id,
            type: 'request',
            source: currentConv.name,
            applicant: currentUserName,
            event: reqText,
            task: reqText,
            summary: reqDesc,
            description: reqDesc,
            issueType: rData.issueType || 'feature',
            version: rData.version,
            time: now,
            status: 'following',
            sourceConversationId: convId,
            sourceMessageId: userMsgId,
            messages: [],
            recipients: [pid],
            fileMetas: attachedList,
            fileSummary,
          });
          if (specific.length > 0) {
            specific.forEach((name) => {
              const pid = NAME_TO_ID[name];
              if (!pid) return;
              const perCardId = generateItemId();
              const perCard = makeReqCard(pid, perCardId);
              useAIStore.getState().addAiCard(perCard);
              useAIStore.getState().addTodoItem({
                id: perCardId,
                task: '需求跟进：' + reqText,
                deadline: '',
                source: currentConv.name,
                completed: false,
                detail: reqDesc,
                recipients: [pid],
              });
              createdCardId = perCardId;
              createdSummary = reqText;
            });
          } else {
            const zhangsanId = 'c4';
            const reqCardId = generateItemId();
            const reqCard = makeReqCard(zhangsanId, reqCardId);
            useAIStore.getState().addAiCard(reqCard);
            useAIStore.getState().addTodoItem({
              id: reqCardId,
              task: '需求跟进：' + (reqText.length > 36 ? reqText.substring(0, 36) + '…' : reqText),
              deadline: '',
              source: currentConv.name,
              completed: false,
              detail: reqDesc,
              recipients: [zhangsanId],
            });
            createdCardId = reqCardId;
            createdSummary = reqText;
          }
        }

        // 记录为当前会话的活动卡片，供后续消息续写合并（同一事项补充时更新而非新建）
        if (createdCardId) {
          useAIStore.getState().setActiveCard(convId, {
            id: createdCardId,
            type: createdType,
            summary: createdSummary,
            extracted: (intent.data as any) || {},
          });
        }
      }
    }
  };

  // ── 文件读取 ──
  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;

    const caption = inputText.trim();
    const kind = resolveFileKind(file.name, file.type);
    const category = kind.category;

    const finish = (content?: string, dataUrl?: string) => {
      const meta: FileMeta = {
        name: file.name,
        size: file.size,
        fileType: file.type || (category === 'text' ? 'text/plain' : category === 'image' ? 'image/*' : 'application/octet-stream'),
        category,
        kind: kind.kind,
        label: kind.label,
        content,
        dataUrl,
      };
      setPendingFiles((prev) => [...prev, meta]);
    };

    if (category === 'image' || category === 'doc') {
      const r = new FileReader();
      r.onload = () => finish(undefined, r.result as string);
      r.readAsDataURL(file);
    } else if (category === 'text') {
      const r = new FileReader();
      r.onload = () => finish(r.result as string);
      r.readAsText(file);
    } else {
      finish();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(pendingFiles);
      setPendingFiles([]);
    }
  };

  // 选中 @ 对象（@所有人 或某个群成员）：只替换「@查询词」这一段，
  // 保留 @ 之前和 @ 之后的所有已输入文字，避免清空。
  const applyMention = (name: string) => {
    const text = inputRef.current ? inputRef.current.value : inputText;
    const atIdx = text.lastIndexOf('@');
    if (atIdx < 0) {
      setInputText(text + '@' + name + ' ');
    } else {
      // 从 @ 到下一个空格（或行尾）是要被替换的 token
      const rest = text.slice(atIdx);
      const sp = rest.indexOf(' ');
      const before = text.slice(0, atIdx);
      const after = (sp >= 0 ? text.slice(atIdx + sp) : '').replace(/^\s+/, ' ');
      // after 已自带前导空格作为分隔；有后续文字时不再额外加空格，避免双空格
      setInputText(before + '@' + name + (after.trim() ? after : ' '));
    }
    setShowAtMenu(false);
    // 延迟聚焦，确保点击按钮导致的失焦后仍能回到输入框
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (activeTab === 'contacts') {
    // 默认选中第一个联系人，右侧始终展示详情（圆角玻璃态）
    const selectedContact = contacts.find(
      (c) => c.id === (selectedContactId ?? contacts[0]?.id)
    );
    if (!selectedContact) {
      return (
        <div className="contact-right-panel flex-1 bg-white flex flex-col overflow-hidden">
          <div className="contact-empty">
            <i className="fas fa-address-book"></i>
            <p>从左侧选择一个联系人查看详情</p>
          </div>
        </div>
      );
    }
    return (
      <div className="contact-right-panel flex-1 bg-white flex flex-col overflow-hidden">
        {/* 顶部标题栏：名字 + 岗位（参考范本 .right-header / .right-title / .right-sub） */}
        <div className="contact-right-header">
          <div className="cr-identity">
            <span className="cr-title">{selectedContact.name}</span>
            <span className="cr-sub">{selectedContact.title}</span>
          </div>
          <span className={`cr-status-dot ${selectedContact.status}`}></span>
        </div>

        <div className="contact-right-body">
          <div className="contact-detail">
            <div className="c-avatar">{selectedContact.name.charAt(0)}</div>
            <div className="c-divider"></div>
            <div className="c-info-grid">
              <div className="info-item">
                <div className="label"><i className="fas fa-phone-alt"></i> 电话</div>
                <div className="value">{selectedContact.phone}</div>
              </div>
              <div className="info-item">
                <div className="label"><i className="fas fa-envelope"></i> 邮箱</div>
                <div className="value">{selectedContact.email}</div>
              </div>
            </div>
            <div className="c-bio">{selectedContact.bio}</div>
            <div className="c-actions">
              <button className="c-btn primary" onClick={() => setActiveTab('chat')}>
                <i className="fas fa-comment-dots"></i> 发消息
              </button>
              <button className="c-btn">
                <i className="fas fa-phone"></i> 语音通话
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentConv) {
    return (
      <div className="flex-1 bg-white flex items-center justify-center">
        <div className="text-center text-gray-400">
          <svg className="w-16 h-16 mx-auto mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p className="text-sm">选择一个会话开始聊天</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-white flex flex-col">
      {/* 聊天头部 */}
      <div className="h-14 border-b border-gray-200 flex items-center px-5">
        <h2 className="chat-title">
          <i className="fas fa-users chat-title-icon"></i>
          {currentConv.name}
        </h2>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-5 pt-4 pb-1">
        {messages.map((msg) => (
          <div key={msg.id} ref={(el) => { messageRefs.current[msg.id] = el; }}>
            <MessageBubble
              message={msg}
              isHighlighted={msg.id === highlightedMessageId}
              currentUserId={currentUserId}
              currentUserName={currentUserName}
              onPreviewFile={setPreviewFile}
            />
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* 待发送附件区：选中的文件先暂存此处，点「发送」才真正发送 */}
      {pendingFiles.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 bg-gray-50/70">
          <div className="text-xs text-gray-400 mb-1.5">待发送附件（{pendingFiles.length}）</div>
          <div className="flex flex-wrap gap-2">
            {pendingFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 pl-2 pr-1 py-1 bg-white rounded-lg border border-gray-200">
                <FileIcon kind={f.kind} size={20} />
                <span className="text-xs text-gray-700 max-w-[140px] truncate">{f.name}</span>
                <span className="text-[10px] text-gray-400">{formatSize(f.size)}</span>
                <button
                  onClick={() => setPendingFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-600 text-sm leading-none"
                  title="移除"
                >×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 待确认意图：低置信度识别结果，用户手动选择加入日程/待办/需求 */}
      <IntentConfirmBar />

      {/* 输入区域 */}
      <div className="h-[60px] border-t border-gray-200 flex items-center gap-3 px-4">
        <button className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-400 transition-colors" title="表情">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="9" cy="9" r="1.5" fill="white"/>
            <circle cx="15" cy="9" r="1.5" fill="white"/>
            <path d="M8 13c1 1 2.5 2 4 2s3-1 4-2" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
          </svg>
        </button>
        <button className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-400 transition-colors" title="图片">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="m21 15-5-5L5 21"/>
          </svg>
        </button>
        <button onClick={() => fileInputRef.current?.click()} className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-400 transition-colors" title="发送文件">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
            <polyline points="13 2 13 9 20 9"/>
          </svg>
        </button>
        <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePicked} />
        <button className="w-9 h-9 flex items-center justify-center hover:bg-gray-100 rounded-lg text-gray-400 transition-colors" title="视频">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polygon points="23 7 16 12 23 17 23 7"/>
            <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
        </button>
        <div className="flex-1 relative">
            <input
              ref={inputRef}
              type="text"
              value={inputText}
              onChange={(e) => {
                const v = e.target.value;
                setInputText(v);
                const lastAt = v.lastIndexOf("@");
                if (lastAt >= 0 && !v.slice(lastAt + 1).includes(" ")) {
                  setShowAtMenu(true);
                  setAtFilter(v.slice(lastAt + 1));
                } else {
                  setShowAtMenu(false);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowAtMenu(false);
                handleKeyDown(e);
              }}
              placeholder="发送消息..."
              className="w-full h-9 bg-gray-50 rounded-lg px-3 text-sm text-gray-700 placeholder-gray-400 outline-none"
            />
            {showAtMenu && (
              <div className="absolute bottom-full left-0 mb-1 w-52 bg-white rounded-xl shadow-xl border border-gray-200 py-1 max-h-56 overflow-y-auto z-50">
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => applyMention('所有人')}
                  className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-amber-100 flex items-center justify-center text-xs">📢</span>
                  <span className="font-medium text-gray-800">所有人</span>
                </button>
                {(currentConv?.members && currentConv.members.length > 0
                  ? currentConv.members
                  : contacts.map((c) => c.id))
                  .map((id) => contacts.find((c) => c.id === id))
                  .filter((c): c is Contact => !!c && c.id !== currentUserId && (!atFilter || c.name.includes(atFilter)))
                  .map((c) => (
                    <button
                      key={c.id}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applyMention(c.name)}
                      className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-600">{c.name.charAt(0)}</span>
                      <span className="text-gray-700">{c.name}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        <button
          onClick={() => { handleSend(pendingFiles); setPendingFiles([]); }}
          disabled={!inputText.trim() && pendingFiles.length === 0}
          className="px-4 h-9 bg-primary-500 text-white text-sm rounded-lg hover:bg-primary-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors font-medium"
        >
          发送
        </button>
      </div>

      <FilePreviewModal file={previewFile} onClose={() => setPreviewFile(null)} />
    </div>
  );
};

export default RightPanel;




