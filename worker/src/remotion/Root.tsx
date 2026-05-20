import React from 'react';
import { Composition } from 'remotion';
import type { TemplateProps } from './templateProps.js';
import { BoldCaption } from './compositions/BoldCaption.js';
import { MemePop } from './compositions/MemePop.js';
import { MinimalBottom } from './compositions/MinimalBottom.js';

const DEFAULT_PROPS: TemplateProps = {
  videoUrl: '',
  durationInFrames: 900,
  captionSegments: [],
  hookText: 'Wait for it…',
  brandPrimaryColor: '#7c3aed',
  brandAccentColor: '#22d3ee',
  brandFont: 'Inter',
  zoomMoments: [],
};

const Bold = BoldCaption as unknown as React.FC<Record<string, unknown>>;
const Meme = MemePop as unknown as React.FC<Record<string, unknown>>;
const Minimal = MinimalBottom as unknown as React.FC<Record<string, unknown>>;
const defaults = DEFAULT_PROPS as unknown as Record<string, unknown>;

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="BoldCaption"
      component={Bold}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaults}
    />
    <Composition
      id="MemePop"
      component={Meme}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaults}
    />
    <Composition
      id="MinimalBottom"
      component={Minimal}
      durationInFrames={900}
      fps={30}
      width={1080}
      height={1920}
      defaultProps={defaults}
    />
  </>
);
