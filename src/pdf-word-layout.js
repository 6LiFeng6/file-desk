import { canvas, disposeCanvas, toBlob } from './images.js';
import { renderPage } from './pdf.js';

const knownFonts = [
  [/yahei/i, 'Microsoft YaHei'], [/dengxian/i, 'DengXian'], [/simsun|stsong|songti/i, 'SimSun'],
  [/simhei|sthei|heiti/i, 'SimHei'], [/fangsong/i, 'FangSong'], [/kaiti|stkai/i, 'KaiTi'],
  [/times|liberationserif/i, 'Times New Roman'], [/courier|liberationmono/i, 'Courier New'],
  [/calibri/i, 'Calibri'], [/cambria/i, 'Cambria'], [/aptos/i, 'Aptos'], [/tahoma/i, 'Tahoma'],
  [/georgia/i, 'Georgia'], [/verdana/i, 'Verdana'], [/helvetica|arial|liberationsans/i, 'Arial'],
];
const han = /[\u2e80-\u9fff\uf900-\ufaff]/u;
const cleanText = value => value.replace(/[\u0000-\u0008\u000b-\u001f\ufffe\uffff]/g, '');

function fontFor(page, item, style) {
  const resolved = page.commonObjs.has(item.fontName) ? page.commonObjs.get(item.fontName) : {};
  const original = resolved.name ?? '';
  const family = knownFonts.find(([test]) => test.test(original))?.[1]
    ?? (han.test(item.str) ? 'Microsoft YaHei' : style.fontFamily === 'serif' ? 'Times New Roman' : 'Arial');
  return {
    family, bold: Boolean(resolved.bold || /bold|demi|semibold|black/i.test(original)),
    italic: Boolean(resolved.italic || /italic|oblique/i.test(original)), ascent: style.ascent > 0.5 ? style.ascent : 0.9,
  };
}

function colorHex(value) {
  if (typeof value !== 'string') return '000000';
  if (/^#[\da-f]{6}$/i.test(value)) return value.slice(1).toUpperCase();
  if (/^#[\da-f]{3}$/i.test(value)) return [...value.slice(1)].map(channel => channel.repeat(2)).join('').toUpperCase();
  const channels = value.match(/^rgba?\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)/i);
  return channels ? channels.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, '0')).join('').toUpperCase() : '000000';
}

function textPaintFilter(context, scale) {
  const glyphs = [];
  const proxy = new Proxy(context, {
    get(target, key) {
      const method = Reflect.get(target, key, target);
      if (key === 'fillText' || key === 'strokeText') {
        return (text, x, y, ...extra) => {
          const t = target.getTransform();
          if (t.a <= 0 || Math.abs(t.b) > Math.abs(t.a) * 0.035) {
            return method.call(target, text, x, y, ...extra);
          }
          glyphs.push({
            x: (t.a * x + t.c * y + t.e) / scale,
            baseline: (t.b * x + t.d * y + t.f) / scale,
            color: colorHex(key === 'fillText' ? target.fillStyle : target.strokeStyle),
          });
        };
      }
      return typeof method === 'function' ? method.bind(target) : method;
    },
    set(target, key, value) {
      return Reflect.set(target, key, value, target);
    },
  });
  return { proxy, glyphs };
}

function colorFor(run, glyphs) {
  const limit = Math.max(1.2, run.size * 0.15);
  const colors = new Map();
  for (const glyph of glyphs) {
    if (glyph.x < run.x - 1.5 || glyph.x > run.x + run.width + 1.5 || Math.abs(glyph.baseline - run.baseline) > limit) continue;
    colors.set(glyph.color, (colors.get(glyph.color) ?? 0) + 1);
  }
  return [...colors].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '000000';
}

function positionRuns(page, content, viewport, glyphs) {
  const [a, b, c, d, e, f] = viewport.transform;
  return content.items.flatMap(item => {
    if (!item.str?.trim() || !item.transform) return [];
    const [ta, tb, tc, td, x, y] = item.transform;
    const horizontal = a * ta + c * tb;
    const rise = b * ta + d * tb;
    if (horizontal <= 0 || Math.abs(rise) > horizontal * 0.035 || content.styles[item.fontName]?.vertical) return [];
    const run = {
      ...fontFor(page, item, content.styles[item.fontName] ?? {}),
      text: cleanText(item.str),
      x: a * x + c * y + e, baseline: b * x + d * y + f,
      size: Math.max(1, Math.min(180, Math.hypot(a * tc + c * td, b * tc + d * td))),
      width: Math.max(0.2, item.width * viewport.scale),
    };
    return [{ ...run, color: colorFor(run, glyphs) }];
  });
}

