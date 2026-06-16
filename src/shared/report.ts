import type { AppData, DailyReportResult, Screenshot, WorkItem, WorkSegment } from './types';

type GenerateDailyReportInput = {
  date: string;
  generatedAt?: string;
  assetUrlForPath?: (filePath: string) => string;
};

type ItemReportNode = {
  item: WorkItem;
  segments: WorkSegment[];
  screenshots: Screenshot[];
  children: ItemReportNode[];
};

export function generateDailyReport(data: AppData, input: GenerateDailyReportInput): DailyReportResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const assetUrlForPath = input.assetUrlForPath ?? ((filePath) => filePath);
  const nodes = buildReportTree(data, input.date);
  const totalMs = nodes.reduce((total, node) => total + getNodeDurationMs(node, generatedAt), 0);

  const markdownLines = [
    `# 忙个明白日报 ${input.date}`,
    '',
    `生成时间：${formatDateTime(generatedAt)}`,
    `记录总时长：${formatDuration(totalMs)}`,
    '',
    '## 工作记录',
    ''
  ];

  if (nodes.length === 0) {
    markdownLines.push('今天还没有记录。');
  } else {
    for (const node of nodes) {
      markdownLines.push(...renderNodeMarkdown(node, generatedAt, assetUrlForPath, 0));
    }
  }

  const htmlItems =
    nodes.length === 0
      ? '<p class="empty">今天还没有记录。</p>'
      : nodes.map((node) => renderNodeHtml(node, generatedAt, assetUrlForPath, 0)).join('\n');

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>忙个明白日报 ${escapeHtml(input.date)}</title>
  <style>
    body {
      margin: 0;
      padding: 32px;
      color: #18222f;
      background: #f6f8fb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      max-width: 920px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #d8e0ea;
      border-radius: 8px;
      padding: 32px;
    }
    h1, h2, h3 {
      margin: 0;
      line-height: 1.25;
    }
    h1 {
      font-size: 28px;
    }
    .meta {
      margin: 12px 0 28px;
      color: #526173;
      display: flex;
      gap: 20px;
      flex-wrap: wrap;
    }
    .item {
      border-top: 1px solid #e2e8f0;
      padding: 18px 0;
    }
    .child {
      margin-left: 28px;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: baseline;
    }
    .duration {
      color: #0f766e;
      font-weight: 700;
      white-space: nowrap;
    }
    .ranges, .notes {
      color: #526173;
      margin: 8px 0 0;
      line-height: 1.6;
    }
    .screenshots {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .screenshots img {
      width: 100%;
      border: 1px solid #d8e0ea;
      border-radius: 6px;
    }
    .empty {
      color: #526173;
    }
  </style>
</head>
<body>
  <main>
    <h1>忙个明白日报 ${escapeHtml(input.date)}</h1>
    <div class="meta">
      <span>生成时间：${escapeHtml(formatDateTime(generatedAt))}</span>
      <span>记录总时长：${escapeHtml(formatDuration(totalMs))}</span>
    </div>
    <h2>工作记录</h2>
    ${htmlItems}
  </main>
</body>
</html>`;

  return {
    markdown: markdownLines.join('\n'),
    html
  };
}

export function getLocalDateKey(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} 分钟`;
  }

  return `${hours} 小时 ${minutes} 分钟`;
}

function buildReportTree(data: AppData, date: string): ItemReportNode[] {
  const segmentsForDate = data.segments.filter((segment) => getLocalDateKey(segment.startAt) === date);
  const segmentItemIds = new Set(segmentsForDate.map((segment) => segment.itemId));
  const screenshotsForDate = data.screenshots.filter((screenshot) => getLocalDateKey(screenshot.capturedAt) === date);
  const screenshotItemIds = new Set(screenshotsForDate.map((screenshot) => screenshot.itemId));

  const shouldIncludeItem = (item: WorkItem): boolean => {
    if (segmentItemIds.has(item.id) || screenshotItemIds.has(item.id)) {
      return true;
    }

    return data.items.some((candidate) => candidate.parentId === item.id && shouldIncludeItem(candidate));
  };

  const createNode = (item: WorkItem): ItemReportNode => ({
    item,
    segments: segmentsForDate.filter((segment) => segment.itemId === item.id),
    screenshots: screenshotsForDate.filter((screenshot) => screenshot.itemId === item.id),
    children: data.items
      .filter((child) => child.parentId === item.id && shouldIncludeItem(child))
      .sort((a, b) => getFirstActivityTime(data, a.id).localeCompare(getFirstActivityTime(data, b.id)))
      .map(createNode)
  });

  return data.items
    .filter((item) => item.parentId === null && shouldIncludeItem(item))
    .sort((a, b) => getFirstActivityTime(data, a.id).localeCompare(getFirstActivityTime(data, b.id)))
    .map(createNode);
}

