export interface TemplateCaptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface TemplateZoomMoment {
  at: number;
  duration: number;
  intensity: number;
}

export interface TemplateProps {
  videoUrl: string;
  durationInFrames: number;
  captionSegments: TemplateCaptionSegment[];
  hookText: string;
  brandPrimaryColor: string;
  brandAccentColor: string;
  brandFont: string;
  zoomMoments: TemplateZoomMoment[];
}
