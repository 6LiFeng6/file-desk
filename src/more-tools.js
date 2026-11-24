import { transformImage } from './images.js';
import { cleanImage, renameFiles, stitchImages } from './photo-tools.js';

const select = (key, label, choices) => ({ type: 'select', key, label, choices });
const number = (key, label, value, min, max) => ({ type: 'number', key, label, value, min, max });
const check = (key, label, value = false) => ({ type: 'check', key, label, value });

export const extraTools = [
  { id: 'heic-to-jpg', title: 'HEIC 转 JPG', description: '批量转换 iPhone 的 HEIC / HEIF 照片。', category: 'convert', kind: 'heic', multiple: true, icon: 'photo', color: 'blue' },
  { id: 'pdf-visual', title: 'PDF 缩略图编辑', description: '拖动、删除、旋转或插入 PDF 页面。', category: 'pdf', kind: 'pdf', multiple: true, editor: 'pages', icon: 'split', color: 'violet', action: '导出已整理 PDF' },
  { id: 'scan-photos', title: '手机拍照转 PDF', description: '调整纸张四角，拉正、排序并压成 A4 PDF。', category: 'convert', kind: 'image', multiple: true, editor: 'scan', icon: 'crop', color: 'green', action: '生成扫描 PDF',
    fields: [
      select('cleanup', '扫描效果', [['color', '保留原色'], ['gray', '灰度增强']]),
      check('limitScan', '压缩到指定体积', true),
      { ...number('pdfMB', '体积上限（MB）', 2, 0.1, 100), step: 0.1 },
    ],
  },
  { id: 'pdf-layout', title: 'PDF 加页码与统一 A4', description: '统一纸张大小，并给页面连续编号。', category: 'pdf', kind: 'pdf', icon: 'text', color: 'coral',
    fields: [
      select('size', '纸张大小', [['auto', 'A4 · 跟随原方向'], ['portrait', 'A4 · 竖向'], ['landscape', 'A4 · 横向'], ['keep', '保留原纸张']]),
      check('numbers', '添加页码', true),
      number('first', '起始页码', 1, 1, 99999),
      select('numberPosition', '页码位置', [['center', '底部居中'], ['left', '底部左侧'], ['right', '底部右侧']]),
    ],
    note: '统一纸张会重排页面内容，原有链接和交互控件可能变化。',
  },
  { id: 'image-stitch', title: '图片拼接', description: '按顺序横向拼图，或把截图拼成长图。', category: 'image', kind: 'image', multiple: true, minimum: 2, reorder: true, icon: 'merge', color: 'violet',
    fields: [
      select('direction', '拼接方向', [['vertical', '上下拼接'], ['horizontal', '左右拼接']]),
      number('gap', '间距（px）', 0, 0, 300),
      { type: 'color', key: 'background', label: '背景颜色', value: '#ffffff' },
      select('type', '输出格式', [['image/png', 'PNG'], ['image/jpeg', 'JPG']]),
    ],
  },
  { id: 'file-privacy', title: '证件水印与隐私打码', description: '批量加水印，永久遮挡图片或 PDF 上的选区。', category: 'image', kind: 'privacy', multiple: true, editor: 'privacy', icon: 'crop', color: 'coral', action: '导出隐私副本',
    fields: [{ type: 'text', key: 'watermark', label: '水印文字（可选）', placeholder: '例如 仅用于办理入职', maxLength: 40 }],
    note: 'PDF 导出为图像页，原始文字层和附件不会写入副本。',
  },
  { id: 'image-metadata', title: '清除照片元数据', description: '批量移除位置、拍摄时间和设备记录。', category: 'image', kind: 'image', multiple: true, icon: 'photo', color: 'green', note: '重新编码保留可见图像，动态 GIF 导出为静态图。' },
  { id: 'file-rename', title: '批量重命名', description: '按前缀、日期和序号统一命名，再打包下载。', category: 'other', kind: 'any', multiple: true, reorder: true, editor: 'rename', icon: 'change', color: 'blue', action: '生成改名副本',
    fields: [
      { type: 'text', key: 'prefix', label: '文件名前缀', placeholder: '例如 报销凭证', value: '文件', maxLength: 96, required: true },
      { type: 'date', key: 'date', label: '日期前缀（可选）' },
      number('first', '起始序号', 1, 1, 99999),
      number('digits', '序号位数', 3, 1, 6),
    ],
  },
];

export async function runExtraTool(tool, files, options, progress) {
  const file = files[0];
  switch (tool.id) {
    case 'file-rename': {
      return renameFiles(files, options);
    }
    case 'pdf-layout': {
      const { layoutPdf } = await import('./pdf-edit.js');
      return [await layoutPdf(file, options, progress)];
    }
    case 'image-stitch': {
      return [await stitchImages(files, options, progress)];
    }
    case 'heic-to-jpg':
    case 'image-metadata': {
      const outputs = [];
      for (const [index, item] of files.entries()) {
        progress(index / files.length, '正在处理第 ' + (index + 1) + ' 张照片');
        try {
          outputs.push(tool.id === 'heic-to-jpg'
            ? await transformImage(item, { type: 'image/jpeg', maxSide: 6000, suffix: '' })
            : await cleanImage(item));
        } catch (error) {
          throw new Error(item.name + ' · ' + error.message, { cause: error });
        }
      }
      return outputs;
    }
    default:
      throw new Error('无法找到此工具。');
  }
}

