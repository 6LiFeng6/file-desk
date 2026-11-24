import { MB, basename, bytesLabel, fileKind, integer } from './rules.js';
import { extraTools, runExtraTool } from './more-tools.js';
import { transformImage } from './images.js';

const extraToolIds = new Set(extraTools.map(tool => tool.id));

const outputType = [['image/jpeg', 'JPG'], ['image/png', 'PNG'], ['image/webp', 'WebP']];
const scales = [[2, '2 倍'], [3, '3 倍'], [4, '4 倍']];
const anchors = [['center', '居中'], ['top', '靠上'], ['bottom', '靠下'], ['left', '靠左'], ['right', '靠右']];
const languages = [['chi_sim', '简体中文 + 英文'], ['eng', '英文']];
const formats = { type: 'select', key: 'type', label: '输出格式', choices: outputType };
const pages = { type: 'text', key: 'pages', label: '页码范围', placeholder: '全部页面', detail: '例如 3, 1-2。按输入顺序输出。' };
const limit = { type: 'number', key: 'maxKB', label: '体积上限（KB）', min: 1, max: 100000, value: 300 };
const pdfLimit = { type: 'number', key: 'pdfMB', label: '体积上限（MB）', min: 0.1, max: 100, step: 0.1, value: 2 };
const width = { type: 'number', key: 'width', label: '宽度（px）', min: 1, max: 8000, value: 300 };
const height = { type: 'number', key: 'height', label: '高度（px）', min: 1, max: 8000, value: 400 };
const cropAnchor = { type: 'select', key: 'anchor', label: '裁剪位置', choices: anchors };
const photoFormat = { ...formats, key: 'format', label: '照片格式' };
const photoLimit = { ...limit, key: 'photoKB', label: '照片上限（KB）', value: 100 };
const scanLanguage = { type: 'select', key: 'ocr', label: 'OCR 语言', choices: languages };

export const workflowFields = { width, height, cropAnchor, photoFormat, photoLimit, pdfLimit };

export const catalog = [
  { id: 'word-to-pdf', title: 'Word 转 PDF', description: '将 .docx 保存为便于查看的 PDF。', category: 'convert', kind: 'word', icon: 'word', color: 'blue', note: '以图像保留页面外观，PDF 中的文字无法直接选取。复杂排版可能存在差异。' },
  { id: 'pdf-to-word', title: 'PDF 转 Word', description: '保留原页版式，支持扫描页 OCR。', category: 'convert', kind: 'pdf', icon: 'word', color: 'violet', fields: [
    { type: 'select', key: 'wordMode', label: '转换方式', choices: [
      ['layout', '保留版式 · 文字可编辑'], ['visual', '保留原样 · 图片版'], ['text', '提取文字 · 段落重排'],
    ], detail: '图片版适合外观优先的复杂页面。' },
    { ...scanLanguage, choices: [...languages, ['off', '关闭 OCR']] },
  ], note: '版式模式可编辑文字框，表格线和图片保留在底图。' },
  { id: 'pdf-merge', title: '合并 PDF', description: '拖动排序，将多个 PDF 合成一份。', category: 'pdf', kind: 'pdf', icon: 'merge', color: 'coral', multiple: true, minimum: 2, reorder: true },
  { id: 'pdf-compress', title: '压缩 PDF', description: '指定 MB 上限，查看压缩结果。', category: 'pdf', kind: 'pdf', icon: 'compress', color: 'green', fields: [pdfLimit], note: '需要进一步压缩时会把页面转为图片，文字将无法选取。结果会标明处理方式。' },
  { id: 'image-upscale', title: '图片放大', description: '放大像素，可选 AI 超分辨率。', category: 'image', kind: 'image', icon: 'upscale', color: 'violet', multiple: true, fields: [
    { type: 'select', key: 'method', label: '放大方式', choices: [['standard', '普通放大'], ['ai', 'AI 超分辨率 · 2 倍']] },
    { type: 'select', key: 'scale', label: '放大倍率', choices: scales },
    formats,
  ], note: 'AI 模式使用 2 倍模型，适合小图或局部细节。' },
  { id: 'image-compress', title: '图片压缩', description: '按指定 KB 压缩，支持批量处理。', category: 'image', kind: 'image', icon: 'compress', color: 'green', multiple: true, fields: [limit, formats, { type: 'check', key: 'allowResize', label: '必要时缩小像素尺寸', value: true }] },
  { id: 'image-crop', title: '图片裁剪与改尺寸', description: '按指定宽高裁剪照片或截图。', category: 'image', kind: 'image', icon: 'crop', color: 'blue', multiple: true, fields: [width, height, cropAnchor, formats] },
  { id: 'pdf-arrange', title: '拆分与整理 PDF', description: '提取指定页、调整页序或旋转页面。', category: 'pdf', kind: 'pdf', icon: 'split', color: 'coral', fields: [pages, { type: 'select', key: 'rotation', label: '顺时针旋转', choices: [[0, '原方向'], [90, '90°'], [180, '180°'], [270, '270°']] }, { type: 'check', key: 'split', label: '将每个选中页面分别导出' }] },
  { id: 'images-to-pdf', title: '图片转 PDF', description: '把多张照片或截图按顺序合成 PDF。', category: 'convert', kind: 'image', icon: 'photo', color: 'blue', multiple: true, reorder: true },
  { id: 'pdf-to-images', title: 'PDF 转图片', description: '逐页导出为 PNG 或 JPG。', category: 'convert', kind: 'pdf', icon: 'photo', color: 'coral', fields: [pages, { ...formats, choices: [outputType[1], outputType[0]] }, { type: 'select', key: 'scale', label: '输出清晰度', choices: [[1.5, '标准'], [2.5, '高清']] }] },
  { id: 'image-format', title: '图片格式转换', description: '批量转换 JPG、PNG 和 WebP。', category: 'image', kind: 'image', icon: 'change', color: 'violet', multiple: true, fields: [formats] },
  { id: 'image-ocr', title: '图片文字提取', description: '识别中英文，可复制或导出 Word。', category: 'image', kind: 'image', icon: 'text', color: 'green', fields: [scanLanguage] },
  ...extraTools,
];

