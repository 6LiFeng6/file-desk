import { fileKind } from './rules.js';
import { defaultCorners, validCorners } from './scan-geometry.js';
import { canvas, previewImage, disposeCanvas } from './images.js';
import { drawMask, drawWatermark, protectImage, renameFiles } from './photo-tools.js';

const pointNames = ['左上角', '右上角', '右下角', '左下角'];
const clamp = value => Math.max(0, Math.min(1, value));

async function imagePreview(file) {
  const output = await previewImage(file);
  try {
    return { thumb: output.toDataURL('image/jpeg', 0.85), aspect: output.width / output.height };
  } finally {
    disposeCanvas(output);
  }
}

async function loadPages(file, kind, maximum, cancelled) {
  if (fileKind(file.name) !== 'pdf') {
    if (kind === 'scan') {
      const { scanPreview } = await import('./scan.js');
      return [{ index: 0, ...await scanPreview(file) }];
    }
    return [{ index: 0, ...await imagePreview(file), boxes: [] }];
  }
  const { readPdf, renderPage } = await import('./pdf.js');
  const source = await readPdf(file);
  try {
    if (source.numPages > maximum) {
      throw new Error('此工具最多同时编辑 120 页。请先拆分文档，或移除部分已添加的文件。');
    }
    const items = [];
    for (let index = 0; index < source.numPages && !cancelled(); index++) {
      const isPreview = kind === 'privacy';
      const { rendered } = await renderPage(await source.getPage(index + 1), isPreview ? 1.35 : 0.35, isPreview ? 1000 : 250);
      try {
        items.push({
          index, thumb: rendered.toDataURL('image/jpeg', isPreview ? 0.85 : 0.75),
          aspect: rendered.width / rendered.height, boxes: [], rotation: 0,
        });
      } finally {
        disposeCanvas(rendered);
      }
    }
    return items;
  } finally {
    await source.destroy();
  }
}

