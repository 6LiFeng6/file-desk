import './style.css';
import { ACCEPT, MAX_BATCH_BYTES, MAX_FILE_BYTES, PRESETS, bytesLabel, fileKind, safeName } from './rules.js';
import { catalog, categories, megabytes, runTool, runWorkflow, supportedFormat, resultMeta, workflowFields } from './catalog.js';
import { mountEditor } from './editors.js';
import { previewImage } from './images.js';

const main = document.querySelector('#main');
const presetKey = 'file-desk.presets.v1';
const presetNames = { application: '报名材料', reimbursement: '报销材料', homework: '作业提交' };
let view;

const html = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]));
const icon = (name, color = '') => '<span class="tool-icon ' + color + '" aria-hidden="true"><i class="icon-' + name + '"></i></span>';
const fieldId = field => 'field-' + field.key;

function home() {
  main.innerHTML = 
    '<section class="hero" aria-labelledby="hero-title">' +
      '<div class="hero-copy"><h1 id="hero-title">文件转换与整理</h1>' +
      '<p>在浏览器里处理 Word、PDF 和图片。<br>转换格式、压缩文件，或一次准备好提交材料。</p>' +
      '<div class="hero-actions"><button class="button primary" type="button" data-scroll>浏览全部工具 <span aria-hidden="true">↓</span></button>' +
      '<a class="button secondary" href="#/submit">按要求提交 <span aria-hidden="true">↗</span></a></div></div>' +
      '<div class="hero-art" aria-hidden="true"><div class="art-orbit"></div><div class="art-orbit outer"></div>' +
      '<div class="art-doc art-word"><b>W</b><i></i><i></i><i></i><strong>DOCX</strong></div>' +
      '<div class="art-doc art-pdf"><b>PDF</b><i></i><i></i><i></i><strong>PDF</strong></div>' +
      '<div class="art-doc art-image"><div class="art-landscape"><i></i></div><strong>JPG</strong></div>' +
      '<div class="art-swap">↔</div><div class="art-spark">✦</div><div class="art-dot"></div></div>' +
    '</section>' +
    '<section class="tools-section" id="tool-list" aria-labelledby="tools-title">' +
      '<div class="section-heading"><div><h2 id="tools-title" tabindex="-1">全部工具</h2><p>选择一项开始处理文件。</p></div>' +
      '<label class="search"><span class="glass" aria-hidden="true"></span><span class="sr-only">搜索工具</span><input type="search" placeholder="搜索工具" autocomplete="off"></label></div>' +
      '<div class="pills" aria-label="工具分类">' +
      categories.map(([id, label]) => '<button type="button" data-category="' + id + '" aria-pressed="' + (id === 'all') + '">' + label + '</button>').join('') +
      '</div><div class="tools-grid"></div><p class="sr-only" aria-live="polite" data-count></p>' +
    '</section>' +
    '<a class="workflow-link" href="#/submit">' + icon('workflow', 'violet') +
      '<span><strong>按要求提交</strong><span>一次准备指定尺寸的照片和符合体积上限的 PDF。</span></span><span class="card-arrow" aria-hidden="true">↗</span></a>';

  const search = main.querySelector('input[type=search]');
  const chips = Array.from(main.querySelectorAll('[data-category]'));
  let category = 'all';
  const refresh = () => {
    const query = search.value.toLowerCase().trim();
    const shown = catalog.filter(tool => (category === 'all' || tool.category === category) &&
      [tool.title, tool.description, tool.note, ...(tool.fields ?? []).map(field => field.label)]
        .join(' ').toLowerCase().includes(query));
    main.querySelector('.tools-grid').innerHTML = shown.length ? shown.map(tool =>
      '<a class="tool-card" href="#/tool/' + tool.id + '">' + icon(tool.icon, tool.color) +
      '<span class="card-arrow" aria-hidden="true">↗</span><h3>' + tool.title + '</h3><p>' + tool.description + '</p></a>'
    ).join('') : '<p class="empty">没有符合条件的工具，试试其他关键词或分类。</p>';
    main.querySelector('[data-count]').textContent = '找到 ' + shown.length + ' 项工具';
  };
  search.addEventListener('input', refresh);
  for (const chip of chips) {
    chip.addEventListener('click', () => {
      category = chip.dataset.category;
      for (const button of chips) button.setAttribute('aria-pressed', String(button === chip));
      refresh();
    });
  }
  main.querySelector('[data-scroll]').addEventListener('click', () => {
    main.querySelector('#tools-title').focus({ preventScroll: true });
    main.querySelector('#tool-list').scrollIntoView({ behavior: 'smooth' });
  });
  refresh();
}

