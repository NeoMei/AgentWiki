import React from 'react';

type ScreenshotFocus = 'top' | 'center' | 'bottom';
type ScreenshotFit = 'cover' | 'contain';

const screenshotFocusClass: Record<ScreenshotFocus, string> = {
  top: 'object-top',
  center: 'object-center',
  bottom: 'object-bottom',
};

const screenshotFitClass: Record<ScreenshotFit, string> = {
  cover: 'object-cover',
  contain: 'object-contain',
};

export const GuideScreenshot: React.FC<{
  src: string;
  alt: string;
  focus?: ScreenshotFocus;
  fit?: ScreenshotFit;
  heightClassName?: string;
}> = ({ src, alt, focus = 'center', fit = 'cover', heightClassName = 'h-56 sm:h-72' }) => (
  <div className={`${heightClassName} overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm`}>
    <img
      src={src}
      alt={alt}
      className={`h-full w-full ${screenshotFitClass[fit]} ${screenshotFocusClass[focus]}`}
      loading="lazy"
    />
  </div>
);