export function mountEditor(kind, host, context) {
  if (kind === 'rename') {
    const render = () => {
      if (!host.isConnected) return;
      host.replaceChildren();
      const files = context.files();
      if (!files.length) {
        host.textContent = '添加文件后可查看改名结果。';
        return;
      }
      try {
        const list = document.createElement('ol');
        list.className = 'rename-list';
        for (const output of renameFiles(files, context.options())) {
          const item = document.createElement('li');
          const oldName = document.createElement('span');
          oldName.textContent = output.note;
          const newName = document.createElement('strong');
          newName.textContent = output.name;
          item.append(oldName, document.createTextNode(' → '), newName);
          list.append(item);
        }
        host.append(list);
      } catch (error) {
        host.textContent = error.message;
      }
    };
    render();
    return { sync: render, settingsChanged: render };
  }

  let entries = [];
  let loaded = new Set();
  let selected;
  let version = 0;
  let nextId = 0;
  let pending = false;
  let failures = [];
  let pointerPaint;
  let dragId;

  const commands = kind === 'privacy' ? [] : [['up', '左移', '←'], ['down', '右移', '→']];
  if (kind === 'pages') commands.push(['rotate', '旋转', '↻']);
  if (kind !== 'privacy') commands.push(['remove', '删除', '×']);

  function focusItem(id, operation) {
    const row = host.querySelector('[data-entry="' + id + '"]');
    const target = row?.querySelector('[data-control="' + operation + '"]:not(:disabled)');
    (target ?? row?.querySelector('[data-pick]'))?.focus({ preventScroll: true });
  }

  function render() {
    if (!host.isConnected) return;
    selected = entries.find(item => item.id === selected)?.id ?? entries[0]?.id;
    pointerPaint = undefined;
    host.replaceChildren();
    if (pending) {
      const status = document.createElement('p');
      status.className = 'editor-message';
      status.setAttribute('role', 'status');
      status.textContent = '正在生成文件预览…';
      host.append(status);
      return;
    }
    if (failures.length) {
      const error = document.createElement('p');
      error.className = 'error';
      error.setAttribute('role', 'alert');
      error.textContent = failures.join(' ');
      host.append(error);
    }
    if (kind === 'pages') {
      const tools = document.createElement('div');
      tools.className = 'editor-tools';
      const insert = document.createElement('button');
      insert.type = 'button';
      insert.className = 'button secondary';
      insert.textContent = selected ? '在选中页后插入空白页' : '插入空白页';
      insert.disabled = entries.length >= 120;
      insert.addEventListener('click', () => {
        const item = { id: ++nextId, rotation: 0 };
        entries.splice(entries.findIndex(entry => entry.id === selected) + 1, 0, item);
        selected = item.id;
        context.changed();
        render();
        focusItem(item.id);
      });
      tools.append(insert);
      host.append(tools);
    }
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'editor-message';
      empty.textContent = kind === 'pages' ? '添加 PDF 会将页面插入到列表，可拖动缩略图排序。' : '添加文件后可在这里查看和编辑。';
      host.append(empty);
      return;
    }
    const list = document.createElement('ul');
    list.className = 'thumb-grid';
    list.setAttribute('aria-label', '页面列表');
    for (const [position, item] of entries.entries()) {
      const row = document.createElement('li');
      row.className = 'thumb-card';
      row.dataset.entry = item.id;
      row.draggable = kind !== 'privacy';
      const pick = document.createElement('button');
      pick.className = 'thumb-pick';
      pick.type = 'button';
      pick.dataset.pick = '';
      pick.setAttribute('aria-pressed', String(item.id === selected));
      pick.setAttribute('aria-label', '选择第 ' + (position + 1) + ' 页');
      const graphic = document.createElement('span');
      graphic.className = 'thumb-image';
      if (item.thumb) {
        const image = new Image();
        image.alt = '';
        image.src = item.thumb;
        image.draggable = false;
        image.style.transform = 'rotate(' + (item.rotation ?? 0) + 'deg)';
        graphic.append(image);
      } else {
        graphic.classList.add('blank-thumb');
        graphic.textContent = '空白页';
      }
      const label = document.createElement('span');
      label.className = 'thumb-label';
      label.textContent = position + 1 + ' · ' + (item.file?.name ?? '空白页');
      label.title = item.file ? item.file.name + (fileKind(item.file.name) === 'pdf' ? ' 第 ' + (item.index + 1) + ' 页' : '') : '空白页';
      pick.append(graphic, label);
      pick.addEventListener('click', () => {
        selected = item.id;
        render();
        focusItem(item.id);
      });
      row.append(pick);
      if (commands.length) {
        const actions = document.createElement('div');
        actions.className = 'thumb-actions';
        for (const [operation, title, value] of commands) {
          const button = document.createElement('button');
          button.className = 'row-button';
          button.type = 'button';
          button.dataset.control = operation;
          button.title = title + '第 ' + (position + 1) + ' 页';
          button.setAttribute('aria-label', button.title);
          button.textContent = value;
          button.disabled = (operation === 'up' && position === 0) || (operation === 'down' && position === entries.length - 1);
          button.addEventListener('click', () => alter(operation, item.id));
          actions.append(button);
        }
        row.append(actions);
      }
      list.append(row);
    }
    if (kind !== 'privacy') {
      list.addEventListener('dragstart', event => {
        const row = event.target.closest('[data-entry]');
        if (!row || context.busy()) return;
        dragId = Number(row.dataset.entry);
        event.dataTransfer.setData('text/plain', String(dragId));
        event.dataTransfer.effectAllowed = 'move';
      });
      list.addEventListener('dragover', event => {
        if (dragId && !context.busy()) {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
        }
      });
      list.addEventListener('drop', event => {
        const row = event.target.closest('[data-entry]');
        if (dragId && row && !context.busy()) {
          event.preventDefault();
          move(dragId, entries.findIndex(entry => entry.id === Number(row.dataset.entry)));
        }
        dragId = undefined;
      });
      list.addEventListener('dragend', () => { dragId = undefined; });
    }
    host.append(list);
    const active = entries.find(item => item.id === selected);
    if (kind === 'scan' || kind === 'privacy') {
      pointerPaint = showStage(host, active, kind, context);
    }
  }

  function move(id, destination, operation) {
    const position = entries.findIndex(entry => entry.id === id);
    if (position < 0 || destination < 0 || destination >= entries.length || position === destination) return;
    const [item] = entries.splice(position, 1);
    entries.splice(destination, 0, item);
    selected = id;
    context.changed();
    render();
    focusItem(id, operation);
  }

  function alter(operation, id) {
    const index = entries.findIndex(item => item.id === id);
    if (index < 0) return;
    if (operation === 'up' || operation === 'down') {
      move(id, index + (operation === 'up' ? -1 : 1), operation);
      return;
    }
    if (operation === 'remove') {
      entries.splice(index, 1);
      if (selected === id) selected = entries[Math.min(index, entries.length - 1)]?.id;
    } else {
      entries[index].rotation = ((entries[index].rotation ?? 0) + 90) % 360;
      selected = id;
    }
    context.changed();
    render();
    focusItem(selected, operation === 'remove' ? undefined : operation);
  }

  async function sync() {
    const revision = ++version;
    const files = context.files();
    const chosen = new Set(files);
    const next = entries.filter(item => !item.file || chosen.has(item.file));
    const seen = new Set([...loaded].filter(file => chosen.has(file)));
    const errors = [];
    pending = true;
    render();

    for (const file of files) {
      if (seen.has(file)) continue;
      const maximum = 120 - next.length;
      try {
        if (maximum < 1) throw new Error('此工具最多同时编辑 120 页。');
        const items = await loadPages(file, kind, maximum, () => revision !== version);
        if (revision !== version) return;
        next.push(...items.map(item => ({ ...item, file, id: ++nextId })));
        seen.add(file);
      } catch (error) {
        if (revision !== version) return;
        errors.push(file.name + ' · ' + error.message);
      }
    }
    if (revision !== version) return;
    pending = false;
    entries = next;
    loaded = seen;
    failures = errors;
    render();
  }

  async function run(options, progress) {
    if (pending) throw new Error('请等待预览生成完成。');
    if (failures.length) throw new Error('请移除读取失败的文件后重试。');
    if (!entries.length) throw new Error(kind === 'pages' ? '请添加 PDF 或插入空白页。' : '请先添加文件。');
    if (kind === 'pages') {
      const { exportPageOrder } = await import('./pdf-edit.js');
      return [await exportPageOrder(entries, progress)];
    }
    if (kind === 'scan') {
      if (entries.some(item => !validCorners(item.points))) throw new Error('有页面的角点交叉，请调整四角后重试。');
      const { scanToPdf } = await import('./scan.js');
      return [await scanToPdf(entries, options, options.limitScan ? context.megabytes(options.pdfMB) : 0, progress)];
    }
    const watermark = options.watermark.trim();
    const selectedFiles = context.files().filter(file => watermark || entries.some(item => item.file === file && item.boxes.length));
    if (!selectedFiles.length) throw new Error('请输入水印，或在页面上圈出要遮挡的区域。');
    const { protectPdf } = await import('./pdf-edit.js');
    const outputs = [];
    for (const [index, file] of selectedFiles.entries()) {
      progress(index / selectedFiles.length, '正在处理 ' + file.name);
      const boxes = new Map(entries.filter(item => item.file === file).map(item => [item.index + 1, item.boxes]));
      if (fileKind(file.name) === 'pdf') {
        outputs.push(await protectPdf(file, boxes, watermark, (fraction, message) => progress((index + fraction) / selectedFiles.length, message)));
      } else {
        outputs.push(await protectImage(file, boxes.get(1) ?? [], watermark));
      }
    }
    return outputs;
  }

  render();
  return {
    run, sync,
    settingsChanged: () => pointerPaint?.(),
    dispose: () => { version++; entries = []; loaded.clear(); },
  };
}

