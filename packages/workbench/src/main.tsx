import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import loader from '@monaco-editor/loader';

import { App } from './App';
import './styles.css';

// Configure Monaco Editor to use bundled assets instead of CDN.
loader.config({
  paths: {
    vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.55.1/min/vs'
  }
});

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Workbench root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);