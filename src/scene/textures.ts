import { CanvasTexture, SRGBColorSpace } from 'three';

/** Canvas-drawn textures (floor labels, hazmat diamonds, fragile glyphs), cached per key. */
const cache = new Map<string, CanvasTexture>();

function cached(key: string, width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): CanvasTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

const FONT = 'Inter, "Segoe UI", system-ui, sans-serif';

/** Painted floor text (bay numbers, lane labels): transparent background, given aspect (width / height). */
export function floorLabelTexture(text: string, color: string, aspect: number): CanvasTexture {
  const h = 96;
  const w = Math.round(h * aspect);
  return cached(`floor:${text}:${color}:${aspect}`, w, h, (ctx) => {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 64;
    ctx.font = `700 ${size}px ${FONT}`;
    while (ctx.measureText(text).width > w * 0.92 && size > 18) {
      size -= 4;
      ctx.font = `700 ${size}px ${FONT}`;
    }
    ctx.fillText(text, w / 2, h / 2 + 2);
  });
}

/** Dangerous-goods diamond (placard colour, class number). */
export function hazmatTexture(hazClass: string, color: string): CanvasTexture {
  return cached(`haz:${hazClass}:${color}`, 128, 128, (ctx) => {
    ctx.translate(64, 64);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-44, -44, 88, 88);
    ctx.fillStyle = color;
    ctx.fillRect(-39, -39, 78, 78);
    ctx.strokeStyle = color === '#ffffff' ? '#1d1d1b' : '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(-34, -34, 68, 68);
    ctx.rotate(-Math.PI / 4);
    const dark = ['#F2C200', '#FAB005', '#D9D6CF'].includes(color.toUpperCase());
    ctx.fillStyle = dark ? '#1d1d1b' : '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${hazClass.length > 2 ? 30 : 38}px ${FONT}`;
    ctx.fillText(hazClass, 0, 22);
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText('DG', 0, -16);
  });
}

/** ADR orange plate: hazard identification number over the UN number (both blank on front/rear plates). */
export function adrPlateTexture(hazardId: string, unNumber: string): CanvasTexture {
  return cached(`adr:${hazardId}:${unNumber}`, 160, 120, (ctx) => {
    ctx.fillStyle = '#1d1d1b';
    ctx.fillRect(0, 0, 160, 120);
    ctx.fillStyle = '#f08c00';
    ctx.fillRect(7, 7, 146, 106);
    if (!hazardId && !unNumber) return;
    ctx.fillStyle = '#1d1d1b';
    ctx.fillRect(7, 57, 146, 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText(hazardId, 80, 34);
    ctx.fillText(unNumber.replace(/^UN/i, ''), 80, 88);
  });
}

/** "Fragile" handling glyph: a wine glass on a white label. */
export function fragileTexture(): CanvasTexture {
  return cached('fragile', 128, 128, (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#c2261d';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(6, 6, 116, 116, 14);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#c2261d';
    ctx.beginPath();
    ctx.moveTo(38, 22);
    ctx.lineTo(90, 22);
    ctx.quadraticCurveTo(92, 66, 64, 72);
    ctx.quadraticCurveTo(36, 66, 38, 22);
    ctx.fill();
    ctx.fillRect(60, 70, 8, 26);
    ctx.fillRect(44, 94, 40, 8);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(58, 26);
    ctx.lineTo(66, 44);
    ctx.lineTo(56, 52);
    ctx.stroke();
  });
}
