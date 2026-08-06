import React from 'react';
import { useStore } from '../store/useStore';
import { Contact } from '../data/mockData';

const ConversationItem: React.FC<{ id: string; name: string; lastMessage: string; time: string; unread: number; isActive: boolean; onClick: () => void }> = ({
  name, lastMessage, time, unread, isActive, onClick
}) => (
  <div
    onClick={onClick}
    className={`list-item ${isActive ? 'active' : ''}`}
  >
    <div className="item-avatar">
      {name.charAt(0)}
    </div>
    <div className="item-info">
      <div className="item-name">{name}</div>
      <div className="item-sub">{lastMessage}</div>
    </div>
    <div className="item-meta">
      <div>{time}</div>
      {unread > 0 && (
        <div className="unread">{unread > 99 ? '99+' : unread}</div>
      )}
    </div>
  </div>
);

const ContactItem: React.FC<{ contact: Contact; isActive: boolean; onClick: () => void }> = ({ contact, isActive, onClick }) => (
  <div
    onClick={onClick}
    className={`list-item ${isActive ? 'active' : ''}`}
  >
    <div className="relative">
      <div className="item-avatar">
        {contact.name.charAt(0)}
      </div>
      <span className={`online-dot ${contact.status}`}></span>
    </div>
    <div className="item-info">
      <div className="item-name">{contact.name}</div>
      <div className="item-sub">{contact.status === 'online' ? '在线' : contact.status === 'away' ? '忙碌' : '离线'}</div>
    </div>
    <div className="item-meta">
      <i className="fas fa-circle status-dot" data-status={contact.status}></i>
    </div>
  </div>
);

const MiddleBar: React.FC = () => {
  const activeTab = useStore((s) => s.activeTab);
  const conversations = useStore((s) => s.conversations);
  const contacts = useStore((s) => s.contacts);
  const selectedConversationId = useStore((s) => s.selectedConversationId);
  const selectedContactId = useStore((s) => s.selectedContactId);
  const selectConversation = useStore((s) => s.selectConversation);
  const selectContact = useStore((s) => s.selectContact);

  return (
    <div className="w-[260px] bg-white border-r border-gray-200 flex flex-col">
      {/* 头部：参考范本 middle-header */}
      <div className="middle-header">
        <h3>{activeTab === 'chat' ? '群聊' : '联系人'}</h3>
        <span className="header-action">
          <i className={activeTab === 'chat' ? 'fas fa-plus' : 'fas fa-user-plus'}></i>
          {' '}{activeTab === 'chat' ? '新建' : '添加'}
        </span>
      </div>

      {/* 列表区域 */}
      <div className="middle-list">
        {activeTab === 'chat' ? (
          conversations.map((conv) => (
            <ConversationItem
              key={conv.id}
              id={conv.id}
              name={conv.name}
              lastMessage={conv.lastMessage}
              time={conv.time}
              unread={conv.unread}
              isActive={conv.id === selectedConversationId}
              onClick={() => selectConversation(conv.id)}
            />
          ))
        ) : (
          contacts.map((contact) => (
            <ContactItem
              key={contact.id}
              contact={contact}
              isActive={contact.id === selectedContactId}
              onClick={() => selectContact(contact.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};

export default MiddleBar;
