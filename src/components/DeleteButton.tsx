import React from "react";

export interface DeleteButtonProps {
  onClick: () => void;
  children?: React.ReactNode;
  className?: string;
}

/**
 * 全局统一的「删除」文字按钮。
 * 需求 / 日程 / 待办三个模块的编辑弹窗底部统一使用，保证红色危险样式一致。
 */
export const DeleteButton: React.FC<DeleteButtonProps> = ({
  onClick,
  children = "删除",
  className = "",
}) => (
  <button
    type="button"
    onClick={onClick}
    className={
      "px-5 py-2 text-sm font-medium text-red-500 hover:bg-red-50 rounded-lg transition-colors " +
      className
    }
  >
    {children}
  </button>
);
