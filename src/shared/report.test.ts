import { describe, expect, it } from 'vitest';
import { generateDailyReport } from './report';
import type { AppData } from './types';

describe('generateDailyReport', () => {
  it('generates a daily markdown and html report with child items and screenshots', () => {
    const data: AppData = {
      version: 1,
      activeSegmentId: null,
      items: [
        {
          id: 'item-1',
          parentId: null,
          title: '做方案',
          notes: '完成第一版结构',
          createdAt: '2026-05-31T01:00:00.000Z',
          updatedAt: '2026-05-31T01:00:00.000Z',
          order: 0
        },
        {
          id: 'item-2',
          parentId: 'item-1',
          title: '临时答疑',
          notes: '',
          createdAt: '2026-05-31T01:20:00.000Z',
          updatedAt: '2026-05-31T01:20:00.000Z',
          order: 0
        }
      ],
      segments: [
        {
          id: 'segment-1',
          itemId: 'item-1',
          startAt: '2026-05-31T01:00:00.000Z',
          endAt: '2026-05-31T01:20:00.000Z'
        },
        {
          id: 'segment-2',
          itemId: 'item-2',
          startAt: '2026-05-31T01:20:00.000Z',
          endAt: '2026-05-31T01:35:00.000Z'
        }
      ],
      screenshots: [
        {
          id: 'screenshot-1',
          itemId: 'item-2',
          capturedFromItemId: 'item-1',
          path: '/tmp/screenshot.png',
          capturedAt: '2026-05-31T01:20:00.000Z'
        }
      ]
    };

    const report = generateDailyReport(data, {
      date: '2026-05-31',
      generatedAt: '2026-05-31T02:00:00.000Z',
      assetUrlForPath: (filePath) => `file://${filePath}`
    });

    expect(report.markdown).toContain('# 忙个明白日报 2026-05-31');
    expect(report.markdown).toContain('做方案');
    expect(report.markdown).toContain('临时答疑');
    expect(report.markdown).toContain('file:///tmp/screenshot.png');
    expect(report.html).toContain('<title>忙个明白日报 2026-05-31</title>');
    expect(report.html).toContain('记录总时长');
  });
});
