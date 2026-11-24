import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCorners, paperCorners, quadrilateralTransform, validCorners } from '../src/scan-geometry.js';
import { renameFiles } from '../src/photo-tools.js';

test('四角校正将输出四角准确投影回原纸张四角', () => {
  const corners = [{ x: .15, y: .12 }, { x: .9, y: .2 }, { x: .74, y: .85 }, { x: .2, y: .9 }];
  const { a, b, c, d, e, f, g, h } = quadrilateralTransform(corners);
  for (const [index, [u, v]] of [[0, 0], [1, 0], [1, 1], [0, 1]].entries()) {
    const divisor = g * u + h * v + 1;
    assert(Math.abs((a * u + b * v + c) / divisor - corners[index].x) < 1e-9);
    assert(Math.abs((d * u + e * v + f) / divisor - corners[index].y) < 1e-9);
  }
  assert.equal(validCorners(defaultCorners()), true);
  assert.throws(() => quadrilateralTransform([corners[0], corners[2], corners[1], corners[3]]), /四个角/);
});

test('找出深色背景的亮纸张，低对比度时留给用户手动调整', () => {
  const size = 80;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(25);
  assert.equal(paperCorners(pixels, size, size), null);
  for (let y = 10; y < 69; y++) {
    for (let x = 15; x < 65; x++) {
      pixels.fill(240, (y * size + x) * 4, (y * size + x) * 4 + 4);
    }
  }
  const corners = paperCorners(pixels, size, size);
  assert(validCorners(corners));
  assert.deepEqual(corners[0], { x: 15 / 79, y: 10 / 79 });
  assert.deepEqual(corners[2], { x: 64 / 79, y: 68 / 79 });
});

test('批量重命名保留原文件数据和扩展名，并清理文件名前缀', () => {
  const input = [new File(['abc'], '合同.PDF'), new File(['xyz'], 'notes')];
  const renamed = renameFiles(input, { prefix: '  报销:2026 ', first: '98', digits: '3', date: '2026-11-24' });
  assert.deepEqual(renamed.map(item => item.name), ['2026-11-24-报销_2026-098.PDF', '2026-11-24-报销_2026-099']);
  assert.equal(renamed[0].blob, input[0]);
  assert.throws(() => renameFiles(input, { prefix: ' .. ', first: '98', digits: '3' }), /文件名前缀/);
});
