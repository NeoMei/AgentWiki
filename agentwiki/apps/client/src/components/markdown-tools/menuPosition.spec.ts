import { describe, it, expect } from 'vitest';
import { menuPosition } from './menuPosition';
describe('measured slash menu viewport placement', () => {
  it('flips the actual 273px menu above the desktop bottom-edge caret', () => {
    expect(menuPosition({ left: 650, top: 690, bottom: 706 }, { width: 200, height: 273 }, { width: 1280, height: 720 })).toEqual({ left: 650, top: 413, maxHeight: 674, maxWidth: 1256 });
  });
  it('keeps a short measured menu below the caret when it fits', () => {
    expect(menuPosition({ left: 100, top: 200, bottom: 218 }, { width: 210, height: 80 }, { width: 1280, height: 720 })).toEqual({ left: 100, top: 222, maxHeight: 486, maxWidth: 1256 });
  });
  it('clamps narrow width and scrolls a taller menu inside available viewport space', () => {
    const result = menuPosition({ left: 350, top: 390, bottom: 410 }, { width: 420, height: 600 }, { width: 390, height: 720 });
    expect(result).toEqual({ left: 12, top: 12, maxHeight: 374, maxWidth: 366 });
  });
  it('clamps a scrolled-out anchor instead of placing the menu offscreen', () => {
    const result = menuPosition({ left: -30, top: -150, bottom: -130 }, { width: 200, height: 260 }, { width: 390, height: 720 });
    expect(result).toEqual({ left: 12, top: 16, maxHeight: 692, maxWidth: 366 });
  });
});
