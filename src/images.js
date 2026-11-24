import { KB, MAX_PIXELS, basename } from './rules.js';

const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export function canvas(width, height) {
  if (width * height > MAX_PIXELS) throw new Error('输出超过 2400 万像素，请减小尺寸或倍率。');
  const result = document.createElement('canvas');
  result.width = width;
  result.height = height;
  return result;
}

export function disposeCanvas(element) {
  element.width = 1;
  element.height = 1;
}

export async function bitmap(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    if (/\.hei[cf]$/i.test(file.name ?? '') || /^image\/hei[cf]/i.test(file.type)) {
      try {
        const decoderUrl = new URL('./local/heic/heic-to.js', document.baseURI).href;
        const { heicTo } = await import(/* @vite-ignore */ decoderUrl);
        const decoded = await heicTo({ blob: file, type: 'image/png' });
        return await createImageBitmap(decoded);
      } catch (cause) {
        throw new Error('无法解码这张 HEIC / HEIF 照片，请检查文件是否完整。', { cause });
      }
    }
    throw new Error('无法读取这张图片。请确认文件完整且格式受支持。');
  }
}

export function toBlob(element, type, quality) {
  return new Promise((resolve, reject) => {
    element.toBlob(result => {
      if (!result || result.type !== type) {
        reject(new Error('浏览器无法以所选格式编码这张图片。'));
        return;
      }
      resolve(result);
    }, type, quality);
  });
}

export async function previewImage(file) {
  const source = await bitmap(file);
  try {
    const factor = Math.min(1, 1000 / Math.max(source.width, source.height));
    return paint(source, Math.max(1, Math.round(source.width * factor)), Math.max(1, Math.round(source.height * factor)), 'image/jpeg');
  } finally {
    source.close();
  }
}

function paint(source, width, height, type, crop, anchor) {
  const result = canvas(width, height);
  const ctx = result.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
  }
  if (!crop) {
    ctx.drawImage(source, 0, 0, width, height);
    return result;
  }
  const scale = Math.max(width / source.width, height / source.height);
  const cropWidth = width / scale;
  const cropHeight = height / scale;
  const x = (source.width - cropWidth) * (anchor === 'left' ? 0 : anchor === 'right' ? 1 : 0.5);
  const y = (source.height - cropHeight) * (anchor === 'top' ? 0 : anchor === 'bottom' ? 1 : 0.5);
  ctx.drawImage(source, x, y, cropWidth, cropHeight, 0, 0, width, height);
  return result;
}

async function bestQuality(element, type, cap) {
  const fullQuality = await toBlob(element, type, 0.94);
  if (type === 'image/png' || !cap || fullQuality.size <= cap) return fullQuality;

  let best = await toBlob(element, type, 0.06);
  if (best.size > cap) return best;
  let lower = 0.06;
  let upper = 0.94;
  for (let repeat = 0; repeat < 8; repeat++) {
    const quality = (lower + upper) / 2;
    const candidate = await toBlob(element, type, quality);
    if (candidate.size <= cap) {
      best = candidate;
      lower = quality;
    } else {
      upper = quality;
    }
  }
  return best;
}

export async function transformImage(file, options) {
  const source = await bitmap(file);
  let output;
  try {
    const requestedWidth = options.width ?? Math.round(source.width * (options.scale ?? 1));
    const requestedHeight = options.height ?? Math.round(source.height * (options.scale ?? 1));
    const factor = options.maxSide ? Math.min(1, options.maxSide / Math.max(requestedWidth, requestedHeight),
      Math.sqrt((MAX_PIXELS - 10000) / (requestedWidth * requestedHeight))) : 1;
    const width = Math.max(1, Math.round(requestedWidth * factor));
    const height = Math.max(1, Math.round(requestedHeight * factor));
    const type = options.type ?? 'image/jpeg';
    const cap = options.maxKB ? options.maxKB * KB : 0;
    const sourceSize = source.width + ' × ' + source.height;
    let resultWidth = width;
    let resultHeight = height;

    if (options.method === 'ai') {
      const { upscaleImage } = await import('./upscale.js');
      output = await upscaleImage(source, options.scale, options.progress, type);
    } else {
      output = paint(source, width, height, type, options.crop, options.anchor);
    }

    let result = await bestQuality(output, type, cap);
    const maxReductions = options.allowResize ? 8 : 0;
    for (let repeat = 0; cap && result.size > cap && repeat < maxReductions; repeat++) {
      const factor = Math.max(0.2, Math.min(0.85, Math.sqrt(cap / result.size) * 0.92));
      const smallerWidth = Math.max(1, Math.floor(resultWidth * factor));
      const smallerHeight = Math.max(1, Math.floor(resultHeight * factor));
      if (smallerWidth === resultWidth && smallerHeight === resultHeight) break;
      resultWidth = smallerWidth;
      resultHeight = smallerHeight;
      disposeCanvas(output);
      output = paint(source, resultWidth, resultHeight, type, options.crop, options.anchor);
      result = await bestQuality(output, type, cap);
    }

    const suffix = options.suffix ?? '';
    return {
      blob: result,
      name: basename(file.name) + suffix + '.' + extensions[type],
      width: resultWidth,
      height: resultHeight,
      before: file.size,
      sourceSize,
      ok: !cap || result.size <= cap,
      cap,
      note: factor < 1 ? '原图较大，已按比例缩小后导出。' : '',
    };
  } finally {
    source.close();
    if (output) disposeCanvas(output);
  }
}

export async function imageForPdf(file) {
  const source = await bitmap(file);
  let rendered;
  try {
    const scale = Math.min(1, 4000 / Math.max(source.width, source.height));
    rendered = paint(source, Math.max(1, Math.round(source.width * scale)), Math.max(1, Math.round(source.height * scale)), 'image/jpeg');
    return new Uint8Array(await (await toBlob(rendered, 'image/jpeg', 0.93)).arrayBuffer());
  } finally {
    source.close();
    if (rendered) disposeCanvas(rendered);
  }
}
