import { PDFDocument, PageSizes, StandardFonts, degrees, rgb } from 'pdf-lib';
import { basename, integer } from './rules.js';
import { jpegPage, loadPdf, pdfBlob, readPdf, renderPage } from './pdf.js';
import { disposeCanvas, toBlob } from './images.js';
import { drawMask, drawWatermark } from './photo-tools.js';

export async function exportPageOrder(pages, progress) {
  if (!pages.length) throw new Error('请保留或插入至少一页。');
  const output = await PDFDocument.create();
  const bySource = new Map();
  for (const item of pages) {
    if (!item.file) continue;
    if (!bySource.has(item.file)) bySource.set(item.file, []);
    bySource.get(item.file).push(item);
  }
  const outputPages = new Map();
  let index = 0;
  for (const [file, items] of bySource) {
    progress(index++ / bySource.size, '正在读取 ' + file.name);
    const source = await loadPdf(file);
    const copies = await output.copyPages(source, items.map(item => item.index));
    items.forEach((item, position) => outputPages.set(item, copies[position]));
  }
  for (const item of pages) {
    const page = outputPages.get(item) ?? output.addPage(PageSizes.A4);
    const rotation = item.rotation ?? 0;
    if (rotation) page.setRotation(degrees((page.getRotation().angle + rotation) % 360));
    if (item.file) output.addPage(page);
  }
  return { name: '已整理页面.pdf', blob: await pdfBlob(output), note: '共 ' + pages.length + ' 页。' };
}

function placement(rotation, width, height) {
  const adjusted = ((rotation % 360) + 360) % 360;
  if (adjusted === 90) return { width: height, height: width, x: 0, y: width, angle: -90 };
  if (adjusted === 180) return { width, height, x: width, y: height, angle: -180 };
  if (adjusted === 270) return { width: height, height: width, x: height, y: 0, angle: -270 };
  return { width, height, x: 0, y: 0, angle: 0 };
}

export async function layoutPdf(file, settings, progress) {
  const source = await loadPdf(file);
  const output = await PDFDocument.create();
  const first = settings.numbers ? integer(settings.first, 1, 99999, '起始页码') : 1;
  if (!settings.numbers && settings.size === 'keep') throw new Error('请选择统一纸张，或勾选添加页码。');
  const font = settings.numbers ? await output.embedFont(StandardFonts.Helvetica) : null;
  const sourcePages = source.getPages();
  if (settings.size === 'keep') {
    for (const page of await output.copyPages(source, source.getPageIndices())) output.addPage(page);
  } else {
    try {
      const form = source.getForm();
      if (form.getFields().length) form.flatten();
    } catch {
      throw new Error('此 PDF 含有无法保留的表单。请在 PDF 阅读器中另存为普通 PDF 后再统一纸张。');
    }

    for (const [index, page] of sourcePages.entries()) {
      progress(index / sourcePages.length, '正在统一页面尺寸');
      const { x, y, width, height } = page.getCropBox();
      const rotation = placement(page.getRotation().angle, width, height);
      const landscape = settings.size === 'landscape' || (settings.size === 'auto' && rotation.width > rotation.height);
      const dimensions = landscape ? [PageSizes.A4[1], PageSizes.A4[0]] : PageSizes.A4;
      const target = output.addPage(dimensions);
      if (!page.node.Contents()) continue;
      const margin = 24;
      const scale = Math.min((dimensions[0] - 2 * margin) / rotation.width, (dimensions[1] - 2 * margin) / rotation.height);
      const view = await output.embedPage(page, { left: x, bottom: y, right: x + width, top: y + height });
      target.drawPage(view, {
        x: (dimensions[0] - rotation.width * scale) / 2 + rotation.x * scale,
        y: (dimensions[1] - rotation.height * scale) / 2 + rotation.y * scale,
        xScale: scale, yScale: scale, rotate: degrees(rotation.angle),
      });
    }
  }

  if (font) {
    for (const [index, page] of output.getPages().entries()) {
      const text = String(first + index);
      const fontSize = 10;
      const crop = page.getCropBox();
      const offset = font.widthOfTextAtSize(text, fontSize);
      const visual = placement(page.getRotation().angle, crop.width, crop.height);
      const left = settings.numberPosition === 'left' ? 14 : settings.numberPosition === 'right'
        ? visual.width - 14 - offset : (visual.width - offset) / 2;
      const bottom = 12;
      const angle = -visual.angle;
      const rad = angle * Math.PI / 180;
      const localX = Math.cos(rad) * (left - visual.x) - Math.sin(rad) * (bottom - visual.y);
      const localY = Math.sin(rad) * (left - visual.x) + Math.cos(rad) * (bottom - visual.y);
      page.drawText(text, { x: crop.x + localX, y: crop.y + localY, size: fontSize, font, rotate: degrees(angle), color: rgb(0.18, 0.18, 0.2) });
    }
  }
  return { name: basename(file.name) + '-出版面.pdf', blob: await pdfBlob(output) };
}

export async function protectPdf(file, boxes, text, progress) {
  const source = await readPdf(file);
  const output = await PDFDocument.create();
  try {
    for (let number = 1; number <= source.numPages; number++) {
      progress((number - 1) / source.numPages, '正在导出第 ' + number + ' 页');
      const { rendered, width, height } = await renderPage(await source.getPage(number), 2.2, 3500);
      try {
        const ctx = rendered.getContext('2d');
        drawWatermark(ctx, text, rendered.width, rendered.height);
        drawMask(ctx, boxes.get(number) ?? [], rendered.width, rendered.height);
        const image = await toBlob(rendered, 'image/jpeg', 0.94);
        await jpegPage(output, await image.arrayBuffer(), width, height);
      } finally {
        disposeCanvas(rendered);
      }
    }
    return {
      name: basename(file.name) + '-隐私副本.pdf',
      blob: await pdfBlob(output),
      note: '已从处理后的页面重建文件。原始文字层和附件已移除。',
    };
  } finally {
    await source.destroy();
  }
}
