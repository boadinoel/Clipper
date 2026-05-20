import type { TemplateZoomMoment } from '../templateProps.js';

export function useZoomScale(moments: TemplateZoomMoment[], tSec: number): number {
  let scale = 1;
  for (const m of moments) {
    if (tSec < m.at || tSec > m.at + m.duration) continue;
    const localT = (tSec - m.at) / m.duration;
    const easeIn = localT < 0.5 ? localT * 2 : 2 - localT * 2;
    scale = 1 + (m.intensity - 1) * easeIn;
    break;
  }
  return scale;
}
