import type { AppData, Screenshot, WorkItem, WorkSegment } from './types';

export const UNTITLED_WORK_TITLE = '未命名工作';
export const UNTITLED_INTERRUPT_TITLE = '未命名打断事项';

type IdPrefix = 'item' | 'segment' | 'screenshot';
type IdFactory = (prefix: IdPrefix) => string;

type CommandBase = {
  now?: string;
  idFactory?: IdFactory;
};

export type StartItemInput = CommandBase & {
  title?: string;
  parentId?: string | null;
};

export type AddItemInput = CommandBase & {
  title?: string;
  parentId?: string | null;
};

export type ContinueItemInput = CommandBase & {
  itemId: string;
};

export type DeleteItemInput = {
  itemId: string;
};

export type DeleteScreenshotMarkerInput = {
  screenshotId: string;
};

export type UpdateItemInput = CommandBase & {
  itemId: string;
  title: string;
  notes: string;
};

export type ReorderRootItemsInput = CommandBase & {
  itemIds: string[];
};

export type InterruptWithScreenshotInput = CommandBase & {
  screenshotPath: string;
};

export type ContinueChildWithScreenshotInput = InterruptWithScreenshotInput & {
  parentId: string;
  childItemId: string;
};

export function createEmptyAppData(): AppData {
  return {
    version: 1,
    items: [],
    segments: [],
    screenshots: [],
    activeSegmentId: null
  };
}

export function findActiveSegment(data: AppData): WorkSegment | null {
  if (data.activeSegmentId) {
    const activeSegment = data.segments.find(
      (segment) => segment.id === data.activeSegmentId && segment.endAt === null
    );

    if (activeSegment) {
      return activeSegment;
    }
  }

  return findActiveSegments(data)[0] ?? null;
}

export function findActiveSegments(data: AppData): WorkSegment[] {
  return data.segments.filter((segment) => segment.endAt === null);
}

export function findActiveSegmentForItem(data: AppData, itemId: string): WorkSegment | null {
  return data.segments.find((segment) => segment.itemId === itemId && segment.endAt === null) ?? null;
}

export function findActiveItem(data: AppData): WorkItem | null {
  const activeSegment = findActiveSegment(data);
  if (!activeSegment) {
    return null;
  }

  return data.items.find((item) => item.id === activeSegment.itemId) ?? null;
}

export function getItem(data: AppData, itemId: string): WorkItem {
  const item = data.items.find((candidate) => candidate.id === itemId);
  if (!item) {
    throw new Error('没有找到对应的工作项。');
  }

  return item;
}

export function getItemDurationMs(data: AppData, itemId: string, endForActive = new Date()): number {
  return data.segments
    .filter((segment) => segment.itemId === itemId)
    .reduce((total, segment) => {
      const start = new Date(segment.startAt).getTime();
      const end = segment.endAt ? new Date(segment.endAt).getTime() : endForActive.getTime();
      return total + Math.max(0, end - start);
    }, 0);
}

export function addItem(data: AppData, input: AddItemInput = {}): AppData {
  const now = input.now ?? new Date().toISOString();
  const itemId = createId('item', input.idFactory);
  const item: WorkItem = {
    id: itemId,
    parentId: input.parentId ?? null,
    title: normalizeTitle(input.title, UNTITLED_WORK_TITLE),
    notes: '',
    createdAt: now,
    updatedAt: now,
    order: getNextOrder(data, input.parentId ?? null)
  };

  return {
    ...data,
    items: [...data.items, item]
  };
}

export function startItem(data: AppData, input: StartItemInput = {}): AppData {
  const now = input.now ?? new Date().toISOString();
  const itemId = createId('item', input.idFactory);
  const segmentId = createId('segment', input.idFactory);
  const title = normalizeTitle(input.title, UNTITLED_WORK_TITLE);

  const item: WorkItem = {
    id: itemId,
    parentId: input.parentId ?? null,
    title,
    notes: '',
    createdAt: now,
    updatedAt: now,
    order: getNextOrder(data, input.parentId ?? null)
  };

  const segment: WorkSegment = {
    id: segmentId,
    itemId,
    startAt: now,
    endAt: null
  };
  const dataWithItem = {
    ...data,
    items: [...data.items, item]
  };
  const targetRootItemId = item.parentId ? getRootItem(dataWithItem, item.parentId).id : item.id;
  const baseData = endActiveSegmentsOutsideRoot(dataWithItem, targetRootItemId, now);

  return {
    ...baseData,
    segments: [...baseData.segments, segment],
    activeSegmentId: segment.id
  };
}

