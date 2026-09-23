// Stands in for next/dynamic on a stage. Loading is asynchronous, so the stage shows the
// component once the import resolves; verify waits for it like any other render.

import { lazy, Suspense, type ComponentType } from 'react';

type Loader<P> = () => Promise<ComponentType<P> | { default: ComponentType<P> }>;

export default function dynamic<P extends object>(loader: Loader<P>): ComponentType<P> {
  const Lazy = lazy(async () => {
    const loaded = await loader();
    return 'default' in loaded ? loaded : { default: loaded };
  });
  return (props: P) => (
    <Suspense fallback={null}>
      <Lazy {...props} />
    </Suspense>
  );
}
