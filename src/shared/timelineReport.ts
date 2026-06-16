import type { AppData, Screenshot, WorkItem, WorkSegment } from './types';

type GenerateTimelineReportInput = {
  generatedAt?: string;
};

type ClippedSegment = {
  id: string;
  item: WorkItem;
  rootItem: WorkItem;
  startMs: number;
  endMs: number;
};

type TimelineScreenshot = {
  screenshot: Screenshot;
  item: WorkItem;
  rootItem: WorkItem;
  capturedMs: number;
};

type TimelineNode = {
  id: string;
  atMs: number;
  title: string;
  subtitle: string;
  color: string;
};

type TimelineNodeLayout = {
  node: TimelineNode;
  leftPx: number;
  cardLeftPx: number;
  topPx: number;
  lane: number;
};

export type TimelineReportSummary = {
  generatedAt: string;
  windowStart: string;
  windowEnd: string;
  totalWorkMs: number;
  taskCount: number;
  interruptionCount: number;
  interruptionMs: number;
  interruptionPercent: number;
};

export type TimelineReportResult = {
  html: string;
  width: number;
  height: number;
  summary: TimelineReportSummary;
  fileName: string;
};

const REPORT_WIDTH = 2200;
const PAGE_PADDING = 48;
const CONTENT_WIDTH = REPORT_WIDTH - PAGE_PADDING * 2;
const TRACK_LEFT = 170;
const TRACK_WIDTH = 1840;
const HEADER_HEIGHT = 190;
const NODE_WIDTH = 280;
const NODE_HEIGHT = 72;
const NODE_GAP = 18;
const AXIS_TOP_GAP = 44;
const FOOTER_HEIGHT = 72;
const MARKER_COLORS = ['#2563eb', '#d97706', '#7c3aed', '#059669', '#dc2626', '#0891b2', '#c026d3'];

export function generateTimelineReport(data: AppData, input: GenerateTimelineReportInput = {}): TimelineReportResult {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const windowEndMs = new Date(generatedAt).getTime();
  const windowStartMs = windowEndMs - 24 * 60 * 60 * 1000;
  const itemsById = new Map(data.items.map((item) => [item.id, item]));
  const segments = getClippedSegments(data.segments, itemsById, windowStartMs, windowEndMs);
  const screenshots = getTimelineScreenshots(data.screenshots, itemsById, windowStartMs, windowEndMs);
  const rootItems = getActiveRootItems(segments, screenshots);
  const nodes = buildTimelineNodes(rootItems, segments, screenshots);
  const nodeLayouts = layoutNodes(nodes, windowStartMs, windowEndMs);
  const nodeLaneCount = nodeLayouts.reduce((max, item) => Math.max(max, item.lane + 1), 0);
  const axisTop = HEADER_HEIGHT + nodeLaneCount * (NODE_HEIGHT + NODE_GAP) + AXIS_TOP_GAP;
  const totalWorkMs = getUnionDurationMs(segments.map((segment) => [segment.startMs, segment.endMs]));
  const childSegments = segments.filter((segment) => segment.item.parentId !== null);
  const interruptionMs = getUnionDurationMs(childSegments.map((segment) => [segment.startMs, segment.endMs]));
  const interruptionCount = screenshots.filter((shot) => shot.item.parentId !== null).length;
  const interruptionPercent = totalWorkMs > 0 ? Math.round((interruptionMs / totalWorkMs) * 100) : 0;
  const summary: TimelineReportSummary = {
    generatedAt,
    windowStart: new Date(windowStartMs).toISOString(),
    windowEnd: generatedAt,
    totalWorkMs,
    taskCount: rootItems.length,
    interruptionCount,
    interruptionMs,
    interruptionPercent
  };
  const height = Math.max(520, PAGE_PADDING * 2 + axisTop + FOOTER_HEIGHT + 86);

  return {
    html: renderTimelineHtml({
      axisTop,
      height,
      nodeLayouts,
      segments,
      summary,
      windowStartMs,
      windowEndMs
    }),
    width: REPORT_WIDTH,
    height,
    summary,
    fileName: `timeline-${formatFileDate(generatedAt)}.png`
  };
}

