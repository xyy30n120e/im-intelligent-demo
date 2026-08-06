import React from 'react';
import LeftBar from '../components/LeftBar';
import MiddleBar from '../components/MiddleBar';
import RightPanel from '../components/RightPanel';

const Home: React.FC = () => {
  return (
    <div className="flex flex-1 overflow-hidden">
      <LeftBar />
      <MiddleBar />
      <RightPanel />
    </div>
  );
};

export default Home;
