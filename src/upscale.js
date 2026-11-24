import Upscaler from 'upscaler';
import definition from '@upscalerjs/esrgan-slim/2x';
import { browser, ready, tidy } from '@tensorflow/tfjs';
import { canvas, disposeCanvas } from './images.js';

let model;

export async function upscaleImage(source, scale, progress = () => {}, type) {
  if (scale !== 2) throw new Error('AI 模式使用 2 倍模型。');
  if (source.width * source.height > 1_600_000) {
    throw new Error('AI 模式支持原图最多 160 万像素。可以先裁剪，或选择普通放大。');
  }

  const { _internals, ...settings } = definition;
  const path = new URL('./local/upscale/model.json', document.baseURI).href;
  progress(0, '正在加载 AI 放大模型');
  const input = canvas(source.width, source.height);
  const inputContext = input.getContext('2d');
  if (type === 'image/jpeg') {
    inputContext.fillStyle = '#fff';
    inputContext.fillRect(0, 0, input.width, input.height);
  }
  inputContext.drawImage(source, 0, 0);
  let tensor;
  let pixels;
  let output;
  try {
    await ready();
    model ??= new Upscaler({ model: { ...settings, path } });
    await model.ready;
    tensor = await model.upscale(input, {
      patchSize: 96, padding: 12, output: 'tensor',
      progress: fraction => progress(fraction, '正在放大图片细节'),
      awaitNextFrame: true,
    });
    output = canvas(source.width * 2, source.height * 2);
    pixels = tidy(() => tensor.round().toInt());
    await browser.toPixels(pixels, output);
    if (type !== 'image/jpeg') {
      const ctx = output.getContext('2d');
      ctx.globalCompositeOperation = 'destination-in';
      ctx.drawImage(input, 0, 0, output.width, output.height);
      ctx.globalCompositeOperation = 'source-over';
    }
    return output;
  } catch (error) {
    if (output) disposeCanvas(output);
    if (model) {
      const failed = model;
      model = undefined;
      await failed.dispose().catch(() => {});
    }
    throw new Error('AI 放大失败，请重试或选择普通放大。', { cause: error });
  } finally {
    pixels?.dispose();
    tensor?.dispose();
    disposeCanvas(input);
  }
}
