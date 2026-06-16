import { describe, expect, it } from 'vitest';
import {
  addItem,
  continueItem,
  continueChildWithScreenshot,
  createEmptyAppData,
  deleteItem,
  deleteScreenshotMarker,
  endActive,
  endActiveAndResumeParent,
  insertChildWithScreenshot,
  interruptWithScreenshot,
  reorderRootItems,
  startItem,
  toggleItemTiming,
  updateItem
} from './workSession';

function createIdFactory(): (prefix: 'item' | 'segment' | 'screenshot') => string {
  let count = 0;
  return (prefix) => `${prefix}-${count++}`;
}

describe('workSession', () => {
  it('adds an item without starting a timer', () => {
    const idFactory = createIdFactory();
    const data = addItem(createEmptyAppData(), {
      title: '记录想法',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });

    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ id: 'item-0', title: '记录想法', parentId: null });
    expect(data.segments).toHaveLength(0);
    expect(data.activeSegmentId).toBeNull();
  });

  it('starts one work item with one active segment', () => {
    const idFactory = createIdFactory();
    const data = startItem(createEmptyAppData(), {
      title: '写日报',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });

    expect(data.items).toHaveLength(1);
    expect(data.items[0]).toMatchObject({ id: 'item-0', title: '写日报', parentId: null });
    expect(data.segments).toHaveLength(1);
    expect(data.activeSegmentId).toBe('segment-1');
  });

  it('does not allow starting the same item twice', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '写日报',
      idFactory
    });
    const running = toggleItemTiming(added, { itemId: 'item-0', idFactory });

    expect(() => continueItem(running, { itemId: 'item-0', idFactory })).toThrow('这项任务已经在计时');
  });

  it('can end and continue the same item with a new segment', () => {
    const idFactory = createIdFactory();
    const started = startItem(createEmptyAppData(), {
      title: '整理材料',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const ended = endActive(started, { now: '2026-05-31T10:00:00.000Z' });
    const continued = continueItem(ended, {
      itemId: 'item-0',
      now: '2026-05-31T10:30:00.000Z',
      idFactory
    });

    expect(continued.segments).toHaveLength(2);
    expect(continued.segments[0].endAt).toBe('2026-05-31T10:00:00.000Z');
    expect(continued.segments[1]).toMatchObject({
      id: 'segment-2',
      itemId: 'item-0',
      startAt: '2026-05-31T10:30:00.000Z',
      endAt: null
    });
  });

  it('toggles an existing item between running and ended', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '整理材料',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const running = toggleItemTiming(added, {
      itemId: 'item-0',
      now: '2026-05-31T09:05:00.000Z',
      idFactory
    });
    const ended = toggleItemTiming(running, {
      itemId: 'item-0',
      now: '2026-05-31T09:20:00.000Z',
      idFactory
    });

    expect(running.activeSegmentId).toBe('segment-1');
    expect(ended.activeSegmentId).toBeNull();
    expect(ended.segments[0]).toMatchObject({
      itemId: 'item-0',
      startAt: '2026-05-31T09:05:00.000Z',
      endAt: '2026-05-31T09:20:00.000Z'
    });
  });

  it('interrupts the active item with a child item and screenshot record', () => {
    const idFactory = createIdFactory();
    const started = startItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const interrupted = interruptWithScreenshot(started, {
      screenshotPath: '/tmp/interruption.png',
      now: '2026-05-31T09:25:00.000Z',
      idFactory
    });

    expect(interrupted.items).toHaveLength(2);
    expect(interrupted.items[1]).toMatchObject({
      id: 'item-2',
      parentId: 'item-0',
      title: '未命名打断事项'
    });
    expect(interrupted.segments[0].endAt).toBeNull();
    expect(interrupted.activeSegmentId).toBe('segment-3');
    expect(interrupted.segments.filter((segment) => segment.endAt === null).map((segment) => segment.itemId)).toEqual([
      'item-0',
      'item-2'
    ]);
    expect(interrupted.screenshots[0]).toMatchObject({
      id: 'screenshot-4',
      itemId: 'item-2',
      capturedFromItemId: 'item-0',
      path: '/tmp/interruption.png'
    });
  });

  it('inserts a child item with screenshot and starts it', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const running = toggleItemTiming(added, {
      itemId: 'item-0',
      now: '2026-05-31T09:05:00.000Z',
      idFactory
    });
    const inserted = insertChildWithScreenshot(running, {
      parentId: 'item-0',
      screenshotPath: '/tmp/inserted.png',
      now: '2026-05-31T09:15:00.000Z',
      idFactory
    });

    expect(inserted.items[1]).toMatchObject({
      id: 'item-2',
      parentId: 'item-0',
      title: '未命名打断事项'
    });
    expect(inserted.segments[0].endAt).toBeNull();
    expect(inserted.segments[1]).toMatchObject({
      id: 'segment-3',
      itemId: 'item-2',
      endAt: null
    });
    expect(inserted.activeSegmentId).toBe('segment-3');
    expect(inserted.segments.filter((segment) => segment.endAt === null).map((segment) => segment.itemId)).toEqual([
      'item-0',
      'item-2'
    ]);
    expect(inserted.screenshots[0]).toMatchObject({
      id: 'screenshot-4',
      itemId: 'item-2',
      capturedFromItemId: 'item-0',
      path: '/tmp/inserted.png'
    });
  });

  it('does not insert another child while one child is active', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const running = toggleItemTiming(added, {
      itemId: 'item-0',
      now: '2026-05-31T09:05:00.000Z',
      idFactory
    });
    const inserted = insertChildWithScreenshot(running, {
      parentId: 'item-0',
      screenshotPath: '/tmp/inserted.png',
      now: '2026-05-31T09:15:00.000Z',
      idFactory
    });

    expect(() =>
      insertChildWithScreenshot(inserted, {
        parentId: 'item-0',
        screenshotPath: '/tmp/inserted-2.png',
        now: '2026-05-31T09:16:00.000Z',
        idFactory
      })
    ).toThrow('请先结束当前截图子项');
  });

  it('stops the previous running root task before starting another root task', () => {
    const idFactory = createIdFactory();
    const addedFirst = addItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const runningFirst = toggleItemTiming(addedFirst, {
      itemId: 'item-0',
      now: '2026-05-31T09:05:00.000Z',
      idFactory
    });
    const withChild = insertChildWithScreenshot(runningFirst, {
      parentId: 'item-0',
      screenshotPath: '/tmp/inserted.png',
      now: '2026-05-31T09:10:00.000Z',
      idFactory
    });
    const addedSecond = addItem(withChild, {
      title: '写日报',
      now: '2026-05-31T09:15:00.000Z',
      idFactory
    });
    const runningSecond = toggleItemTiming(addedSecond, {
      itemId: 'item-5',
      now: '2026-05-31T09:20:00.000Z',
      idFactory
    });

    expect(runningSecond.segments.filter((segment) => segment.endAt === null).map((segment) => segment.itemId)).toEqual([
      'item-5'
    ]);
    expect(runningSecond.segments.find((segment) => segment.id === 'segment-1')?.endAt).toBe(
      '2026-05-31T09:20:00.000Z'
    );
    expect(runningSecond.segments.find((segment) => segment.id === 'segment-3')?.endAt).toBe(
      '2026-05-31T09:20:00.000Z'
    );
  });

  it('does not create a nested interruption while a child item is running', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const running = toggleItemTiming(added, {
      itemId: 'item-0',
      now: '2026-05-31T09:05:00.000Z',
      idFactory
    });
    const inserted = insertChildWithScreenshot(running, {
      parentId: 'item-0',
      screenshotPath: '/tmp/inserted.png',
      now: '2026-05-31T09:15:00.000Z',
      idFactory
    });

    expect(() =>
      interruptWithScreenshot(inserted, {
        screenshotPath: '/tmp/nested.png',
        now: '2026-05-31T09:20:00.000Z',
        idFactory
      })
    ).toThrow('请先结束当前截图子项');
  });

  it('continues an ended screenshot child with a new screenshot and segment', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const running = toggleItemTiming(added, {
      itemId: 'item-0',
      now: '2026-05-31T09:05:00.000Z',
      idFactory
    });
    const inserted = insertChildWithScreenshot(running, {
      parentId: 'item-0',
      screenshotPath: '/tmp/inserted.png',
      now: '2026-05-31T09:15:00.000Z',
      idFactory
    });
    const childEnded = toggleItemTiming(inserted, {
      itemId: 'item-2',
      now: '2026-05-31T09:25:00.000Z',
      idFactory
    });
    const continued = continueChildWithScreenshot(childEnded, {
      parentId: 'item-0',
      childItemId: 'item-2',
      screenshotPath: '/tmp/follow-up.png',
      now: '2026-05-31T09:40:00.000Z',
      idFactory
    });

    expect(continued.items).toHaveLength(2);
    expect(continued.segments.filter((segment) => segment.itemId === 'item-2')).toHaveLength(2);
    expect(continued.segments.at(-1)).toMatchObject({
      id: 'segment-5',
      itemId: 'item-2',
      startAt: '2026-05-31T09:40:00.000Z',
      endAt: null
    });
    expect(continued.screenshots).toHaveLength(2);
    expect(continued.screenshots[1]).toMatchObject({
      id: 'screenshot-6',
      itemId: 'item-2',
      capturedFromItemId: 'item-0',
      path: '/tmp/follow-up.png'
    });
  });

  it('deletes only the dragged follow-up marker and its matching child segment', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const running = toggleItemTiming(added, {
      itemId: 'item-0',
      now: '2026-05-31T09:05:00.000Z',
      idFactory
    });
    const inserted = insertChildWithScreenshot(running, {
      parentId: 'item-0',
      screenshotPath: '/tmp/inserted.png',
      now: '2026-05-31T09:15:00.000Z',
      idFactory
    });
    const childEnded = toggleItemTiming(inserted, {
      itemId: 'item-2',
      now: '2026-05-31T09:25:00.000Z',
      idFactory
    });
    const continued = continueChildWithScreenshot(childEnded, {
      parentId: 'item-0',
      childItemId: 'item-2',
      screenshotPath: '/tmp/follow-up.png',
      now: '2026-05-31T09:40:00.000Z',
      idFactory
    });
    const deleted = deleteScreenshotMarker(continued, { screenshotId: 'screenshot-6' });

    expect(deleted.items).toHaveLength(2);
    expect(deleted.segments.filter((segment) => segment.itemId === 'item-2')).toEqual([
      expect.objectContaining({
        id: 'segment-3',
        startAt: '2026-05-31T09:15:00.000Z',
        endAt: '2026-05-31T09:25:00.000Z'
      })
    ]);
    expect(deleted.screenshots).toEqual([
      expect.objectContaining({
        id: 'screenshot-4',
        itemId: 'item-2',
        path: '/tmp/inserted.png'
      })
    ]);
    expect(deleted.activeSegmentId).toBe('segment-1');
  });

  it('deletes the whole child item when the first child marker is dragged away', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const running = toggleItemTiming(added, {
      itemId: 'item-0',
      now: '2026-05-31T09:05:00.000Z',
      idFactory
    });
    const inserted = insertChildWithScreenshot(running, {
      parentId: 'item-0',
      screenshotPath: '/tmp/inserted.png',
      now: '2026-05-31T09:15:00.000Z',
      idFactory
    });
    const childEnded = toggleItemTiming(inserted, {
      itemId: 'item-2',
      now: '2026-05-31T09:25:00.000Z',
      idFactory
    });
    const continued = continueChildWithScreenshot(childEnded, {
      parentId: 'item-0',
      childItemId: 'item-2',
      screenshotPath: '/tmp/follow-up.png',
      now: '2026-05-31T09:40:00.000Z',
      idFactory
    });
    const deleted = deleteScreenshotMarker(continued, { screenshotId: 'screenshot-4' });

    expect(deleted.items.map((item) => item.id)).toEqual(['item-0']);
    expect(deleted.segments.every((segment) => segment.itemId === 'item-0')).toBe(true);
    expect(deleted.screenshots).toHaveLength(0);
    expect(deleted.activeSegmentId).toBe('segment-1');
  });

  it('requires a running parent before inserting a screenshot child item', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });

    expect(() =>
      insertChildWithScreenshot(added, {
        parentId: 'item-0',
        screenshotPath: '/tmp/inserted.png',
        now: '2026-05-31T09:15:00.000Z',
        idFactory
      })
    ).toThrow('任务开始后才能插入截图子项');
  });

  it('deletes an item with its children, segments, screenshots, and active state', () => {
    const idFactory = createIdFactory();
    const added = addItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const running = toggleItemTiming(added, {
      itemId: 'item-0',
      now: '2026-05-31T09:05:00.000Z',
      idFactory
    });
    const inserted = insertChildWithScreenshot(running, {
      parentId: 'item-0',
      screenshotPath: '/tmp/inserted.png',
      now: '2026-05-31T09:15:00.000Z',
      idFactory
    });
    const deleted = deleteItem(inserted, { itemId: 'item-0' });

    expect(deleted.items).toHaveLength(0);
    expect(deleted.segments).toHaveLength(0);
    expect(deleted.screenshots).toHaveLength(0);
    expect(deleted.activeSegmentId).toBeNull();
  });

  it('ends an interruption and resumes its parent item', () => {
    const idFactory = createIdFactory();
    const started = startItem(createEmptyAppData(), {
      title: '做方案',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const interrupted = interruptWithScreenshot(started, {
      screenshotPath: '/tmp/interruption.png',
      now: '2026-05-31T09:25:00.000Z',
      idFactory
    });
    const resumed = endActiveAndResumeParent(interrupted, {
      now: '2026-05-31T09:40:00.000Z',
      idFactory
    });

    expect(resumed.segments[0].endAt).toBeNull();
    expect(resumed.segments[1].endAt).toBe('2026-05-31T09:40:00.000Z');
    expect(resumed.activeSegmentId).toBe('segment-1');
  });

  it('updates item title and notes', () => {
    const idFactory = createIdFactory();
    const data = startItem(createEmptyAppData(), {
      title: '',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const updated = updateItem(data, {
      itemId: 'item-0',
      title: '  客户沟通  ',
      notes: '同步需求范围',
      now: '2026-05-31T09:10:00.000Z'
    });

    expect(updated.items[0]).toMatchObject({
      title: '客户沟通',
      notes: '同步需求范围',
      updatedAt: '2026-05-31T09:10:00.000Z'
    });
  });

  it('reorders root items without changing child item order', () => {
    const idFactory = createIdFactory();
    const first = addItem(createEmptyAppData(), {
      title: '第一项',
      now: '2026-05-31T09:00:00.000Z',
      idFactory
    });
    const second = addItem(first, {
      title: '第二项',
      now: '2026-05-31T09:01:00.000Z',
      idFactory
    });
    const withChild = addItem(second, {
      parentId: 'item-0',
      title: '子项',
      now: '2026-05-31T09:02:00.000Z',
      idFactory
    });
    const reordered = reorderRootItems(withChild, {
      itemIds: ['item-1', 'item-0'],
      now: '2026-05-31T09:03:00.000Z'
    });

    expect(reordered.items.find((item) => item.id === 'item-1')?.order).toBe(0);
    expect(reordered.items.find((item) => item.id === 'item-0')?.order).toBe(1);
    expect(reordered.items.find((item) => item.id === 'item-2')?.order).toBe(0);
  });
});