function getClippedSegments(
  segments: WorkSegment[],
  itemsById: Map<string, WorkItem>,
  windowStartMs: number,
  windowEndMs: number
): ClippedSegment[] {
  return segments.flatMap((segment) => {
    const item = itemsById.get(segment.itemId);
    if (!item) {
      return [];
    }

    const rootItem = getRootItem(item, itemsById);
    if (!rootItem) {
      return [];
    }

    const segmentStartMs = new Date(segment.startAt).getTime();
    const segmentEndMs = segment.endAt ? new Date(segment.endAt).getTime() : windowEndMs;
    const startMs = Math.max(segmentStartMs, windowStartMs);
    const endMs = Math.min(segmentEndMs, windowEndMs);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return [];
    }

    return [
      {
        id: segment.id,
        item,
        rootItem,
        startMs,
        endMs
      }
    ];
  });
}

function getTimelineScreenshots(
  screenshots: Screenshot[],
  itemsById: Map<string, WorkItem>,
  windowStartMs: number,
  windowEndMs: number
): TimelineScreenshot[] {
  return screenshots.flatMap((screenshot) => {
    const item = itemsById.get(screenshot.itemId);
    if (!item) {
      return [];
    }

    const rootItem = getRootItem(item, itemsById);
    const capturedMs = new Date(screenshot.capturedAt).getTime();

    if (!rootItem || capturedMs < windowStartMs || capturedMs > windowEndMs || !Number.isFinite(capturedMs)) {
      return [];
    }

    return [
      {
        screenshot,
        item,
        rootItem,
        capturedMs
      }
    ];
  });
}

function getActiveRootItems(segments: ClippedSegment[], screenshots: TimelineScreenshot[]): WorkItem[] {
  const rootMap = new Map<string, WorkItem>();

  for (const segment of segments) {
    rootMap.set(segment.rootItem.id, segment.rootItem);
  }

  for (const screenshot of screenshots) {
    rootMap.set(screenshot.rootItem.id, screenshot.rootItem);
  }

  return [...rootMap.values()].sort((a, b) => getRootFirstActivityMs(a.id, segments, screenshots) - getRootFirstActivityMs(b.id, segments, screenshots));
}

function buildTimelineNodes(
  rootItems: WorkItem[],
  segments: ClippedSegment[],
  screenshots: TimelineScreenshot[]
): TimelineNode[] {
  const rootNodes = rootItems.flatMap((item) => {
    const firstTime = getRootFirstActivityMs(item.id, segments, screenshots);

    if (!Number.isFinite(firstTime)) {
      return [];
    }

    return [
      {
        id: `root:${item.id}`,
        atMs: firstTime,
        title: item.title,
        subtitle: '主任务',
        color: '#667085'
      }
    ];
  });
  const screenshotNodes = screenshots.map((shot) => ({
    id: `shot:${shot.screenshot.id}`,
    atMs: shot.capturedMs,
    title: getFileName(shot.screenshot.path),
    subtitle: `${shot.item.title} · ${formatClock(shot.capturedMs)}`,
    color: getItemColor(shot.item.id)
  }));

  return [...rootNodes, ...screenshotNodes].sort((a, b) => a.atMs - b.atMs);
}