function fieldHtml(field) {
  const id = fieldId(field);
  const label = html(field.label);
  if (field.type === 'check') {
    return '<label class="checkbox field"><input id="' + id + '" name="' + field.key + '" type="checkbox"' +
      (field.value ? ' checked' : '') + '> <span>' + label + '</span></label>';
  }
  let control;
  if (field.type === 'select') {
    control = '<select name="' + field.key + '" id="' + id + '">' + field.choices.map(([value, name]) =>
      '<option value="' + html(value) + '">' + html(name) + '</option>').join('') + '</select>';
  } else {
    control = '<input name="' + field.key + '" id="' + id + '" type="' + field.type + '"' +
      (field.type === 'number' ? ' min="' + field.min + '" max="' + field.max + '" step="' + (field.step ?? 1) + '" required' : '') +
      (field.value !== undefined ? ' value="' + html(field.value) + '"' : '') +
      (field.placeholder ? ' placeholder="' + html(field.placeholder) + '"' : '') +
      (field.maxLength ? ' maxlength="' + field.maxLength + '"' : '') +
      (field.required ? ' required' : '') +
      (field.detail ? ' aria-describedby="' + id + '-hint"' : '') + '>';
  }
  return '<div class="field"><label for="' + id + '">' + label + '</label>' + control +
    (field.detail ? '<small id="' + id + '-hint">' + html(field.detail) + '</small>' : '') + '</div>';
}

function collectFields(form) {
  return Object.fromEntries(Array.from(form.querySelectorAll('[name]'), input =>
    [input.name, input.type === 'checkbox' ? input.checked : input.value]));
}

function heading(title, description, graphic) {
  return '<a class="back" href="#/"><span aria-hidden="true">←</span> 全部工具</a>' +
    '<section class="detail-heading">' + graphic + '<div><h1>' + title + '</h1><p>' + description + '</p></div></section>';
}

function actionMarkup(label, note) {
  return '<div class="action-row"><button class="button primary" type="submit">' + label + ' <span aria-hidden="true">→</span></button>' +
    (note ? '<p>' + html(note) + '</p>' : '') + '</div>';
}

