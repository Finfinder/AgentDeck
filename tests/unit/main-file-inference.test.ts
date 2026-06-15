import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getVersion: () => '0.0.0',
    getPath: () => 'tmp',
    isReady: () => false,
    once: vi.fn(),
    on: vi.fn(),
    quit: vi.fn()
  },
  BrowserWindow: vi.fn(),
  dialog: vi.fn(),
  ipcMain: { handle: vi.fn() },
  Menu: vi.fn(),
  globalShortcut: vi.fn(),
  session: {
    defaultSession: {
      webRequest: {
        onHeadersReceived: vi.fn()
      }
    }
  },
  shell: { openExternal: vi.fn() }
}));

import { inferTargetFileNameFromMessages } from '../../apps/desktop/src/main/index';

describe('inferTargetFileNameFromMessages', () => {
  it('extracts a proposed Windows target path from assistant confirmation context', () => {
    const messages = [
      { role: 'user', content: 'Tak zapisz', timestamp: 1 },
      {
        role: 'assistant',
        content: 'Proponowana docelowa ścieżka: `E:\\AI_WORKSPACE\\Moje projekty\\AgentDeck\\AgentTest.md`\n\nJeśli chcesz, podaj pełną ścieżkę zapisu albo potwierdź dokładnie tę lokalizację.',
        timestamp: 2
      }
    ];

    expect(inferTargetFileNameFromMessages(messages)).toBe('E:\\AI_WORKSPACE\\Moje projekty\\AgentDeck\\AgentTest.md');
  });

  it('extracts target file name from original write request', () => {
    const messages = [
      {
        role: 'user',
        content: 'Otwórz i przeczytaj a następnie streść mi plik Readme.md z projektu AgentDeck, wynik streszczenia zapisz do pliku AgentTest.md',
        timestamp: 1
      }
    ];

    expect(inferTargetFileNameFromMessages(messages)).toBe('AgentTest.md');
  });
});
