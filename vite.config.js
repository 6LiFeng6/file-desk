import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

function copy(source, target) {
  const destination = join(root, 'public', 'local', target);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(join(root, 'node_modules', source), destination, { recursive: true });
}

function prepareAssets() {
  copy('pdfjs-dist/cmaps', 'cmaps');
  copy('pdfjs-dist/standard_fonts', 'fonts');
  copy('tesseract.js/dist/worker.min.js', 'ocr/worker.min.js');
  copy('tesseract.js/dist/worker.min.js.LICENSE.txt', 'ocr/worker.min.js.LICENSE.txt');
  copy('tesseract.js-core/tesseract-core-lstm.wasm.js', 'ocr/core/tesseract-core-lstm.wasm.js');
  copy('tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'ocr/core/tesseract-core-simd-lstm.wasm.js');
  copy('tesseract.js-core/LICENSE', 'ocr/core/LICENSE');
  for (const language of ['eng', 'chi_sim']) {
    copy('@tesseract.js-data/' + language + '/4.0.0_best_int/' + language + '.traineddata.gz',
      'ocr/lang/' + language + '.traineddata.gz');
  }
  copy('@upscalerjs/esrgan-slim/models/x2', 'upscale');
  copy('@upscalerjs/esrgan-slim/LICENSE', 'upscale/LICENSE');
  copy('heic-to/dist/csp/heic-to.min.js', 'heic/heic-to.js');
  for (const packageName of ['pdf-lib', 'pdfjs-dist', 'docx-preview', 'docx', 'html2canvas', 'jszip', 'tesseract.js', 'upscaler', '@tensorflow/tfjs', 'heic-to']) {
    const folder = join(root, 'node_modules', packageName);
    const license = readdirSync(folder).find(name => /^license(?:\..*)?$/i.test(name));
    if (license) copy(packageName + '/' + license, 'licenses/' + packageName.replace('/', '-') + '.txt');
  }
}

export default defineConfig({
  base: './',
  plugins: [{ name: 'local-processing-assets', configResolved: prepareAssets }],
});