function renderTimelineHtml(input: {
  axisTop: number;
  height: number;
  nodeLayouts: TimelineNodeLayout[];
  segments: ClippedSegment[];
  summary: TimelineReportSummary;
  windowStartMs: number;
  windowEndMs: number;
}): string {
  const summaryText = `过去 24 小时，一共工作 ${formatDuration(input.summary.totalWorkMs)}，有 ${input.summary.taskCount} 项任务，被打断 ${input.summary.interruptionCount} 次，占总工作时长的 ${input.summary.interruptionPercent}%。`;
  const axisMarks = renderAxisMarks(input.windowStartMs, input.windowEndMs);
  const segments = input.segments
    .map((segment) => renderSegment(segment, input.windowStartMs, input.windowEndMs, input.axisTop))
    .join('');
  const nodes = input.nodeLayouts.map((item) => renderNode(item, input.axisTop)).join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>忙个明白时间轴</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      width: ${REPORT_WIDTH}px;
      min-height: ${input.height}px;
      overflow: visible;
      scrollbar-width: none;
      background: #f5f7fa;
      color: #17212f;
      font-family: "Microsoft YaHei", "微软雅黑", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
    }
    html::-webkit-scrollbar, body::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }
    body { padding: ${PAGE_PADDING}px; }
    main {
      position: relative;
      width: ${CONTENT_WIDTH}px;
      min-height: ${input.height - PAGE_PADDING * 2}px;
      background: #fff;
      border: 1px solid #d7dee8;
      border-radius: 14px;
      padding: 34px 38px;
    }
    h1 { margin: 0 0 12px; font-size: 34px; letter-spacing: 0; }
    .summary {
      margin: 0 0 18px;
      padding: 18px 20px;
      border-radius: 10px;
      background: #eef6f4;
      color: #113f3a;
      font-size: 24px;
      font-weight: 700;
      line-height: 1.45;
    }
    .range {
      margin: 0;
      color: #667386;
      font-size: 18px;
    }
    .timeline {
      position: relative;
      min-height: ${input.height - PAGE_PADDING * 2 - HEADER_HEIGHT}px;
    }
    .axis {
      position: absolute;
      left: ${TRACK_LEFT}px;
      top: ${input.axisTop}px;
      width: ${TRACK_WIDTH}px;
      height: 18px;
      border-radius: 999px;
      background: #e6ebf2;
      overflow: hidden;
      box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.12);
    }
    .axis-mark {
      position: absolute;
      top: ${input.axisTop + 28}px;
      width: 1px;
      height: 12px;
      background: #94a3b8;
    }
    .axis-label {
      position: absolute;
      top: ${input.axisTop + 44}px;
      transform: translateX(-50%);
      color: #64748b;
      font-size: 15px;
      white-space: nowrap;
    }
    .segment {
      position: absolute;
      height: 12px;
      border-radius: 999px;
      background: #667085;
      z-index: 2;
    }
    .child-segment {
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.64);
      z-index: 3;
    }
    .node-line {
      position: absolute;
      width: 1px;
      background: #aab4c2;
      z-index: 1;
    }
    .node-dot {
      position: absolute;
      width: 14px;
      height: 14px;
      border: 2px solid #fff;
      border-radius: 50%;
      transform: translate(-50%, -50%);
      box-shadow: 0 0 0 1px currentColor;
      z-index: 5;
    }
    .node-card {
      position: absolute;
      width: ${NODE_WIDTH}px;
      min-height: ${NODE_HEIGHT}px;
      padding: 10px 12px;
      border: 1px solid #d7dee8;
      border-left-width: 5px;
      border-radius: 9px;
      background: #fff;
      box-shadow: 0 7px 18px rgba(15, 23, 42, 0.1);
      z-index: 4;
    }
    .node-title {
      display: block;
      color: #17212f;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.18;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .node-subtitle {
      display: block;
      margin-top: 4px;
      color: #64748b;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <main>
    <h1>忙个明白时间轴</h1>
    <p class="summary">${escapeHtml(summaryText)}</p>
    <p class="range">${escapeHtml(formatDateTime(input.summary.windowStart))} - ${escapeHtml(
      formatDateTime(input.summary.windowEnd)
    )}</p>
    <section class="timeline" aria-label="过去24小时时间轴">
      <div class="axis"></div>
      ${segments}
      ${nodes}
      ${axisMarks}
    </section>
  </main>
</body>
</html>`;
}

function renderAxisMarks(windowStartMs: number, windowEndMs: number): string {
  const intervalMs = 3 * 60 * 60 * 1000;
  const firstTick = Math.ceil(windowStartMs / intervalMs) * intervalMs;
  const values = [windowStartMs];

  for (let value = firstTick; value < windowEndMs; value += intervalMs) {
    if (value > windowStartMs) {
      values.push(value);
    }
  }

  values.push(windowEndMs);

  return values
    .map((value) => {
      const left = TRACK_LEFT + getLeftPx(value, windowStartMs, windowEndMs);
      return `<span class="axis-mark" style="left:${left}px"></span><span class="axis-label" style="left:${left}px">${escapeHtml(
        formatClock(value)
      )}</span>`;
    })
    .join('');
}

function renderSegment(
  segment: ClippedSegment,
  windowStartMs: number,
  windowEndMs: number,
  axisTop: number
): string {
  const leftPx = TRACK_LEFT + getLeftPx(segment.startMs, windowStartMs, windowEndMs);
  const rightPx = TRACK_LEFT + getLeftPx(segment.endMs, windowStartMs, windowEndMs);
  const widthPx = Math.max(2, rightPx - leftPx);
  const isChild = segment.item.parentId !== null;
  const colorStyle = isChild ? `background:${escapeHtml(getItemColor(segment.item.id))};` : '';

  return `<span class="segment ${isChild ? 'child-segment' : ''}" title="${escapeHtml(
    segment.item.title
  )}" style="left:${leftPx}px;top:${axisTop + 3}px;width:${widthPx}px;${colorStyle}"></span>`;
}