function toolPage(tool) {
  const editorTitle = { pages: '页面顺序', scan: '校正与排序', privacy: '预览与遮挡', rename: '改名预览' }[tool.editor];
  main.innerHTML = heading(tool.title, tool.description, icon(tool.icon, tool.color)) +
    '<form class="editor"><fieldset class="editor-body"><legend class="sr-only">' + tool.title + '</legend>' +
    '<div class="panel"><h2>' + (tool.multiple ? '添加文件' : '选择文件') + '</h2><div data-zone></div></div>' +
    (tool.fields?.length ? '<div class="panel"><h2>输出设置</h2><div class="settings">' + tool.fields.map(fieldHtml).join('') + '</div></div>' : '') +
    (editorTitle ? '<section class="panel"><h2>' + editorTitle + '</h2><div data-custom-editor></div></section>' : '') +
    actionMarkup(tool.action ?? '开始处理', tool.note) + '</fieldset></form>' + processMarkup();
  const form = main.querySelector('form');
  let editor;
  const zone = makeZone(form.querySelector('[data-zone]'), {
    allow: tool.kind, multiple: tool.multiple, reorder: tool.reorder, capture: tool.editor === 'scan',
    changed: () => {
      clearResults();
      editor?.sync();
    },
  });
  if (editorTitle) {
    editor = mountEditor(tool.editor, form.querySelector('[data-custom-editor]'), {
      files: () => zone.files, options: () => collectFields(form), busy: () => form.querySelector('fieldset').disabled,
      changed: clearResults, megabytes,
    });
    view.dispose = editor.dispose;
  }
  if (tool.id === 'image-upscale') {
    const method = form.elements.method;
    const scale = form.elements.scale;
    method.addEventListener('change', () => {
      if (method.value === 'ai') scale.value = '2';
      scale.disabled = method.value === 'ai';
    });
  }
  if (tool.id === 'scan-photos') {
    form.elements.limitScan.addEventListener('change', () => {
      form.elements.pdfMB.disabled = !form.elements.limitScan.checked;
    });
  }
  if (tool.id === 'pdf-layout') {
    form.elements.numbers.addEventListener('change', () => {
      form.elements.first.disabled = !form.elements.numbers.checked;
      form.elements.numberPosition.disabled = !form.elements.numbers.checked;
    });
  }
  const updateSettings = event => {
    if (!event.target.name) return;
    clearResults();
    editor?.settingsChanged();
  };
  form.addEventListener('input', updateSettings);
  form.addEventListener('change', updateSettings);
  setupJob(form, async progress => {
    if (editor?.run) return editor.run(collectFields(form), progress);
    if (zone.files.length < (tool.minimum ?? 1)) {
      const label = tool.kind === 'image' ? ' 张图片。' : ' 个 PDF。';
      throw new Error(tool.minimum ? '请添加至少 ' + tool.minimum + label : '请先添加文件。');
    }
    return runTool(tool, zone.files, collectFields(form), progress);
  });
}

function processMarkup() {
  return '<div class="process" hidden aria-live="polite"><span data-status></span><progress max="1" value="0" aria-label="处理进度"></progress></div>' +
    '<p class="error global-error" role="alert" hidden></p><section class="results" aria-labelledby="result-title" hidden></section>';
}

