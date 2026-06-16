import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import type { AppData, WorkItem } from '../shared/types';
import { createEmptyAppData } from '../shared/workSession';

export class JsonWorkRepository {
  private readonly dataPath: string;
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(dataRoot: string) {
    this.dataPath = join(dataRoot, 'data.json');
  }

  async load(): Promise<AppData> {
    try {
      const raw = await readFile(this.dataPath, 'utf8');
      return normalizeData(JSON.parse(raw));
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return createEmptyAppData();
      }

      throw error;
    }
  }

  async save(data: AppData): Promise<void> {
    await mkdir(dirname(this.dataPath), { recursive: true });
    const cleanData = stripClientOnlyFields(data);
    const tempPath = `${this.dataPath}.${randomUUID()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(cleanData, null, 2)}\n`, 'utf8');
    await rename(tempPath, this.dataPath);
  }

  async update(mutator: (data: AppData) => AppData): Promise<AppData> {
    const operation = this.updateQueue.catch(() => undefined).then(async () => {
      const current = await this.load();
      const next = mutator(current);
      await this.save(next);
      return next;
    });

    this.updateQueue = operation.then(
      () => undefined,
      () => undefined
    );

    return operation;
  }
}

export function getWorkDataRoot(userDataPath: string): string {
  return join(userDataPath, 'work-data');
}

export function getScreenshotsRoot(picturesPath: string): string {
  return join(picturesPath, '忙个明白', '截图');
}

export function getReportsRoot(userDataPath: string): string {
  return join(getWorkDataRoot(userDataPath), 'reports');
}

function normalizeData(value: unknown): AppData {
  if (!isRecord(value) || value.version !== 1) {
    return createEmptyAppData();
  }

  return {
    version: 1,
    items: normalizeItems(value.items),
    segments: Array.isArray(value.segments) ? value.segments : [],
    screenshots: Array.isArray(value.screenshots) ? value.screenshots : [],
    activeSegmentId: typeof value.activeSegmentId === 'string' ? value.activeSegmentId : null
  };
}

function normalizeItems(value: unknown): WorkItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item, index) => {
    if (!isRecord(item)) {
      return item as WorkItem;
    }

    return {
      ...(item as WorkItem),
      order: typeof item.order === 'number' && Number.isFinite(item.order) ? item.order : index
    };
  });
}

function stripClientOnlyFields(data: AppData): AppData {
  return {
    ...data,
    screenshots: data.screenshots.map(({ previewUrl: _previewUrl, ...screenshot }) => screenshot)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
