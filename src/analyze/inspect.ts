// What a stage is made of: the components its render function uses, each prop's type and what the
// stage passes it, and the props that could move in a video. Read from the types, so an agent
// plans against the real components rather than guessing.

import type * as TS from 'typescript5';
import { appProgram, AnalyzeError, type AppProgram } from './program.ts';
import { componentProps, importedFrom, isComponentTag, jsxElements, tagName, type PropInfo } from './props.ts';

export interface UsedProp extends PropInfo {
  /** What the stage passes, as written, when it passes it. */
  passed?: string;
}

export interface UsedComponent {
  name: string;
  from?: string;
  props: UsedProp[];
}

export interface StageInspection {
  stage: string;
  file: string;
  /** Values the stage declares, as written. */
  values: string[];
  components: UsedComponent[];
}

export function inspectStage(root: string, stagesFile: string, stage: string): StageInspection {
  const app = appProgram(root, [stagesFile]);
  const found = findStage(app, app.source(stagesFile), stage, new Set());
  if (!found) {
    const names = stageNames(app, app.source(stagesFile), new Set());
    throw new AnalyzeError(`There is no stage "${stage}" in ${stagesFile}. Stages: ${names.map((n) => `"${n}"`).join(', ') || 'none'}.`);
  }
  const { ts } = app;
  const values: string[] = [];
  const valuesProp = found.properties.find((p) => propertyName(app, p) === 'values');
  if (valuesProp && ts.isPropertyAssignment(valuesProp) && ts.isObjectLiteralExpression(valuesProp.initializer)) {
    for (const v of valuesProp.initializer.properties) values.push(v.getText());
  }
  const render = found.properties.find((p) => propertyName(app, p) === 'render');
  if (!render) throw new AnalyzeError(`Stage "${stage}" has no render function.`);

  const components: UsedComponent[] = [];
  const seen = new Set<string>();
  for (const element of jsxElements(app, render)) {
    if (!isComponentTag(app, element.tagName)) continue;
    const name = tagName(element.tagName);
    if (seen.has(name)) continue;
    seen.add(name);
    const props = componentProps(app, element.tagName) ?? [];
    const passed = new Map<string, string>();
    for (const attribute of element.attributes.properties) {
      if (ts.isJsxAttribute(attribute) && attribute.initializer) {
        const text = ts.isJsxExpression(attribute.initializer) ? (attribute.initializer.expression?.getText() ?? '') : attribute.initializer.getText();
        passed.set(attribute.name.getText(), shorten(text));
      } else if (ts.isJsxAttribute(attribute)) {
        passed.set(attribute.name.getText(), 'true');
      }
    }
    const from = importedFrom(app, element.tagName);
    components.push({
      name,
      ...(from && { from }),
      props: props.map((p) => ({ ...p, ...(passed.has(p.name) && { passed: passed.get(p.name)! }) })),
    });
  }
  return { stage, file: found.getSourceFile().fileName, values, components };
}

/** The stage's definition object: { values, render, targets }. Follows spreads into other files. */
function findStage(app: AppProgram, file: TS.SourceFile, stage: string, visited: Set<TS.Node>): TS.ObjectLiteralExpression | undefined {
  const stages = stagesObject(app, file);
  return stages ? findIn(app, stages, stage, visited) : undefined;
}

function findIn(app: AppProgram, object: TS.ObjectLiteralExpression, stage: string, visited: Set<TS.Node>): TS.ObjectLiteralExpression | undefined {
  const { ts } = app;
  if (visited.has(object)) return undefined;
  visited.add(object);
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property) && propertyName(app, property) === stage) return definitionObject(app, property.initializer);
    if (ts.isSpreadAssignment(property)) {
      const spread = resolveObject(app, property.expression);
      const found = spread && findIn(app, spread, stage, visited);
      if (found) return found;
    }
  }
  return undefined;
}

function stageNames(app: AppProgram, file: TS.SourceFile, visited: Set<TS.Node>): string[] {
  const { ts } = app;
  const collect = (object: TS.ObjectLiteralExpression): string[] => {
    if (visited.has(object)) return [];
    visited.add(object);
    return object.properties.flatMap((p) => {
      if (ts.isPropertyAssignment(p)) return [propertyName(app, p) ?? ''];
      if (ts.isSpreadAssignment(p)) {
        const spread = resolveObject(app, p.expression);
        return spread ? collect(spread) : [];
      }
      return [];
    });
  };
  const stages = stagesObject(app, file);
  return stages ? collect(stages).filter(Boolean) : [];
}

/** The object passed to `export default defineStages({ ... })`, or exported directly. */
function stagesObject(app: AppProgram, file: TS.SourceFile): TS.ObjectLiteralExpression | undefined {
  const { ts } = app;
  for (const statement of file.statements) {
    if (ts.isExportAssignment(statement)) return resolveObject(app, statement.expression);
  }
  return undefined;
}

/** Unwraps defineStages(...)/defineStage(...) calls, `as` and `satisfies`, and identifiers bound to objects. */
function resolveObject(app: AppProgram, expression: TS.Expression): TS.ObjectLiteralExpression | undefined {
  const { ts, checker } = app;
  let e: TS.Expression = expression;
  for (;;) {
    if (ts.isObjectLiteralExpression(e)) return e;
    if (ts.isCallExpression(e) && e.arguments[0]) e = e.arguments[0];
    else if (ts.isAsExpression(e) || ts.isSatisfiesExpression(e) || ts.isParenthesizedExpression(e)) e = e.expression;
    else if (ts.isIdentifier(e)) {
      let symbol = checker.getSymbolAtLocation(e);
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
      const declaration = symbol?.declarations?.[0];
      if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) e = declaration.initializer;
      else return undefined;
    } else return undefined;
  }
}

function definitionObject(app: AppProgram, expression: TS.Expression): TS.ObjectLiteralExpression | undefined {
  return resolveObject(app, expression);
}

function propertyName(app: AppProgram, property: TS.ObjectLiteralElementLike): string | undefined {
  const { ts } = app;
  const name = property.name;
  if (!name) return undefined;
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return name.getText();
}

function shorten(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 70 ? `${flat.slice(0, 67)}...` : flat;
}

export function formatInspection(inspection: StageInspection, targets: readonly string[] | undefined): string {
  const lines = [`Stage "${inspection.stage}" (${inspection.file})`, ''];
  if (targets) lines.push(`Targets: ${targets.length ? targets.join(', ') : 'none yet. Wrap sections in <div data-focus="name">.'}`, '');
  lines.push(inspection.values.length ? 'Values:' : 'Values: none declared.');
  for (const v of inspection.values) lines.push(`  ${v.replace(/\s+/g, ' ')}`);
  lines.push('', 'Components, in the order the stage renders them:');
  const movable: string[] = [];
  for (const c of inspection.components) {
    lines.push(`  ${c.name}${c.from ? `  (${c.from})` : ''}`);
    for (const p of c.props) {
      const passed = p.passed !== undefined ? `= ${p.passed}` : p.optional ? '(optional, not passed)' : '(REQUIRED, not passed)';
      lines.push(`    ${`${p.name}${p.optional ? '?' : ''}`.padEnd(24)} ${shorten(p.type).padEnd(28)} ${p.handler ? '(handler)' : passed}`);
      if (p.motion) movable.push(`  ${c.name}.${p.name}: ${p.motion.hint}`);
    }
  }
  lines.push('', movable.length ? 'Could move in a video:' : 'No props that could obviously move.', ...movable);
  return lines.join('\n');
}
