import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { desktopCapturer, screen } from 'electron';
import { getLocalDateKey } from '../shared/report';

export type ScreenshotCaptureResult = {
  path: string;
  capturedAt: string;
};

export type ScreenshotCaptureOptions = {
  capturedAt?: string;
  fileNameBase?: string;
};

export async function capturePrimaryScreen(
  screenshotsRoot: string,
  options: ScreenshotCaptureOptions = {}
): Promise<ScreenshotCaptureResult> {
  const capturedAt = options.capturedAt ?? new Date().toISOString();
  const primaryDisplay = screen.getPrimaryDisplay();
  const scaleFactor = primaryDisplay.scaleFactor || 1;
  const thumbnailSize = {
    width: Math.round(primaryDisplay.size.width * scaleFactor),
    height: Math.round(primaryDisplay.size.height * scaleFactor)
  };

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize
  });

  const source =
    sources.find((candidate) => candidate.display_id === String(primaryDisplay.id)) ??
    sources.find((candidate) => !candidate.thumbnail.isEmpty()) ??
    sources[0];

  if (!source || source.thumbnail.isEmpty()) {
    throw new Error('截图失败。macOS 可能需要在系统设置里授予“屏幕录制”权限。');
  }

  const dateKey = getLocalDateKey(capturedAt);
  const screenshotsDir = join(screenshotsRoot, dateKey);
  const baseFileName = normalizeScreenshotFileNameBase(options.fileNameBase ?? capturedAt);

  await mkdir(screenshotsDir, { recursive: true });
  const filePath = await writeUniquePng(screenshotsDir, baseFileName, source.thumbnail.toPNG());

  return {
    path: filePath,
    capturedAt
  };
}

async function writeUniquePng(directory: string, baseFileName: string, pngBuffer: Buffer): Promise<string> {
  let index = 0;

  while (true) {
    const suffix = index === 0 ? '' : `-${index + 1}`;
    const filePath = join(directory, `${baseFileName}${suffix}.png`);

    try {
      await writeFile(filePath, pngBuffer, { flag: 'wx' });
      return filePath;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'EEXIST') {
        throw error;
      }
      index += 1;
    }
  }
}

function normalizeScreenshotFileNameBase(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/\u0000-\u001F]/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 90);

  return normalized || '截图';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
