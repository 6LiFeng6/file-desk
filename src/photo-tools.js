import { basename, fileKind, integer, MAX_PIXELS, safeName } from './rules.js';
import { bitmap, canvas, disposeCanvas, toBlob, transformImage } from './images.js';

export function cleanImage(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  const type = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg';
  return transformImage(file, { type, maxSide: 6000, suffix: '-已清除元数据' });
}

export function renameFiles(files, options) {
  const prefix = safeName(options.prefix.trim()).slice(0, 96).replace(/^[. ]+|[. ]+$/g, '');
  if (!prefix) throw new Error('请输入有效的文件名前缀。');
  const first = integer(options.first, 1, 99999, '起始序号');
  const digits = integer(options.digits, 1, 6, '序号位数');
  const date = options.date ? options.date + '-' : '';
  return files.map((file, index) => {
    const dot = file.name.lastIndexOf('.');
    const extension = dot > 0 && dot < file.name.length - 1 ? safeName(file.name.slice(dot)).slice(0, 24) : '';
    return {
      blob: file,
      name: date + prefix + '-' + String(first + index).padStart(digits, '0') + extension,
      note: file.name,
      previewable: ['image', 'pdf'].includes(fileKind(file.name)),
    };
  });
}

export async function stitchImages(files, settings, progress) {
  const vertical = settings.direction === 'vertical';
  const gap = integer(settings.gap, 0, 300, '间距');
  const sizes = [];
  for (const [index, file] of files.entries()) {
    progress(index / files.length * 0.15, '正在读取图片尺寸');
    const image = await bitmap(file);
    sizes.push(vertical ? [image.width, image.height] : [image.height, image.width]);
    image.close();
  }
  const cross = Math.min(3000, Math.max(...sizes.map(size => size[0])));
  const strips = sizes.map(([width, height]) => height * cross / width);
  const total = strips.reduce((sum, length) => sum + length, 0);
  const maxAxis = 16000;
  const lengthWithGaps = total + gap * (files.length - 1);
  const factor = Math.min(1, (maxAxis - files.length * 2) / lengthWithGaps,
    Math.sqrt((MAX_PIXELS - 50000) / (cross * lengthWithGaps)));
  const shortSide = Math.max(1, Math.floor(cross * factor));
  const stripLengths = strips.map(length => Math.max(1, Math.round(length * factor)));
  const spacing = Math.round(gap * factor);
  const longSide = stripLengths.reduce((sum, length) => sum + length, 0) + spacing * (files.length - 1);
  const width = vertical ? shortSide : longSide;
  const height = vertical ? longSide : shortSide;
  const output = canvas(width, height);
  try {
    const ctx = output.getContext('2d');
    ctx.fillStyle = settings.background;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    let start = 0;
    for (const [index, file] of files.entries()) {
      progress(0.15 + 0.85 * index / files.length, '正在拼接第 ' + (index + 1) + ' 张图');
      const image = await bitmap(file);
      const length = stripLengths[index];
      try {
        if (vertical) ctx.drawImage(image, 0, start, shortSide, length);
        else ctx.drawImage(image, start, 0, length, shortSide);
      } finally {
        image.close();
      }
      start += length + spacing;
    }
    return {
      name: '拼接图片' + (settings.type === 'image/png' ? '.png' : '.jpg'),
      blob: await toBlob(output, settings.type, 0.93), width, height,
      note: factor < 1 ? '图片较长，已按比例缩小以便完整导出。' : '',
    };
  } finally {
    disposeCanvas(output);
  }
}

export function drawMask(ctx, boxes, width, height) {
  ctx.fillStyle = '#080808';
  for (const box of boxes) {
    const x = Math.floor(box.x * width);
    const y = Math.floor(box.y * height);
    ctx.fillRect(x, y, Math.ceil((box.x + box.width) * width) - x, Math.ceil((box.y + box.height) * height) - y);
  }
}

export function drawWatermark(ctx, text, width, height) {
  if (!text) return;
  const size = Math.max(10, Math.min(88, Math.round(Math.min(width, height) / 15)));
  const step = Math.max(size * 4, Math.min(width, height) * 0.4);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 7);
  ctx.font = '700 ' + size + 'px "Microsoft YaHei", "PingFang SC", sans-serif';
  const widthWithGap = ctx.measureText(text).width + size * 2.8;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(40,35,47,.39)';
  const limit = Math.hypot(width, height) / 2;
  for (let row = -Math.ceil(limit / step); row <= Math.ceil(limit / step); row++) {
    for (let col = -Math.ceil(limit / widthWithGap); col <= Math.ceil(limit / widthWithGap); col++) {
      ctx.fillText(text, col * widthWithGap + (row % 2) * widthWithGap / 2, row * step);
    }
  }
  ctx.restore();
}

export async function protectImage(file, boxes, text) {
  const image = await bitmap(file);
  let output;
  try {
    const factor = Math.min(1, 4800 / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * factor));
    const height = Math.max(1, Math.round(image.height * factor));
    output = canvas(width, height);
    const ctx = output.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    drawWatermark(ctx, text, width, height);
    drawMask(ctx, boxes, width, height);
    return { name: basename(file.name) + '-隐私副本.png', blob: await toBlob(output, 'image/png'), width, height };
  } finally {
    image.close();
    if (output) disposeCanvas(output);
  }
}
