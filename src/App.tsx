import React from 'react';
import { Routes, Route } from 'react-router-dom';
import TitleBar from './components/TitleBar';
import Home from './pages/Home';
import Ai from './pages/Ai';

const App: React.FC = () => {
  return (
    <div className="h-screen w-screen flex flex-col bg-white overflow-hidden">
      <TitleBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/ai" element={<Ai />} />
      </Routes>
    </div>
  );
};

export default App;
