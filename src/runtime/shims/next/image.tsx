// Stands in for next/image on a stage: a plain img with the same sizing props.

import type { CSSProperties, ImgHTMLAttributes } from 'react';

export interface ImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | { src: string; width?: number; height?: number };
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  placeholder?: string;
  blurDataURL?: string;
  unoptimized?: boolean;
}

export default function Image({ src, fill, priority, quality, placeholder, blurDataURL, unoptimized, style, ...rest }: ImageProps) {
  const url = typeof src === 'string' ? src : src.src;
  const filled: CSSProperties = fill ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : {};
  return <img src={url} style={{ ...filled, ...style }} {...rest} />;
}
