import { useEffect, useState } from 'react';

type ColorWheelProps = {
  onColorSelected: (hexColor: string) => void;
  selectedColor?: string;
};

const hslToHex = (h: number, s: number, l: number): string => {
  const c = (1 - Math.abs(2 * l - 1)) * (s / 100);
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l / 100 - c / 2;

  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }

  const hexR = Math.round((r + m) * 255)
    .toString(16)
    .padStart(2, '0');
  const hexG = Math.round((g + m) * 255)
    .toString(16)
    .padStart(2, '0');
  const hexB = Math.round((b + m) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${hexR}${hexG}${hexB}`.toUpperCase();
};

export const ColorWheel = ({ onColorSelected, selectedColor }: ColorWheelProps) => {
  const [hue, setHue] = useState(0);
  const [saturation, setSaturation] = useState(100);
  const [lightness, setLightness] = useState(50);

  useEffect(() => {
    if (selectedColor && selectedColor.startsWith('#')) {
      const hex = selectedColor.slice(1);
      const r = parseInt(hex.slice(0, 2), 16) / 255;
      const g = parseInt(hex.slice(2, 4), 16) / 255;
      const b = parseInt(hex.slice(4, 6), 16) / 255;

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h = 0;
      let s = 0;

      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

        switch (max) {
          case r:
            h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
            break;
          case g:
            h = ((b - r) / d + 2) / 6;
            break;
          case b:
            h = ((r - g) / d + 4) / 6;
            break;
        }
      }

      setHue(h * 360);
      setSaturation(s * 100);
      setLightness(l * 100);
    }
  }, [selectedColor]);

  const handleHueChange = (value: number) => {
    setHue(value);
    const hex = hslToHex(value, saturation, lightness);
    onColorSelected(hex);
  };

  const handleSaturationChange = (value: number) => {
    setSaturation(value);
    const hex = hslToHex(hue, value, lightness);
    onColorSelected(hex);
  };

  const handleLightnessChange = (value: number) => {
    setLightness(value);
    const hex = hslToHex(hue, saturation, value);
    onColorSelected(hex);
  };

  return (
    <div className="flex w-full items-end justify-center gap-6">
      <div className="flex h-64 flex-col items-center gap-3">
        <div className="relative h-56 w-16 overflow-hidden rounded-full border border-gray-300 dark:border-gray-600 shadow-sm">
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, rgb(255,0,0), rgb(255,255,0), rgb(0,255,0), rgb(0,255,255), rgb(0,0,255), rgb(255,0,255), rgb(255,0,0))`,
            }}
          />
          <input
            type="range"
            min="0"
            max="360"
            value={hue}
            onChange={(e) => handleHueChange(Number(e.target.value))}
            className="absolute inset-0 h-full w-full appearance-none bg-transparent opacity-0"
            style={{ cursor: 'pointer' }}
          />
          <div
            className="pointer-events-none absolute left-1/2 w-6 -translate-x-1/2 rounded-full border-2 border-white bg-white shadow-md"
            style={{
              height: '20px',
              top: `calc(${(hue / 360) * 100}% - 10px)`,
            }}
          />
        </div>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
          Hue
        </p>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{Math.round(hue)}°</p>
      </div>

      <div className="flex h-64 flex-col items-center gap-3">
        <div className="relative h-56 w-16 overflow-hidden rounded-full border border-gray-300 dark:border-gray-600 shadow-sm">
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, hsl(${hue}, 0%, 50%), hsl(${hue}, 100%, 50%))`,
            }}
          />
          <input
            type="range"
            min="0"
            max="100"
            value={saturation}
            onChange={(e) => handleSaturationChange(Number(e.target.value))}
            className="absolute inset-0 h-full w-full appearance-none bg-transparent opacity-0"
            style={{ cursor: 'pointer' }}
          />
          <div
            className="pointer-events-none absolute left-1/2 w-6 -translate-x-1/2 rounded-full border-2 border-white bg-white shadow-md"
            style={{
              height: '20px',
              top: `calc(${100 - (saturation / 100) * 100}% - 10px)`,
            }}
          />
        </div>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
          Saturation
        </p>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{Math.round(saturation)}%</p>
      </div>

      <div className="flex h-64 flex-col items-center gap-3">
        <div className="relative h-56 w-16 overflow-hidden rounded-full border border-gray-300 dark:border-gray-600 shadow-sm">
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, hsl(${hue}, ${saturation}%, 0%), hsl(${hue}, ${saturation}%, 50%), hsl(${hue}, ${saturation}%, 100%))`,
            }}
          />
          <input
            type="range"
            min="0"
            max="100"
            value={lightness}
            onChange={(e) => handleLightnessChange(Number(e.target.value))}
            className="absolute inset-0 h-full w-full appearance-none bg-transparent opacity-0"
            style={{ cursor: 'pointer' }}
          />
          <div
            className="pointer-events-none absolute left-1/2 w-6 -translate-x-1/2 rounded-full border-2 border-white bg-white shadow-md"
            style={{
              height: '20px',
              top: `calc(${100 - (lightness / 100) * 100}% - 10px)`,
            }}
          />
        </div>
        <p className="text-center text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">
          Lightness
        </p>
        <p className="text-xs font-semibold text-gray-700 dark:text-gray-300">{Math.round(lightness)}%</p>
      </div>
    </div>
  );
};
