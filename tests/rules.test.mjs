import test from 'node:test';
import assert from 'node:assert/strict';
import { bytesLabel, fileKind, integer, parsePages, safeName } from '../src/rules.js';

test('识别支持的文件扩展名', () => {
  assert.equal(fileKind('报名.DOCX'), 'word');
  assert.equal(fileKind('截图.JPEG'), 'image');
  assert.equal(fileKind('材料.pdf'), 'pdf');
  assert.equal(fileKind('归档.doc'), '');
});

test('按用户输入顺序展开和重复 PDF 页码', () => {
  assert.deepEqual(parsePages('3，1－2、3', 3), [2, 0, 1, 2]);
  assert.deepEqual(parsePages('', 3), [0, 1, 2]);
  for (const bad of ['0', '4', '2-1', '1,,2', '1.5', '一']) {
    assert.throws(() => parsePages(bad, 3));
  }
});

test('尺寸、体积和文件名显示', () => {
  assert.equal(integer('300', 1, 8000, '宽度'), 300);
  assert.throws(() => integer('300.5', 1, 8000, '宽度'));
  assert.equal(bytesLabel(100 * 1024), '100 KB');
  assert.equal(bytesLabel(2 * 1024 * 1024), '2 MB');
  assert.equal(safeName('文档:报告.pdf'), '文档_报告.pdf');
});