function visualCoords(element, event) {
  const rect = element.getBoundingClientRect();
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) };
}

function draggedBox(start, end) {
  return { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) };
}

function showStage(host, item, kind, context) {
  const area = document.createElement('div');
  area.className = 'stage-area';
  const instruction = document.createElement('p');
  instruction.className = 'editor-message';
  instruction.textContent = kind === 'scan'
    ? (item.detected ? '已找到纸张边缘。拖动四角微调，也可用方向键。' : '请拖动四角贴齐纸张边缘。角点也支持方向键。')
    : '在预览上拖动鼠标或手指，框选要永久遮挡的位置。';
  const stage = document.createElement('div');
  stage.className = 'photo-stage' + (kind === 'privacy' ? ' mask-stage' : '');
  stage.style.aspectRatio = String(item.aspect);
  stage.style.maxWidth = Math.round(Math.min(680, 530 * item.aspect)) + 'px';
  const image = new Image();
  image.src = item.thumb;
  image.alt = item.file.name + ' · 第 ' + (item.index + 1) + ' 页预览';
  image.draggable = false;
  const width = Math.max(1, Math.round(Math.min(850, 850 * item.aspect)));
  const height = Math.max(1, Math.round(width / item.aspect));
  const overlay = canvas(width, height);
  overlay.setAttribute('aria-hidden', 'true');
  const ctx = overlay.getContext('2d');
  stage.append(image, overlay);
  area.append(instruction, stage);
  host.append(area);

  if (kind === 'scan') {
    const points = pointNames.map((name, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'corner-point';
      button.setAttribute('aria-label', name);
      button.title = name;
      button.textContent = String(index + 1);
      stage.append(button);
      button.addEventListener('pointerdown', event => {
        if (context.busy() || event.button !== 0) return;
        button.setPointerCapture(event.pointerId);
      });
      button.addEventListener('pointermove', event => {
        if (context.busy() || !button.hasPointerCapture(event.pointerId)) return;
        set(index, visualCoords(stage, event));
      });
      button.addEventListener('keydown', event => {
        if (context.busy()) return;
        const step = event.shiftKey ? 0.025 : 0.005;
        const change = { ArrowUp: [0, -step], ArrowRight: [step, 0], ArrowDown: [0, step], ArrowLeft: [-step, 0] }[event.key];
        if (!change) return;
        event.preventDefault();
        set(index, { x: clamp(item.points[index].x + change[0]), y: clamp(item.points[index].y + change[1]) });
      });
      return button;
    });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'text-button';
    reset.textContent = '重置四角';
    reset.addEventListener('click', () => {
      item.points = defaultCorners();
      item.detected = false;
      instruction.textContent = '请拖动四角贴齐纸张边缘。角点也支持方向键。';
      context.changed();
      paint();
    });
    area.append(reset);

    function paint() {
      ctx.clearRect(0, 0, width, height);
      ctx.beginPath();
      for (const [index, point] of item.points.entries()) {
        const x = point.x * width;
        const y = point.y * height;
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        points[index].style.left = point.x * 100 + '%';
        points[index].style.top = point.y * 100 + '%';
        points[index].setAttribute('aria-label', pointNames[index] + '，横向 ' + Math.round(point.x * 100) + '%，纵向 ' + Math.round(point.y * 100) + '%');
      }
      ctx.closePath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = validCorners(item.points) ? '#7766ff' : '#c9364c';
      ctx.fillStyle = 'rgba(115,100,255,0.16)';
      ctx.fill();
      ctx.stroke();
    }

    function set(index, point) {
      item.points[index] = point;
      context.changed();
      paint();
    }
    paint();
    return paint;
  }

  const tools = document.createElement('div');
  tools.className = 'editor-tools';
  const status = document.createElement('span');
  status.className = 'editor-message';
  status.setAttribute('aria-live', 'polite');
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'text-button';
  undo.textContent = '撤销本页最后一个遮挡';
  undo.addEventListener('click', () => {
    item.boxes.pop();
    context.changed();
    paint();
  });
  tools.append(status, undo);
  area.append(tools);
  const editor = document.createElement('details');
  editor.className = 'mask-keyboard';
  const summary = document.createElement('summary');
  summary.textContent = '按百分比添加遮挡';
  const numbers = document.createElement('div');
  numbers.className = 'settings';
  const inputs = ['左边距', '上边距', '宽度', '高度'].map((name, index) => {
    const label = document.createElement('label');
    label.className = 'field';
    label.textContent = name + '（%）';
    const input = document.createElement('input');
    input.type = 'number';
    input.min = index < 2 ? '0' : '1';
    input.max = '100';
    input.step = '1';
    input.value = '25';
    label.append(input);
    numbers.append(label);
    return input;
  });
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'button secondary';
  add.textContent = '添加遮挡';
  const warning = document.createElement('p');
  warning.className = 'error';
  warning.setAttribute('role', 'alert');
  warning.hidden = true;
  add.addEventListener('click', () => {
    const [x, y, width, height] = inputs.map(input => Number(input.value) / 100);
    if (inputs.some(input => !input.value || !input.validity.valid) || x + width > 1.00001 || y + height > 1.00001) {
      warning.textContent = '请输入有效百分比，遮挡区域需在页面范围内。';
      warning.hidden = false;
      return;
    }
    warning.hidden = true;
    commit({ x, y, width, height });
  });
  editor.append(summary, numbers, add, warning);
  area.append(editor);

  let start;
  let draft;
  stage.addEventListener('pointerdown', event => {
    if (context.busy() || event.button !== 0) return;
    start = visualCoords(stage, event);
    stage.setPointerCapture(event.pointerId);
  });
  stage.addEventListener('pointermove', event => {
    if (!start || !stage.hasPointerCapture(event.pointerId)) return;
    draft = draggedBox(start, visualCoords(stage, event));
    paint();
  });
  stage.addEventListener('pointerup', event => {
    if (!start) return;
    const box = draggedBox(start, visualCoords(stage, event));
    start = undefined;
    draft = undefined;
    if (box.width >= 0.004 && box.height >= 0.004) commit(box);
    else paint();
  });
  stage.addEventListener('pointercancel', () => {
    start = undefined;
    draft = undefined;
    paint();
  });

  function commit(box) {
    item.boxes.push(box);
    context.changed();
    paint();
  }

  function paint() {
    ctx.clearRect(0, 0, width, height);
    drawWatermark(ctx, context.options().watermark.trim(), width, height);
    drawMask(ctx, item.boxes, width, height);
    if (draft) {
      ctx.fillStyle = 'rgba(67,54,112,.5)';
      ctx.fillRect(draft.x * width, draft.y * height, draft.width * width, draft.height * height);
    }
    undo.disabled = item.boxes.length === 0;
    status.textContent = '本页 ' + item.boxes.length + ' 处遮挡';
  }
  paint();
  return paint;
}
