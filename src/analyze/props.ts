// Describes a component's props from its type, and says which ones could move in a video: a
// number can count up, a boolean can flip, a set of string states can step through, and a list
// of records with numbers can grow in proportion.

import type * as TS from 'typescript5';
import type { AppProgram } from './program.ts';

export type Motion =
  | { kind: 'number'; hint: string }
  | { kind: 'toggle'; hint: string }
  | { kind: 'steps'; hint: string; steps: string[] }
  | { kind: 'scale'; hint: string; fields: string[] };

export interface PropInfo {
  name: string;
  type: string;
  optional: boolean;
  /** An event handler: a stage passes a no-op. */
  handler: boolean;
  motion?: Motion;
}

export interface ComponentInfo {
  name: string;
  /** The module it is imported from, as written. */
  from?: string;
  props: PropInfo[];
}

/** The props of the component a JSX tag names, or undefined when the tag is not a component. */
export function componentProps(app: AppProgram, tag: TS.JsxTagNameExpression): PropInfo[] | undefined {
  const { checker } = app;
  const type = checker.getTypeAtLocation(tag);
  const signature = [...type.getCallSignatures(), ...type.getConstructSignatures()][0];
  const parameter = signature?.getParameters()[0];
  if (!parameter) return type.getCallSignatures().length || type.getConstructSignatures().length ? [] : undefined;
  let propsType = checker.getTypeOfSymbolAtLocation(parameter, tag);
  // Class components take props as the first constructor parameter; function components too.
  propsType = checker.getApparentType(propsType);
  return propsType
    .getProperties()
    .filter((p) => !['children', 'key', 'ref', 'className', 'style'].includes(p.name))
    .map((symbol) => describeProp(app, symbol, tag));
}

function describeProp(app: AppProgram, symbol: TS.Symbol, at: TS.Node): PropInfo {
  const { ts, checker } = app;
  const optional = (symbol.flags & ts.SymbolFlags.Optional) !== 0;
  const declared = checker.getTypeOfSymbolAtLocation(symbol, at);
  const type = checker.getNonNullableType(declared);
  const handler = type.getCallSignatures().length > 0;
  const info: PropInfo = { name: symbol.name, type: checker.typeToString(declared), optional, handler };
  if (!handler) {
    const motion = motionFor(app, symbol.name, type);
    if (motion) info.motion = motion;
  }
  return info;
}

// Booleans worth flipping in a demo change what the viewer sees: a view, a mode, a section.
// Loading, busy, error and permission flags are states a demo should not show changing.
const VIEW_SWITCH = /(view|mode|show|details|expanded|open|enabled|verified|visible|active|selected|toggle|on)$/i;
const NOT_A_SWITCH = /(loading|fetching|checking|preparing|saving|submitting|pending|busy|error|disabled)|^(can|no|has)[A-Z]/i;
// Numbers that are positions, not quantities: pagination and indexes.
const NOT_A_QUANTITY = /^(page|pageNumber|pageSize|offset|index|tabIndex|step|limit)$|(Index|Page|PageSize)$/;

function motionFor(app: AppProgram, name: string, type: TS.Type): Motion | undefined {
  const { ts, checker } = app;
  if (type.flags & ts.TypeFlags.NumberLike) {
    return NOT_A_QUANTITY.test(name) ? undefined : { kind: 'number', hint: 'a number value: count it up from a smaller figure' };
  }
  if (type.flags & ts.TypeFlags.BooleanLike || (type.isUnion() && type.types.every((t) => t.flags & ts.TypeFlags.BooleanLike))) {
    return VIEW_SWITCH.test(name) && !NOT_A_SWITCH.test(name) ? { kind: 'toggle', hint: 'a steps value [false, true]: flip it' } : undefined;
  }
  if (type.isUnion() && type.types.every((t) => t.isStringLiteral())) {
    const steps = type.types.map((t) => (t as TS.StringLiteralType).value);
    return { kind: 'steps', steps, hint: `a steps value through ${steps.map((s) => `"${s}"`).join(', ')}` };
  }
  // A list of records with numbers (stats, collections, line items): scale them together with a
  // 0 to 1 value, so every figure grows in proportion.
  const element = checker.isArrayType(type) ? checker.getTypeArguments(type as TS.TypeReference)[0] : undefined;
  // A list of plain values (ids, names) has nothing to scale; neither does a list's own length.
  if (element && !(element.flags & ts.TypeFlags.Object)) return undefined;
  const record = element ?? (type.flags & ts.TypeFlags.Object && !checker.isArrayType(type) ? type : undefined);
  if (record) {
    const fields = record
      .getProperties()
      .filter((p) => checker.getTypeOfSymbol(p).flags & ts.TypeFlags.NumberLike)
      .map((p) => p.name);
    if (fields.length) {
      return {
        kind: 'scale',
        fields,
        hint: `${element ? 'a list' : 'a record'} with number fields ${fields.map((f) => `"${f}"`).join(', ')}: scale them with a 0 to 1 value`,
      };
    }
  }
  return undefined;
}

/** The module a JSX tag's component is imported from, as the source file wrote it. */
export function importedFrom(app: AppProgram, tag: TS.JsxTagNameExpression): string | undefined {
  const { ts, checker } = app;
  const symbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(tag) ? tag.expression : tag);
  const declaration = symbol?.declarations?.[0];
  if (!declaration) return undefined;
  let node: TS.Node | undefined = declaration;
  while (node && !ts.isImportDeclaration(node)) node = node.parent;
  return node && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
}

/** Every JSX element under `node`, in source order. */
export function jsxElements(app: AppProgram, node: TS.Node): (TS.JsxOpeningElement | TS.JsxSelfClosingElement)[] {
  const { ts } = app;
  const out: (TS.JsxOpeningElement | TS.JsxSelfClosingElement)[] = [];
  const visit = (n: TS.Node) => {
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) out.push(n);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return out;
}

/** A component tag starts with a capital letter, or is a member such as Card.Header. */
export function isComponentTag(app: AppProgram, tag: TS.JsxTagNameExpression): boolean {
  const { ts } = app;
  return ts.isPropertyAccessExpression(tag) || (ts.isIdentifier(tag) && /^[A-Z]/.test(tag.text));
}

export function tagName(tag: TS.JsxTagNameExpression): string {
  return tag.getText();
}
