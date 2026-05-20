import React from 'react';
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import { CaptionTrack } from '../shared/CaptionTrack.js';
import type { TemplateProps } from '../templateProps.js';
import { useZoomScale } from './useZoomScale.js';

export const MinimalBottom: React.FC<TemplateProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = useZoomScale(props.zoomMoments, frame / fps);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: '50% 50%' }}>
        <OffthreadVideo src={props.videoUrl} muted={false} />
      </AbsoluteFill>
      <div
        style={{
          position: 'absolute',
          top: 80,
          left: 80,
          color: '#fff',
          fontFamily: props.brandFont,
          fontWeight: 600,
          fontSize: 44,
          textShadow: '0 2px 0 #000',
          maxWidth: '70%',
        }}
      >
        {props.hookText}
      </div>
      <CaptionTrack
        segments={props.captionSegments}
        font={props.brandFont}
        activeColor={props.brandAccentColor}
        baseSize={60}
        bottomOffset={200}
      />
    </AbsoluteFill>
  );
};
