// The API an app's stages file uses. It runs in the browser, inside the app's own bundle, so it
// imports nothing from Node and holds no state.

import type { ReactNode } from 'react';

export interface StageDefinition {
  /** Renders the app's real components with fixture data. Called on every frame, so keep it pure. */
  render: () => ReactNode;
  /**
   * Targets that cannot be wrapped in data-focus, as CSS selectors, such as
   * { "claim-total": "[data-testid='claim-total']" }. A selector that matches several elements
   * targets the box around all of them.
   */
  targets?: Record<string, string>;
}

export type Stages = Record<string, StageDefinition>;

/** Identity function that gives a stages file its types. */
export function defineStages<T extends Stages>(stages: T): T {
  return stages;
}
