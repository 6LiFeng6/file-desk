export const KB = 1024;
export const MB = 1024 * KB;
export const MAX_FILE_BYTES = 100 * MB;
export const MAX_BATCH_BYTES = 300 * MB;
export const MAX_PIXELS = 24_000_000;

export const ACCEPT = {
  pdf: '.pdf,application/pdf',
  word: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  image: '.jpg,.jpeg,.png,.webp,.bmp,.gif,.heic,.heif,image/jpeg,image/png,image/webp,image/bmp,image/gif,image/heic,image/heif',
  heic: '.heic,.heif,image/heic,image/heif',
  any: '',
};
ACCEPT.material = [ACCEPT.pdf, ACCEPT.word, ACCEPT.image].join(',');
ACCEPT.privacy = [ACCEPT.pdf, ACCEPT.image].join(',');

export function fileKind(name) {
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'pdf') return 'pdf';
  if (extension === 'docx') return 'word';
  if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'gif', 'heic', 'heif'].includes(extension)) return 'image';
  return '';
}

export function basename(name) {
  return name.replace(/\.[^.]+$/, '') || '文件';
}

export function bytesLabel(bytes) {
  if (bytes < KB) return `${bytes} B`;
  const unit = bytes < MB ? KB : MB;
  const amount = bytes / unit;
  return `${amount.toFixed(amount < 10 ? 2 : 1).replace(/\.?0+$/, '')} ${unit === KB ? 'KB' : 'MB'}`;
}

export function integer(value, min, max, label) {
  const number = Number(value);
  if (!String(value).trim() || !Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${label}请输入 ${min} 至 ${max} 之间的整数。`);
  }
  return number;
}

export function parsePages(input, pageCount) {
  const cleaned = input.trim().replace(/[，、]/g, ',').replace(/[－–—]/g, '-');
  if (!cleaned) return Array.from({ length: pageCount }, (_, index) => index);
  const pages = [];
  for (const part of cleaned.split(',')) {
    const match = part.trim().match(/^(\d+)\s*(?:-\s*(\d+))?$/);
    if (!match) throw new Error('请输入页码或页码范围，例如 3, 1-2。');
    const first = integer(match[1], 1, pageCount, '起始页码');
    const last = match[2] ? integer(match[2], 1, pageCount, '结束页码') : first;
    if (first > last) throw new Error('范围中的起始页码必须小于或等于结束页码。');
    if (pages.length + last - first + 1 > 1000) throw new Error('单次最多输出 1000 页。');
    for (let page = first; page <= last; page++) pages.push(page - 1);
  }
  return pages;
}

export function safeName(name) {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 160);
}

export const PRESETS = {
  application: { photo: true, width: 300, height: 400, photoKB: 100, pdfMB: 2, format: 'image/jpeg' },
  reimbursement: { photo: false, width: 300, height: 400, photoKB: 100, pdfMB: 5, format: 'image/jpeg' },
  homework: { photo: false, width: 300, height: 400, photoKB: 100, pdfMB: 10, format: 'image/jpeg' },
};
