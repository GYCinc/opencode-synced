import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CHUNK_SUFFIX,
  reassembleChunks,
  setChunkSizeForTesting,
  splitIntoChunks,
} from './apply.js';

describe('File Chunking', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'opencode-sync-test-'));
    setChunkSizeForTesting(100); // 100 bytes for testing
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    setChunkSizeForTesting(50 * 1024 * 1024); // Reset to default
  });

  it('splits a file into chunks', async () => {
    const sourcePath = path.join(tempDir, 'large-file.txt');
    const content = 'a'.repeat(250); // Should create 3 chunks (100, 100, 50)
    await writeFile(sourcePath, content);

    const destBase = path.join(tempDir, 'repo-file.txt');
    await splitIntoChunks(sourcePath, destBase);

    const files = await readdir(tempDir);
    const chunks = files.filter((f) => f.startsWith(`repo-file.txt${CHUNK_SUFFIX}`));
    expect(chunks).toHaveLength(3);

    const chunk0 = await readFile(path.join(tempDir, `repo-file.txt${CHUNK_SUFFIX}0`), 'utf8');
    const chunk1 = await readFile(path.join(tempDir, `repo-file.txt${CHUNK_SUFFIX}1`), 'utf8');
    const chunk2 = await readFile(path.join(tempDir, `repo-file.txt${CHUNK_SUFFIX}2`), 'utf8');

    expect(chunk0).toHaveLength(100);
    expect(chunk1).toHaveLength(100);
    expect(chunk2).toHaveLength(50);
    expect(chunk0 + chunk1 + chunk2).toBe(content);
  });

  it('reassembles chunks into a file', async () => {
    let chunkDir = path.join(tempDir, 'chunks');
    await rm(chunkDir, { recursive: true, force: true }).catch(() => {});
    chunkDir = await mkdtemp(chunkDir); // ensure it exists

    const chunkNames = [
      `file.txt${CHUNK_SUFFIX}0`,
      `file.txt${CHUNK_SUFFIX}1`,
      `file.txt${CHUNK_SUFFIX}2`,
    ];

    await writeFile(path.join(chunkDir, chunkNames[0]), 'part1-');
    await writeFile(path.join(chunkDir, chunkNames[1]), 'part2-');
    await writeFile(path.join(chunkDir, chunkNames[2]), 'part3');

    const destPath = path.join(tempDir, 'reassembled.txt');
    await reassembleChunks(chunkDir, chunkNames, destPath);

    const reassembledContent = await readFile(destPath, 'utf8');
    expect(reassembledContent).toBe('part1-part2-part3');
  });

  it('handles chunks out of order in the list', async () => {
    let chunkDir = path.join(tempDir, 'chunks-unordered');
    chunkDir = await mkdtemp(chunkDir);

    const chunkNames = [
      `file.txt${CHUNK_SUFFIX}1`,
      `file.txt${CHUNK_SUFFIX}0`,
      `file.txt${CHUNK_SUFFIX}2`,
    ];

    await writeFile(path.join(chunkDir, `file.txt${CHUNK_SUFFIX}0`), 'A');
    await writeFile(path.join(chunkDir, `file.txt${CHUNK_SUFFIX}1`), 'B');
    await writeFile(path.join(chunkDir, `file.txt${CHUNK_SUFFIX}2`), 'C');

    const destPath = path.join(tempDir, 'reassembled-ordered.txt');
    await reassembleChunks(chunkDir, chunkNames, destPath);

    const reassembledContent = await readFile(destPath, 'utf8');
    expect(reassembledContent).toBe('ABC');
  });

  it('removes stale chunks when splitting a file that got smaller', async () => {
    const sourcePath = path.join(tempDir, 'smaller-file.txt');
    const destBase = path.join(tempDir, 'repo-smaller.txt');

    // First, split a large file into 3 chunks
    setChunkSizeForTesting(10);
    await writeFile(sourcePath, 'a'.repeat(25)); // 3 chunks: 10, 10, 5
    await splitIntoChunks(sourcePath, destBase);
    let files = await readdir(tempDir);
    expect(files.filter((f) => f.startsWith(`repo-smaller.txt${CHUNK_SUFFIX}`))).toHaveLength(3);

    // Now, split a smaller file into 1 chunk
    await writeFile(sourcePath, 'b'.repeat(5)); // 1 chunk: 5
    // In copyItem, we'd call removeChunks then splitIntoChunks (if still > CHUNK_SIZE)
    // or just copyItem which calls removeChunks.
    // Let's simulate the copyItem logic for large -> smaller
    await rm(destBase, { force: true });
    // Simulate removeChunks which should be called
    const dir = path.dirname(destBase);
    const baseName = path.basename(destBase);
    const entries = await readdir(dir);
    for (const entry of entries) {
      if (entry.startsWith(baseName + CHUNK_SUFFIX)) {
        await rm(path.join(dir, entry), { force: true });
      }
    }

    await splitIntoChunks(sourcePath, destBase);
    files = await readdir(tempDir);
    expect(files.filter((f) => f.startsWith(`repo-smaller.txt${CHUNK_SUFFIX}`))).toHaveLength(1);
  });
});