export const categories = [
  ['all', '全部'], ['convert', '格式转换'], ['pdf', 'PDF 整理'], ['image', '图片处理'], ['other', '文件整理'],
];

export function megabytes(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0.1 || amount > 100) throw new Error('PDF 体积上限请输入 0.1 至 100 MB。');
  return Math.floor(amount * MB);
}

export function pdfCompressionResult(result, name, before = result.before) {
  return {
    ...result,
    name,
    before,
    note: result.rasterized ? '页面已转为图像，文字无法直接选取。' : '',
  };
}

export async function runTool(tool, files, options, progress) {
  if (extraToolIds.has(tool.id)) return runExtraTool(tool, files, options, progress);
  const file = files[0];
  switch (tool.id) {
    case 'word-to-pdf': {
      const { wordToPdf } = await import('./word.js');
      return [{ name: basename(file.name) + '.pdf', blob: await wordToPdf(file, progress), note: '以图像保留页面外观。' }];
    }
    case 'pdf-to-word': {
      const { pdfToWord } = await import('./word.js');
      return [await pdfToWord(file, options, progress)];
    }
    case 'pdf-merge':
    case 'images-to-pdf': {
      const { combineMaterials } = await import('./pdf.js');
      return [{ name: tool.id === 'pdf-merge' ? '合并文件.pdf' : '图片合集.pdf', blob: await combineMaterials(files, fileKind, progress) }];
    }
    case 'pdf-compress': {
      const { compressPdf } = await import('./pdf.js');
      return [pdfCompressionResult(await compressPdf(file, megabytes(options.pdfMB), progress), basename(file.name) + '-已压缩.pdf')];
    }
    case 'pdf-arrange': {
      const { arrangePdf } = await import('./pdf.js');
      return arrangePdf(file, { ...options, rotation: Number(options.rotation) });
    }
    case 'pdf-to-images': {
      const { pdfToImages } = await import('./pdf.js');
      return pdfToImages(file, { ...options, scale: Number(options.scale) }, progress);
    }
    case 'image-ocr': {
      const { recognizeImage } = await import('./word.js');
      return [await recognizeImage(file, options, progress)];
    }
    default: {
      const outputs = [];
      for (const [index, item] of files.entries()) {
        const update = (fraction, status) => progress((index + fraction) / files.length, status);
        update(0, '正在处理 ' + (index + 1) + ' / ' + files.length + ' 张图片');
        let settings = { type: options.type, suffix: '-已转换' };
        if (tool.id === 'image-upscale') {
          settings = { ...settings, method: options.method, scale: Number(options.scale), suffix: '-已放大', progress: update };
        } else if (tool.id === 'image-crop') {
          settings = {
            ...settings, width: integer(options.width, 1, 8000, '宽度'),
            height: integer(options.height, 1, 8000, '高度'),
            crop: true, anchor: options.anchor, suffix: '-已裁剪',
          };
        } else if (tool.id === 'image-compress') {
          settings = { ...settings, maxKB: integer(options.maxKB, 1, 100000, '体积上限'), allowResize: options.allowResize, suffix: '-已压缩' };
        }
        try {
          outputs.push(await transformImage(item, settings));
        } catch (error) {
          throw new Error(item.name + ' · ' + error.message, { cause: error });
        }
      }
      return outputs;
    }
  }
}

export async function runWorkflow({ photo, materials, options, progress }) {
  const { combineMaterials, compressPdf } = await import('./pdf.js');
  const outputs = [];
  const maxPdf = megabytes(options.pdfMB);
  if (photo) {
    progress(0.02, '正在裁剪并压缩照片');
    outputs.push(await transformImage(photo, {
      width: integer(options.width, 1, 8000, '照片宽度'),
      height: integer(options.height, 1, 8000, '照片高度'),
      maxKB: integer(options.photoKB, 1, 100000, '照片上限'),
      type: options.format, crop: true, anchor: options.anchor,
      suffix: '-提交照片',
    }));
  }
  const merged = await combineMaterials(materials, fileKind, (fraction, message) => progress(0.09 + 0.51 * fraction, message));
  const compact = await compressPdf(merged, maxPdf, (fraction, message) => progress(0.6 + 0.4 * fraction, message));
  outputs.push(pdfCompressionResult(compact, '提交材料.pdf'));
  return outputs;
}

export function supportedFormat(allow) {
  return {
    word: 'DOCX', pdf: 'PDF', image: 'JPG、PNG、WebP、BMP、GIF、HEIC',
    material: 'PDF、DOCX 和常见图片', heic: 'HEIC、HEIF', privacy: 'PDF 和常见图片', any: '任意格式',
  }[allow];
}

export function resultMeta(result) {
  const size = result.before ? bytesLabel(result.before) + ' → ' + bytesLabel(result.blob.size) : bytesLabel(result.blob.size);
  const pixels = result.width ? (result.sourceSize && result.sourceSize !== result.width + ' × ' + result.height ? result.sourceSize + ' → ' : '') + result.width + ' × ' + result.height + ' px' : '';
  return [size, pixels].filter(Boolean).join(' · ');
}
