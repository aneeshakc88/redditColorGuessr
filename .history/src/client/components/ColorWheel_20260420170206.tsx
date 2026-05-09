import { useRef, useEffect, useState } from 'react';

type ColorWheelProps = {
  onColorSelected: (hexColor: string) => void;
  selectedColor?: string;
};

export const ColorWheel = ({ onColorSelected, selectedColor }: ColorWheelProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [currentHue, setCurrentHue] = useState(0);
  const [currentSaturation, setSaturation] = useState(100);
  const [brightness, setBrightness] = useState(50);

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

      setCurrentHue(h * 360);
      setSaturation(s * 100);
      setBrightness(l * 100);
    }
  }, [selectedColor]);

  // Draw color wheel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 10;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Draw color wheel
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= radius) {
          const angle = Math.atan2(dy, dx);
          const hue = ((angle + Math.PI) / (2 * Math.PI)) * 360;
          const saturation = (distance / radius) * 100;

          // Convert HSL to RGB
          const h = hue / 360;
          const s = saturation / 100;
          const l = 0.5;

          const c = (1 - Math.abs(2 * l - 1)) * s;
          const x1 = c * (1 - Math.abs(((h * 6) % 2) - 1));
          const m = l - c / 2;

          let r = 0,
            g = 0,
            b = 0;
          if (h < 1 / 6) {
            r = c;
            g = x1;
            b = 0;
          } else if (h < 2 / 6) {
            r = x1;
            g = c;
            b = 0;
          } else if (h < 3 / 6) {
            r = 0;
            g = c;
            b = x1;
          } else if (h < 4 / 6) {
            r = 0;
            g = x1;
            b = c;
          } else if (h < 5 / 6) {
            r = x1;
            g = 0;
            b = c;
          } else {
            r = c;
            g = 0;
            b = x1;
          }

          const index = (y * width + x) * 4;
          data[index] = Math.round((r + m) * 255);
          data[index + 1] = Math.round((g + m) * 255);
          data[index + 2] = Math.round((b + m) * 255);
          data[index + 3] = 255;
        }
      }
    }

    ctx.putImageData(imageData, 0, 0);

    // Draw selection indicator
    const angle = (currentHue * Math.PI) / 180 - Math.PI / 2;
    const x = centerX + Math.cos(angle) * ((currentSaturation / 100) * radius);
    const y = centerY + Math.sin(angle) * ((currentSaturation / 100) * radius);

    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 8, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
  }, [currentHue, currentSaturation]);

  const handleColorSelect = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 2 - 10;

    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= radius) {
      const angle = Math.atan2(dy, dx);
      const hue = ((angle + Math.PI) / (2 * Math.PI)) * 360;
      const saturation = (distance / radius) * 100;

      setCurrentHue(hue);
      setSaturation(saturation);

      // Convert HSL to hex
      const h = hue / 360;
      const s = saturation / 100;
      const l = currentLightness / 100;

      const c = (1 - Math.abs(2 * l - 1)) * s;
      const x1 = c * (1 - Math.abs(((h * 6) % 2) - 1));
      const m = l - c / 2;

      let r = 0,
        g = 0,
        b = 0;
      if (h < 1 / 6) {
        r = c;
        g = x1;
        b = 0;
      } else if (h < 2 / 6) {
        r = x1;
        g = c;
        b = 0;
      } else if (h < 3 / 6) {
        r = 0;
        g = c;
        b = x1;
      } else if (h < 4 / 6) {
        r = 0;
        g = x1;
        b = c;
      } else if (h < 5 / 6) {
        r = x1;
        g = 0;
        b = c;
      } else {
        r = c;
        g = 0;
        b = x1;
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

      const hex = `#${hexR}${hexG}${hexB}`.toUpperCase();
      onColorSelected(hex);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <canvas
        ref={canvasRef}
        width={280}
        height={280}
        onClick={handleColorSelect}
        className="cursor-crosshair rounded-full border-2 border-gray-300 dark:border-gray-600"
        style={{
          touchAction: 'none',
        }}
      />
      <div
        className="h-12 w-full rounded-lg border-2 border-gray-300 dark:border-gray-600"
        style={{
          backgroundColor: `hsl(${currentHue}, ${currentSaturation}%, ${currentLightness}%)`,
        }}
      />
      <p className="text-sm font-mono text-gray-600 dark:text-gray-400">
        {`hsl(${Math.round(currentHue)}, ${Math.round(currentSaturation)}%, ${Math.round(currentLightness)}%)`}
      </p>
    </div>
  );
};
