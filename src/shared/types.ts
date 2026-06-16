export type ISODateString = string;

export type WorkItem = {
  id: string;
  parentId: string | null;
  title: string;
  notes: string;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  order: number;
};

export type WorkSegment = {
  id: string;
  itemId: string;
  startAt: ISODateString;
  endAt: ISODateString | null;
};

export type Screenshot = {
  id: string;
  itemId: string;
  capturedFromItemId: string | null;
  path: string;
  capturedAt: ISODateString;
  previewUrl?: string;
};

export type AppData = {
  version: 1;
  items: WorkItem[];
  segments: WorkSegment[];
  screenshots: Screenshot[];
  activeSegmentId: string | null;
};

export type ClientAppData = AppData;

export type DailyReportResult = {
  markdown: string;
  html: string;
};

export type ExportDailyReportResult = {
  markdownPath: string;
  htmlPath: string;
};

export type ExportTimelineReportResult = {
  pngPath: string;
};

export type AppSettings = {
  minimizeToTray: boolean;
  stealthMode: boolean;
  alwaysOnTop: boolean;
  screenshotShortcut: string | null;
  mainTaskShortcut: string | null;
};
