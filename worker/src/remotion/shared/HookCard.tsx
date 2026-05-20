import React from 'react';
import { interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

interface Props {
  text: string;
  font: string;
  accentColor: string;
  background?: 'pill' | 'sticker' | 'plain';
  top: number;
  visibleSeconds?: number;
  tilt?: number;
}

export const HookCard: React.FC<Props> = ({
  text,
  font,
  accentColor,
  background = 'pill',
  top,
  visibleSeconds = 1.5,
  tilt = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / fps;
  const fadeIn = interpolate(tSec, [0, 0.2], [0, 1], { extrapolateRight: 'clamp' });
  const fadeOut = interpolate(
    tSec,
    [visibleSeconds, visibleSeconds + 0.4],
    [1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  const opacity = Math.min(fadeIn, fadeOut);
  if (opacity <= 0) return null;

  const padding =
    background === 'plain' ? 0 : background === 'sticker' ? '16px 28px' : '14px 24px';
  const radius = background === 'sticker' ? 12 : 32;
  const bg =
    background === 'plain' ? 'transparent' : background === 'sticker' ? '#fff' : accentColor;

  return (
    <div
      style={{
        position: 'absolute',
        top,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        opacity,
        transform: `rotate(${tilt}deg)`,
      }}
    >
      <div
        style={{
          fontFamily: font,
          fontWeight: 700,
          fontSize: 64,
          color: background === 'sticker' ? '#0b0712' : '#ffffff',
          background: bg,
          padding,
          borderRadius: radius,
          textShadow: background === 'plain' ? '0 4px 0 #000' : 'none',
          boxShadow: background === 'sticker' ? '0 16px 32px rgba(0,0,0,0.35)' : 'none',
          maxWidth: '92%',
          textAlign: 'center',
        }}
      >
        {text}
      </div>
    </div>
  );
};
