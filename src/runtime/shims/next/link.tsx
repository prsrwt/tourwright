// Stands in for next/link on a stage: a plain anchor that never navigates.

import type { AnchorHTMLAttributes, ReactNode } from 'react';

type Href = string | { pathname?: string; query?: Record<string, string> };

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> {
  href: Href;
  children?: ReactNode;
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  passHref?: boolean;
  legacyBehavior?: boolean;
}

export default function Link({ href, prefetch, replace, scroll, shallow, passHref, legacyBehavior, children, ...rest }: LinkProps) {
  const url = typeof href === 'string' ? href : (href.pathname ?? '');
  return (
    <a href={url} onClick={(e) => e.preventDefault()} {...rest}>
      {children}
    </a>
  );
}