function makeZone(host, { allow, multiple, reorder, capture, changed, button = '选择文件' }) {
  host.innerHTML =
    '<div class="drop-zone"><input type="file" hidden accept="' + ACCEPT[allow] + '"' + (multiple ? ' multiple' : '') + '>' +
    '<span class="upload-symbol" aria-hidden="true">↑</span><div class="upload-actions"><button class="button secondary" type="button" data-select>' + button + '</button>' +
    (capture ? '<input type="file" hidden accept="image/*" capture="environment"><button class="button secondary" type="button" data-camera>拍一张</button>' : '') + '</div>' +
    '<p>或拖放到这里 · ' + supportedFormat(allow) + ' · 单个文件最多 100 MB</p></div>' +
    '<p class="error zone-error" role="alert" hidden></p><ul class="file-list" aria-label="已添加文件"></ul>';
  const control = host.querySelector('input');
  const drop = host.querySelector('.drop-zone');
  const list = host.querySelector('.file-list');
  const error = host.querySelector('.zone-error');
  let current = [];
  let dragIndex = null;
  let dragDepth = 0;
  const busy = () => Boolean(host.closest('fieldset')?.disabled);

  function render() {
    list.innerHTML = current.map((file, index) => '<li data-index="' + index + '"' + (reorder ? ' draggable="true"' : '') + '>' +
      (reorder ? '<span class="drag-handle" aria-hidden="true">⋮⋮</span>' : '') +
      '<span class="file-info"><strong title="' + html(file.name) + '">' + html(file.name) + '</strong><small>' + bytesLabel(file.size) + '</small></span>' +
      (['pdf', 'image'].includes(fileKind(file.name)) ? rowButton(index, 'preview', '预览', '查看') : '') +
      (reorder ? rowButton(index, 'up', '上移', '↑', index === 0) + rowButton(index, 'down', '下移', '↓', index === current.length - 1) : '') +
      rowButton(index, 'remove', '移除', '×') + '</li>').join('');
  }

  function rowButton(index, action, title, value, disabled = false) {
    return '<button type="button" class="row-button" title="' + title + '" aria-label="' + title + ' ' + html(current[index].name) +
      '" data-operation="' + action + '"' + (disabled ? ' disabled' : '') + '>' + value + '</button>';
  }

  function add(incoming) {
    if (busy()) return;
    const warnings = [];
    const accepted = [];
    for (const file of incoming) {
      const kind = fileKind(file.name);
      const matches = allow === 'any' || (allow === 'material' && kind) || (allow === 'privacy' && ['pdf', 'image'].includes(kind)) ||
        (allow === 'heic' && /\.hei[cf]$/i.test(file.name)) || kind === allow;
      if (!matches) warnings.push(file.name + ' 格式不受支持。');
      else if (!file.size && allow !== 'any') warnings.push(file.name + ' 是空文件。');
      else if (file.size > MAX_FILE_BYTES) warnings.push(file.name + ' 超过 100 MB。');
      else accepted.push(file);
    }
    const next = multiple ? current.concat(accepted) : accepted.slice(0, 1);
    if (!multiple && accepted.length > 1) warnings.push('此处一次处理一个文件，已选择第一份。');
    if (next.length > 40 || next.reduce((sum, file) => sum + file.size, 0) > MAX_BATCH_BYTES) {
      warnings.push('单次最多添加 40 个文件，合计不超过 300 MB。');
    } else if (accepted.length) {
      current = next;
      render();
      changed();
    }
    error.hidden = !warnings.length;
    error.textContent = warnings.join(' ');
  }

  function move(from, to) {
    if (from === to || !current[from] || !current[to] || busy()) return;
    const [file] = current.splice(from, 1);
    current.splice(to, 0, file);
    render();
    changed();
  }

  host.querySelector('[data-select]').addEventListener('click', () => control.click());
  control.addEventListener('change', () => {
    add(Array.from(control.files));
    control.value = '';
  });
  if (capture) {
    const camera = host.querySelector('[capture]');
    host.querySelector('[data-camera]').addEventListener('click', () => camera.click());
    camera.addEventListener('change', () => {
      add(Array.from(camera.files));
      camera.value = '';
    });
  }
  drop.addEventListener('dragenter', event => {
    if (!event.dataTransfer.types.includes('Files') || busy()) return;
    event.preventDefault();
    dragDepth++;
    drop.classList.add('drag-over');
  });
  drop.addEventListener('dragover', event => {
    if (!busy() && event.dataTransfer.types.includes('Files')) event.preventDefault();
  });
  drop.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) drop.classList.remove('drag-over');
  });
  drop.addEventListener('drop', event => {
    event.preventDefault();
    dragDepth = 0;
    drop.classList.remove('drag-over');
    add(Array.from(event.dataTransfer.files));
  });

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-operation]');
    if (!button || busy()) return;
    const index = Number(button.closest('li').dataset.index);
    const action = button.dataset.operation;
    if (action === 'preview') {
      openPreview(current[index].name, current[index]);
      return;
    }
    if (action === 'remove') {
      current.splice(index, 1);
      error.hidden = true;
      render();
      changed();
      (list.querySelector('button') ?? host.querySelector('[data-select]')).focus();
      return;
    }
    const to = index + (action === 'up' ? -1 : 1);
    move(index, to);
    const row = list.children[to];
    (row?.querySelector('[data-operation="' + action + '"]:not(:disabled)') ?? row?.querySelector('button:not(:disabled)'))?.focus();
  });

  if (reorder) {
    list.addEventListener('dragstart', event => {
      const row = event.target.closest('[data-index]');
      if (!row || busy()) return;
      dragIndex = Number(row.dataset.index);
      event.dataTransfer.setData('text/plain', String(dragIndex));
      event.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
    });
    list.addEventListener('dragover', event => {
      if (dragIndex === null || busy()) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    });
    list.addEventListener('drop', event => {
      const row = event.target.closest('[data-index]');
      if (dragIndex === null || !row || busy()) return;
      event.preventDefault();
      move(dragIndex, Number(row.dataset.index));
      dragIndex = null;
    });
    list.addEventListener('dragend', () => {
      dragIndex = null;
      list.querySelector('.is-dragging')?.classList.remove('is-dragging');
    });
  }
  return { get files() { return current.slice(); } };
}

