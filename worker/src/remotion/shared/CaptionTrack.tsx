import React from 'react';
import { useCurrentFrame, useVideoConfig } from 'remotion';
import type { TemplateCaptionSegment } from '../templateProps.js';

interface Props {
  segments: TemplateCaptionSegment[];
  font: string;
  activeColor: string;
  inactiveColor?: string;
  baseSize: number;
  bottomOffset: number;
  withBackground?: boolean;
  springy?: boolean;
}

export const CaptionTrack: React.FC<Props> = ({
  segments,
  font,
  activeColor,
  inactiveColor = '#ffffff',
  baseSize,
  bottomOffset,
  withBackground = false,
  springy = false,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const tSec = frame / fps;
  const active = segments.find((s) => tSec >= s.start && tSec <= s.end);
  if (!active) return null;

  const progress = Math.min(1, Math.max(0, (tSec - active.start) / 0.18));
  const scale = springy ? 1 + 0.08 * (1 - progress) : 1;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: bottomOffset,
        left: 0,
        right: 0,
        display: 'flex',
        justifyContent: 'center',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          fontFamily: font,
          fontWeight: 800,
          fontSize: baseSize,
          color: inactiveColor,
          textShadow: '0 0 12px rgba(0,0,0,0.85), 0 4px 0 #000',
          padding: withBackground ? '12px 28px' : 0,
          background: withBackground ? activeColor : 'transparent',
          borderRadius: 18,
          transform: `scale(${scale})`,
          maxWidth: '90%',
          textAlign: 'center',
          textTransform: 'uppercase',
          letterSpacing: '0.02em',
          lineHeight: 1.1,
        }}
      >
        {active.text}
      </div>
    </div>
  );
};
