import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import loader from '@monaco-editor/loader';
import * as monaco from 'monaco-editor';

import { App } from './App';
import './styles.css';

// Configure Monaco Editor to use the directly-imported monaco instance.
// This prevents @monaco-editor/loader from trying to dynamically inject script
// tags at runtime (which fails under Electron's file:// protocol).
// The build step also copies Monaco assets to /monaco-editor/min/vs so they
// are available for any code that references them directly.
loader.config({ monaco });

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Workbench root element was not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);