import { describe, expect, it } from 'vitest';
import { generateTimelineReport } from './timelineReport';
import type { AppData } from './types';

describe('generateTimelineReport', () => {
  it('summarizes the last 24 hours without double-counting parent and child time', () => {
    const data: AppData = {
      version: 1,
      activeSegmentId: null,
      items: [
        {
          id: 'main-1',
          parentId: null,
          title: '做方案',
          notes: '',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
          order: 0
        },
        {
          id: 'child-1',
          parentId: 'main-1',
          title: '临时截图',
          notes: '',
          createdAt: '2026-06-01T00:10:00.000Z',
          updatedAt: '2026-06-01T00:10:00.000Z',
          order: 0
        }
      ],
      segments: [
        {
          id: 'segment-main',
          itemId: 'main-1',
          startAt: '2026-06-01T00:00:00.000Z',
          endAt: '2026-06-01T01:00:00.000Z'
        },
        {
          id: 'segment-child',
          itemId: 'child-1',
          startAt: '2026-06-01T00:10:00.000Z',
          endAt: '2026-06-01T00:25:00.000Z'
        }
      ],
      screenshots: [
        {
          id: 'shot-1',
          itemId: 'child-1',
          capturedFromItemId: 'main-1',
          path: '/tmp/shot-1.png',
          capturedAt: '2026-06-01T00:10:00.000Z'
        },
        {
          id: 'shot-2',
          itemId: 'child-1',
          capturedFromItemId: 'main-1',
          path: '/tmp/shot-2.png',
          capturedAt: '2026-06-01T00:40:00.000Z'
        }
      ]
    };

    const report = generateTimelineReport(data, {
      generatedAt: '2026-06-01T02:00:00.000Z'
    });

    expect(report.summary.totalWorkMs).toBe(60 * 60 * 1000);
    expect(report.summary.taskCount).toBe(1);
    expect(report.summary.interruptionCount).toBe(2);
    expect(report.summary.interruptionPercent).toBe(25);
    expect(report.html).toContain('过去 24 小时，一共工作 1 小时');
    expect(report.html).toContain('shot-1.png');
    expect(report.html).toContain('shot-2.png');
    expect(report.html).not.toContain('截图明细');
    expect(report.height).toBeLessThan(900);
  });
});
