import { PDFDocument } from 'pdf-lib';
import { basename } from './rules.js';
import { disposeCanvas, toBlob, transformImage } from './images.js';
import { jpegPage, pdfBlob, readPdf, renderPage } from './pdf.js';

export async function wordToPdf(file, progress = () => {}) {
  const [{ renderAsync }, { default: capture }] = await Promise.all([
    import('docx-preview'),
    import('html2canvas'),
  ]);
  const wrapper = document.createElement('div');
  wrapper.className = 'word-render';
  wrapper.setAttribute('aria-hidden', 'true');
  document.body.append(wrapper);
  try {
    try {
      await renderAsync(await file.arrayBuffer(), wrapper, null, {
        className: 'converted-docx',
        inWrapper: false,
        breakPages: true,
        ignoreLastRenderedPageBreak: false,
        renderAltChunks: false,
      });
    } catch {
      throw new Error('无法打开 Word 文档，请确认文件为有效的 .docx。');
    }
    await Promise.allSettled([
      document.fonts.ready,
      ...Array.from(wrapper.querySelectorAll('img'), image => image.decode()),
    ]);
    const sections = Array.from(wrapper.querySelectorAll('section.converted-docx'));
    if (!sections.length) throw new Error('Word 文档中没有可转换的内容。');
    const output = await PDFDocument.create();
    for (const [index, section] of sections.entries()) {
      progress(index / sections.length, '正在转换 Word 页面 ' + (index + 1));
      const width = Math.ceil(section.getBoundingClientRect().width);
      const pageHeight = Math.round(parseFloat(getComputedStyle(section).minHeight)) || 1123;
      const height = Math.max(pageHeight, Math.ceil(section.scrollHeight));
      const scale = Math.min(1.55, 2800 / Math.max(width, pageHeight));
      const sectionTop = section.getBoundingClientRect().top;
      const lineBoundaries = Array.from(section.querySelectorAll('p, tr'), block =>
        Math.round(block.getBoundingClientRect().bottom - sectionTop));
      let offset = 0;
      while (offset < height) {
        const remaining = height - offset;
        const edge = offset + pageHeight;
        const safeBreak = Math.max(0, ...lineBoundaries.filter(line => line >= edge - 160 && line <= edge));
        const slice = remaining <= pageHeight ? remaining : (safeBreak || edge) - offset;
        const rendered = await capture(section, {
          x: 0, y: offset, width, height: pageHeight, scale,
          backgroundColor: '#fff', logging: false, useCORS: false,
          windowWidth: Math.max(width + 20, 1024),
        });
        try {
          if (slice < pageHeight && remaining > pageHeight) {
            const ctx = rendered.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, Math.floor(slice * scale), rendered.width, rendered.height);
          }
          const image = await toBlob(rendered, 'image/jpeg', 0.92);
          await jpegPage(output, await image.arrayBuffer(), width * 0.75, pageHeight * 0.75);
        } finally {
          disposeCanvas(rendered);
        }
        offset += slice;
      }
    }
    return pdfBlob(output);
  } finally {
    wrapper.remove();
  }
}

async function createOcr(langs, progress) {
  const [{ createWorker, OEM }, resources] = await Promise.all([
    import('tesseract.js'),
    import('./ocr-assets.js'),
  ]);
  return createWorker(langs, OEM.LSTM_ONLY, {
    ...resources.ocrAssets(),
    logger: ({ progress: fraction, status }) => {
      progress(fraction, status === 'recognizing text' ? '正在识别文字' : '正在加载 OCR 引擎与语言');
    },
    errorHandler: () => {},
  });
}

function textFromPdf(items) {
  let output = '';
  let last = null;
  for (const item of items) {
    if (!('str' in item)) continue;
    if (last && !last.hasEOL && last.str && item.str) {
      const height = Math.max(item.height, last.height, 4);
      const shift = Math.abs(item.transform[5] - last.transform[5]);
      const gap = item.transform[4] - (last.transform[4] + last.width);
      if (shift > height * 0.55) output += '\n';
      else if (gap > height * 0.28 && !/\s$/.test(output) && !/^\s/.test(item.str)) output += ' ';
    }
    output += item.str;
    if (item.hasEOL) output += '\n';
    last = item;
  }
  return output.trim();
}

async function makeDocx(pages) {
  const { Document, Packer, Paragraph, TextRun } = await import('docx');
  const children = pages.flatMap((page, pageIndex) => page.split(/\r?\n/).map((line, lineIndex) => new Paragraph({
    children: [new TextRun({ text: line, font: { name: '等线', eastAsia: '等线' }, size: 22 })],
    spacing: { after: 80 },
    pageBreakBefore: pageIndex > 0 && lineIndex === 0,
  })));
  return Packer.toBlob(new Document({ sections: [{ children }] }));
}

export async function pdfToWord(file, options, progress) {
  const pdf = await readPdf(file);
  let worker;
  let workerProgress = () => {};
  try {
    const pages = [];
    let scans = 0;
    let missing = 0;
    for (let index = 1; index <= pdf.numPages; index++) {
      const base = (index - 1) / pdf.numPages;
      progress(base, '正在读取 PDF 第 ' + index + ' 页');
      const page = await pdf.getPage(index);
      const contents = await page.getTextContent();
      let text = textFromPdf(contents.items);
      if (!text && options.ocr !== 'off') {
        workerProgress = (fraction, status) => progress(base + fraction / pdf.numPages, status + ' · 第 ' + index + ' 页');
        worker ??= await createOcr(options.ocr === 'eng' ? ['eng'] : ['chi_sim', 'eng'], (...data) => workerProgress(...data));
        const { rendered } = await renderPage(page, 2.3);
        try {
          const result = await worker.recognize(rendered);
          text = result.data.text.trim();
          scans++;
        } finally {
          disposeCanvas(rendered);
        }
      }
      if (!text) missing++;
      pages.push(text);
      page.cleanup();
    }
    if (missing === pages.length) {
      throw new Error(options.ocr === 'off' ? '没有找到可提取文字，请开启 OCR 后重试。' : '没有识别到文字，请检查 PDF 的清晰度和所选语言。');
    }
    return {
      name: basename(file.name) + '.docx',
      blob: await makeDocx(pages),
      note: [scans ? scans + ' 页使用了 OCR。' : '', missing ? missing + ' 页未识别到文字。' : '', '布局、图表和原有样式可能变化。'].join(''),
    };
  } finally {
    await Promise.allSettled([pdf.destroy(), worker?.terminate()]);
  }
}

export async function recognizeImage(file, options, progress) {
  const input = /\.hei[cf]$/i.test(file.name) ? (await transformImage(file, { type: 'image/png', maxSide: 3200 })).blob : file;
  const worker = await createOcr(options.ocr === 'eng' ? ['eng'] : ['chi_sim', 'eng'], progress);
  try {
    const { data } = await worker.recognize(input);
    const value = data.text.trim();
    if (!value) throw new Error('没有识别到文字，请使用更清晰的图片。');
    return {
      text: value,
      name: basename(file.name) + '-文字.docx',
      blob: await makeDocx([value]),
    };
  } finally {
    await worker.terminate();
  }
}
