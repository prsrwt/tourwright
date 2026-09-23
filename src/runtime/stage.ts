// The API an app's stages file uses. It runs in the browser, inside the app's own bundle, so it
// imports nothing from Node and holds no state.

import type { ReactNode } from 'react';

/** A number that eases from `from` to `to` when a beat animates it: a total, a count, a meter. */
export interface NumberValue {
  from: number;
  to: number;
  /** Decimal places to round to on every frame. Default 0, a whole number. */
  decimals?: number;
}

/**
 * A value that moves through states, one step per beat that animates it: a toggle
 * ([false, true]), progress steps, a status. It starts at the first step.
 */
export interface StepsValue<T = unknown> {
  steps: readonly T[];
}

export type ValueDefinition = NumberValue | StepsValue;

export type ValueDefinitions = Record<string, ValueDefinition>;

/** What `render` receives: each value at the current frame. */
export type ValuesOf<V extends ValueDefinitions> = {
  [K in keyof V]: V[K] extends StepsValue<infer T> ? T : number;
};

export interface StageDefinition<V extends ValueDefinitions = ValueDefinitions> {
  /**
   * Values the script can animate. The real components render them, so a meter fills or a
   * toggle flips because its props changed, exactly as it would in the app.
   */
  values?: V;
  /** Renders the app's real components with fixture data. Called on every frame, so keep it pure. */
  render: (values: ValuesOf<V>) => ReactNode;
  /**
   * Targets that cannot be wrapped in data-focus, as CSS selectors, such as
   * { "claim-total": "[data-testid='claim-total']" }. A selector that matches several elements
   * targets the box around all of them.
   */
  targets?: Record<string, string>;
}

export type Stages = Record<string, StageDefinition<any>>;

/** Identity function that gives a stages file its types. */
export function defineStages<T extends Stages>(stages: T): T {
  return stages;
}

/**
 * Identity function for one stage, so `render` gets its values' exact types:
 * a NumberValue arrives as a number, a StepsValue as one of its steps.
 */
export function defineStage<V extends ValueDefinitions>(stage: StageDefinition<V>): StageDefinition<V> {
  return stage;
}

export function isSteps(value: ValueDefinition): value is StepsValue {
  return 'steps' in value;
}
