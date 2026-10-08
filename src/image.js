// Takes any photo, crops the middle to a square, shrinks it to 512 x 512 pixels
// and saves it as WebP (or JPEG on browsers that cannot do WebP). Keeps storage tiny.
export async function squarePhoto(file, size = 512) {
  const bitmap = await loadBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size);
  if (bitmap.close) bitmap.close();

  let blob = await toBlob(canvas, 'image/webp', 0.82);
  if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.85);
  return blob;
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function loadBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch (_) { /* fall through */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}