function renderNode(item: TimelineNodeLayout, axisTop: number): string {
  const x = TRACK_LEFT + item.leftPx;
  const lineTop = item.topPx + NODE_HEIGHT;
  const lineHeight = Math.max(0, axisTop - lineTop + 9);

  return `<span class="node-line" style="left:${x}px;top:${lineTop}px;height:${lineHeight}px"></span>
    <span class="node-dot" style="left:${x}px;top:${axisTop + 9}px;color:${escapeHtml(
      item.node.color
    )};background:${escapeHtml(item.node.color)}"></span>
    <span class="node-card" style="left:${TRACK_LEFT + item.cardLeftPx}px;top:${item.topPx}px;border-left-color:${escapeHtml(
      item.node.color
    )}">
      <span class="node-title">${escapeHtml(item.node.title)}</span>
      <span class="node-subtitle">${escapeHtml(item.node.subtitle)}</span>
    </span>`;
}

function layoutNodes(nodes: TimelineNode[], windowStartMs: number, windowEndMs: number): TimelineNodeLayout[] {
  const laneEnds: number[] = [];

  return nodes.map((node) => {
    const leftPx = getLeftPx(node.atMs, windowStartMs, windowEndMs);
    const cardLeftPx = clamp(leftPx - NODE_WIDTH / 2, 0, TRACK_WIDTH - NODE_WIDTH);
    const lane = laneEnds.findIndex((end) => cardLeftPx > end + NODE_GAP);
    const nextLane = lane === -1 ? laneEnds.length : lane;
    laneEnds[nextLane] = cardLeftPx + NODE_WIDTH;

    return {
      node,
      leftPx,
      cardLeftPx,
      topPx: HEADER_HEIGHT + nextLane * (NODE_HEIGHT + NODE_GAP),
      lane: nextLane
    };
  });
}

function getRootItem(item: WorkItem, itemsById: Map<string, WorkItem>): WorkItem | null {
  let current: WorkItem | undefined = item;
  const seen = new Set<string>();

  while (current?.parentId) {
    if (seen.has(current.id)) {
      return null;
    }
    seen.add(current.id);
    current = itemsById.get(current.parentId);
  }

  return current ?? null;
}

function getRootFirstActivityMs(
  rootItemId: string,
  segments: ClippedSegment[],
  screenshots: TimelineScreenshot[]
): number {
  const segmentTimes = segments.filter((segment) => segment.rootItem.id === rootItemId).map((segment) => segment.startMs);
  const screenshotTimes = screenshots
    .filter((screenshot) => screenshot.rootItem.id === rootItemId)
    .map((screenshot) => screenshot.capturedMs);

  return Math.min(...segmentTimes, ...screenshotTimes);
}

function getUnionDurationMs(intervals: Array<[number, number]>): number {
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);

  if (sorted.length === 0) {
    return 0;
  }

  let total = 0;
  let [currentStart, currentEnd] = sorted[0];

  for (const [start, end] of sorted.slice(1)) {
    if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
      continue;
    }

    total += currentEnd - currentStart;
    currentStart = start;
    currentEnd = end;
  }

  return total + currentEnd - currentStart;
}

function getLeftPx(valueMs: number, windowStartMs: number, windowEndMs: number): number {
  const progress = (valueMs - windowStartMs) / (windowEndMs - windowStartMs);
  return Math.round(clamp(progress, 0, 1) * TRACK_WIDTH);
}

function getItemColor(itemId: string): string {
  let total = 0;
  for (const char of itemId) {
    total += char.charCodeAt(0);
  }

  return MARKER_COLORS[total % MARKER_COLORS.length];
}

function formatDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} 分钟`;
  }

  if (minutes === 0) {
    return `${hours} 小时`;
  }

  return `${hours} 小时 ${minutes} 分钟`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(
    2,
    '0'
  )} ${formatClock(date.getTime())}`;
}

function formatClock(valueMs: number): string {
  const date = new Date(valueMs);
  return `${`${date.getHours()}`.padStart(2, '0')}:${`${date.getMinutes()}`.padStart(2, '0')}`;
}

function formatFileDate(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(
    2,
    '0'
  )}-${`${date.getHours()}`.padStart(2, '0')}${`${date.getMinutes()}`.padStart(2, '0')}`;
}

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