function linesFor(runs) {
  const bands = [];
  for (const run of runs.sort((a, b) => a.baseline - b.baseline || a.x - b.x)) {
    const band = bands.at(-1);
    if (band && Math.abs(run.baseline - band.baseline) < Math.max(0.7, Math.min(run.size, band.size) * 0.19)) {
      band.runs.push(run);
    } else {
      bands.push({ baseline: run.baseline, size: run.size, runs: [run] });
    }
  }

  return bands.flatMap(band => {
    const lines = [];
    for (const run of band.runs.sort((a, b) => a.x - b.x)) {
      const current = lines.at(-1);
      const gap = current ? run.x - current.right : 0;
      if (current && gap <= Math.max(2, run.size * 0.48) && gap >= -run.size * 0.3 && Math.abs(current.size - run.size) < 2.5) {
        const previous = current.runs.at(-1);
        const latinGap = /[A-Za-z0-9]$/.test(previous.text) && /^[A-Za-z0-9]/.test(run.text);
        if (gap > run.size * (latinGap ? 0.13 : 0.22) && !/\s$/.test(previous.text) && !/^\s/.test(run.text)) {
          current.runs[current.runs.length - 1] = { ...previous, text: previous.text + ' ', width: previous.width + gap };
        }
        current.right = Math.max(current.right, run.x + run.width);
        current.size = Math.max(current.size, run.size);
        current.ascent = Math.max(current.ascent, run.ascent);
        current.runs.push(run);
      } else {
        lines.push({ x: run.x, right: run.x + run.width, baseline: run.baseline, size: run.size, ascent: run.ascent, runs: [run] });
      }
    }
    return lines;
  });
}

async function backgroundImage(rendered) {
  const pixels = rendered.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, rendered.width, rendered.height).data;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 249 || pixels[index + 1] < 249 || pixels[index + 2] < 249) return toBlob(rendered, 'image/png');
  }
}

export async function visualWordPage(page) {
  const { rendered, width, height } = await renderPage(page, 2.25, 3300);
  try {
    return { width, height, picture: await toBlob(rendered, 'image/png'), lines: [] };
  } finally {
    disposeCanvas(rendered);
  }
}

export async function editableWordPage(page, content) {
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(1.9, 2700 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale });
  const rendered = canvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  try {
    const filter = textPaintFilter(rendered.getContext('2d', { willReadFrequently: true }), scale);
    await page.render({ canvasContext: filter.proxy, viewport, background: '#fff' }).promise;
    const runs = positionRuns(page, content, base, filter.glyphs);
    const expected = runs.reduce((sum, run) => sum + [...run.text.trim()].length, 0);
    if (!runs.length || filter.glyphs.length < expected * 0.35) return null;
    return { width: base.width, height: base.height, picture: await backgroundImage(rendered), lines: linesFor(runs) };
  } finally {
    disposeCanvas(rendered);
    page.cleanup();
  }
}

export function scannedWordPage(viewport, rendered, result) {
  const width = viewport.width;
  const height = viewport.height;
  const lines = [];
  for (const block of result.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        const text = cleanText(line.text.trim()).replace(/(?<=[\u3400-\u9fff]) +(?=[\u3400-\u9fff])/g, '');
        if (!text) continue;
        const { x0, x1, y0, y1 } = line.bbox;
        const size = Math.max(4, (y1 - y0) / rendered.height * height * 0.83);
        const x = x0 / rendered.width * width;
        const right = x1 / rendered.width * width;
        lines.push({
          x, right, size, baseline: y1 / rendered.height * height - size * 0.09, ascent: 0.96,
          runs: [{ text, width: right - x, size, family: 'Microsoft YaHei', color: '000000' }],
        });
      }
    }
  }
  return { width, height, lines };
}

const escapeXml = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const emu = value => Math.round(value * 12700);
const twip = value => Math.round(value * 20);

