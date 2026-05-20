import React from 'react';
import { AbsoluteFill, OffthreadVideo, useCurrentFrame, useVideoConfig } from 'remotion';
import { CaptionTrack } from '../shared/CaptionTrack.js';
import { HookCard } from '../shared/HookCard.js';
import type { TemplateProps } from '../templateProps.js';
import { useZoomScale } from './useZoomScale.js';

export const MemePop: React.FC<TemplateProps> = (props) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = useZoomScale(props.zoomMoments, frame / fps);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <AbsoluteFill style={{ transform: `scale(${scale})`, transformOrigin: '50% 50%' }}>
        <OffthreadVideo src={props.videoUrl} muted={false} />
      </AbsoluteFill>
      <HookCard
        text={props.hookText}
        font={props.brandFont}
        accentColor={props.brandPrimaryColor}
        background="sticker"
        top={200}
        tilt={-4}
        visibleSeconds={2}
      />
      <CaptionTrack
        segments={props.captionSegments}
        font={props.brandFont}
        activeColor={props.brandPrimaryColor}
        baseSize={100}
        bottomOffset={300}
        withBackground
        springy
      />
    </AbsoluteFill>
  );
};
