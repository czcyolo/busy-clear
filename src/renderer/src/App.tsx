import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { Camera, Download, Keyboard, Pin, Plus, Play, Square, Trash2 } from 'lucide-react';
import type { AppSettings, ClientAppData, WorkItem, WorkSegment } from '../../shared/types';
import { findActiveSegments, getItemDurationMs } from '../../shared/workSession';
import bullUpperMaskUrl from './assets/bull-upper-runner-mask.png';
import bullWheelMaskUrl from './assets/bull-wheel-mask.png';

const MARKER_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#059669', '#dc2626', '#0891b2', '#c026d3'];
const TITLE_BASE_FONT_SIZE_PX = 14;
const TITLE_MIN_FONT_SIZE_PX = 4;
const TITLE_INPUT_HEIGHT_PX = 28;
const TITLE_MAX_LINE_COUNT = 3;
let titleMeasureContext: CanvasRenderingContext2D | null = null;

type ShortcutRecorder = {
  type: 'screenshot' | 'main';
  itemId: string;
};

type TaskDragState = {
  itemId: string;
  pointerId: number;
  pointerStartX: number;
  pointerStartY: number;
  pointerOffsetY: number;
  rowLeft: number;
  rowWidth: number;
  title: string;
  timeText: string;
  orderIds: string[];
  isDragging: boolean;
};

type TaskDragVisual = {
  itemId: string;
  left: number;
  top: number;
  width: number;
  title: string;
  timeText: string;
};

type TaskDragWindowHandlers = {
  move: (event: PointerEvent) => void;
  up: (event: PointerEvent) => void;
  cancel: (event: PointerEvent) => void;
  blur: () => void;
};

