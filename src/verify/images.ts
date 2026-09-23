// Image work done in the browser that is already open, so Tourwright needs no image library.

import type { Browser } from 'playwright';

export interface ImageStats {
  /** Share of pixels, from 0 to 1, in the most common colour (quantised to 4 bits a channel). */
  dominantShare: number;
}

export async function imageStats(browser: Browser, images: readonly Buffer[]): Promise<ImageStats[]> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const out: ImageStats[] = [];
    for (const png of images) {
      out.push(
        await page.evaluate(async (base64) => {
          const img = new Image();
          img.src = `data:image/png;base64,${base64}`;
          await img.decode();
          const canvas = new OffscreenCanvas(img.width, img.height);
          const ctx = canvas.getContext('2d')!;
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, img.width, img.height).data;
          const counts = new Map<number, number>();
          let total = 0;
          for (let i = 0; i < data.length; i += 8) {
            const key = ((data[i]! >> 4) << 8) | ((data[i + 1]! >> 4) << 4) | (data[i + 2]! >> 4);
            counts.set(key, (counts.get(key) ?? 0) + 1);
            total += 1;
          }
          return { dominantShare: Math.max(...counts.values()) / total };
        }, png.toString('base64')),
      );
    }
    return out;
  } finally {
    await context.close();
  }
}

const THUMB = { w: 480, h: 270 };
const GAP = 16;

/** One labelled image of every still, so a model can look at a single file. */
export async function contactSheet(browser: Browser, images: readonly Buffer[], labels: readonly string[]): Promise<Buffer> {
  const columns = Math.min(4, Math.max(1, images.length));
  const context = await browser.newContext({ viewport: { width: columns * (THUMB.w + GAP) + GAP, height: 400 }, deviceScaleFactor: 1 });
  try {
    const page = await context.newPage();
    const cells = images
      .map(
        (png, i) =>
          `<figure><img src="data:image/png;base64,${png.toString('base64')}"><figcaption>${escapeHtml(`${i + 1}. ${labels[i] ?? ''}`)}</figcaption></figure>`,
      )
      .join('');
    await page.setContent(
      `<!doctype html><html><head><style>
        body { margin: 0; padding: ${GAP}px; background: #1e293b; font: 16px ui-sans-serif, system-ui, sans-serif; color: #f8fafc; }
        main { display: grid; grid-template-columns: repeat(${columns}, ${THUMB.w}px); gap: ${GAP}px; }
        figure { margin: 0; }
        img { display: block; width: ${THUMB.w}px; height: ${THUMB.h}px; background: #fff; }
        figcaption { padding-top: 6px; }
      </style></head><body><main>${cells}</main></body></html>`,
      { waitUntil: 'load' },
    );
    return await page.screenshot({ type: 'png', fullPage: true });
  } finally {
    await context.close();
  }
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
