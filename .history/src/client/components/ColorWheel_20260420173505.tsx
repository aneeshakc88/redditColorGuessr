
import { useEffect, useState } from 'react';

type ColorWheelProps = {
  onColorSelected: (hexColor: string) => void;
  selectedColor?: string;
};

// HSB/HSV to HEX
function hsbToHex(h: number, s: number, v: number): string {
  s /= 100;
  v /= 100;
  let r = 0, g = 0, b = 0;
  let i = Math.floor(h / 60) % 6;
  let f = h / 60 - i;
  let p = v * (1 - s);
  let q = v * (1 - f * s);
  let t = v * (1 - (1 - f) * s);
  switch (i) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return (
    '#' +
    [r, g, b]
      .map((x) => Math.round(x * 255).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

// HEX to HSB/HSV
function hexToHsb(hex: string): { h: number; s: number; b: number } {
  hex = hex.replace('#', '');
  let r = parseInt(hex.substring(0, 2), 16) / 255;
  let g = parseInt(hex.substring(2, 4), 16) / 255;
  let b = parseInt(hex.substring(4, 6), 16) / 255;
  let max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, v = max;
  let d = max - min;
  s = max === 0 ? 0 : d / max;
  if (max === min) {
    h = 0;
  } else {
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s: s * 100, b: v * 100 };
}

export const ColorWheel = ({ onColorSelected, selectedColor }: ColorWheelProps) => {
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(100);
  const [brightness, setBrightness] = useState(100);

  // Sync with selectedColor prop
  useEffect(() => {
    if (selectedColor && selectedColor.startsWith('#')) {
      const { h, s, b } = hexToHsb(selectedColor);
      setHue(h);
      setSaturation(s);
      setBrightness(b);
    }
  }, [selectedColor]);

  // Update parent on slider change
  useEffect(() => {
    const hex = hsbToHex(hue, saturation, brightness);
    onColorSelected(hex);
    // eslint-disable-next-line
  }, [hue, saturation, brightness]);

  // Gradients
  const hueGradient =
    'linear-gradient(to bottom, #FF0000, #FFFF00, #00FF00, #00FFFF, #0000FF, #FF00FF, #FF0000)';
  const satGradient = `linear-gradient(to bottom, ${hsbToHex(hue, 0, brightness)}, ${hsbToHex(hue, 100, brightness)})`;
  const briGradient = `linear-gradient(to bottom, #000, ${hsbToHex(hue, saturation, 100)})`;

  return (
    <div className="flex w-full items-end justify-center gap-6">
      {/* HUE */}
      <div className="flex h-64 flex-col items-center gap-3">
        <div className="relative h-56 w-16 overflow-hidden rounded-full border border-gray-300 dark:border-gray-600 shadow-sm">
          <div className="absolute inset-0" style={{ background: hueGradient }} />
          <input
            type="range"
            min="0"
            max="359"
            value={hue}
            onChange={(e) => setHue(Number(e.target.value))}
            className="absolute inset-0 h-full w-full appearance-none bg-transparent opacity-0"
            style={{ cursor: 'pointer' }}
          />
          <div
            className="pointer-events-none absolute left-1/2 w-6 -translate-x-1/2 rounded-full border-2 border-white bg-white shadow-md"
            style={{
              height: '20px',
              top: `calc(${(hue / 359) * 100}% - 10px)`
            }}
          />
        </div>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Hue</p>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{Math.round(hue)}°</p>
      </div>

      {/* SATURATION */}
      <div className="flex h-64 flex-col items-center gap-3">
        <div className="relative h-56 w-16 overflow-hidden rounded-full border border-gray-300 dark:border-gray-600 shadow-sm">
          <div className="absolute inset-0" style={{ background: satGradient }} />
          <input
            type="range"
            min="0"
            max="100"
            value={saturation}
            onChange={(e) => setSaturation(Number(e.target.value))}
            className="absolute inset-0 h-full w-full appearance-none bg-transparent opacity-0"
            style={{ cursor: 'pointer' }}
          />
          <div
            className="pointer-events-none absolute left-1/2 w-6 -translate-x-1/2 rounded-full border-2 border-white bg-white shadow-md"
            style={{
              height: '20px',
              top: `calc(${(saturation / 100) * 100}% - 10px)`
            }}
          />
        </div>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Saturation</p>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{Math.round(saturation)}%</p>
      </div>

      {/* BRIGHTNESS */}
      <div className="flex h-64 flex-col items-center gap-3">
        <div className="relative h-56 w-16 overflow-hidden rounded-full border border-gray-300 dark:border-gray-600 shadow-sm">
          <div className="absolute inset-0" style={{ background: briGradient }} />
          <input
            type="range"
            min="0"
            max="100"
            value={brightness}
            onChange={(e) => setBrightness(Number(e.target.value))}
            className="absolute inset-0 h-full w-full appearance-none bg-transparent opacity-0"
            style={{ cursor: 'pointer' }}
          />
          <div
            className="pointer-events-none absolute left-1/2 w-6 -translate-x-1/2 rounded-full border-2 border-white bg-white shadow-md"
            style={{
              height: '20px',
              top: `calc(${(brightness / 100) * 100}% - 10px)`
            }}
          />
        </div>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">Brightness</p>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{Math.round(brightness)}%</p>
      </div>
    </div>
  );
};
