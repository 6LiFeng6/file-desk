import { PDFDocument, degrees } from 'pdf-lib';
import { basename, bytesLabel, parsePages } from './rules.js';
import { canvas, disposeCanvas, imageForPdf, toBlob } from './images.js';

let pdfEngine;

export async function readPdf(file) {
  pdfEngine ??= Promise.all([
    import('pdfjs-dist/build/pdf.mjs'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
    return pdfjs;
  });

  const pdfjs = await pdfEngine;
  const loading = pdfjs.getDocument({
    data: await file.arrayBuffer(),
    isEvalSupported: false,
    cMapUrl: new URL('./local/cmaps/', document.baseURI).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('./local/fonts/', document.baseURI).href,
  });
  try {
    return await loading.promise;
  } catch (error) {
    await loading.destroy();
    if (error.name === 'PasswordException') throw new Error('文件有密码保护，请解锁后再添加。');
    throw new Error('无法打开 PDF，请检查文件是否完整。');
  }
}

export async function loadPdf(file) {
  try {
    return await PDFDocument.load(await file.arrayBuffer(), { updateMetadata: false });
  } catch (error) {
    if (error.constructor.name === 'EncryptedPDFError') throw new Error('文件有密码保护，请解锁后再添加。');
    throw new Error('无法打开 PDF，请检查文件是否完整。');
  }
}

export async function renderPage(page, scale, maxSide = 3200) {
  const base = page.getViewport({ scale: 1 });
  const actual = Math.min(scale, maxSide / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale: actual });
  const rendered = canvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
  try {
    await page.render({ canvasContext: rendered.getContext('2d'), viewport, background: '#fff' }).promise;
    return { rendered, width: base.width, height: base.height };
  } catch (error) {
    disposeCanvas(rendered);
    throw error;
  } finally {
    page.cleanup();
  }
}

export async function jpegPage(pdf, jpeg, width, height, options = {}) {
  const embedded = await pdf.embedJpg(jpeg);
  const page = pdf.addPage([width, height]);
  if (options.fit) {
    const scale = Math.min((width - 32) / embedded.width, (height - 32) / embedded.height);
    const image = embedded.scale(scale);
    page.drawImage(embedded, { x: (width - image.width) / 2, y: (height - image.height) / 2, ...image });
  } else {
    page.drawImage(embedded, { x: 0, y: 0, width, height });
  }
  return page;
}

export async function pdfBlob(pdf) {
  return new Blob([await pdf.save({ useObjectStreams: true })], { type: 'application/pdf' });
}

export async function copyPages(target, source, indices, rotation = 0) {
  const copied = await target.copyPages(source, indices);
  for (const page of copied) {
    if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
    target.addPage(page);
  }
}

export async function combineMaterials(files, kind, progress = () => {}) {
  const output = await PDFDocument.create();
  for (const [index, file] of files.entries()) {
    progress(index / files.length, '正在处理第 ' + (index + 1) + ' 份材料');
    try {
      if (kind(file.name) === 'image') {
        await jpegPage(output, await imageForPdf(file), 595.28, 841.89, { fit: true });
      } else {
        let source;
        if (kind(file.name) === 'word') {
          const { wordToPdf } = await import('./word.js');
          source = await loadPdf(await wordToPdf(file));
        } else {
          source = await loadPdf(file);
        }
        await copyPages(output, source, source.getPageIndices());
      }
    } catch (error) {
      throw new Error(file.name + ' · ' + error.message);
    }
  }
  return pdfBlob(output);
}

export async function arrangePdf(file, { pages, rotation, split }) {
  const source = await loadPdf(file);
  const indices = parsePages(pages, source.getPageCount());
  if (split && indices.length > 100) throw new Error('拆分模式单次最多导出 100 页。');
  const groups = split ? indices.map(index => [index]) : [indices];
  const outputs = [];
  for (const [index, group] of groups.entries()) {
    const output = await PDFDocument.create();
    await copyPages(output, source, group, rotation);
    const suffix = split ? '-第' + (index + 1) + '份-第' + (group[0] + 1) + '页' : '-已整理';
    outputs.push({ name: basename(file.name) + suffix + '.pdf', blob: await pdfBlob(output) });
  }
  return outputs;
}

async function rasterPdf(source, scale, quality, progress) {
  const output = await PDFDocument.create();
  for (let index = 1; index <= source.numPages; index++) {
    progress(index / source.numPages);
    const page = await source.getPage(index);
    const { rendered, width, height } = await renderPage(page, scale);
    try {
      const image = await toBlob(rendered, 'image/jpeg', quality);
      await jpegPage(output, await image.arrayBuffer(), width, height);
    } finally {
      disposeCanvas(rendered);
    }
  }
  return pdfBlob(output);
}

export async function compressPdf(file, cap, progress = () => {}) {
  const input = file.slice(0, file.size, 'application/pdf');
  const parsed = await loadPdf(file);
  if (input.size <= cap) return { blob: input, before: input.size, cap, ok: true };
  const rewritten = await pdfBlob(parsed);
  let best = rewritten.size < input.size ? rewritten : input;
  if (best.size <= cap) return { blob: best, before: input.size, cap, ok: true };

  const source = await readPdf(file);
  let rasterized = false;
  try {
    const levels = [[1.65, 0.78], [1.35, 0.62], [1.1, 0.48], [0.85, 0.36], [0.6, 0.24], [0.42, 0.14]];
    for (const [index, [scale, quality]] of levels.entries()) {
      const candidate = await rasterPdf(source, scale, quality, fraction => {
        progress((index + fraction) / levels.length, '正在压缩 PDF · ' + bytesLabel(best.size));
      });
      if (candidate.size < best.size) {
        best = candidate;
        rasterized = true;
      }
      if (best.size <= cap) break;
    }
    return { blob: best, before: input.size, cap, ok: best.size <= cap, rasterized };
  } finally {
    await source.destroy();
  }
}

export async function pdfToImages(file, options, progress) {
  const pdf = await readPdf(file);
  try {
    const indices = parsePages(options.pages, pdf.numPages);
    if (indices.length > 60) throw new Error('单次最多导出 60 张图片，请缩小页码范围。');
    const outputs = [];
    for (const [index, pageIndex] of indices.entries()) {
      progress(index / indices.length, '正在导出第 ' + (index + 1) + ' 张图片');
      const page = await pdf.getPage(pageIndex + 1);
      const { rendered } = await renderPage(page, options.scale);
      try {
        outputs.push({
          name: basename(file.name) + '-第' + (pageIndex + 1) + '页' + (options.type === 'image/jpeg' ? '.jpg' : '.png'),
          blob: await toBlob(rendered, options.type, 0.92),
          width: rendered.width,
          height: rendered.height,
        });
      } finally {
        disposeCanvas(rendered);
      }
    }
    return outputs;
  } finally {
    await pdf.destroy();
  }
}