export function endActive(data: AppData, input: CommandBase = {}): AppData {
  const activeSegment = findActiveSegment(data);
  if (!activeSegment) {
    throw new Error('当前没有正在计时的工作。');
  }

  const now = input.now ?? new Date().toISOString();

  const nextSegments = data.segments.map((segment) =>
    segment.id === activeSegment.id ? { ...segment, endAt: now } : segment
  );

  return {
    ...data,
    segments: nextSegments,
    activeSegmentId: nextSegments.find((segment) => segment.endAt === null)?.id ?? null
  };
}

export function continueItem(data: AppData, input: ContinueItemInput): AppData {
  const item = getItem(data, input.itemId);
  ensureItemNotActive(data, input.itemId);

  const now = input.now ?? new Date().toISOString();
  const rootItem = getRootItem(data, item.id);
  const baseData = endActiveSegmentsOutsideRoot(data, rootItem.id, now);
  const segmentId = createId('segment', input.idFactory);
  const segment: WorkSegment = {
    id: segmentId,
    itemId: input.itemId,
    startAt: now,
    endAt: null
  };

  return {
    ...baseData,
    segments: [...baseData.segments, segment],
    activeSegmentId: segment.id
  };
}

export function toggleItemTiming(data: AppData, input: ContinueItemInput): AppData {
  const activeSegment = findActiveSegmentForItem(data, input.itemId);

  if (activeSegment?.itemId === input.itemId) {
    return endItemAndActiveDescendants(data, input);
  }

  return continueItem(data, input);
}

export function deleteItem(data: AppData, input: DeleteItemInput): AppData {
  getItem(data, input.itemId);

  const itemIdsToDelete = collectDescendantItemIds(data, input.itemId);
  const nextSegments = data.segments.filter((segment) => !itemIdsToDelete.has(segment.itemId));

  return {
    ...data,
    items: data.items.filter((item) => !itemIdsToDelete.has(item.id)),
    segments: nextSegments,
    screenshots: data.screenshots.filter(
      (screenshot) =>
        !itemIdsToDelete.has(screenshot.itemId) &&
        (!screenshot.capturedFromItemId || !itemIdsToDelete.has(screenshot.capturedFromItemId))
    ),
    activeSegmentId: nextSegments.find((segment) => segment.endAt === null)?.id ?? null
  };
}

export function deleteScreenshotMarker(data: AppData, input: DeleteScreenshotMarkerInput): AppData {
  const screenshot = data.screenshots.find((candidate) => candidate.id === input.screenshotId);
  if (!screenshot) {
    throw new Error('没有找到对应的截图点。');
  }

  const itemScreenshots = data.screenshots
    .filter((candidate) => candidate.itemId === screenshot.itemId)
    .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt));
  const isFirstScreenshotForItem = itemScreenshots[0]?.id === screenshot.id;

  if (isFirstScreenshotForItem) {
    return deleteItem(data, { itemId: screenshot.itemId });
  }

  const nextSegments = data.segments.filter(
    (segment) => !(segment.itemId === screenshot.itemId && segment.startAt === screenshot.capturedAt)
  );

  return {
    ...data,
    segments: nextSegments,
    screenshots: data.screenshots.filter((candidate) => candidate.id !== screenshot.id),
    activeSegmentId: nextSegments.find((segment) => segment.endAt === null)?.id ?? null
  };
}

export function updateItem(data: AppData, input: UpdateItemInput): AppData {
  getItem(data, input.itemId);
  const now = input.now ?? new Date().toISOString();

  return {
    ...data,
    items: data.items.map((item) =>
      item.id === input.itemId
        ? {
            ...item,
            title: normalizeTitle(input.title, UNTITLED_WORK_TITLE),
            notes: input.notes,
            updatedAt: now
          }
        : item
    )
  };
}

