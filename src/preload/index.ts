import { contextBridge, ipcRenderer } from 'electron';
import type { AppSettings, ClientAppData, ExportDailyReportResult, ExportTimelineReportResult } from '../shared/types';

const api = {
  getToday: (): Promise<ClientAppData> => ipcRenderer.invoke('work:getToday'),
  addItem: (input?: { parentId?: string | null; title?: string }): Promise<ClientAppData> =>
    ipcRenderer.invoke('work:addItem', input),
  startItem: (input?: { title?: string }): Promise<ClientAppData> => ipcRenderer.invoke('work:startItem', input),
  endActive: (): Promise<ClientAppData> => ipcRenderer.invoke('work:endActive'),
  endActiveAndResumeParent: (): Promise<ClientAppData> => ipcRenderer.invoke('work:endActiveAndResumeParent'),
  continueItem: (input: { itemId: string }): Promise<ClientAppData> => ipcRenderer.invoke('work:continueItem', input),
  toggleItemTiming: (input: { itemId: string }): Promise<ClientAppData> =>
    ipcRenderer.invoke('work:toggleItemTiming', input),
  deleteItem: (input: { itemId: string }): Promise<ClientAppData> => ipcRenderer.invoke('work:deleteItem', input),
  deleteScreenshotMarker: (input: { screenshotId: string }): Promise<ClientAppData> =>
    ipcRenderer.invoke('work:deleteScreenshotMarker', input),
  updateItem: (input: { itemId: string; title: string; notes: string }): Promise<ClientAppData> =>
    ipcRenderer.invoke('work:updateItem', input),
  reorderRootItems: (input: { itemIds: string[] }): Promise<ClientAppData> =>
    ipcRenderer.invoke('work:reorderRootItems', input),
  insertChildWithScreenshot: (input: { parentId: string }): Promise<ClientAppData> =>
    ipcRenderer.invoke('work:insertChildWithScreenshot', input),
  continueChildWithScreenshot: (input: { parentId: string; childItemId: string }): Promise<ClientAppData> =>
    ipcRenderer.invoke('work:continueChildWithScreenshot', input),
  interruptWithScreenshot: (): Promise<ClientAppData> => ipcRenderer.invoke('work:interruptWithScreenshot'),
  exportDailyReport: (input?: { date?: string }): Promise<ExportDailyReportResult> =>
    ipcRenderer.invoke('report:exportDaily', input),
  exportTimelineReport: (): Promise<ExportTimelineReportResult> => ipcRenderer.invoke('report:exportTimeline'),
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setScreenshotShortcut: (input: { shortcut: string | null }): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:setScreenshotShortcut', input),
  setMainTaskShortcut: (input: { shortcut: string | null }): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:setMainTaskShortcut', input),
  setStealthMode: (input: { enabled: boolean }): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:setStealthMode', input),
  setAlwaysOnTop: (input: { enabled: boolean }): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:setAlwaysOnTop', input),
  openPath: (filePath: string): Promise<boolean> => ipcRenderer.invoke('shell:openPath', filePath),
  showItemInFolder: (filePath: string): Promise<boolean> => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  openScreenshotsFolder: (): Promise<boolean> => ipcRenderer.invoke('shell:openScreenshotsFolder'),
  resizeToContent: (input: { height: number }): Promise<boolean> => ipcRenderer.invoke('window:resizeToContent', input),
  onSettingsChanged: (listener: (settings: AppSettings) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, settings: AppSettings): void => listener(settings);
    ipcRenderer.on('settings:changed', handler);
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },
  onDataChanged: (listener: (data: ClientAppData) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ClientAppData): void => listener(data);
    ipcRenderer.on('work:dataChanged', handler);
    return () => ipcRenderer.removeListener('work:dataChanged', handler);
  }
};

contextBridge.exposeInMainWorld('busyApi', api);

export type BusyApi = typeof api;
