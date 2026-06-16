import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JsonWorkRepository } from './storage';

describe('JsonWorkRepository', () => {
  it('serializes concurrent updates without corrupting data.json', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'busy-clear-storage-'));
    const repository = new JsonWorkRepository(dataRoot);

    try {
      await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          repository.update((data) => ({
            ...data,
            items: [
              ...data.items,
              {
                id: `item-${index}`,
                parentId: null,
                title: `任务 ${index}`,
                notes: '',
                createdAt: '2026-06-01T00:00:00.000Z',
                updatedAt: '2026-06-01T00:00:00.000Z',
                order: index
              }
            ]
          }))
        )
      );

      const raw = await readFile(join(dataRoot, 'data.json'), 'utf8');
      const parsed = JSON.parse(raw);
      expect(parsed.items).toHaveLength(5);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