function localPresets() {
  try {
    const record = JSON.parse(localStorage.getItem(presetKey) ?? '{}');
    return record && typeof record === 'object' ? record : {};
  } catch {
    return {};
  }
}

function workflow() {
  const fields = workflowFields;
  main.innerHTML = heading('按要求提交', '填写提交要求，生成指定尺寸的照片和合并后的 PDF。', icon('workflow', 'violet')) +
    '<a class="workflow-link scan-link" href="#/tool/scan-photos">' + icon('crop', 'green') +
    '<span><strong>手机拍照交材料</strong><span>拉正纸张、调整顺序，生成符合体积上限的 A4 PDF。</span></span><span class="card-arrow" aria-hidden="true">↗</span></a>' +
    '<form class="editor"><fieldset class="editor-body"><legend class="sr-only">提交材料设置</legend>' +
    '<section class="panel"><div class="panel-heading"><h2>提交要求</h2><button class="text-button" type="button" data-save>保存为预设</button></div>' +
    '<div class="settings"><div class="field"><label for="presets">选择预设</label><select id="presets"></select></div>' +
    fieldHtml(fields.pdfLimit) + '</div>' +
    fieldHtml({ type: 'check', key: 'photo', label: '额外生成一张提交照片', value: true }) +
    '<div class="settings photo-fields" data-photo-fields>' +
    [fields.width, fields.height, fields.cropAnchor, fields.photoFormat, fields.photoLimit].map(fieldHtml).join('') + '</div></section>' +
    '<section class="panel" data-photo-panel><h2>提交照片</h2><div data-photo></div></section>' +
    '<section class="panel"><h2>PDF 材料</h2><p class="panel-hint">Word、PDF 和图片将按下方顺序合并。可拖动或用箭头调整。</p><div data-materials></div></section>' +
    actionMarkup('生成提交文件', '根据实际输出校验尺寸和体积。') + '</fieldset></form>' + processMarkup();

  const form = main.querySelector('form');
  const photo = makeZone(form.querySelector('[data-photo]'), { allow: 'image', changed: clearResults, button: '选择照片' });
  const materials = makeZone(form.querySelector('[data-materials]'), { allow: 'material', multiple: true, reorder: true, changed: clearResults, button: '添加材料' });
  const picker = form.querySelector('#presets');
  const custom = localPresets();
  const includePhoto = form.elements.photo;

  function refreshPicker(selected) {
    picker.innerHTML = Object.entries(presetNames).map(([id, label]) => '<option value="' + id + '">' + label + '</option>').join('') +
    Object.keys(custom).map(name => '<option value="custom:' + html(name) + '">' + html(name) + '（已保存）</option>').join('') +
    '<option value="manual">自定义要求</option>';
    picker.value = selected;
  }

  function showPhoto() {
    form.querySelector('[data-photo-fields]').hidden = !includePhoto.checked;
    form.querySelector('[data-photo-panel]').hidden = !includePhoto.checked;
    for (const control of form.querySelector('[data-photo-fields]').querySelectorAll('input, select')) {
      control.disabled = !includePhoto.checked;
    }
  }

  function setPreset(value) {
    if (!value) return;
    for (const [key, setting] of Object.entries(value)) {
      const input = form.elements.namedItem(key);
      if (!input) continue;
      if (input.type === 'checkbox') input.checked = Boolean(setting);
      else input.value = setting;
    }
    showPhoto();
  }

  refreshPicker('application');
  setPreset(PRESETS.application);
  picker.addEventListener('change', () => {
    setPreset(picker.value.startsWith('custom:') ? custom[picker.value.slice(7)] : PRESETS[picker.value]);
    clearResults();
  });
  form.addEventListener('change', event => {
    if (!event.target.name) return;
    picker.value = 'manual';
    showPhoto();
    clearResults();
  });
  form.querySelector('[data-save]').addEventListener('click', () => {
    if (!form.reportValidity()) return;
    openPresetDialog(name => {
      custom[name] = collectFields(form);
      try {
        localStorage.setItem(presetKey, JSON.stringify(custom));
      } catch {
        throw new Error('浏览器当前无法保存预设。');
      }
      refreshPicker('custom:' + name);
    }, Object.keys(custom));
  });

  setupJob(form, async progress => {
    if (includePhoto.checked && !photo.files.length) throw new Error('请添加提交照片，或取消勾选额外生成照片。');
    if (!materials.files.length) throw new Error('请添加至少一份 PDF 材料。');
    return runWorkflow({ photo: includePhoto.checked ? photo.files[0] : null, materials: materials.files, options: collectFields(form), progress });
  });
}

