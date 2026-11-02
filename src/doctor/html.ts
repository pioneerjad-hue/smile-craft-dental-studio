/** Base64 of a large byte array (chunked to stay within call-stack limits). */
export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** One self-contained HTML document: case package (base64) + viewer runtime. */
export function viewerHtml(pkg: Uint8Array, title: string, runtime: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head><body><div>Loading treatment simulation…</div><script>window.__SMILE_CASE__="${toBase64(pkg)}";</script><script>${runtime.replace(/<\/script/gi, '<\\/script')}</script></body></html>`;
}
