// Stable id generator. WebView2 is Chromium, so crypto.randomUUID is available.
export function uid(): string {
  return crypto.randomUUID();
}
