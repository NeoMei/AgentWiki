import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LanguageProvider } from '../../src/context/LanguageContext';
import { TaskboardPage } from '../../src/features/taskboard/TaskboardPage';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<LanguageProvider><MemoryRouter initialEntries={['/spaces/fixture/taskboard']}>
  <Routes><Route path="/spaces/:id/taskboard" element={<TaskboardPage />} /></Routes>
</MemoryRouter></LanguageProvider>);