function openPresetDialog(save, existing) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal preset-modal';
  dialog.innerHTML = '<form><div class="modal-heading"><h2 id="preset-title">保存提交要求</h2>' +
    '<button class="close" type="button" aria-label="关闭">×</button></div>' +
    '<div class="field"><label for="preset-name">预设名称</label><input id="preset-name" required maxlength="30" placeholder="例如 校园报名"></div>' +
    '<p class="panel-hint">保存在当前浏览器。使用相同名称会更新设置。</p>' +
    '<p class="error" role="alert" hidden></p><button class="button primary" type="submit">保存预设</button></form>';
  dialog.setAttribute('aria-labelledby', 'preset-title');
  document.body.append(dialog);
  const form = dialog.querySelector('form');
  const input = dialog.querySelector('input');
  const error = dialog.querySelector('.error');
  const close = () => dialog.close();
  dialog.querySelector('.close').addEventListener('click', close);
  dialog.addEventListener('close', () => dialog.remove());
  form.addEventListener('submit', event => {
    event.preventDefault();
    const name = input.value.trim();
    try {
      if (!name || ['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('请输入有效的预设名称。');
      if (!existing.includes(name) && existing.length >= 20) throw new Error('最多保存 20 个预设，可以用已有名称更新。');
      save(name);
      close();
    } catch (issue) {
      error.textContent = issue.message;
      error.hidden = false;
    }
  });
  dialog.showModal();
}

function clearResults() {
  const result = main.querySelector('.results');
  const error = main.querySelector('.global-error');
  if (result) {
    result.hidden = true;
    result.replaceChildren();
  }
  if (error) error.hidden = true;
}

function setupJob(form, run) {
  const owner = view;
  const process = main.querySelector('.process');
  const status = process.querySelector('[data-status]');
  const indicator = process.querySelector('progress');
  const error = main.querySelector('.global-error');
  const fields = form.querySelector('fieldset');
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (fields.disabled) return;
    fields.disabled = true;
    clearResults();
    process.hidden = false;
    const progress = (fraction, message) => {
      if (owner !== view) return;
      indicator.value = Math.max(indicator.value, Math.min(1, fraction));
      if (message) status.textContent = message;
    };
    indicator.value = 0;
    status.textContent = '正在处理文件…';
    try {
      const outputs = await run(progress);
      if (owner === view) showResults(outputs);
    } catch (issue) {
      if (owner === view) {
        console.error(issue, issue.cause?.cause ?? issue.cause);
        error.textContent = issue.message || '处理失败，请检查文件后重试。';
        error.hidden = false;
      }
    } finally {
      process.hidden = true;
      fields.disabled = false;
    }
  });
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = safeName(name);
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}

