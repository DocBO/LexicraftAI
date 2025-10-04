import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app';
import './styles/main.css';
import { ProjectProvider } from './context/ProjectContext';

const container = document.getElementById('root');
const root = createRoot(container);
root.render(
  <ProjectProvider>
    <App />
  </ProjectProvider>
);
