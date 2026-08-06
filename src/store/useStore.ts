import { create } from 'zustand';
import { Conversation, Contact, Message, FileMeta, conversations as mockConversations, contacts as mockContacts, accounts as mockAccounts, getMessages, generateMessageId, getCurrentTime, addMessage } from '../data/mockData';

type TabType = 'chat' | 'contacts';

interface AppState {
  activeTab: TabType;
  selectedConversationId: string | null;
  currentUserId: string;
  accounts: { id: string; name: string }[];

  selectedContactId: string | null;
  conversations: Conversation[];
  contacts: Contact[];
  messages: Message[];
  highlightedMessageId: string | null;
  /** 置顶 AI 提醒条的关闭日期（"M月D日"），当天内关闭后不再弹出 */
  pinnedReminderClosedDate: string | null;

  setActiveTab: (tab: TabType) => void;
  dismissPinnedReminder: () => void;
  setCurrentUserId: (id: string) => void;
  selectConversation: (id: string) => void;
  selectContact: (id: string) => void;
  sendMessage: (content: string) => string | undefined;
  sendFileMessage: (files: FileMeta[], caption?: string) => string | undefined;
  navigateToMessage: (conversationId: string, messageId: string) => void;
  clearHighlight: () => void;
}

export const useStore = create<AppState>((set, get) => ({
  activeTab: 'chat',
  selectedConversationId: mockConversations[0]?.id || null,
  selectedContactId: mockContacts[0]?.id || null,
  conversations: mockConversations,
  contacts: mockContacts,
  messages: getMessages(mockConversations[0]?.id || ''),
  highlightedMessageId: null,
  pinnedReminderClosedDate: null,
  currentUserId: 'c2',
  accounts: mockAccounts,

  dismissPinnedReminder: () => {
    const now = new Date();
    set({ pinnedReminderClosedDate: `${now.getMonth() + 1}月${now.getDate()}日` });
  },

  setActiveTab: (tab) => {
    set({ activeTab: tab, highlightedMessageId: null });
    if (tab === 'chat') {
      const state = get();
      const convId = state.selectedConversationId || state.conversations[0]?.id;
      if (convId) {
        set({
          messages: getMessages(convId),
        });
      }
    } else {
      set({ messages: [] });
    }
  },

  selectConversation: (id) => {
    set({
      selectedConversationId: id,
      messages: getMessages(id),
    });
    const convs = get().conversations.map(c =>
      c.id === id ? { ...c, unread: 0 } : c
    );
    set({ conversations: convs });
  },

  selectContact: (id) => {
    set({ selectedContactId: id });
  },

  sendMessage: (content) => {
    const state = get();
    const convId = state.selectedConversationId;
    if (!convId || !content.trim()) return undefined;

    const account = state.accounts.find((a) => a.id === state.currentUserId);
    const currentName = account?.name || '\u6211';

    const newMsg: Message = {
      id: generateMessageId(),
      senderId: state.currentUserId,
      senderName: currentName,
      content: content.trim(),
      timestamp: getCurrentTime(),
      type: 'text',
      isMe: true,
    };

    set({ messages: [...state.messages, newMsg] });
    addMessage(convId, newMsg);

    const convs = state.conversations.map(c =>
      c.id === convId ? { ...c, lastMessage: `${currentName}\uff1a${content.trim()}`, time: getCurrentTime() } : c
    );
    set({ conversations: convs });

    return newMsg.id;
  },

  sendFileMessage: (files, caption) => {
    const state = get();
    const convId = state.selectedConversationId;
    if (!convId || !files || files.length === 0) return undefined;

    const account = state.accounts.find((a) => a.id === state.currentUserId);
    const currentName = account?.name || '我';
    const fileNames = files.map((f) => f.name).join('、');
    const content = caption?.trim() || (files.length === 1 ? files[0].name : `发送了 ${files.length} 个文件`);

    const newMsg: Message = {
      id: generateMessageId(),
      senderId: state.currentUserId,
      senderName: currentName,
      content,
      timestamp: getCurrentTime(),
      type: 'file',
      isMe: true,
      fileMetas: files,
    };

    set({ messages: [...state.messages, newMsg] });
    addMessage(convId, newMsg);

    const convs = state.conversations.map(c =>
      c.id === convId ? { ...c, lastMessage: `${currentName}：发送了文件 ${fileNames}`, time: getCurrentTime() } : c
    );
    set({ conversations: convs });

    return newMsg.id;
  },

  navigateToMessage: (conversationId, messageId) => {
    set({
      activeTab: 'chat',
      selectedConversationId: conversationId,
      messages: getMessages(conversationId),
      highlightedMessageId: messageId,
    });
    const convs = get().conversations.map(c =>
      c.id === conversationId ? { ...c, unread: 0 } : c
    );
    set({ conversations: convs });
  },


  setCurrentUserId: (id: string) => {
    set({ currentUserId: id });
  },

  clearHighlight: () => {
    set({ highlightedMessageId: null });
  },
}));