function showResults(outputs) {
  const panel = main.querySelector('.results');
  const compliant = outputs.every(result => result.ok !== false);
  const hasTarget = outputs.some(result => result.cap);
  panel.hidden = false;
  panel.innerHTML = '<div class="results-heading"><div><h2 id="result-title" tabindex="-1">处理结果</h2><p>' +
    (hasTarget ? (compliant ? '所有文件均满足体积要求。' : '有文件超过体积上限。可放宽要求后重试。') : '已生成 ' + outputs.length + ' 个文件。') +
    '</p></div>' + (outputs.length > 1 ? '<button class="button secondary" type="button" data-zip>下载全部 ZIP</button>' : '') + '</div>' +
    '<div class="result-list">' +
    outputs.map((result, index) => '<div class="result-item">' +
      icon(result.blob.type.startsWith('image/') ? 'photo' : 'text', 'blue') +
      '<div class="result-name"><strong>' + html(result.name) + '</strong><span>' + html(resultMeta(result)) + '</span>' +
      (result.note ? '<small>' + html(result.note) + '</small>' : '') + '</div>' +
      (result.cap ? '<span class="status-chip ' + (result.ok ? 'pass' : 'fail') + '">' +
        (result.ok ? '已达标' : '超出上限') + ' · ' + bytesLabel(result.cap) + '</span>' : '') +
      '<div class="result-actions">' +
      ((result.previewable ?? (result.blob.type.startsWith('image/') || result.blob.type === 'application/pdf')) ? '<button type="button" class="button secondary" data-preview="' + index + '">预览</button>' : '') +
      '<button class="button primary" type="button" data-download="' + index + '">下载</button></div></div>' +
      (result.text ? '<label class="field ocr-result">识别结果<textarea readonly rows="7">' + html(result.text) +
        '</textarea><button class="button secondary" type="button" data-copy="' + index + '">复制文字</button></label>' : '')
    ).join('') + '</div><p class="error" role="alert" hidden></p>';

  for (const button of panel.querySelectorAll('[data-download]')) {
    const item = outputs[Number(button.dataset.download)];
    button.addEventListener('click', () => download(item.blob, item.name));
  }
  for (const button of panel.querySelectorAll('[data-preview]')) {
    const item = outputs[Number(button.dataset.preview)];
    button.addEventListener('click', () => openPreview(item.name, item.blob));
  }
  for (const button of panel.querySelectorAll('[data-copy]')) {
    const item = outputs[Number(button.dataset.copy)];
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(item.text);
        button.textContent = '已复制';
      } catch {
        button.parentElement.querySelector('textarea').select();
        button.textContent = '请按 Ctrl+C 或 ⌘C';
      }
    });
  }
  const zipButton = panel.querySelector('[data-zip]');
  zipButton?.addEventListener('click', async () => {
    zipButton.disabled = true;
    zipButton.textContent = '正在打包…';
    try {
      const { default: JSZip } = await import('jszip');
      const archive = new JSZip();
      const names = new Set();
      for (const item of outputs) {
        let name = safeName(item.name);
        while (names.has(name)) name = '副本-' + name;
        names.add(name);
        archive.file(name, await item.blob.arrayBuffer());
      }
      download(await archive.generateAsync({ type: 'blob' }), '文件工坊-处理结果.zip');
    } catch {
      const alert = panel.querySelector('.error');
      alert.textContent = '打包失败，可单独下载文件。';
      alert.hidden = false;
    } finally {
      zipButton.disabled = false;
      zipButton.textContent = '下载全部 ZIP';
    }
  });
  panel.querySelector('h2').focus({ preventScroll: true });
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function openPreview(name, blob) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal preview-modal';
  dialog.innerHTML = '<div class="modal-heading"><h2 id="preview-title">' + html(name) +
    '</h2><button class="close" type="button" aria-label="关闭预览">×</button></div>' +
    '<div class="preview-body" aria-busy="true"><p>正在加载预览…</p></div><div class="preview-nav" hidden></div>';
  dialog.setAttribute('aria-labelledby', 'preview-title');
  document.body.append(dialog);
  const body = dialog.querySelector('.preview-body');
  let url;
  let pdf;
  let closed = false;
  dialog.querySelector('.close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    closed = true;
    if (url) URL.revokeObjectURL(url);
    pdf?.destroy().catch(() => {});
    dialog.remove();
  });
  dialog.showModal();

  try {
    if (fileKind(name) !== 'pdf' && blob.type !== 'application/pdf') {
      if (/\.hei[cf]$/i.test(name)) {
        const rendered = await previewImage(blob);
        if (closed) return;
        rendered.setAttribute('aria-label', name);
        body.replaceChildren(rendered);
        body.setAttribute('aria-busy', 'false');
        return;
      }
      url = URL.createObjectURL(blob);
      const image = new Image();
      image.alt = name;
      image.src = url;
      await image.decode();
      body.replaceChildren(image);
      body.setAttribute('aria-busy', 'false');
      return;
    }
    const { readPdf, renderPage } = await import('./pdf.js');
    pdf = await readPdf(blob);
    if (closed) {
      await pdf.destroy();
      return;
    }
    const nav = dialog.querySelector('.preview-nav');
    nav.innerHTML = '<button class="button secondary" type="button" data-prev>上一页</button><span aria-live="polite"></span><button class="button secondary" type="button" data-next>下一页</button>';
    nav.hidden = pdf.numPages < 2;
    const prev = nav.querySelector('[data-prev]');
    const next = nav.querySelector('[data-next]');
    let pageIndex = 1;

    async function render(index) {
      prev.disabled = true;
      next.disabled = true;
      body.setAttribute('aria-busy', 'true');
      try {
        const { rendered } = await renderPage(await pdf.getPage(index), 1.5, 1500);
        if (closed) return;
        rendered.setAttribute('aria-label', 'PDF 第 ' + index + ' 页');
        body.replaceChildren(rendered);
        body.scrollTop = 0;
        pageIndex = index;
        nav.querySelector('span').textContent = index + ' / ' + pdf.numPages;
      } catch {
        if (!closed) body.textContent = '无法预览本页。';
      } finally {
        prev.disabled = pageIndex <= 1;
        next.disabled = pageIndex >= pdf.numPages;
        body.setAttribute('aria-busy', 'false');
      }
    }
    prev.addEventListener('click', () => render(pageIndex - 1));
    next.addEventListener('click', () => render(pageIndex + 1));
    await render(1);
  } catch {
    body.textContent = '无法预览这个文件。';
    body.setAttribute('aria-busy', 'false');
  }
}

function route() {
  const path = location.hash.slice(1) || '/';
  const tool = catalog.find(item => path === '/tool/' + item.id);
  view?.dispose?.();
  view = {};
  for (const link of document.querySelectorAll('[data-nav]')) {
    const active = link.dataset.nav === (path === '/submit' ? 'submit' : 'tools');
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  if (path === '/submit') workflow();
  else if (tool) toolPage(tool);
  else home();
  document.title = (path === '/submit' ? '按要求提交 · ' : tool ? tool.title + ' · ' : '') + '文件工坊';
}

window.addEventListener('hashchange', () => {
  if (location.hash === '#main') return;
  route();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});
document.addEventListener('dragover', event => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
document.addEventListener('drop', event => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
route();
