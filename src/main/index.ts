import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
  type MenuItemConstructorOptions
} from 'electron';
import { getLocalDateKey, generateDailyReport } from '../shared/report';
import { generateTimelineReport } from '../shared/timelineReport';
import type { AppData, AppSettings, ClientAppData, WorkItem, WorkSegment } from '../shared/types';
import {
  addItem,
  continueItem,
  continueChildWithScreenshot,
  deleteItem,
  deleteScreenshotMarker,
  endActive,
  endActiveAndResumeParent,
  getItemDurationMs,
  insertChildWithScreenshot,
  interruptWithScreenshot,
  reorderRootItems,
  startItem,
  toggleItemTiming,
  updateItem
} from '../shared/workSession';
import { capturePrimaryScreen } from './screenshots';
import { getReportsRoot, getScreenshotsRoot, getWorkDataRoot, JsonWorkRepository } from './storage';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayTitleTimer: NodeJS.Timeout | null = null;
let repository: JsonWorkRepository;
let isQuitting = false;
let settings: AppSettings = {
  minimizeToTray: true,
  stealthMode: false,
  alwaysOnTop: false,
  screenshotShortcut: null,
  mainTaskShortcut: null
};

app.setName('忙个明白');

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 360,
    height: 58,
    minWidth: 300,
    minHeight: 52,
    title: '忙个明白',
    backgroundColor: '#ffffff',
    frame: false,
    skipTaskbar: settings.stealthMode,
    acceptFirstMouse: true,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
      refreshTrayMenu();
    }
  });
  mainWindow.on('show', () => refreshTrayMenu());
  mainWindow.on('hide', () => refreshTrayMenu());
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.meta && input.key.toLowerCase() === 'q') {
      event.preventDefault();
      isQuitting = true;
      app.quit();
    }
  });

  applyWindowPresentationMode();
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function createTray(): void {
  tray = new Tray(createTrayIcon('main'));
  tray.setToolTip('忙个明白');
  refreshTrayMenu();
  void refreshTrayPresentationFromRepository();
  startTrayTitleRefresh();
}

function refreshTrayMenu(data?: AppData): void {
  void refreshTrayMenuFromData(data);
}

async function refreshTrayMenuFromData(data?: AppData): Promise<void> {
  const menuData = data ?? (repository ? await repository.load().catch(() => null) : null);
  const taskMenuItems = menuData ? getTrayTaskMenuItems(menuData) : [];
  const template: MenuItemConstructorOptions[] = [
    {
      label: '说明书',
      click: () => {
        void openUserGuide();
      }
    },
    {
      label: '无感模式',
      type: 'checkbox',
      checked: settings.stealthMode,
      click: (menuItem) => {
        void setStealthMode(menuItem.checked);
      }
    },
    {
      label: '置顶',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: (menuItem) => {
        void setAlwaysOnTopMode(menuItem.checked);
      }
    },
    ...(taskMenuItems.length > 0 ? ([{ type: 'separator' }, ...taskMenuItems] as MenuItemConstructorOptions[]) : []),
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ];

  tray?.setContextMenu(Menu.buildFromTemplate(template));
}

function getTrayTaskMenuItems(data: AppData): MenuItemConstructorOptions[] {
  return getSortedRootItems(data)
    .slice(0, 3)
    .map((item) => ({
      label: getTrayTaskLabel(item.title),
      type: 'checkbox',
      checked: isRootItemRunning(data, item.id),
      click: () => {
        void toggleTrayRootTask(item.id);
      }
    }));
}

function startTrayTitleRefresh(): void {
  if (trayTitleTimer) {
    return;
  }

  trayTitleTimer = setInterval(() => {
    void refreshTrayPresentationFromRepository();
  }, 30_000);
}

async function refreshTrayPresentationFromRepository(): Promise<void> {
  try {
    refreshTrayPresentation(await repository.load());
  } catch {
    tray?.setTitle('');
  }
}

function refreshTrayPresentation(data: AppData, endForActive = new Date()): void {
  refreshTrayIcon(data);
  refreshTrayTitle(data, endForActive);
}

function refreshTrayIcon(data: AppData): void {
  tray?.setImage(createTrayIcon(hasActiveChild(data) ? 'child' : 'main'));
}

