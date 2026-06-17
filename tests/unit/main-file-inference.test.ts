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
        content: 'Proponowana docelowa ┼Ťcie┼╝ka: `E:\\AI_WORKSPACE\\Moje projekty\\AgentDeck\\AgentTest.md`\n\nJe┼Ťli chcesz, podaj pe┼én─ů ┼Ťcie┼╝k─Ö zapisu albo potwierd┼║ dok┼éadnie t─Ö lokalizacj─Ö.',
        timestamp: 2
      }
    ];

    expect(inferTargetFileNameFromMessages(messages)).toBe('E:\\AI_WORKSPACE\\Moje projekty\\AgentDeck\\AgentTest.md');
  });

  it('extracts target file name from original write request', () => {
    const messages = [
      {
        role: 'user',
        content: 'Otw├│rz i przeczytaj a nast─Öpnie stre┼Ť─ç mi plik Readme.md z projektu AgentDeck, wynik streszczenia zapisz do pliku AgentTest.md',
        timestamp: 1
      }
    ];

    expect(inferTargetFileNameFromMessages(messages)).toBe('AgentTest.md');
  });
});
