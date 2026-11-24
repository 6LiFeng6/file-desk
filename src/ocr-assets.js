export function ocrAssets() {
  return {
    workerPath: new URL('./local/ocr/worker.min.js', document.baseURI).href,
    workerBlobURL: false,
    corePath: new URL('./local/ocr/core/', document.baseURI).href,
    langPath: new URL('./local/ocr/lang/', document.baseURI).href,
  };
}