function refreshTrayTitle(data: AppData, endForActive = new Date()): void {
  if (!tray) {
    return;
  }

  const activeSegment = findActiveSegment(data);

  if (!activeSegment) {
    tray.setTitle('');
    return;
  }

  try {
    const rootItem = getRootItem(data, activeSegment.itemId);
    const minutes = Math.floor(getItemDurationMs(data, rootItem.id, endForActive) / 60_000);
    tray.setTitle(`${minutes}m`);
  } catch {
    tray.setTitle('');
  }
}

function refreshApplicationMenu(): void {
  const appMenu: MenuItemConstructorOptions = {
    label: '忙个明白',
    submenu: [
      { role: 'about', label: '关于忙个明白' },
      {
        label: '说明书',
        click: () => {
          void openUserGuide();
        }
      },
      { type: 'separator' },
      {
        label: '无感模式',
        type: 'checkbox',
        checked: settings.stealthMode,
        click: (menuItem) => {
          void setStealthMode(menuItem.checked);
        }
      },
      {
        label: '置顶',
        type: 'checkbox',
        checked: settings.alwaysOnTop,
        click: (menuItem) => {
          void setAlwaysOnTopMode(menuItem.checked);
        }
      },
      { type: 'separator' },
      { role: 'hide', label: '隐藏忙个明白' },
      { role: 'hideOthers', label: '隐藏其他' },
      { role: 'unhide', label: '全部显示' },
      { type: 'separator' },
      {
        label: '退出忙个明白',
        accelerator: 'Command+Q',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]
  };
  const editMenu: MenuItemConstructorOptions = {
    label: '编辑',
    submenu: [
      { role: 'undo', label: '撤销' },
      { role: 'redo', label: '重做' },
      { type: 'separator' },
      { role: 'cut', label: '剪切' },
      { role: 'copy', label: '复制' },
      { role: 'paste', label: '粘贴' },
      { role: 'selectAll', label: '全选' }
    ]
  };

  Menu.setApplicationMenu(Menu.buildFromTemplate([appMenu, editMenu]));
}

function setupAboutPanel(): void {
  app.setAboutPanelOptions({
    applicationName: '忙个明白',
    applicationVersion: app.getVersion(),
    version: `版本 ${app.getVersion()}`,
    credits: '轻量桌面工作记录工具'
  });
}

function createTrayIcon(kind: 'main' | 'child'): ReturnType<typeof nativeImage.createFromDataURL> {
  const icon = nativeImage.createFromPath(getMenuBarIconPath(kind)).resize({
    width: 18,
    height: 14
  });
  icon.setTemplateImage(true);
  return icon;
}

function setupIpc(): void {
  ipcMain.handle('work:getToday', async () => toClientData(await repository.load()));

  ipcMain.handle('work:addItem', async (_event, input?: { parentId?: string | null; title?: string }) =>
    mutateAndBroadcast((data) =>
      addItem(data, {
        parentId: input?.parentId ?? null,
        title: input?.title
      })
    )
  );

  ipcMain.handle('work:startItem', async (_event, input?: { title?: string }) =>
    mutateAndBroadcast((data) => startItem(data, { title: input?.title }))
  );

  ipcMain.handle('work:endActive', async () => mutateAndBroadcast((data) => endActive(data)));

  ipcMain.handle('work:endActiveAndResumeParent', async () =>
    mutateAndBroadcast((data) => endActiveAndResumeParent(data))
  );

  ipcMain.handle('work:continueItem', async (_event, input: { itemId: string }) =>
    mutateAndBroadcast((data) => continueItem(data, { itemId: input.itemId }))
  );

  ipcMain.handle('work:toggleItemTiming', async (_event, input: { itemId: string }) =>
    mutateAndBroadcast((data) => toggleItemTiming(data, { itemId: input.itemId }))
  );

  ipcMain.handle('work:deleteItem', async (_event, input: { itemId: string }) =>
    mutateAndBroadcast((data) => deleteItem(data, { itemId: input.itemId }))
  );

  ipcMain.handle('work:deleteScreenshotMarker', async (_event, input: { screenshotId: string }) =>
    mutateAndBroadcast((data) => deleteScreenshotMarker(data, { screenshotId: input.screenshotId }))
  );

  ipcMain.handle('work:updateItem', async (_event, input: { itemId: string; title: string; notes: string }) =>
    mutateAndBroadcast((data) =>
      updateItem(data, {
        itemId: input.itemId,
        title: input.title,
        notes: input.notes
      })
    )
  );

  ipcMain.handle('work:reorderRootItems', async (_event, input: { itemIds: string[] }) =>
    mutateAndBroadcast((data) => reorderRootItems(data, { itemIds: input.itemIds }))
  );

  ipcMain.handle('work:insertChildWithScreenshot', async (_event, input: { parentId: string }) => {
    const data = await repository.load();
    const rootItem = getReadyRootForScreenshot(data, input.parentId);
    const captured = await captureScreenshotForRoot(rootItem);
    return mutateAndBroadcast((data) =>
      insertChildWithScreenshot(data, {
        parentId: input.parentId,
        screenshotPath: captured.path,
        now: captured.capturedAt
      })
    );
  });

  ipcMain.handle('work:continueChildWithScreenshot', async (_event, input: { parentId: string; childItemId: string }) => {
    const data = await repository.load();
    const rootItem = getReadyRootForChildFollowUp(data, input.parentId, input.childItemId);
    const captured = await captureScreenshotForRoot(rootItem);
    return mutateAndBroadcast((data) =>
      continueChildWithScreenshot(data, {
        parentId: input.parentId,
        childItemId: input.childItemId,
        screenshotPath: captured.path,
        now: captured.capturedAt
      })
    );
  });

  ipcMain.handle('work:interruptWithScreenshot', async () => {
    const captured = await captureScreenshotForActiveRoot();
    return mutateAndBroadcast((data) =>
      interruptWithScreenshot(data, {
        screenshotPath: captured.path,
        now: captured.capturedAt
      })
    );
  });

  ipcMain.handle('report:exportDaily', async (_event, input?: { date?: string }) => {
    const data = await repository.load();
    const date = input?.date ?? getLocalDateKey(new Date());
    const generatedAt = new Date().toISOString();
    const report = generateDailyReport(data, {
      date,
      generatedAt,
      assetUrlForPath: (filePath) => pathToFileURL(filePath).href
    });
    const reportsRoot = getReportsRoot(app.getPath('userData'));
    await mkdir(reportsRoot, { recursive: true });

    const markdownPath = join(reportsRoot, `${date}.md`);
    const htmlPath = join(reportsRoot, `${date}.html`);
    await writeFile(markdownPath, report.markdown, 'utf8');
    await writeFile(htmlPath, report.html, 'utf8');

    return {
      markdownPath,
      htmlPath
    };
  });

  ipcMain.handle('report:exportTimeline', async () => exportTimelineReportAsPng());

  ipcMain.handle('settings:get', async () => settings);

  ipcMain.handle('settings:setScreenshotShortcut', async (_event, input: { shortcut: string | null }) =>
    setScreenshotShortcut(input.shortcut)
  );

  ipcMain.handle('settings:setMainTaskShortcut', async (_event, input: { shortcut: string | null }) =>
    setMainTaskShortcut(input.shortcut)
  );

  ipcMain.handle('settings:setStealthMode', async (_event, input: { enabled: boolean }) =>
    setStealthMode(input.enabled)
  );

  ipcMain.handle('settings:setAlwaysOnTop', async (_event, input: { enabled: boolean }) =>
    setAlwaysOnTopMode(input.enabled)
  );

  ipcMain.handle('shell:openPath', async (_event, filePath: string) => {
    const errorMessage = await shell.openPath(filePath);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return true;
  });

  ipcMain.handle('shell:showItemInFolder', async (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
    return true;
  });

  ipcMain.handle('shell:openScreenshotsFolder', async () => {
    const screenshotsRoot = getScreenshotsRootPath();
    await mkdir(screenshotsRoot, { recursive: true });

    const errorMessage = await shell.openPath(screenshotsRoot);
    if (errorMessage) {
      throw new Error(errorMessage);
    }

    return true;
  });

  ipcMain.handle('window:resizeToContent', async (_event, input: { height: number }) => {
    if (!mainWindow) {
      return false;
    }

    const [width] = mainWindow.getContentSize();
    const nextHeight = Math.min(Math.max(Math.ceil(input.height), 68), 560);
    const nextWidth = Math.min(Math.max(width, 300), 520);
    mainWindow.setContentSize(nextWidth, nextHeight, true);
    return true;
  });
}

async function exportTimelineReportAsPng(): Promise<{ pngPath: string }> {
  const data = await repository.load();
  const generatedAt = new Date().toISOString();
  const reportDirectory = join(getScreenshotsRootPath(), getLocalDateKey(generatedAt));
  await mkdir(reportDirectory, { recursive: true });

  const report = generateTimelineReport(data, {
    generatedAt
  });
  const htmlPath = join(reportDirectory, `${report.fileName}.html`);
  let pngPath = join(reportDirectory, report.fileName);
  await writeFile(htmlPath, report.html, 'utf8');

  const reportWindow = new BrowserWindow({
    width: report.width,
    height: report.height,
    show: false,
    frame: false,
    useContentSize: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  try {
    await reportWindow.loadFile(htmlPath);
    await waitForReportAssets(reportWindow);
    const captureSize = await getReportCaptureSize(reportWindow, report.width, report.height);
    reportWindow.setContentSize(captureSize.width, captureSize.height);
    await waitForReportAssets(reportWindow);
    const image = await reportWindow.webContents.capturePage({
      x: 0,
      y: 0,
      width: captureSize.width,
      height: captureSize.height
    });
    pngPath = await writeUniqueFile(reportDirectory, report.fileName, image.toPNG());
  } finally {
    reportWindow.destroy();
    try {
      await unlink(htmlPath);
    } catch {
      // The temporary HTML is best-effort cleanup; the PNG is the actual export.
    }
  }

  return { pngPath };
}

async function getReportCaptureSize(
  window: BrowserWindow,
  fallbackWidth: number,
  fallbackHeight: number
): Promise<{ width: number; height: number }> {
  const size = (await window.webContents.executeJavaScript(`
    (() => {
      const element = document.documentElement;
      const body = document.body;
      return {
        width: Math.ceil(Math.max(
          element.scrollWidth,
          element.offsetWidth,
          body?.scrollWidth ?? 0,
          body?.offsetWidth ?? 0
        )),
        height: Math.ceil(Math.max(
          element.scrollHeight,
          element.offsetHeight,
          body?.scrollHeight ?? 0,
          body?.offsetHeight ?? 0
        ))
      };
    })();
  `)) as { width?: unknown; height?: unknown };

  return {
    width: normalizeCaptureDimension(size.width, fallbackWidth),
    height: normalizeCaptureDimension(size.height, fallbackHeight)
  };
}

function normalizeCaptureDimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.ceil(value) : fallback;
}

async function writeUniqueFile(directory: string, fileName: string, buffer: Buffer): Promise<string> {
  const dotIndex = fileName.lastIndexOf('.');
  const baseName = dotIndex === -1 ? fileName : fileName.slice(0, dotIndex);
  const extension = dotIndex === -1 ? '' : fileName.slice(dotIndex);
  let index = 0;

  while (true) {
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const filePath = join(directory, `${baseName}${suffix}${extension}`);

    try {
      await writeFile(filePath, buffer, { flag: 'wx' });
      return filePath;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {
        throw error;
      }
      index += 1;
    }
  }
}

async function waitForReportAssets(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript(`
    (async () => {
      if (document.fonts?.ready) {
        await document.fonts.ready;
      }
      await Promise.all(Array.from(document.images).map((image) => {
        if (image.complete) {
          return true;
        }
        return new Promise((resolve) => {
          image.onload = () => resolve(true);
          image.onerror = () => resolve(true);
        });
      }));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return true;
    })();
  `);
}

async function mutateAndBroadcast(mutator: (data: AppData) => AppData): Promise<ClientAppData> {
  const updated = await repository.update(mutator);
  const clientData = toClientData(updated);
  refreshTrayPresentation(updated);
  refreshTrayMenu(updated);
  mainWindow?.webContents.send('work:dataChanged', clientData);
  return clientData;
}

function toClientData(data: AppData): ClientAppData {
  return {
    ...data,
    screenshots: data.screenshots.map((screenshot) => ({
      ...screenshot,
      previewUrl: pathToFileURL(screenshot.path).href
    }))
  };
}

function showMainWindow(): void {
  if (!mainWindow) {
    createMainWindow();
  }

  mainWindow?.show();
  mainWindow?.focus();
  refreshTrayMenu();
}

function hideMainWindow(): void {
  mainWindow?.hide();
  refreshTrayMenu();
}

function toggleMainWindow(): void {
  if (mainWindow?.isVisible()) {
    hideMainWindow();
    return;
  }

  showMainWindow();
}

async function runTrayCommand(command: () => Promise<unknown>): Promise<void> {
  try {
    await command();
    showMainWindow();
  } catch (error) {
    new Notification({
      title: '忙个明白',
      body: getErrorMessage(error)
    }).show();
  }
}

async function openUserGuide(): Promise<void> {
  try {
    const errorMessage = await shell.openPath(getUserGuidePath());
    if (errorMessage) {
      throw new Error(errorMessage);
    }
  } catch (error) {
    new Notification({
      title: '忙个明白',
      body: getErrorMessage(error)
    }).show();
  }
}

async function toggleScreenshotShortcutTarget(): Promise<ClientAppData> {
  const data = await repository.load();
  const activeChild = findActiveChild(data);
  if (activeChild) {
    return mutateAndBroadcast((currentData) => toggleItemTiming(currentData, { itemId: activeChild.id }));
  }

  return insertScreenshotForActiveParent();
}

async function toggleMainTaskShortcutTarget(): Promise<ClientAppData> {
  const data = await repository.load();
  const activeSegment = findActiveSegment(data);
  if (activeSegment) {
    const rootItem = getRootItem(data, activeSegment.itemId);
    return mutateAndBroadcast((currentData) => toggleItemTiming(currentData, { itemId: rootItem.id }));
  }

  const firstRootItem = getSortedRootItems(data)[0];
  if (!firstRootItem) {
    throw new Error('请先添加一个主任务。');
  }

  return mutateAndBroadcast((currentData) => continueItem(currentData, { itemId: firstRootItem.id }));
}

async function toggleTrayRootTask(itemId: string): Promise<void> {
  try {
    await mutateAndBroadcast((data) => toggleItemTiming(data, { itemId }));
  } catch (error) {
    new Notification({
      title: '忙个明白',
      body: getErrorMessage(error)
    }).show();
  }
}

async function insertScreenshotForActiveParent(): Promise<ClientAppData> {
  const data = await repository.load();
  const activeItemIds = new Set(data.segments.filter((segment) => segment.endAt === null).map((segment) => segment.itemId));
  const activeParent = data.items.find((item) => item.parentId === null && activeItemIds.has(item.id));

  if (!activeParent) {
    throw new Error('需要先开始主任务，才能插入截图。');
  }

  const activeChild = findDirectActiveChild(data.items, activeItemIds, activeParent.id);
  if (activeChild) {
    throw new Error('请先结束当前截图子项。');
  }

  const captured = await captureScreenshotForRoot(activeParent);
  return mutateAndBroadcast((currentData) =>
    insertChildWithScreenshot(currentData, {
      parentId: activeParent.id,
      screenshotPath: captured.path,
      now: captured.capturedAt
    })
  );
}

async function captureScreenshotForActiveRoot() {
  const data = await repository.load();
  const activeSegment = data.segments.find((segment) => segment.endAt === null);
  if (!activeSegment) {
    throw new Error('需要先开始主任务，才能插入截图。');
  }

  return captureScreenshotForRoot(getReadyRootForScreenshot(data, activeSegment.itemId));
}

async function captureScreenshotForRoot(rootItem: WorkItem) {
  const capturedAt = new Date().toISOString();
  return capturePrimaryScreen(getScreenshotsRootPath(), {
    capturedAt,
    fileNameBase: getScreenshotFileNameBase(rootItem.title, capturedAt)
  });
}

function getScreenshotFileNameBase(rootTitle: string, capturedAt: string): string {
  const title = rootTitle.trim() || '未命名工作';
  return `${title}${formatFileClock(capturedAt)}`;
}

function formatFileClock(value: string): string {
  const date = new Date(value);
  return `${`${date.getHours()}`.padStart(2, '0')}：${`${date.getMinutes()}`.padStart(2, '0')}`;
}

function getReadyRootForChildFollowUp(data: AppData, parentId: string, childItemId: string): WorkItem {
  const childItem = data.items.find((item) => item.id === childItemId);
  if (!childItem || childItem.parentId !== parentId) {
    throw new Error('子项不属于当前任务。');
  }

  return getReadyRootForScreenshot(data, parentId);
}

function getReadyRootForScreenshot(data: AppData, itemId: string): WorkItem {
  const rootItem = getRootItem(data, itemId);
  const activeItemIds = new Set(data.segments.filter((segment) => segment.endAt === null).map((segment) => segment.itemId));

  if (!activeItemIds.has(rootItem.id)) {
    throw new Error('任务开始后才能插入截图子项。');
  }

  const activeChild = findDirectActiveChild(data.items, activeItemIds, rootItem.id);
  if (activeChild) {
    throw new Error('请先结束当前截图子项。');
  }

  return rootItem;
}

function getRootItem(data: AppData, itemId: string): WorkItem {
  let item = data.items.find((candidate) => candidate.id === itemId);
  const seen = new Set<string>();

  while (item?.parentId) {
    if (seen.has(item.id)) {
      throw new Error('工作项层级存在循环。');
    }
    seen.add(item.id);
    const parentId = item.parentId;
    item = data.items.find((candidate) => candidate.id === parentId);
  }

  if (!item) {
    throw new Error('没有找到对应的主任务。');
  }

  return item;
}

function findDirectActiveChild(items: WorkItem[], activeItemIds: Set<string>, parentId: string): WorkItem | null {
  return items.find((item) => item.parentId === parentId && activeItemIds.has(item.id)) ?? null;
}

function findActiveSegment(data: AppData): WorkSegment | null {
  return (
    (data.activeSegmentId
      ? data.segments.find((segment) => segment.id === data.activeSegmentId && segment.endAt === null)
      : null) ??
    data.segments.find((segment) => segment.endAt === null) ??
    null
  );
}

function findActiveChild(data: AppData): WorkItem | null {
  const activeItemIds = new Set(data.segments.filter((segment) => segment.endAt === null).map((segment) => segment.itemId));
  return data.items.find((item) => item.parentId !== null && activeItemIds.has(item.id)) ?? null;
}

function hasActiveChild(data: AppData): boolean {
  return Boolean(findActiveChild(data));
}

function isRootItemRunning(data: AppData, rootItemId: string): boolean {
  return data.segments.some((segment) => {
    if (segment.endAt !== null) {
      return false;
    }

    try {
      return getRootItem(data, segment.itemId).id === rootItemId;
    } catch {
      return false;
    }
  });
}

function getSortedRootItems(data: AppData): WorkItem[] {
  return data.items
    .filter((item) => item.parentId === null)
    .sort((a, b) => compareItemsByOrder(a, b));
}

function compareItemsByOrder(a: WorkItem, b: WorkItem): number {
  const orderA = Number.isFinite(a.order) ? a.order : 0;
  const orderB = Number.isFinite(b.order) ? b.order : 0;
  if (orderA !== orderB) {
    return orderA - orderB;
  }

  return a.createdAt.localeCompare(b.createdAt);
}

function getTrayTaskLabel(title: string): string {
  const normalizedTitle = title.trim() || '未命名工作';
  return normalizedTitle.length > 6 ? `${normalizedTitle.slice(0, 6)}...` : normalizedTitle;
}

async function loadSettings(): Promise<void> {
  try {
    const raw = await readFile(getSettingsPath(), 'utf8');
    settings = normalizeSettings(JSON.parse(raw));
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error;
    }
  }
}

async function saveSettings(): Promise<void> {
  await mkdir(getWorkDataRoot(app.getPath('userData')), { recursive: true });
  await writeFile(getSettingsPath(), `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}

async function setScreenshotShortcut(shortcut: string | null): Promise<AppSettings> {
  const nextShortcut = normalizeShortcutValue(shortcut);

  if (shortcut && !nextShortcut) {
    throw new Error('快捷键需要包含 Command、Control 或 Option。');
  }

  const previousShortcut = normalizeShortcutValue(settings.screenshotShortcut);
  unregisterScreenshotShortcut(previousShortcut);
  settings = {
    ...settings,
    screenshotShortcut: nextShortcut
  };

  try {
    registerScreenshotShortcut(nextShortcut);
    await saveSettings();
  } catch (error) {
    unregisterScreenshotShortcut(nextShortcut);
    settings = {
      ...settings,
      screenshotShortcut: previousShortcut
    };
    try {
      registerScreenshotShortcut(previousShortcut);
    } catch {
      settings = {
        ...settings,
        screenshotShortcut: null
      };
    }
    throw error;
  }

  mainWindow?.webContents.send('settings:changed', settings);
  refreshTrayMenu();
  refreshApplicationMenu();
  return settings;
}

async function setMainTaskShortcut(shortcut: string | null): Promise<AppSettings> {
  const nextShortcut = normalizeShortcutValue(shortcut);

  if (shortcut && !nextShortcut) {
    throw new Error('快捷键需要包含 Command、Control 或 Option。');
  }

  const previousShortcut = normalizeShortcutValue(settings.mainTaskShortcut);
  unregisterMainTaskShortcut(previousShortcut);
  settings = {
    ...settings,
    mainTaskShortcut: nextShortcut
  };

  try {
    registerMainTaskShortcut(nextShortcut);
    await saveSettings();
  } catch (error) {
    unregisterMainTaskShortcut(nextShortcut);
    settings = {
      ...settings,
      mainTaskShortcut: previousShortcut
    };
    try {
      registerMainTaskShortcut(previousShortcut);
    } catch {
      settings = {
        ...settings,
        mainTaskShortcut: null
      };
    }
    throw error;
  }

  mainWindow?.webContents.send('settings:changed', settings);
  refreshTrayMenu();
  refreshApplicationMenu();
  return settings;
}

async function setStealthMode(stealthMode: boolean): Promise<AppSettings> {
  settings = {
    ...settings,
    stealthMode
  };
  applyAppPresentationMode();
  applyWindowPresentationMode();
  await saveSettingsAndNotify();
  return settings;
}

async function setAlwaysOnTopMode(alwaysOnTop: boolean): Promise<AppSettings> {
  settings = {
    ...settings,
    alwaysOnTop
  };
  applyWindowPresentationMode();
  await saveSettingsAndNotify();
  return settings;
}

async function saveSettingsAndNotify(): Promise<void> {
  try {
    await saveSettings();
  } catch (error) {
    new Notification({
      title: '忙个明白',
      body: getErrorMessage(error)
    }).show();
  }

  mainWindow?.webContents.send('settings:changed', settings);
  refreshTrayMenu();
  refreshApplicationMenu();
}

function applyAppPresentationMode(): void {
  if (process.platform !== 'darwin') {
    return;
  }

  app.setActivationPolicy(settings.stealthMode ? 'accessory' : 'regular');
  if (settings.stealthMode) {
    app.dock?.hide();
  } else {
    void app.dock?.show();
  }
}

function applyWindowPresentationMode(): void {
  if (!mainWindow) {
    return;
  }

  mainWindow.setSkipTaskbar(settings.stealthMode);
  mainWindow.setAlwaysOnTop(settings.alwaysOnTop, settings.alwaysOnTop ? 'floating' : 'normal');
}

function registerScreenshotShortcut(shortcut: string | null): void {
  if (!shortcut) {
    return;
  }

  let registered = false;

  try {
    registered = globalShortcut.register(shortcut, () => {
      void runTrayCommand(toggleScreenshotShortcutTarget);
    });
  } catch {
    throw new Error('这个快捷键无法使用，请换一个组合。');
  }

  if (!registered) {
    throw new Error('这个快捷键已被系统或其他应用占用。');
  }
}

function registerMainTaskShortcut(shortcut: string | null): void {
  if (!shortcut) {
    return;
  }

  let registered = false;

  try {
    registered = globalShortcut.register(shortcut, () => {
      void runTrayCommand(toggleMainTaskShortcutTarget);
    });
  } catch {
    throw new Error('这个快捷键无法使用，请换一个组合。');
  }

  if (!registered) {
    throw new Error('这个快捷键已被系统或其他应用占用。');
  }
}

function unregisterScreenshotShortcut(shortcut: string | null): void {
  const normalizedShortcut = normalizeShortcutValue(shortcut);
  if (!normalizedShortcut) {
    return;
  }

  try {
    globalShortcut.unregister(normalizedShortcut);
  } catch {
    // Ignore stale malformed shortcuts left from an older recorder bug.
  }
}

function unregisterMainTaskShortcut(shortcut: string | null): void {
  const normalizedShortcut = normalizeShortcutValue(shortcut);
  if (!normalizedShortcut) {
    return;
  }

  try {
    globalShortcut.unregister(normalizedShortcut);
  } catch {
    // Ignore stale malformed shortcuts left from an older recorder bug.
  }
}

function normalizeSettings(value: unknown): AppSettings {
  if (!isRecord(value)) {
    return settings;
  }

  return {
    minimizeToTray: true,
    stealthMode: typeof value.stealthMode === 'boolean' ? value.stealthMode : false,
    alwaysOnTop: typeof value.alwaysOnTop === 'boolean' ? value.alwaysOnTop : false,
    screenshotShortcut: typeof value.screenshotShortcut === 'string' ? normalizeShortcutValue(value.screenshotShortcut) : null,
    mainTaskShortcut: typeof value.mainTaskShortcut === 'string' ? normalizeShortcutValue(value.mainTaskShortcut) : null
  };
}

function getSettingsPath(): string {
  return join(getWorkDataRoot(app.getPath('userData')), 'settings.json');
}

function getUserGuidePath(): string {
  return join(app.isPackaged ? process.resourcesPath : app.getAppPath(), '用户使用说明.md');
}

function getMenuBarIconPath(kind: 'main' | 'child'): string {
  const basePath = app.isPackaged ? process.resourcesPath : app.getAppPath();
  const iconFileName = kind === 'child' ? 'menu-bar-child-icon.png' : 'menu-bar-icon.png';
  const iconPath = app.isPackaged ? iconFileName : `build/${iconFileName}`;
  return join(basePath, iconPath);
}

function getScreenshotsRootPath(): string {
  return getScreenshotsRoot(app.getPath('pictures'));
}

function isValidShortcut(shortcut: string): boolean {
  const parts = shortcut.split('+');
  const modifiers = new Set(['Command', 'Control', 'Alt', 'Shift', 'CommandOrControl']);
  const hasModifier = parts.some((part) => ['Command', 'Control', 'Alt', 'CommandOrControl'].includes(part));
  const keyParts = parts.filter((part) => !modifiers.has(part));

  return parts.every(Boolean) && hasModifier && keyParts.length === 1;
}

function normalizeShortcutValue(shortcut: string | null): string | null {
  if (!shortcut) {
    return null;
  }

  const trimmedShortcut = shortcut.trim();
  return isValidShortcut(trimmedShortcut) ? trimmedShortcut : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后再试。';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

app.whenReady().then(async () => {
  repository = new JsonWorkRepository(getWorkDataRoot(app.getPath('userData')));
  await loadSettings();
  const shouldResetStealthMode = settings.stealthMode;
  if (shouldResetStealthMode) {
    settings = {
      ...settings,
      stealthMode: false
    };
  }
  setupAboutPanel();
  refreshApplicationMenu();
  applyAppPresentationMode();
  let shouldSaveSettings = shouldResetStealthMode;
  try {
    registerScreenshotShortcut(settings.screenshotShortcut);
  } catch {
    settings = {
      ...settings,
      screenshotShortcut: null
    };
    shouldSaveSettings = true;
  }
  try {
    registerMainTaskShortcut(settings.mainTaskShortcut);
  } catch {
    settings = {
      ...settings,
      mainTaskShortcut: null
    };
    shouldSaveSettings = true;
  }
  if (shouldSaveSettings) {
    await saveSettings();
  }
  setupIpc();
  createMainWindow();
  createTray();
  applyWindowPresentationMode();

  app.on('activate', showMainWindow);
});

app.on('before-quit', () => {
  isQuitting = true;
  if (trayTitleTimer) {
    clearInterval(trayTitleTimer);
    trayTitleTimer = null;
  }
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