export default function App(): JSX.Element {
  const appRef = useRef<HTMLElement | null>(null);
  const [data, setData] = useState<ClientAppData | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(() => Date.now());
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [shortcutRecorder, setShortcutRecorder] = useState<ShortcutRecorder | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [taskDragVisual, setTaskDragVisual] = useState<TaskDragVisual | null>(null);
  const [previewRootItemIds, setPreviewRootItemIds] = useState<string[] | null>(null);
  const taskDragRef = useRef<TaskDragState | null>(null);
  const previewRootItemIdsRef = useRef<string[] | null>(null);
  const taskNodeRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingTaskDragVisualRef = useRef<TaskDragVisual | null>(null);
  const taskDragAnimationFrameRef = useRef<number | null>(null);
  const taskDragWindowHandlersRef = useRef<TaskDragWindowHandlers | null>(null);

  useEffect(() => {
    let mounted = true;

    window.busyApi
      .getToday()
      .then((nextData) => {
        if (mounted) {
          setData(nextData);
        }
      })
      .catch((loadError) => setError(getErrorMessage(loadError)));

    window.busyApi
      .getSettings()
      .then((nextSettings) => {
        if (mounted) {
          setSettings(nextSettings);
        }
      })
      .catch((loadError) => setError(getErrorMessage(loadError)));

    const unsubscribe = window.busyApi.onDataChanged((nextData) => {
      setData(nextData);
    });
    const unsubscribeSettings = window.busyApi.onSettingsChanged((nextSettings) => {
      setSettings(nextSettings);
    });

    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeSettings();
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(
    () => () => {
      removeTaskDragWindowListeners();
      if (taskDragAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(taskDragAnimationFrameRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!shortcutRecorder) {
      return;
    }

    const handleShortcutKeyDown = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();

      if (event.key === 'Escape') {
        setShortcutRecorder(null);
        setError('');
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        void saveShortcut(shortcutRecorder.type, null);
        return;
      }

      const shortcut = eventToAccelerator(event);
      if (!shortcut) {
        return;
      }

      void saveShortcut(shortcutRecorder.type, shortcut);
    };

    window.addEventListener('keydown', handleShortcutKeyDown, true);
    return () => window.removeEventListener('keydown', handleShortcutKeyDown, true);
  }, [shortcutRecorder]);

  useEffect(() => {
    if (!appRef.current) {
      return;
    }

    const resize = (): void => {
      const height = appRef.current?.scrollHeight ?? 56;
      void window.busyApi.resizeToContent({ height });
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(appRef.current);

    return () => observer.disconnect();
  }, [data?.items.length, data?.segments.length, data?.screenshots.length, error]);

  const activeItemIds = useMemo(
    () => new Set(data ? findActiveSegments(data).map((segment) => segment.itemId) : []),
    [data]
  );
  const rootItems = useMemo(() => (data ? getChildren(data, null) : []), [data]);
  const displayedRootItems = useMemo(
    () => applyPreviewOrder(rootItems, previewRootItemIds),
    [rootItems, previewRootItemIds]
  );

  async function runAction(actionId: string, action: () => Promise<ClientAppData>): Promise<void> {
    setBusyId(actionId);
    setError('');

    try {
      setData(await action());
    } catch (actionError) {
      setError(getErrorMessage(actionError));
    } finally {
      setBusyId(null);
    }
  }

  async function saveShortcut(type: ShortcutRecorder['type'], shortcut: string | null): Promise<void> {
    setBusyId('shortcut');
    setError('');

    try {
      const nextSettings =
        type === 'screenshot'
          ? await window.busyApi.setScreenshotShortcut({ shortcut })
          : await window.busyApi.setMainTaskShortcut({ shortcut });
      setSettings(nextSettings);
      setShortcutRecorder(null);
    } catch (shortcutError) {
      setError(getErrorMessage(shortcutError));
    } finally {
      setBusyId(null);
    }
  }

  async function reorderRootItems(itemIds: string[]): Promise<void> {
    setBusyId('reorder');
    setError('');

    try {
      setData(await window.busyApi.reorderRootItems({ itemIds }));
    } catch (reorderError) {
      setError(getErrorMessage(reorderError));
    } finally {
      setBusyId(null);
      setDraggedTaskId(null);
      clearTaskDragVisual();
      setPreviewOrder(null);
    }
  }

  function setPreviewOrder(itemIds: string[] | null): void {
    previewRootItemIdsRef.current = itemIds;
    setPreviewRootItemIds(itemIds);
  }

  function setTaskNodeRef(itemId: string, node: HTMLDivElement | null): void {
    if (node) {
      taskNodeRefs.current.set(itemId, node);
      return;
    }

    taskNodeRefs.current.delete(itemId);
  }

  function handleTaskPointerDown(event: ReactPointerEvent<HTMLDivElement>, item: WorkItem, timeText: string): void {
    if (event.button !== 0 || busyId || isInteractiveTaskDragTarget(event.target)) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    taskDragRef.current = {
      itemId: item.id,
      pointerId: event.pointerId,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      pointerOffsetY: event.clientY - rect.top,
      rowLeft: rect.left,
      rowWidth: rect.width,
      title: getVisibleTitle(item) || '任务',
      timeText,
      orderIds: displayedRootItems.map((candidate) => candidate.id),
      isDragging: false
    };
    addTaskDragWindowListeners();
  }

  function handleTaskPointerMove(pointerId: number, clientX: number, clientY: number): void {
    const dragState = taskDragRef.current;
    if (!dragState || dragState.pointerId !== pointerId || busyId) {
      return;
    }

    const distanceX = clientX - dragState.pointerStartX;
    const distanceY = clientY - dragState.pointerStartY;
    const hasMovedEnough = Math.hypot(distanceX, distanceY) > 5;

    if (!dragState.isDragging && !hasMovedEnough) {
      return;
    }

    if (!dragState.isDragging) {
      dragState.isDragging = true;
      setDraggedTaskId(dragState.itemId);
      setPreviewOrder(dragState.orderIds);
    }

    const currentOrderIds = previewRootItemIdsRef.current ?? dragState.orderIds;
    const nextOrderIds = getTaskOrderForPointer(currentOrderIds, dragState.itemId, clientY, taskNodeRefs.current);
    if (!areStringArraysEqual(currentOrderIds, nextOrderIds)) {
      animateTaskReorder(nextOrderIds, dragState.itemId);
    }

    scheduleTaskDragVisual({
      itemId: dragState.itemId,
      left: dragState.rowLeft,
      top: clientY - dragState.pointerOffsetY,
      width: dragState.rowWidth,
      title: dragState.title,
      timeText: dragState.timeText
    });
  }

  function handleTaskPointerUp(pointerId: number): void {
    const dragState = taskDragRef.current;
    if (!dragState || dragState.pointerId !== pointerId) {
      return;
    }

    finishTaskPointerDrag(dragState.isDragging);
  }

  function handleTaskPointerCancel(pointerId: number): void {
    const dragState = taskDragRef.current;
    if (!dragState || dragState.pointerId !== pointerId) {
      return;
    }

    finishTaskPointerDrag(false);
  }

  function finishTaskPointerDrag(shouldSave: boolean): void {
    const dragState = taskDragRef.current;
    if (!dragState) {
      return;
    }

    removeTaskDragWindowListeners();
    taskDragRef.current = null;

    const nextOrderIds = previewRootItemIdsRef.current;
    clearTaskDragVisual();
    setDraggedTaskId(null);

    if (shouldSave && nextOrderIds && !areStringArraysEqual(nextOrderIds, dragState.orderIds)) {
      void reorderRootItems(nextOrderIds);
      return;
    }

    setPreviewOrder(null);
  }

  function addTaskDragWindowListeners(): void {
    removeTaskDragWindowListeners();

    const handlers: TaskDragWindowHandlers = {
      move: (event) => {
        handleTaskPointerMove(event.pointerId, event.clientX, event.clientY);
      },
      up: (event) => {
        handleTaskPointerUp(event.pointerId);
      },
      cancel: (event) => {
        handleTaskPointerCancel(event.pointerId);
      },
      blur: () => {
        finishTaskPointerDrag(false);
      }
    };

    taskDragWindowHandlersRef.current = handlers;
    window.addEventListener('pointermove', handlers.move);
    window.addEventListener('pointerup', handlers.up);
    window.addEventListener('pointercancel', handlers.cancel);
    window.addEventListener('blur', handlers.blur);
  }

  function removeTaskDragWindowListeners(): void {
    const handlers = taskDragWindowHandlersRef.current;
    if (!handlers) {
      return;
    }

    window.removeEventListener('pointermove', handlers.move);
    window.removeEventListener('pointerup', handlers.up);
    window.removeEventListener('pointercancel', handlers.cancel);
    window.removeEventListener('blur', handlers.blur);
    taskDragWindowHandlersRef.current = null;
  }

  function animateTaskReorder(nextOrderIds: string[], draggedItemId: string): void {
    const previousRects = getTaskNodeRects(taskNodeRefs.current);
    setPreviewOrder(nextOrderIds);

    window.requestAnimationFrame(() => {
      const animations: Array<{ node: HTMLDivElement; deltaY: number }> = [];
      taskNodeRefs.current.forEach((node, itemId) => {
        if (itemId === draggedItemId) {
          return;
        }

        const previousRect = previousRects.get(itemId);
        if (!previousRect) {
          return;
        }

        const nextRect = node.getBoundingClientRect();
        const deltaY = previousRect.top - nextRect.top;
        if (Math.abs(deltaY) < 0.5) {
          return;
        }

        animations.push({ node, deltaY });
      });

      if (animations.length === 0) {
        return;
      }

      animations.forEach(({ node, deltaY }) => {
        node.style.transition = 'none';
        node.style.transform = `translateY(${deltaY}px)`;
      });

      void document.body.offsetHeight;

      animations.forEach(({ node }) => {
        node.style.transition = 'transform 140ms ease';
        node.style.transform = '';
        window.setTimeout(() => {
          node.style.transition = '';
        }, 160);
      });
    });
  }

  function scheduleTaskDragVisual(visual: TaskDragVisual): void {
    pendingTaskDragVisualRef.current = visual;

    if (taskDragAnimationFrameRef.current !== null) {
      return;
    }

    taskDragAnimationFrameRef.current = window.requestAnimationFrame(() => {
      taskDragAnimationFrameRef.current = null;
      const nextVisual = pendingTaskDragVisualRef.current;
      pendingTaskDragVisualRef.current = null;

      if (nextVisual) {
        setTaskDragVisual(nextVisual);
      }
    });
  }

  function clearTaskDragVisual(): void {
    pendingTaskDragVisualRef.current = null;
    if (taskDragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(taskDragAnimationFrameRef.current);
      taskDragAnimationFrameRef.current = null;
    }
    setTaskDragVisual(null);
  }

  async function openScreenshotsFolder(): Promise<void> {
    setBusyId('screenshots-folder');
    setError('');

    try {
      await window.busyApi.openScreenshotsFolder();
    } catch (folderError) {
      setError(getErrorMessage(folderError));
    } finally {
      setBusyId(null);
    }
  }

  async function exportTimelineReport(): Promise<void> {
    setBusyId('export-timeline');
    setError('');

    try {
      const result = await window.busyApi.exportTimelineReport();
      await window.busyApi.showItemInFolder(result.pngPath);
    } catch (exportError) {
      setError(getErrorMessage(exportError));
    } finally {
      setBusyId(null);
    }
  }

  async function setStealthMode(enabled: boolean): Promise<void> {
    setBusyId('stealth-mode');
    setError('');

    try {
      setSettings(await window.busyApi.setStealthMode({ enabled }));
    } catch (settingsError) {
      setError(getErrorMessage(settingsError));
    } finally {
      setBusyId(null);
    }
  }

  async function setAlwaysOnTop(enabled: boolean): Promise<void> {
    setBusyId('always-on-top');
    setError('');

    try {
      setSettings(await window.busyApi.setAlwaysOnTop({ enabled }));
    } catch (settingsError) {
      setError(getErrorMessage(settingsError));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main ref={appRef} className="mini-app">
      <div className="top-strip" />

      {data && displayedRootItems.length > 0 && (
        <section className="task-list" aria-label="任务列表">
          {displayedRootItems.map((item) => (
            <TaskRow
              key={item.id}
              taskNodeRef={(node) => setTaskNodeRef(item.id, node)}
              data={data}
              item={item}
              tick={tick}
              activeItemIds={activeItemIds}
              busyId={busyId}
              settings={settings}
              isDraggingTask={draggedTaskId === item.id}
              isRecordingScreenshotShortcut={shortcutRecorder?.type === 'screenshot' && shortcutRecorder.itemId === item.id}
              isRecordingMainShortcut={shortcutRecorder?.type === 'main' && shortcutRecorder.itemId === item.id}
              onUpdateData={setData}
              onRun={runAction}
              onShortcutRecordStart={setShortcutRecorder}
              onOpenScreenshotsFolder={openScreenshotsFolder}
              onTaskPointerDown={handleTaskPointerDown}
            />
          ))}
        </section>
      )}

      {taskDragVisual && <TaskDragGhost visual={taskDragVisual} />}

      <div className="bottom-actions">
        <button
          type="button"
          className="add-row-button"
          title="添加任务"
          aria-label="添加任务"
          disabled={!data || busyId === 'add'}
          onClick={() => void runAction('add', () => window.busyApi.addItem())}
        >
          <Plus size={14} aria-hidden="true" />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={settings?.stealthMode ?? false}
          className={settings?.stealthMode ? 'stealth-switch is-on' : 'stealth-switch'}
          title={settings?.stealthMode ? '关闭无感模式' : '开启无感模式'}
          aria-label={settings?.stealthMode ? '关闭无感模式' : '开启无感模式'}
          disabled={!settings || busyId === 'stealth-mode'}
          onClick={() => void setStealthMode(!(settings?.stealthMode ?? false))}
        >
          <span className="stealth-switch-track" aria-hidden="true">
            <span className="stealth-switch-knob" />
          </span>
        </button>
        <button
          type="button"
          className={settings?.alwaysOnTop ? 'export-button is-active-mode' : 'export-button'}
          title={settings?.alwaysOnTop ? '取消置顶' : '置顶'}
          aria-label={settings?.alwaysOnTop ? '取消置顶' : '置顶'}
          disabled={!settings || busyId === 'always-on-top'}
          onClick={() => void setAlwaysOnTop(!(settings?.alwaysOnTop ?? false))}
        >
          <Pin size={13} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="export-button"
          title="导出过去24小时时间轴"
          aria-label="导出过去24小时时间轴"
          disabled={!data || busyId === 'export-timeline'}
          onClick={() => void exportTimelineReport()}
        >
          <Download size={14} aria-hidden="true" />
        </button>
      </div>

      {error && <p className="mini-error">{error}</p>}
    </main>
  );
}

type TaskRowProps = {
  taskNodeRef: (node: HTMLDivElement | null) => void;
  data: ClientAppData;
  item: WorkItem;
  tick: number;
  activeItemIds: Set<string>;
  busyId: string | null;
  settings: AppSettings | null;
  isDraggingTask: boolean;
  isRecordingScreenshotShortcut: boolean;
  isRecordingMainShortcut: boolean;
  onUpdateData: (data: ClientAppData) => void;
  onRun: (actionId: string, action: () => Promise<ClientAppData>) => Promise<void>;
  onShortcutRecordStart: (recorder: ShortcutRecorder) => void;
  onOpenScreenshotsFolder: () => Promise<void>;
  onTaskPointerDown: (event: ReactPointerEvent<HTMLDivElement>, item: WorkItem, timeText: string) => void;
};

function TaskRow({
  taskNodeRef,
  data,
  item,
  tick,
  activeItemIds,
  busyId,
  settings,
  isDraggingTask,
  isRecordingScreenshotShortcut,
  isRecordingMainShortcut,
  onUpdateData,
  onRun,
  onShortcutRecordStart,
  onOpenScreenshotsFolder,
  onTaskPointerDown
}: TaskRowProps): JSX.Element {
  const isActive = activeItemIds.has(item.id);
  const children = getChildren(data, item.id);
  const timeline = getTaskTimeline(data, item.id, tick);
  const activeChild = children.find((child) => activeItemIds.has(child.id)) ?? null;
  const itemBusy = busyId?.endsWith(item.id) ?? false;
  const deleteButtonRef = useRef<HTMLButtonElement | null>(null);
  const [draggedMarkerId, setDraggedMarkerId] = useState<string | null>(null);
  const [isDeleteDropTargetActive, setIsDeleteDropTargetActive] = useState(false);
  const deleteButtonClassName = getDeleteButtonClassName(draggedMarkerId, isDeleteDropTargetActive);
  const timeText = formatTaskTime(data, item.id, tick);

  return (
    <div ref={taskNodeRef} className={getTaskNodeClassName(isDraggingTask)}>
      <div
        className={isActive ? 'task-row is-active' : 'task-row'}
        onPointerDown={(event) => onTaskPointerDown(event, item, timeText)}
      >
        <TaskTitleInput item={item} onUpdateData={onUpdateData} />
        <span className="time-text" title={formatAllRanges(data, item.id, tick)}>
          {timeText}
        </span>
        <div className="row-actions">
          <button
            type="button"
            className={isRecordingMainShortcut ? 'icon-button is-recording-shortcut' : isActive ? 'icon-button is-stop' : 'icon-button'}
            title={
              isRecordingMainShortcut
                ? '按下主项快捷键，Esc 取消，退格清除'
                : `${isActive ? '结束' : '开始'}${settings?.mainTaskShortcut ? ` (${settings.mainTaskShortcut})` : ''}`
            }
            aria-label={isActive ? '结束' : '开始'}
            disabled={itemBusy}
            onClick={() => void onRun(`toggle:${item.id}`, () => window.busyApi.toggleItemTiming({ itemId: item.id }))}
            onContextMenu={(event) => {
              event.preventDefault();
              onShortcutRecordStart({ type: 'main', itemId: item.id });
            }}
          >
            {isRecordingMainShortcut ? (
              <Keyboard size={14} aria-hidden="true" />
            ) : isActive ? (
              <Square size={14} aria-hidden="true" />
            ) : (
              <Play size={14} aria-hidden="true" />
            )}
          </button>
          {isActive && activeChild && (
            <button
              type="button"
              className="icon-button is-child-stop"
              title="结束子项"
              aria-label="结束子项"
              disabled={itemBusy}
              onClick={() =>
                void onRun(`toggle-child:${activeChild.id}`, () =>
                  window.busyApi.toggleItemTiming({ itemId: activeChild.id })
                )
              }
            >
              <Square size={14} aria-hidden="true" />
            </button>
          )}
          {isActive && !activeChild && (
            <button
              type="button"
              className={isRecordingScreenshotShortcut ? 'icon-button is-recording-shortcut' : 'icon-button'}
              title={
                isRecordingScreenshotShortcut
                  ? '按下快捷键，Esc 取消，退格清除'
                  : `插入并截图${settings?.screenshotShortcut ? ` (${settings.screenshotShortcut})` : ''}`
              }
              aria-label="插入并截图"
              disabled={itemBusy}
              onClick={() =>
                void onRun(`insert:${item.id}`, () => window.busyApi.insertChildWithScreenshot({ parentId: item.id }))
              }
              onContextMenu={(event) => {
                event.preventDefault();
                onShortcutRecordStart({ type: 'screenshot', itemId: item.id });
              }}
            >
              {isRecordingScreenshotShortcut ? (
                <Keyboard size={14} aria-hidden="true" />
              ) : (
                <Camera size={14} aria-hidden="true" />
              )}
            </button>
          )}
          <button
            ref={deleteButtonRef}
            type="button"
            className={deleteButtonClassName}
            title="删除"
            aria-label="删除"
            disabled={itemBusy}
            onClick={() => void onRun(`delete:${item.id}`, () => window.busyApi.deleteItem({ itemId: item.id }))}
            onContextMenu={(event) => {
              event.preventDefault();
              void onOpenScreenshotsFolder();
            }}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {timeline && (
        <TaskTrack
          parentSegments={timeline.parentSegments}
          childSegments={timeline.childSegments}
          markers={timeline.markers}
          isRunning={isActive}
          parentId={item.id}
          parentIsRunning={isActive}
          busyId={busyId}
          onRun={onRun}
          deleteButtonRef={deleteButtonRef}
          draggedMarkerId={draggedMarkerId}
          onMarkerDragStateChange={setDraggedMarkerId}
          onDeleteDropTargetChange={setIsDeleteDropTargetActive}
        />
      )}
    </div>
  );
}

type TaskTrackProps = {
  parentSegments: TimelineSegment[];
  childSegments: TimelineChildSegment[];
  markers: TimelineMarker[];
  isRunning: boolean;
  parentId: string;
  parentIsRunning: boolean;
  busyId: string | null;
  onRun: (actionId: string, action: () => Promise<ClientAppData>) => Promise<void>;
  deleteButtonRef: RefObject<HTMLButtonElement | null>;
  draggedMarkerId: string | null;
  onMarkerDragStateChange: (markerId: string | null) => void;
  onDeleteDropTargetChange: (isActive: boolean) => void;
};

function TaskTrack({
  parentSegments,
  childSegments,
  markers,
  isRunning,
  parentId,
  parentIsRunning,
  busyId,
  onRun,
  deleteButtonRef,
  draggedMarkerId,
  onMarkerDragStateChange,
  onDeleteDropTargetChange
}: TaskTrackProps): JSX.Element {
  const markerDragRef = useRef<MarkerDragState | null>(null);
  const suppressMarkerClickRef = useRef(false);
  const [dragVisual, setDragVisual] = useState<MarkerDragVisual | null>(null);

  function handleMarkerPointerDown(event: ReactPointerEvent<HTMLButtonElement>, marker: TimelineMarker): void {
    if (event.button !== 0 || busyId) {
      return;
    }

    markerDragRef.current = {
      marker,
      pointerId: event.pointerId,
      pointerStartX: event.clientX,
      pointerStartY: event.clientY,
      isDragging: false
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleMarkerPointerMove(event: ReactPointerEvent<HTMLButtonElement>): void {
    const dragState = markerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const distanceX = event.clientX - dragState.pointerStartX;
    const distanceY = event.clientY - dragState.pointerStartY;
    const hasMovedEnough = Math.hypot(distanceX, distanceY) > 5;

    if (!dragState.isDragging && hasMovedEnough) {
      dragState.isDragging = true;
      onMarkerDragStateChange(dragState.marker.id);
    }

    if (dragState.isDragging) {
      setDragVisual({
        marker: dragState.marker,
        currentX: event.clientX,
        currentY: event.clientY
      });
      onDeleteDropTargetChange(isPointInsideElement(deleteButtonRef.current, event.clientX, event.clientY));
    }
  }

  function handleMarkerPointerUp(event: ReactPointerEvent<HTMLButtonElement>): void {
    const dragState = markerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const shouldDelete =
      dragState.isDragging && isPointInsideElement(deleteButtonRef.current, event.clientX, event.clientY);
    finishMarkerDrag(event);

    if (!shouldDelete) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const marker = dragState.marker;
    const actionId = marker.isFollowUp ? `delete-shot:${marker.id}` : `delete-child:${marker.itemId}`;
    void onRun(actionId, () =>
      marker.isFollowUp
        ? window.busyApi.deleteScreenshotMarker({ screenshotId: marker.id })
        : window.busyApi.deleteItem({ itemId: marker.itemId })
    );
  }

  function handleMarkerPointerCancel(event: ReactPointerEvent<HTMLButtonElement>): void {
    finishMarkerDrag(event);
  }

  function finishMarkerDrag(event: ReactPointerEvent<HTMLButtonElement>): void {
    const dragState = markerDragRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    markerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onMarkerDragStateChange(null);
    onDeleteDropTargetChange(false);
    setDragVisual(null);

    if (dragState.isDragging) {
      suppressMarkerClickRef.current = true;
      window.setTimeout(() => {
        suppressMarkerClickRef.current = false;
      }, 0);
    }
  }

  return (
    <div className={isRunning ? 'task-track is-running' : 'task-track'} aria-label="任务时间条">
      <div className="main-track">
        <div className="track-zone">
          <div className="track-line" />
          {parentSegments.map((segment) => (
            <span
              key={segment.id}
              className="track-segment"
              style={{ left: `${segment.left}%`, width: `${segment.width}%` }}
            />
          ))}
          {childSegments.map((segment) => (
            <span
              key={segment.id}
              className="track-child-segment"
              style={{
                left: `${segment.left}%`,
                width: `${segment.width}%`,
                backgroundColor: segment.color
              }}
            />
          ))}
          {markers.map((marker) => (
            <button
              key={marker.id}
              type="button"
              className={getShotMarkerClassName(marker, draggedMarkerId)}
              title={`截图 ${formatClock(marker.capturedAt)}`}
              style={
                {
                  left: `${marker.position}%`,
                  backgroundColor: marker.color,
                  '--marker-color': marker.color
                } as CSSProperties
              }
              onPointerDown={(event) => handleMarkerPointerDown(event, marker)}
              onPointerMove={handleMarkerPointerMove}
              onPointerUp={handleMarkerPointerUp}
              onPointerCancel={handleMarkerPointerCancel}
              onClick={(event) => {
                if (suppressMarkerClickRef.current) {
                  event.preventDefault();
                  return;
                }

                void window.busyApi.openPath(marker.path);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                if (!parentIsRunning || marker.isActive || busyId) {
                  return;
                }

                void onRun(`follow-up:${marker.itemId}`, () =>
                  window.busyApi.continueChildWithScreenshot({
                    parentId,
                    childItemId: marker.itemId
                  })
                );
              }}
            >
              <Camera size={10} aria-hidden="true" />
            </button>
          ))}
          {dragVisual && <MarkerDragOverlay visual={dragVisual} />}
        </div>
        {isRunning && <BullRunner />}
      </div>
    </div>
  );
}

function MarkerDragOverlay({ visual }: { visual: MarkerDragVisual }): JSX.Element {
  return (
    <span
      className="marker-drag-ghost"
      style={
        {
          left: visual.currentX,
          top: visual.currentY,
          backgroundColor: visual.marker.color,
          '--marker-color': visual.marker.color
        } as CSSProperties
      }
    >
      <Camera size={10} aria-hidden="true" />
    </span>
  );
}

function TaskDragGhost({ visual }: { visual: TaskDragVisual }): JSX.Element {
  return (
    <div
      className="task-drag-ghost"
      style={{
        width: visual.width,
        transform: `translate3d(${visual.left}px, ${visual.top}px, 0)`
      }}
      aria-hidden="true"
    >
      <span className="task-drag-title">{visual.title}</span>
      <span className="task-drag-time">{visual.timeText}</span>
    </div>
  );
}

function BullRunner(): JSX.Element {
  return (
    <span
      className="bull-runner"
      style={
        {
          '--bull-upper-mask': `url(${bullUpperMaskUrl})`,
          '--bull-wheel-mask': `url(${bullWheelMaskUrl})`
        } as CSSProperties
      }
      aria-hidden="true"
    >
      <span className="bull-runner-upper" />
      <span className="bull-runner-wheel" />
    </span>
  );
}

type TaskTitleInputProps = {
  item: WorkItem;
  onUpdateData: (data: ClientAppData) => void;
};

function TaskTitleInput({ item, onUpdateData }: TaskTitleInputProps): JSX.Element {
  const [title, setTitle] = useState(getVisibleTitle(item));
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const isRootItem = item.parentId === null;
  const [titleFit, setTitleFit] = useState<TitleFit>(() => getTitleFit(TITLE_BASE_FONT_SIZE_PX, 1));

  useEffect(() => {
    setTitle(getVisibleTitle(item));
  }, [item.id, item.title]);

  useEffect(() => {
    if (!isRootItem) {
      setTitleFit(getTitleFit(TITLE_BASE_FONT_SIZE_PX, 1));
      return;
    }

    const input = inputRef.current;
    if (!input) {
      return;
    }

    const updateFontSize = (): void => {
      setTitleFit(getFittedTitleFit(input, title));
    };

    updateFontSize();
    const observer = new ResizeObserver(updateFontSize);
    observer.observe(input);

    return () => observer.disconnect();
  }, [isRootItem, title]);

  async function save(): Promise<void> {
    const normalizedTitle = title.trim() || (item.parentId ? '未命名打断事项' : '未命名工作');
    if (normalizedTitle === item.title) {
      setTitle(getVisibleTitle({ ...item, title: normalizedTitle }));
      return;
    }

    const nextData = await window.busyApi.updateItem({
      itemId: item.id,
      title: normalizedTitle,
      notes: item.notes
    });
    setTitle(getVisibleTitle({ ...item, title: normalizedTitle }));
    onUpdateData(nextData);
  }

  return (
    <textarea
      ref={inputRef}
      className="title-input"
      style={
        isRootItem
          ? {
              fontSize: titleFit.fontSize,
              lineHeight: `${titleFit.lineHeight}px`,
              paddingTop: titleFit.paddingY,
              paddingBottom: titleFit.paddingY
            }
          : undefined
      }
      rows={2}
      value={title}
      placeholder={item.parentId ? '子项' : '任务'}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => void save()}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

type TitleFit = {
  fontSize: number;
  lineHeight: number;
  paddingY: number;
};

function getFittedTitleFit(input: HTMLTextAreaElement, title: string): TitleFit {
  const context = getTitleMeasureContext();
  const visibleText = title || input.placeholder;
  const availableWidth = Math.max(input.clientWidth - 6, 0);

  if (!context || !visibleText || availableWidth === 0) {
    return getTitleFit(TITLE_BASE_FONT_SIZE_PX, 1);
  }

  for (let fontSize = TITLE_BASE_FONT_SIZE_PX; fontSize >= TITLE_MIN_FONT_SIZE_PX; fontSize -= 0.5) {
    const lineCount = getWrappedLineCount(context, visibleText, availableWidth, fontSize);
    const fit = getTitleFit(fontSize, lineCount);

    if (lineCount <= TITLE_MAX_LINE_COUNT && fit.lineHeight * lineCount <= TITLE_INPUT_HEIGHT_PX) {
      return fit;
    }
  }

  return getTitleFit(TITLE_MIN_FONT_SIZE_PX, TITLE_MAX_LINE_COUNT);
}

function getWrappedLineCount(
  context: CanvasRenderingContext2D,
  text: string,
  availableWidth: number,
  fontSize: number
): number {
  context.font = `${fontSize}px "Microsoft YaHei", "微软雅黑", "PingFang SC", sans-serif`;
  const paragraphs = text.replace(/\s+/g, ' ').trim().split(/\n+/).filter(Boolean);

  if (paragraphs.length === 0) {
    return 1;
  }

  return paragraphs.reduce((total, paragraph) => total + getParagraphLineCount(context, paragraph, availableWidth), 0);
}

function getParagraphLineCount(context: CanvasRenderingContext2D, text: string, availableWidth: number): number {
  let lineCount = 1;
  let currentLineWidth = 0;

  for (const char of text) {
    const charWidth = context.measureText(char).width;

    if (currentLineWidth > 0 && currentLineWidth + charWidth > availableWidth) {
      lineCount += 1;
      currentLineWidth = charWidth;
      continue;
    }

    currentLineWidth += charWidth;
  }

  return lineCount;
}

function getTitleFit(fontSize: number, lineCount: number): TitleFit {
  const lineHeight = Math.max(4.5, Number((fontSize * 1.08).toFixed(2)));
  const visibleLineCount = Math.min(Math.max(lineCount, 1), TITLE_MAX_LINE_COUNT);
  const paddingY = Math.max(0, Number(((TITLE_INPUT_HEIGHT_PX - lineHeight * visibleLineCount) / 2).toFixed(2)));

  return {
    fontSize: Number(fontSize.toFixed(2)),
    lineHeight,
    paddingY
  };
}

function getTitleMeasureContext(): CanvasRenderingContext2D | null {
  if (titleMeasureContext) {
    return titleMeasureContext;
  }

  titleMeasureContext = document.createElement('canvas').getContext('2d');
  return titleMeasureContext;
}

type TimelineMarker = {
  id: string;
  itemId: string;
  capturedAt: string;
  path: string;
  position: number;
  color: string;
  isActive: boolean;
  isFollowUp: boolean;
};

type MarkerDragState = {
  marker: TimelineMarker;
  pointerId: number;
  pointerStartX: number;
  pointerStartY: number;
  isDragging: boolean;
};

type MarkerDragVisual = {
  marker: TimelineMarker;
  currentX: number;
  currentY: number;
};

type TimelineSegment = {
  id: string;
  left: number;
  width: number;
};

type TimelineChildSegment = TimelineSegment & {
  color: string;
};

type TaskTimeline = {
  parentSegments: TimelineSegment[];
  childSegments: TimelineChildSegment[];
  markers: TimelineMarker[];
};

type TimelineDomain = {
  startMs: number;
  endMs: number;
};

function getTaskTimeline(data: ClientAppData, itemId: string, tick: number): TaskTimeline | null {
  const domain = getTimelineDomain(data, itemId, tick);
  if (!domain) {
    return null;
  }

  const childItems = getChildren(data, itemId);
  const childColorMap = new Map(childItems.map((child, index) => [child.id, MARKER_COLORS[index % MARKER_COLORS.length]]));
  const parentSegments = getSegments(data, itemId).map((segment) => segmentToTimelineSegment(segment, domain, tick));
  const childSegments = childItems.flatMap((child, index) =>
    getSegments(data, child.id).map((segment) => ({
      ...segmentToTimelineSegment(segment, domain, tick),
      color: MARKER_COLORS[index % MARKER_COLORS.length]
    }))
  );

  return {
    parentSegments,
    childSegments,
    markers: getScreenshotMarkers(data, itemId, domain, childColorMap)
  };
}

function getShotMarkerClassName(marker: TimelineMarker, draggedMarkerId: string | null): string {
  return [
    'shot-marker',
    marker.isFollowUp ? 'is-follow-up' : '',
    draggedMarkerId === marker.id ? 'is-dragging' : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function getTaskNodeClassName(isDragging: boolean): string {
  return ['task-node', isDragging ? 'is-task-dragging' : ''].filter(Boolean).join(' ');
}

function getDeleteButtonClassName(draggedMarkerId: string | null, isDropTargetActive: boolean): string {
  return [
    'icon-button',
    'is-delete',
    draggedMarkerId ? 'is-drop-target' : '',
    isDropTargetActive ? 'is-drop-over' : ''
  ]
    .filter(Boolean)
    .join(' ');
}

function isPointInsideElement(element: HTMLElement | null, x: number, y: number): boolean {
  if (!element) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function eventToAccelerator(event: KeyboardEvent): string | null {
  const key = getShortcutKey(event);
  if (!key) {
    return null;
  }

  const parts: string[] = [];
  if (event.metaKey) {
    parts.push('Command');
  }
  if (event.ctrlKey) {
    parts.push('Control');
  }
  if (event.altKey) {
    parts.push('Alt');
  }
  if (event.shiftKey) {
    parts.push('Shift');
  }

  const hasRequiredModifier = event.metaKey || event.ctrlKey || event.altKey;
  if (!hasRequiredModifier) {
    return null;
  }

  return [...parts, key].join('+');
}

function getShortcutKey(event: KeyboardEvent): string | null {
  const codeKey = normalizeShortcutCode(event.code);
  if (codeKey) {
    return codeKey;
  }

  return normalizeShortcutKey(event.key);
}

function normalizeShortcutCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    return code;
  }

  const codeKeys: Record<string, string> = {
    Space: 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  };

  return codeKeys[code] ?? null;
}

function normalizeShortcutKey(key: string): string | null {
  if (!key) {
    return null;
  }

  if (['Meta', 'Control', 'Alt', 'Shift', 'Fn', 'Dead', 'Process', 'Unidentified'].includes(key)) {
    return null;
  }

  const specialKeys: Record<string, string> = {
    ' ': 'Space',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Escape: 'Esc',
    '+': 'Plus'
  };

  if (specialKeys[key]) {
    return specialKeys[key];
  }

  if (/^[a-z]$/i.test(key)) {
    return key.toUpperCase();
  }

  if (/^[0-9]$/.test(key) || /^F([1-9]|1[0-9]|2[0-4])$/.test(key)) {
    return key;
  }

  return key.length === 1 ? key.toUpperCase() : key;
}

function getScreenshotMarkers(
  data: ClientAppData,
  itemId: string,
  domain: TimelineDomain,
  childColorMap: Map<string, string>
): TimelineMarker[] {
  const activeItemIds = new Set(data.segments.filter((segment) => segment.endAt === null).map((segment) => segment.itemId));
  const screenshotIndexByItem = new Map<string, number>();
  const screenshots = data.screenshots
    .filter((screenshot) => screenshot.capturedFromItemId === itemId)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));

  return screenshots.map((screenshot) => {
    const itemScreenshotIndex = screenshotIndexByItem.get(screenshot.itemId) ?? 0;
    screenshotIndexByItem.set(screenshot.itemId, itemScreenshotIndex + 1);

    return {
      id: screenshot.id,
      itemId: screenshot.itemId,
      capturedAt: screenshot.capturedAt,
      path: screenshot.path,
      position: timeToPercent(new Date(screenshot.capturedAt).getTime(), domain),
      color: childColorMap.get(screenshot.itemId) ?? '#2563eb',
      isActive: activeItemIds.has(screenshot.itemId),
      isFollowUp: itemScreenshotIndex > 0
    };
  });
}

function getTimelineDomain(data: ClientAppData, itemId: string, tick: number): TimelineDomain | null {
  const childIds = new Set(getChildren(data, itemId).map((child) => child.id));
  const relatedSegments = data.segments.filter((segment) => segment.itemId === itemId || childIds.has(segment.itemId));
  const relatedScreenshots = data.screenshots.filter((screenshot) => screenshot.capturedFromItemId === itemId);

  if (relatedSegments.length === 0 && relatedScreenshots.length === 0) {
    return null;
  }

  const startTimes = [
    ...relatedSegments.map((segment) => new Date(segment.startAt).getTime()),
    ...relatedScreenshots.map((screenshot) => new Date(screenshot.capturedAt).getTime())
  ];
  const endTimes = [
    ...relatedSegments.map((segment) => (segment.endAt ? new Date(segment.endAt).getTime() : tick)),
    ...relatedScreenshots.map((screenshot) => new Date(screenshot.capturedAt).getTime())
  ];
  const startMs = Math.min(...startTimes);
  const rawEndMs = Math.max(...endTimes);

  return {
    startMs,
    endMs: rawEndMs > startMs ? rawEndMs : startMs + 60000
  };
}

function segmentToTimelineSegment(segment: WorkSegment, domain: TimelineDomain, tick: number): TimelineSegment {
  const startMs = new Date(segment.startAt).getTime();
  const endMs = segment.endAt ? new Date(segment.endAt).getTime() : tick;
  const left = timeToPercent(startMs, domain);
  const right = timeToPercent(endMs, domain);

  return {
    id: segment.id,
    left,
    width: Math.max(1.2, right - left)
  };
}

function timeToPercent(timeMs: number, domain: TimelineDomain): number {
  const duration = domain.endMs - domain.startMs;
  if (duration <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, ((timeMs - domain.startMs) / duration) * 100));
}

function getVisibleTitle(item: WorkItem): string {
  if (item.title === '未命名工作' || item.title === '未命名打断事项') {
    return '';
  }

  return item.title;
}

function getChildren(data: ClientAppData, parentId: string | null): WorkItem[] {
  return data.items
    .filter((item) => item.parentId === parentId)
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

function applyPreviewOrder(items: WorkItem[], previewIds: string[] | null): WorkItem[] {
  if (!previewIds) {
    return items;
  }

  const itemById = new Map(items.map((item) => [item.id, item]));
  const orderedItems = previewIds.flatMap((itemId) => {
    const item = itemById.get(itemId);
    return item ? [item] : [];
  });
  const previewIdSet = new Set(previewIds);
  const missingItems = items.filter((item) => !previewIdSet.has(item.id));
  return [...orderedItems, ...missingItems];
}

function getTaskOrderForPointer(
  orderIds: string[],
  draggedItemId: string,
  pointerY: number,
  taskNodeRefs: Map<string, HTMLDivElement>
): string[] {
  const orderWithoutDraggedItem = orderIds.filter((itemId) => itemId !== draggedItemId);
  let insertIndex = orderWithoutDraggedItem.length;

  for (const [index, itemId] of orderWithoutDraggedItem.entries()) {
    const node = taskNodeRefs.get(itemId);
    if (!node) {
      continue;
    }

    const rect = node.getBoundingClientRect();
    if (pointerY < rect.top + rect.height / 2) {
      insertIndex = index;
      break;
    }
  }

  return [
    ...orderWithoutDraggedItem.slice(0, insertIndex),
    draggedItemId,
    ...orderWithoutDraggedItem.slice(insertIndex)
  ];
}

function getTaskNodeRects(taskNodeRefs: Map<string, HTMLDivElement>): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  taskNodeRefs.forEach((node, itemId) => {
    rects.set(itemId, node.getBoundingClientRect());
  });
  return rects;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
}

function isInteractiveTaskDragTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest('button, textarea, input, select, a'));
}

function formatTaskTime(data: ClientAppData, itemId: string, tick: number): string {
  const segments = getSegments(data, itemId);
  if (segments.length === 0) {
    return '';
  }

  const firstSegment = segments[0];
  const lastSegment = segments.at(-1);
  const endTime = lastSegment?.endAt ?? new Date(tick).toISOString();

  return `${formatClock(firstSegment.startAt)}-${formatClock(endTime)} · ${formatDurationCompact(
    getItemDurationMs(data, itemId, new Date(tick))
  )}`;
}

function formatAllRanges(data: ClientAppData, itemId: string, tick: number): string {
  const ranges = getSegments(data, itemId).map((segment) => formatRange(segment, tick));
  if (ranges.length === 0) {
    return '还没有执行时间';
  }

  return `${ranges.join(' / ')} · 累计 ${formatDurationCompact(getItemDurationMs(data, itemId, new Date(tick)))}`;
}

function getSegments(data: ClientAppData, itemId: string): WorkSegment[] {
  return data.segments
    .filter((segment) => segment.itemId === itemId)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function formatRange(segment: WorkSegment, tick: number): string {
  return `${formatClock(segment.startAt)}-${segment.endAt ? formatClock(segment.endAt) : formatClock(new Date(tick).toISOString())}`;
}

function formatClock(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function formatDurationCompact(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0) {
    return `${hours}h${minutes.toString().padStart(2, '0')}m`;
  }

  return `${minutes}m`;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败';
}
