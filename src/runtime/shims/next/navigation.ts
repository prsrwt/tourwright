// Stands in for next/navigation on a stage. Routing does nothing; the path is "/".

const router = {
  push: () => undefined,
  replace: () => undefined,
  refresh: () => undefined,
  prefetch: () => undefined,
  back: () => undefined,
  forward: () => undefined,
};

export function useRouter() {
  return router;
}

export function usePathname(): string {
  return '/';
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams();
}

export function useParams(): Record<string, string> {
  return {};
}

export function useSelectedLayoutSegment(): string | null {
  return null;
}

export function useSelectedLayoutSegments(): string[] {
  return [];
}

export function redirect(path: string): never {
  throw new Error(`redirect("${path}") was called while rendering a stage. Stages cannot navigate; give the component fixtures that do not redirect.`);
}

export function notFound(): never {
  throw new Error('notFound() was called while rendering a stage. Give the component fixtures for data that exists.');
}
