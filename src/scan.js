import { PDFDocument, PageSizes } from 'pdf-lib';
import { bitmap, canvas, disposeCanvas, toBlob } from './images.js';
import { compressPdf, jpegPage, pdfBlob } from './pdf.js';
import { defaultCorners, paperCorners, quadrilateralTransform } from './scan-geometry.js';

function drawScaled(image, limit) {
  const scale = Math.min(1, limit / Math.max(image.width, image.height));
  const output = canvas(Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)));
  const ctx = output.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, output.width, output.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, output.width, output.height);
  return output;
}

export async function scanPreview(file) {
  const image = await bitmap(file);
  let preview;
  let sample;
  try {
    preview = drawScaled(image, 1000);
    sample = drawScaled(image, 330);
    const pixels = sample.getContext('2d').getImageData(0, 0, sample.width, sample.height);
    const found = paperCorners(pixels.data, sample.width, sample.height);
    return {
      thumb: preview.toDataURL('image/jpeg', 0.82),
      aspect: preview.width / preview.height,
      detected: Boolean(found),
      points: found ?? defaultCorners(),
    };
  } finally {
    image.close();
    if (preview) disposeCanvas(preview);
    if (sample) disposeCanvas(sample);
  }
}

export function straighten(input, corners, cleanup) {
  const { a, b, c, d, e, f, g, h } = quadrilateralTransform(corners);
  const distance = (start, end) => Math.hypot((corners[start].x - corners[end].x) * input.width,
    (corners[start].y - corners[end].y) * input.height);
  const width = Math.max(2, Math.round(Math.max(distance(0, 1), distance(3, 2))));
  const height = Math.max(2, Math.round(Math.max(distance(0, 3), distance(1, 2))));
  const output = canvas(width, height);
  const sourcePixels = input.getContext('2d').getImageData(0, 0, input.width, input.height).data;
  const ctx = output.getContext('2d');
  const corrected = ctx.createImageData(width, height);
  const pixels = corrected.data;
  const imageRight = input.width - 1;
  const imageBottom = input.height - 1;

  for (let y = 0; y < height; y++) {
    const v = y / (height - 1);
    for (let x = 0; x < width; x++) {
      const u = x / (width - 1);
      const divisor = g * u + h * v + 1;
      const sourceX = Math.max(0, Math.min(imageRight, (a * u + b * v + c) / divisor * imageRight));
      const sourceY = Math.max(0, Math.min(imageBottom, (d * u + e * v + f) / divisor * imageBottom));
      const column = Math.floor(sourceX);
      const row = Math.floor(sourceY);
      const nextColumn = Math.min(imageRight, column + 1);
      const nextRow = Math.min(imageBottom, row + 1);
      const horizontal = sourceX - column;
      const vertical = sourceY - row;
      const dest = (y * width + x) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const p0 = sourcePixels[(row * input.width + column) * 4 + channel];
        const p1 = sourcePixels[(row * input.width + nextColumn) * 4 + channel];
        const p2 = sourcePixels[(nextRow * input.width + column) * 4 + channel];
        const p3 = sourcePixels[(nextRow * input.width + nextColumn) * 4 + channel];
        pixels[dest + channel] = (p0 + (p1 - p0) * horizontal) * (1 - vertical) + (p2 + (p3 - p2) * horizontal) * vertical;
      }
      if (cleanup === 'gray') {
        const tone = pixels[dest] * 0.21 + pixels[dest + 1] * 0.72 + pixels[dest + 2] * 0.07;
        const gray = (tone - 24) * 1.22;
        pixels[dest] = gray;
        pixels[dest + 1] = gray;
        pixels[dest + 2] = gray;
      }
      pixels[dest + 3] = 255;
    }
  }
  ctx.putImageData(corrected, 0, 0);
  return output;
}

export async function scanToPdf(items, options, cap, progress) {
  const output = await PDFDocument.create();
  for (const [index, item] of items.entries()) {
    progress(index / items.length * (cap ? 0.72 : 1), '正在校正第 ' + (index + 1) + ' 张照片');
    const image = await bitmap(item.file);
    let source;
    let corrected;
    try {
      source = drawScaled(image, 2200);
      corrected = straighten(source, item.points, options.cleanup);
      const jpg = await toBlob(corrected, 'image/jpeg', 0.89);
      const [a4Width, a4Height] = PageSizes.A4;
      await jpegPage(output, await jpg.arrayBuffer(), a4Width, a4Height, { fit: true });
    } finally {
      image.close();
      if (source) disposeCanvas(source);
      if (corrected) disposeCanvas(corrected);
    }
  }
  const blob = await pdfBlob(output);
  const name = '手机扫描材料.pdf';
  if (!cap) return { name, blob, note: '共 ' + items.length + ' 页 A4。' };
  const result = await compressPdf(blob, cap, (fraction, message) => progress(0.72 + fraction * 0.28, message));
  return { ...result, name, note: '共 ' + items.length + ' 页 A4。' };
}
