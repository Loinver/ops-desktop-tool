const { nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

// Create a 1024x1024 icon using a simple approach - generate a gradient with text
// We'll build a raw RGBA buffer and use nativeImage to convert
const size = 1024;
const buf = Buffer.alloc(size * size * 4);

// Gradient colors: #5b6abf -> #764ba2
const c1 = [91, 106, 191];
const c2 = [118, 75, 162];

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    const idx = (y * size + x) * 4;
    const t = (x + y) / (2 * size);
    buf[idx]     = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    buf[idx + 1] = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    buf[idx + 2] = Math.round(c1[2] + (c2[2] - c1[2]) * t);
    buf[idx + 3] = 255;
  }
}

// Draw a simple white rounded rectangle "monitor" shape in the center
const cx = size / 2;
const cy = size / 2;
const rectW = 560;
const rectH = 360;
const rectX = cx - rectW / 2;
const rectY = cy - rectH / 2;
const radius = 24;

function inRoundedRect(x, y, rx, ry, rw, rh, r) {
  if (x < rx || x > rx + rw || y < ry || y > ry + rh) return false;
  const dx = Math.max(rx + r - x, 0, x - (rx + rw - r));
  const dy = Math.max(ry + r - y, 0, y - (ry + rh - r));
  return dx * dx + dy * dy <= r * r;
}

for (let y = 0; y < size; y++) {
  for (let x = 0; x < size; x++) {
    if (inRoundedRect(x, y, rectX, rectY, rectW, rectH, radius)) {
      const idx = (y * size + x) * 4;
      // White with slight transparency
      buf[idx] = 255;
      buf[idx + 1] = 255;
      buf[idx + 2] = 255;
      buf[idx + 3] = 242;
    }
  }
}

// Draw status indicator dots (green, yellow, red, blue)
const dots = [
  { x: rectX + 80, y: rectY + 50, color: [16, 185, 129] },
  { x: rectX + 80, y: rectY + 150, color: [245, 158, 11] },
  { x: rectX + 80, y: rectY + 250, color: [239, 68, 68] },
];
const dotR = 14;
for (const dot of dots) {
  for (let y = dot.y - dotR; y <= dot.y + dotR; y++) {
    for (let x = dot.x - dotR; x <= dot.x + dotR; x++) {
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      const dx = x - dot.x;
      const dy = y - dot.y;
      if (dx * dx + dy * dy <= dotR * dotR) {
        const idx = (y * size + x) * 4;
        buf[idx] = dot.color[0];
        buf[idx + 1] = dot.color[1];
        buf[idx + 2] = dot.color[2];
        buf[idx + 3] = 255;
      }
    }
  }
}

const img = nativeImage.createFromBuffer(buf, { width: size, height: size });
const outDir = path.join(__dirname, '..', 'Users', 'linyer', 'Public', 'Private', 'ops-desktop-tool', 'build', 'icons');
const pngPath = path.resolve('/Users/linyer/Public/Private/ops-desktop-tool/build/icons/icon.png');
fs.writeFileSync(pngPath, img.toPNG());
console.log('PNG written to', pngPath, fs.statSync(pngPath).size, 'bytes');