function wordRun(run, metrics) {
  const size = Math.max(2, Math.round(run.size * 2));
  const face = escapeXml(run.family);
  metrics.font = (run.italic ? 'italic ' : '') + (run.bold ? 'bold ' : '') + size / 2 + 'px "' + run.family + '"';
  const length = Math.max(1, [...run.text].length);
  const spacing = Math.max(-20, Math.min(24, twip((run.width - metrics.measureText(run.text).width) / length)));
  return '<w:r><w:rPr><w:rFonts w:ascii="' + face + '" w:hAnsi="' + face + '" w:eastAsia="' + face + '" w:cs="' + face + '"/>' +
    (run.bold ? '<w:b/><w:bCs/>' : '') + (run.italic ? '<w:i/><w:iCs/>' : '') + '<w:color w:val="' + run.color + '"/>' +
    (spacing ? '<w:spacing w:val="' + spacing + '"/>' : '') + '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' +
    '</w:rPr><w:t xml:space="preserve">' + escapeXml(run.text) + '</w:t></w:r>';
}

function textBox(line, id, pageWidth, pageHeight, metrics, xml) {
  const x = emu(Math.max(0, line.x));
  const lineHeight = line.size * 1.33;
  const y = emu(Math.max(0, line.baseline - line.size * (line.ascent + 0.02)));
  const cx = Math.max(1, emu(Math.min(pageWidth - line.x, Math.max(2, line.right - line.x + 4))));
  const cy = Math.max(1, Math.min(emu(pageHeight) - y, emu(lineHeight * 1.28)));
  const runContent = line.runs.map(run => wordRun(run, metrics)).join('');
  const drawing =
    '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="' + (251659264 + id) + '" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">' +
    '<wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>' + x + '</wp:posOffset></wp:positionH>' +
    '<wp:positionV relativeFrom="page"><wp:posOffset>' + y + '</wp:posOffset></wp:positionV>' +
    '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/>' +
    '<wp:docPr id="' + id + '" name="Text ' + id + '"/><wp:cNvGraphicFramePr/>' +
    '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape">' +
    '<wps:wsp xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:cNvSpPr txBox="1"/>' +
    '<wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr>' +
    '<wps:txbx><w:txbxContent><w:p><w:pPr><w:adjustRightInd w:val="0"/><w:snapToGrid w:val="0"/>' +
    '<w:spacing w:before="0" w:after="0" w:line="' + twip(lineHeight) + '" w:lineRule="exact"/>' +
    '<w:contextualSpacing w:val="0"/><w:jc w:val="left"/></w:pPr>' + runContent + '</w:p></w:txbxContent></wps:txbx>' +
    '<wps:bodyPr rot="0" spcFirstLastPara="0" vertOverflow="overflow" horzOverflow="overflow" vert="horz" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" numCol="1" anchor="t"><a:noAutofit/></wps:bodyPr>' +
    '</wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>';
  return xml.fromXmlString(drawing).root[0];
}

export async function positionedDocx(pages) {
  const { Document, Packer, Paragraph, TextRun, ImageRun, ImportedXmlComponent, PageOrientation, TextWrappingType } = await import('docx');
  const metrics = canvas(1, 1).getContext('2d');
  let id = 10000;
  const sections = [];
  for (const page of pages) {
    const fits = Math.min(1, 1584 / Math.max(page.width, page.height));
    const width = page.width * fits;
    const height = page.height * fits;
    const landscape = width > height;
    const children = [];
    if (page.picture) {
      children.push(new ImageRun({
        type: 'png', data: new Uint8Array(await page.picture.arrayBuffer()),
        transformation: { width: width * 4 / 3, height: height * 4 / 3 },
        floating: { horizontalPosition: { relative: 'page', offset: 0 }, verticalPosition: { relative: 'page', offset: 0 },
          wrap: { type: TextWrappingType.NONE }, behindDocument: true, allowOverlap: true, zIndex: 1 },
      }));
    }
    for (const line of page.lines) {
      const scaled = fits === 1 ? line : {
        ...line, x: line.x * fits, right: line.right * fits, baseline: line.baseline * fits, size: line.size * fits,
        runs: line.runs.map(run => ({ ...run, size: run.size * fits, width: run.width * fits })),
      };
      children.push(textBox(scaled, ++id, width, height, metrics, ImportedXmlComponent));
    }
    if (!children.length) children.push(new TextRun({ text: '', size: 2 }));
    sections.push({
      properties: { page: {
        size: { width: twip(landscape ? height : width), height: twip(landscape ? width : height),
          orientation: landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT },
        margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0, gutter: 0 },
      } },
      children: [new Paragraph({ children, spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' } })],
    });
  }
  return Packer.toBlob(new Document({ sections }));
}
