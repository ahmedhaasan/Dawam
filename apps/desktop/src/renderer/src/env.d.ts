/// <reference types="vite/client" />

import type { DawamDesktopApi } from '../../shared/ipc';

declare global {
  interface Window {
    dawam?: DawamDesktopApi;
  }
}

export {};
