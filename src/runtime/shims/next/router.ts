// Stands in for next/router (the pages router) on a stage.

const router = {
  pathname: '/',
  route: '/',
  asPath: '/',
  query: {},
  isReady: true,
  push: async () => true,
  replace: async () => true,
  prefetch: async () => undefined,
  back: () => undefined,
  reload: () => undefined,
  events: { on: () => undefined, off: () => undefined, emit: () => undefined },
};

export function useRouter() {
  return router;
}

export default router;
