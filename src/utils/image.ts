export async function downscaleDataUrl(src: string, maxSize = 800, quality = 0.8): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const w = img.width, h = img.height;
          const scale = Math.min(1, maxSize / Math.max(w, h));
          const dstW = Math.max(1, Math.round(w * scale));
          const dstH = Math.max(1, Math.round(h * scale));
          if (dstW === w && dstH === h) { resolve(src); return; }
          const canvas = document.createElement('canvas');
          canvas.width = dstW; canvas.height = dstH;
          const ctx = canvas.getContext('2d');
          if (!ctx) { resolve(src); return; }
          ctx.drawImage(img, 0, 0, dstW, dstH);
          let out = '';
          try { out = canvas.toDataURL('image/webp', quality); } catch { out = canvas.toDataURL('image/jpeg', quality); }
          if (!out || out.length < 20) out = src;
          resolve(out);
        } catch {
          resolve(src);
        }
      };
      img.onerror = () => resolve(src);
      img.src = src;
    } catch {
      resolve(src);
    }
  });
}

