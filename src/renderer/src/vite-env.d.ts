/// <reference types="vite/client" />

import type { BusyApi } from '../../preload';

declare global {
  interface Window {
    busyApi: BusyApi;
  }
}

