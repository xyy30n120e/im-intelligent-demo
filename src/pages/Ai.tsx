import React from 'react';
import LeftBar from '../components/LeftBar';
import AiMiddleBar from '../components/AiMiddleBar';
import AiRightPanel from '../components/AiRightPanel';

const Ai: React.FC = () => {
  return (
    <div className="flex flex-1 overflow-hidden">
      <LeftBar />
      <AiMiddleBar />
      <AiRightPanel />
    </div>
  );
};

export default Ai;