export function interruptWithScreenshot(data: AppData, input: InterruptWithScreenshotInput): AppData {
  const activeSegment = findActiveSegment(data);
  if (!activeSegment) {
    throw new Error('需要先开始一项工作，才能记录打断事项。');
  }

  const activeItem = getItem(data, activeSegment.itemId);
  const activeRootItem = getRootItem(data, activeItem.id);
  if (findActiveDirectChildSegment(data, activeRootItem.id)) {
    throw new Error('请先结束当前截图子项。');
  }

  const now = input.now ?? new Date().toISOString();
  const childItemId = createId('item', input.idFactory);
  const childSegmentId = createId('segment', input.idFactory);
  const screenshotId = createId('screenshot', input.idFactory);

  const childItem: WorkItem = {
    id: childItemId,
    parentId: activeRootItem.id,
    title: UNTITLED_INTERRUPT_TITLE,
    notes: '',
    createdAt: now,
    updatedAt: now,
    order: getNextOrder(data, activeRootItem.id)
  };

  const childSegment: WorkSegment = {
    id: childSegmentId,
    itemId: childItemId,
    startAt: now,
    endAt: null
  };

  const screenshot: Screenshot = {
    id: screenshotId,
    itemId: childItemId,
    capturedFromItemId: activeRootItem.id,
    path: input.screenshotPath,
    capturedAt: now
  };

  return {
    ...data,
    items: [...data.items, childItem],
    segments: [...data.segments, childSegment],
    screenshots: [...data.screenshots, screenshot],
    activeSegmentId: childSegment.id
  };
}

export function insertChildWithScreenshot(
  data: AppData,
  input: InterruptWithScreenshotInput & { parentId: string }
): AppData {
  getItem(data, input.parentId);
  const now = input.now ?? new Date().toISOString();
  const baseData = endActiveSegmentsOutsideRoot(data, input.parentId, now);
  if (!findActiveSegmentForItem(baseData, input.parentId)) {
    throw new Error('任务开始后才能插入截图子项。');
  }
  if (findActiveDirectChildSegment(baseData, input.parentId)) {
    throw new Error('请先结束当前截图子项。');
  }

  const childItemId = createId('item', input.idFactory);
  const childSegmentId = createId('segment', input.idFactory);
  const screenshotId = createId('screenshot', input.idFactory);

  const childItem: WorkItem = {
    id: childItemId,
    parentId: input.parentId,
    title: UNTITLED_INTERRUPT_TITLE,
    notes: '',
    createdAt: now,
    updatedAt: now,
    order: getNextOrder(baseData, input.parentId)
  };

  const childSegment: WorkSegment = {
    id: childSegmentId,
    itemId: childItemId,
    startAt: now,
    endAt: null
  };

  const screenshot: Screenshot = {
    id: screenshotId,
    itemId: childItemId,
    capturedFromItemId: input.parentId,
    path: input.screenshotPath,
    capturedAt: now
  };

  return {
    ...baseData,
    items: [...baseData.items, childItem],
    segments: [...baseData.segments, childSegment],
    screenshots: [...baseData.screenshots, screenshot],
    activeSegmentId: childSegment.id
  };
}

export function continueChildWithScreenshot(data: AppData, input: ContinueChildWithScreenshotInput): AppData {
  const childItem = getItem(data, input.childItemId);
  if (childItem.parentId !== input.parentId) {
    throw new Error('子项不属于当前任务。');
  }
  const now = input.now ?? new Date().toISOString();
  const baseData = endActiveSegmentsOutsideRoot(data, input.parentId, now);
  if (!findActiveSegmentForItem(baseData, input.parentId)) {
    throw new Error('主任务开始后才能追加子项。');
  }
  if (findActiveSegmentForItem(baseData, input.childItemId)) {
    throw new Error('这个子项已经在计时。');
  }
  if (findActiveDirectChildSegment(baseData, input.parentId)) {
    throw new Error('请先结束当前截图子项。');
  }

  const childSegmentId = createId('segment', input.idFactory);
  const screenshotId = createId('screenshot', input.idFactory);
  const childSegment: WorkSegment = {
    id: childSegmentId,
    itemId: input.childItemId,
    startAt: now,
    endAt: null
  };
  const screenshot: Screenshot = {
    id: screenshotId,
    itemId: input.childItemId,
    capturedFromItemId: input.parentId,
    path: input.screenshotPath,
    capturedAt: now
  };

  return {
    ...baseData,
    segments: [...baseData.segments, childSegment],
    screenshots: [...baseData.screenshots, screenshot],
    activeSegmentId: childSegment.id
  };
}

export function endActiveAndResumeParent(data: AppData, input: CommandBase = {}): AppData {
  const activeItem = findActiveItem(data);
  if (!activeItem) {
    throw new Error('当前没有正在计时的工作。');
  }

  const now = input.now ?? new Date().toISOString();
  const ended = endActive(data, { now });

  if (!activeItem.parentId) {
    return ended;
  }

  if (findActiveSegmentForItem(ended, activeItem.parentId)) {
    return ended;
  }

  return continueItem(ended, {
    itemId: activeItem.parentId,
    now,
    idFactory: input.idFactory
  });
}

