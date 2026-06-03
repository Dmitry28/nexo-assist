import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Test } from '@nestjs/testing';

import { SnapshotService } from './snapshot.service';

interface Item {
  id: string;
  value: number;
}

const isItem = (v: unknown): v is Item =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as Item).id === 'string' &&
  typeof (v as Item).value === 'number';

describe('SnapshotService', () => {
  let service: SnapshotService;
  let dir: string;
  let file: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [SnapshotService] }).compile();
    service = moduleRef.get(SnapshotService);

    dir = await fs.mkdtemp(path.join(tmpdir(), 'snap-'));
    file = path.join(dir, 'snap.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns [] when the snapshot file does not exist', async () => {
    expect(await service.read(file, isItem)).toEqual([]);
  });

  it('round-trips items', async () => {
    const items: Item[] = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
    ];
    await service.write(file, items);
    expect(await service.read(file, isItem)).toEqual(items);
  });

  it('creates intermediate directories on write', async () => {
    const deep = path.join(dir, 'nested', 'sub', 'snap.json');
    await service.write(deep, [{ id: 'x', value: 0 }]);
    expect(await service.read(deep, isItem)).toEqual([{ id: 'x', value: 0 }]);
  });

  it('resets to [] when the snapshot is not an array', async () => {
    await fs.writeFile(file, JSON.stringify({ not: 'array' }));
    expect(await service.read(file, isItem)).toEqual([]);
  });

  it('resets to [] when items fail the type-guard', async () => {
    await fs.writeFile(file, JSON.stringify([{ wrong: 'shape' }]));
    expect(await service.read(file, isItem)).toEqual([]);
  });

  it('resets to [] when JSON is malformed', async () => {
    await fs.writeFile(file, '{not json');
    expect(await service.read(file, isItem)).toEqual([]);
  });

  it('writes atomically — no .tmp file remains after success', async () => {
    await service.write(file, [{ id: 'a', value: 1 }]);
    const files = await fs.readdir(dir);
    expect(files).toEqual(['snap.json']);
  });
});