function renderNodeMarkdown(
  node: ItemReportNode,
  generatedAt: string,
  assetUrlForPath: (filePath: string) => string,
  depth: number
): string[] {
  const prefix = '  '.repeat(depth);
  const duration = formatDuration(getNodeOwnDurationMs(node, generatedAt));
  const ranges = node.segments.map(formatRange).join('，') || '无计时段';
  const lines = [`${prefix}- ${node.item.title}（${duration}）`, `${prefix}  - 时间段：${ranges}`];

  if (node.item.notes.trim()) {
    lines.push(`${prefix}  - 备注：${node.item.notes.trim()}`);
  }

  for (const screenshot of node.screenshots) {
    lines.push(`${prefix}  - 截图：![截图](${assetUrlForPath(screenshot.path)})`);
  }

  for (const child of node.children) {
    lines.push(...renderNodeMarkdown(child, generatedAt, assetUrlForPath, depth + 1));
  }

  return [...lines, ''];
}

function renderNodeHtml(
  node: ItemReportNode,
  generatedAt: string,
  assetUrlForPath: (filePath: string) => string,
  depth: number
): string {
  const duration = formatDuration(getNodeOwnDurationMs(node, generatedAt));
  const ranges = node.segments.map(formatRange).join('，') || '无计时段';
  const notes = node.item.notes.trim() ? `<p class="notes">备注：${escapeHtml(node.item.notes.trim())}</p>` : '';
  const screenshots =
    node.screenshots.length === 0
      ? ''
      : `<div class="screenshots">${node.screenshots
          .map(
            (screenshot) =>
              `<img src="${escapeHtml(assetUrlForPath(screenshot.path))}" alt="${escapeHtml(node.item.title)} 的截图" />`
          )
          .join('')}</div>`;
  const children = node.children.map((child) => renderNodeHtml(child, generatedAt, assetUrlForPath, depth + 1)).join('\n');

  return `<section class="item ${depth > 0 ? 'child' : ''}">
  <div class="title-row">
    <h3>${escapeHtml(node.item.title)}</h3>
    <span class="duration">${escapeHtml(duration)}</span>
  </div>
  <p class="ranges">时间段：${escapeHtml(ranges)}</p>
  ${notes}
  ${screenshots}
  ${children}
</section>`;
}

function getNodeOwnDurationMs(node: ItemReportNode, generatedAt: string): number {
  const fallbackEnd = new Date(generatedAt).getTime();
  return node.segments.reduce((total, segment) => {
    const start = new Date(segment.startAt).getTime();
    const end = segment.endAt ? new Date(segment.endAt).getTime() : fallbackEnd;
    return total + Math.max(0, end - start);
  }, 0);
}

function getNodeDurationMs(node: ItemReportNode, generatedAt: string): number {
  return (
    getNodeOwnDurationMs(node, generatedAt) +
    node.children.reduce((total, child) => total + getNodeDurationMs(child, generatedAt), 0)
  );
}

function getFirstActivityTime(data: AppData, itemId: string): string {
  const segmentTime = data.segments
    .filter((segment) => segment.itemId === itemId)
    .map((segment) => segment.startAt)
    .sort()[0];
  const screenshotTime = data.screenshots
    .filter((screenshot) => screenshot.itemId === itemId)
    .map((screenshot) => screenshot.capturedAt)
    .sort()[0];

  return [segmentTime, screenshotTime].filter(Boolean).sort()[0] ?? '9999-12-31T23:59:59.999Z';
}

function formatRange(segment: WorkSegment): string {
  const start = formatTime(segment.startAt);
  const end = segment.endAt ? formatTime(segment.endAt) : '进行中';
  return `${start}-${end}`;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

