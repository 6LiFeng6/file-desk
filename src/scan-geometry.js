export const defaultCorners = () => [
  { x: 0, y: 0 }, { x: 1, y: 0 },
  { x: 1, y: 1 }, { x: 0, y: 1 },
];

export function validCorners(corners) {
  return corners.length === 4 && corners.every((point, index) => {
    const next = corners[(index + 1) % 4];
    const end = corners[(index + 2) % 4];
    const turn = (next.x - point.x) * (end.y - next.y) - (next.y - point.y) * (end.x - next.x);
    return point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 && turn > 0.003;
  });
}

export function quadrilateralTransform(corners) {
  if (!validCorners(corners)) throw new Error('请把四个角按顺时针摆在纸张边缘，避免交叉或重叠。');
  const [topLeft, topRight, bottomRight, bottomLeft] = corners;
  const dx1 = topRight.x - bottomRight.x;
  const dx2 = bottomLeft.x - bottomRight.x;
  const dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y;
  const dy2 = bottomLeft.y - bottomRight.y;
  const dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const determinant = dx1 * dy2 - dx2 * dy1;
  const g = (dx3 * dy2 - dx2 * dy3) / determinant;
  const h = (dx1 * dy3 - dx3 * dy1) / determinant;
  return {
    a: topRight.x - topLeft.x + g * topRight.x,
    b: bottomLeft.x - topLeft.x + h * bottomLeft.x,
    c: topLeft.x,
    d: topRight.y - topLeft.y + g * topRight.y,
    e: bottomLeft.y - topLeft.y + h * bottomLeft.y,
    f: topLeft.y, g, h,
  };
}

export function paperCorners(rgba, width, height) {
  if (width < 18 || height < 18) return null;
  const gray = new Uint8Array(width * height);
  const histogram = new Uint32Array(256);
  const border = [];
  const edge = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      const value = (rgba[offset] * 0.2126 + rgba[offset + 1] * 0.7152 + rgba[offset + 2] * 0.0722) | 0;
      gray[y * width + x] = value;
      histogram[value]++;
      if (x < edge || y < edge || x >= width - edge || y >= height - edge) border.push(value);
    }
  }
  border.sort((a, b) => a - b);
  const background = border[Math.floor(border.length / 2)];
  let bright = 255;
  let brighterPixels = 0;
  for (; bright >= 0; bright--) {
    brighterPixels += histogram[bright];
    if (brighterPixels > gray.length * 0.17) break;
  }
  if (bright - background < 28) return null;
  const threshold = background + Math.max(22, (bright - background) * 0.55);
  const visited = new Uint8Array(gray.length);
  const queue = new Int32Array(gray.length);
  let best = 0;
  let points = [];
  const mark = (position, tail) => {
    if (visited[position] || gray[position] < threshold) return tail;
    visited[position] = 1;
    queue[tail] = position;
    return tail + 1;
  };

  for (let start = 0; start < gray.length; start++) {
    let head = 0;
    let tail = mark(start, 0);
    if (!tail) continue;
    const scores = [Infinity, -Infinity, -Infinity, Infinity];
    const indices = [];
    while (head < tail) {
      const position = queue[head++];
      const x = position % width;
      const y = Math.floor(position / width);
      const sum = x + y;
      const difference = x - y;
      if (sum < scores[0]) { scores[0] = sum; indices[0] = position; }
      if (difference > scores[1]) { scores[1] = difference; indices[1] = position; }
      if (sum > scores[2]) { scores[2] = sum; indices[2] = position; }
      if (difference < scores[3]) { scores[3] = difference; indices[3] = position; }
      if (x > 0) tail = mark(position - 1, tail);
      if (x + 1 < width) tail = mark(position + 1, tail);
      if (y > 0) tail = mark(position - width, tail);
      if (y + 1 < height) tail = mark(position + width, tail);
    }
    if (tail > best) {
      best = tail;
      points = indices.map(index => ({ x: (index % width) / (width - 1), y: Math.floor(index / width) / (height - 1) }));
    }
  }
  if (best < gray.length * 0.18 || best > gray.length * 0.96 || !validCorners(points)) return null;
  return points;
}
