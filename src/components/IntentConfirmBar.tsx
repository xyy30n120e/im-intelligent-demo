import React from 'react';
import { useStore } from '../store/useStore';
import { useAIStore, type PendingIntent } from '../store/aiStore';
import { applyIntent, applyUpdateToCard, IntentType } from '../services/intentApply';

const TYPE_LABEL: Record<IntentType, string> = {
  schedule: '日程',
  todo: '待办',
  request: '需求',
};

/**
 * 低置信度意图的「待确认」选择条。
 * 出现在聊天输入区上方，列出 AI 识别出但把握不足的消息，
 * 让用户手动选择加入「日程 / 待办 / 需求」，或忽略。
 */
export const IntentConfirmBar: React.FC = () => {
  const pending = useAIStore((s) => s.pendingIntents);
  const removePendingIntent = useAIStore((s) => s.removePendingIntent);
  const accounts = useStore((s) => s.accounts);
  const currentUserId = useStore((s) => s.currentUserId);
  const currentUserName = accounts.find((a) => a.id === currentUserId)?.name || '我';

  if (!pending || pending.length === 0) return null;

  const choose = async (p: PendingIntent, type: IntentType, mode: 'new' | 'update') => {
    if (mode === 'update' && p.updateTargetId) {
      applyUpdateToCard({
        targetId: p.updateTargetId,
        type: p.predicted,
        extracted: p.extracted || {},
        msgText: p.rawText,
        attachedList: p.fileMetas,
        now: p.time,
        convId: p.convId,
      });
    } else {
      await applyIntent({
        type,
        extracted: p.extracted,
        msgText: p.rawText,
        recipients: p.recipients,
        attachedList: p.fileMetas,
        now: p.time,
        convId: p.convId,
        convName: p.convName,
        userMsgId: p.userMsgId,
        senderName: currentUserName,
      });
    }
    removePendingIntent(p.id);
  };

  return (
    <div className="px-4 py-2 border-t border-gray-100 bg-amber-50/70 space-y-2">
      {pending.map((p) =>
        p.mode === 'ambiguous' ? (
          <div key={p.id} className="rounded-xl bg-white border border-amber-200 p-3 shadow-sm">
            <div className="text-xs text-gray-600 mb-2 leading-relaxed">
              <span>AI 不确定这条消息是要</span>
              <span className="font-medium text-amber-700 mx-1">补充/修改</span>
              <span>上一张「{TYPE_LABEL[p.predicted]}」卡片</span>
              {p.lastCardSummary && (
                <span className="text-gray-800">：“{p.lastCardSummary}”</span>
              )}
              <div className="mt-0.5 text-gray-700 line-clamp-2">“{p.rawText}”</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => choose(p, p.predicted, 'update')}
                className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
              >
                更新上一张
              </button>
              <button
                onClick={() => choose(p, 'schedule', 'new')}
                className="px-3 py-1.5 text-xs font-medium text-indigo-600/80 bg-indigo-50/60 hover:bg-indigo-100 rounded-lg transition-colors"
              >
                新建日程
              </button>
              <button
                onClick={() => choose(p, 'todo', 'new')}
                className="px-3 py-1.5 text-xs font-medium text-teal-600/80 bg-teal-50/60 hover:bg-teal-100 rounded-lg transition-colors"
              >
                新建待办
              </button>
              <button
                onClick={() => choose(p, 'request', 'new')}
                className="px-3 py-1.5 text-xs font-medium text-purple-600/80 bg-purple-50/60 hover:bg-purple-100 rounded-lg transition-colors"
              >
                新建需求
              </button>
              <button
                onClick={() => removePendingIntent(p.id)}
                className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors ml-auto"
              >
                忽略
              </button>
            </div>
          </div>
        ) : (
          <div key={p.id} className="rounded-xl bg-white border border-amber-200 p-3 shadow-sm">
            <div className="text-xs text-gray-600 mb-2 leading-relaxed">
              <span className="text-gray-500">AI 识别为</span>
              <span className="font-medium text-amber-700 mx-1">{TYPE_LABEL[p.predicted]}</span>
              <span className="text-amber-600">（置信度 {Math.round((p.confidence || 0) * 100)}%）</span>
              <div className="mt-0.5 text-gray-700 line-clamp-2">“{p.rawText}”</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => choose(p, 'schedule', 'new')}
                className="px-3 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
              >
                添加到日程
              </button>
              <button
                onClick={() => choose(p, 'todo', 'new')}
                className="px-3 py-1.5 text-xs font-medium text-teal-600 bg-teal-50 hover:bg-teal-100 rounded-lg transition-colors"
              >
                添加到待办
              </button>
              <button
                onClick={() => choose(p, 'request', 'new')}
                className="px-3 py-1.5 text-xs font-medium text-purple-600 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors"
              >
                添加到需求
              </button>
              <button
                onClick={() => removePendingIntent(p.id)}
                className="px-3 py-1.5 text-xs font-medium text-gray-500 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors ml-auto"
              >
                忽略
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
};