export function reorderRootItems(data: AppData, input: ReorderRootItemsInput): AppData {
  const rootItems = data.items.filter((item) => item.parentId === null);
  const rootItemIds = new Set(rootItems.map((item) => item.id));
  const orderedIds = [...input.itemIds];

  if (orderedIds.length !== rootItems.length || new Set(orderedIds).size !== orderedIds.length) {
    throw new Error('主任务排序数据不完整。');
  }

  for (const itemId of orderedIds) {
    if (!rootItemIds.has(itemId)) {
      throw new Error('主任务排序数据包含无效任务。');
    }
  }

  const now = input.now ?? new Date().toISOString();
  const orderById = new Map(orderedIds.map((itemId, index) => [itemId, index]));

  return {
    ...data,
    items: data.items.map((item) =>
      item.parentId === null
        ? {
            ...item,
            order: orderById.get(item.id) ?? item.order,
            updatedAt: now
          }
        : item
    )
  };
}

function endItemAndActiveDescendants(data: AppData, input: ContinueItemInput): AppData {
  getItem(data, input.itemId);
  const itemIdsToEnd = collectDescendantItemIds(data, input.itemId);
  const activeSegmentsToEnd = data.segments.filter(
    (segment) => itemIdsToEnd.has(segment.itemId) && segment.endAt === null
  );

  if (activeSegmentsToEnd.length === 0) {
    throw new Error('当前任务没有正在计时。');
  }

  const now = input.now ?? new Date().toISOString();
  const nextSegments = data.segments.map((segment) =>
    itemIdsToEnd.has(segment.itemId) && segment.endAt === null ? { ...segment, endAt: now } : segment
  );
  const remainingActiveSegmentId = nextSegments.find((segment) => segment.endAt === null)?.id ?? null;

  return {
    ...data,
    segments: nextSegments,
    activeSegmentId: remainingActiveSegmentId
  };
}

function ensureItemNotActive(data: AppData, itemId: string): void {
  if (findActiveSegmentForItem(data, itemId)) {
    throw new Error('这项任务已经在计时。');
  }
}

function endActiveSegmentsOutsideRoot(data: AppData, rootItemId: string, now: string): AppData {
  const nextSegments = data.segments.map((segment) => {
    if (segment.endAt !== null) {
      return segment;
    }

    const item = data.items.find((candidate) => candidate.id === segment.itemId);
    if (!item) {
      return segment;
    }

    const segmentRootItem = getRootItem(data, item.id);
    return segmentRootItem.id === rootItemId ? segment : { ...segment, endAt: now };
  });

  return {
    ...data,
    segments: nextSegments,
    activeSegmentId: nextSegments.find((segment) => segment.endAt === null)?.id ?? null
  };
}

function findActiveDirectChildSegment(data: AppData, parentId: string): WorkSegment | null {
  const childIds = new Set(data.items.filter((item) => item.parentId === parentId).map((item) => item.id));
  return data.segments.find((segment) => childIds.has(segment.itemId) && segment.endAt === null) ?? null;
}

function normalizeTitle(title: string | undefined, fallback: string): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : fallback;
}

function getNextOrder(data: AppData, parentId: string | null): number {
  const siblingOrders = data.items
    .filter((item) => item.parentId === parentId)
    .map((item) => (Number.isFinite(item.order) ? item.order : 0));

  return siblingOrders.length === 0 ? 0 : Math.max(...siblingOrders) + 1;
}

function collectDescendantItemIds(data: AppData, rootItemId: string): Set<string> {
  const ids = new Set<string>([rootItemId]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const item of data.items) {
      if (item.parentId && ids.has(item.parentId) && !ids.has(item.id)) {
        ids.add(item.id);
        changed = true;
      }
    }
  }

  return ids;
}

function getRootItem(data: AppData, itemId: string): WorkItem {
  let item = getItem(data, itemId);
  const seen = new Set<string>();

  while (item.parentId) {
    if (seen.has(item.id)) {
      throw new Error('工作项层级存在循环。');
    }

    seen.add(item.id);
    item = getItem(data, item.parentId);
  }

  return item;
}

function createId(prefix: IdPrefix, idFactory?: IdFactory): string {
  if (idFactory) {
    return idFactory(prefix);
  }

  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${randomId}`;
}
