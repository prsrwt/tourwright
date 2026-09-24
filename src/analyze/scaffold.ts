// Drafts a stage from a page component: its own section components in page order, each wrapped in
// data-focus, with a typed props object per component whose placeholders come from the real prop
// types. The page's data fetching is left behind; the draft is a starting point for fixtures,
// never a finished stage, and it is type-checked so the gaps are listed.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import type * as TS from 'typescript5';
import { appProgram, AnalyzeError, type AppProgram } from './program.ts';
import { componentProps, isComponentTag, jsxElements, type PropInfo } from './props.ts';

export interface ScaffoldResult {
  file: string;
  stage: string;
  components: string[];
  skipped: string[];
  /** Type errors in the draft: placeholders that need real fixture data. */
  problems: string[];
}

interface Section {
  name: string;
  importLine: string;
  focus: string;
  condition?: string;
  props: PropInfo[];
  /** What the page passes each prop, as written, so fixtures can be modelled on it. */
  passed: Map<string, string>;
  /** Sections the page nests inside this one: it is a wrapper, such as a layout shell. */
  children: Section[];
}

/** Writes the draft to a scaffold folder next to the configured stages file, which it refers to. */
export function scaffoldStage(root: string, pageFile: string, stage: string, stagesFile: string): ScaffoldResult {
  const outDir = join(dirname(stagesFile), 'scaffold');
  const page = resolve(pageFile);
  if (!existsSync(page)) throw new AnalyzeError(`${pageFile} does not exist.`);
  const app = appProgram(root, [page]);
  const { ts } = app;
  const source = app.source(page);
  const jsx = mainJsx(app, source);
  if (!jsx) throw new AnalyzeError(`${pageFile} has no component that returns JSX.`);

  const out = join(outDir, `${stage}.tsx`);
  const prefix = /^[A-Z][a-z0-9]*/.exec(basename(page).replace(/\.[jt]sx?$/, ''))?.[0] ?? '';
  const skipped = new Set<string>();

  // Sections in page order. One nested inside another (a page inside a layout shell) becomes its
  // child, so the draft keeps the page's structure.
  const collect = (node: TS.Node, into: Section[]) => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const opening = ts.isJsxElement(node) ? node.openingElement : node;
      const section = isComponentTag(app, opening.tagName) ? sectionFor(app, opening, out, prefix, skipped) : undefined;
      if (section) {
        if (ts.isJsxElement(node)) for (const child of node.children) collect(child, section.children);
        into.push(section);
        return;
      }
    }
    ts.forEachChild(node, (child) => collect(child, into));
  };
  const sections: Section[] = [];
  collect(jsx, sections);
  const all = flatten(sections);
  if (!all.length) throw new AnalyzeError(`${pageFile} renders no components of its own to stage. Skipped: ${[...skipped].join(', ') || 'none'}.`);

  mkdirSync(outDir, { recursive: true });
  const posix = (path: string) => relative(root, path).replace(/\\/g, '/');
  writeFileSync(out, render(stage, posix(page), posix(stagesFile), sections));
  return { file: out, stage, components: all.map((s) => s.name), skipped: [...skipped], problems: typeProblems(root, out) };
}

function flatten(sections: Section[]): Section[] {
  return sections.flatMap((s) => [s, ...flatten(s.children)]);
}

/** The JSX the page's main component returns: the largest JSX return in the file. */
function mainJsx(app: AppProgram, source: TS.SourceFile): TS.Node | undefined {
  const { ts } = app;
  let best: TS.Node | undefined;
  let size = 0;
  const visit = (node: TS.Node) => {
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = unwrap(app, node.expression);
      if (ts.isJsxElement(expression) || ts.isJsxFragment(expression) || ts.isJsxSelfClosingElement(expression)) {
        const count = jsxElements(app, expression).length;
        if (count > size) {
          best = expression;
          size = count;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return best;
}

function unwrap(app: AppProgram, e: TS.Expression): TS.Expression {
  return app.ts.isParenthesizedExpression(e) ? unwrap(app, e.expression) : e;
}

function sectionFor(app: AppProgram, opening: TS.JsxOpeningElement | TS.JsxSelfClosingElement, out: string, prefix: string, skipped: Set<string>): Section | undefined {
  const { ts, checker } = app;
  const name = opening.tagName.getText();
  if (!ts.isIdentifier(opening.tagName)) {
    skipped.add(name);
    return undefined;
  }
  let symbol = checker.getSymbolAtLocation(opening.tagName);
  const local = symbol?.declarations?.[0];
  if (!local || !(ts.isImportSpecifier(local) || ts.isImportClause(local))) {
    skipped.add(`${name} (defined in the page, so it cannot be imported)`);
    return undefined;
  }
  if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
  const definedIn = symbol?.declarations?.[0]?.getSourceFile().fileName.replace(/\\/g, '/') ?? '';
  // Library components and the app's UI primitives (buttons, cards, dialogs) are not sections.
  if (definedIn.includes('/node_modules/') || /\/ui\/[^/]+$/.test(definedIn)) {
    skipped.add(name);
    return undefined;
  }

  const declaration = ts.isImportSpecifier(local) ? local.parent.parent.parent : local.parent;
  const specifier = (declaration.moduleSpecifier as TS.StringLiteral).text;
  const from = specifier.startsWith('.') ? relativeSpecifier(dirname(out), definedIn) : specifier;
  const importLine = ts.isImportSpecifier(local)
    ? `import { ${local.propertyName ? `${local.propertyName.text} as ${name}` : name} } from '${from}';`
    : `import ${name} from '${from}';`;

  const passed = new Map<string, string>();
  for (const attribute of opening.attributes.properties) {
    if (ts.isJsxAttribute(attribute)) {
      const init = attribute.initializer;
      passed.set(attribute.name.getText(), init ? (ts.isJsxExpression(init) ? (init.expression?.getText() ?? '') : init.getText()) : 'true');
    }
  }
  const focus = kebab(name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name);
  const condition = conditionOf(app, opening);
  return { name, importLine, focus, ...(condition && { condition }), props: componentProps(app, opening.tagName) ?? [], passed, children: [] };
}

/**
 * When the page shows this element only under a condition, the nearest one, as written. Outer
 * conditions (usually "not loading") repeat for every section and say nothing new.
 */
function conditionOf(app: AppProgram, node: TS.Node): string | undefined {
  const { ts } = app;
  let child = node;
  let parent = node.parent;
  while (parent && !ts.isFunctionLike(parent)) {
    if (ts.isConditionalExpression(parent) && child !== parent.condition) {
      const condition = parent.condition.getText().replace(/\s+/g, ' ');
      return child === parent.whenTrue ? condition : `not (${condition})`;
    }
    if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && child === parent.right) {
      return parent.left.getText().replace(/\s+/g, ' ');
    }
    child = parent;
    parent = parent.parent;
  }
  return undefined;
}

function render(stage: string, pageFile: string, stagesFile: string, sections: Section[]): string {
  const all = flatten(sections);
  const names = new Map<Section, string>();
  const used = new Map<string, number>();
  for (const section of all) {
    const base = `${camel(section.name)}Props`;
    const count = (used.get(base) ?? 0) + 1;
    used.set(base, count);
    names.set(section, count === 1 ? base : `${base}${count}`);
  }
  const movable = all.flatMap((s) => s.props.filter((p) => p.motion).map((p) => `//   ${s.name}.${p.name}: ${p.motion!.hint}`));

  const lines = [
    `// Drafted by "tourwright scaffold" from ${pageFile}.`,
    '//',
    '// The page fetches its data; a stage gets it from fixtures instead. Every value below is a',
    '// placeholder of the right type: replace each with fictional data that tells the story (made-up',
    '// names, round amounts, never real records), delete sections the video does not need, and add',
    `// this stage to ${stagesFile}. "What the page passes" comments show where each value comes`,
    '// from in the real page.',
    ...(movable.length ? ['//', '// Could move in a video (declare a value, pass it, and animate it from a beat):', ...movable] : []),
    '',
    "import type { ComponentProps } from 'react';",
    "import { defineStage } from 'tourwright/stage';",
    ...[...new Set(all.map((s) => s.importLine))],
    '',
    'const noop = () => undefined;',
    '',
  ];
  for (const section of all) {
    // A wrapper's children are the sections nested in it, so they are not part of its props.
    const type = section.children.length ? `Omit<ComponentProps<typeof ${section.name}>, 'children'>` : `ComponentProps<typeof ${section.name}>`;
    lines.push(`export const ${names.get(section)}: ${type} = {`);
    for (const prop of section.props) {
      if (prop.optional && !section.passed.has(prop.name)) continue;
      const was = section.passed.get(prop.name);
      const comment = was && !prop.handler ? `  // What the page passes: ${oneLine(was)}` : '';
      lines.push(`  ${safeKey(prop.name)}: ${prop.handler ? 'noop' : placeholder(prop)},${comment}`);
    }
    lines.push('};', '');
  }

  const jsx = (section: Section, indent: string): string[] => {
    const out: string[] = [];
    if (section.condition) out.push(`${indent}{/* The page shows this only when: ${oneLine(section.condition).replace(/\*\//g, '* /')} */}`);
    if (section.children.length) {
      // A wrapper (a layout shell, say) is not a target itself; the sections inside it are.
      out.push(`${indent}<${section.name} {...${names.get(section)}}>`);
      for (const child of section.children) out.push(...jsx(child, indent + '  '));
      out.push(`${indent}</${section.name}>`);
    } else {
      out.push(`${indent}<div data-focus="${section.focus}">`, `${indent}  <${section.name} {...${names.get(section)}} />`, `${indent}</div>`);
    }
    return out;
  };
  lines.push(`export const ${camel(stage)} = defineStage({`, '  render: () => (', "    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>");
  for (const section of sections) lines.push(...jsx(section, '      '));
  lines.push('    </div>', '  ),', '});', '');
  return lines.join('\n');
}

/**
 * A placeholder of the prop's type, for a person to replace. Simple types get a value that
 * type-checks; an object type gets {}, so the type check names every field still to fill in.
 */
function placeholder(prop: PropInfo): string {
  const type = prop.type;
  // A union of strings, even behind a type alias, starts on its first option.
  if (prop.motion?.kind === 'steps') return `'${prop.motion.steps[0]}'`;
  if (/(^|\| )null( \||$)/.test(type)) return 'null';
  if (/(^|\| )undefined( \||$)/.test(type)) return 'undefined';
  if (type === 'number') return '0';
  if (type === 'string') return "''";
  if (type === 'boolean' || type === 'false' || type === 'true') return 'false';
  const literal = /^"([^"]*)"/.exec(type);
  if (literal) return `'${literal[1]}'`;
  if (/\[\]$|^(readonly )?Array</.test(type)) return '[]';
  return `{} /* ${oneLine(type).replace(/\*\//g, '* /')}: fill in */`;
}

function typeProblems(root: string, file: string): string[] {
  const app = appProgram(root, [file]);
  return app.ts
    .getPreEmitDiagnostics(app.program, app.source(file))
    .map((d) => {
      const where = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : undefined;
      return `${where ? `line ${where.line + 1}: ` : ''}${app.ts.flattenDiagnosticMessageText(d.messageText, '\n').split('\n')[0]}`;
    });
}

function relativeSpecifier(fromDir: string, file: string): string {
  const path = relative(fromDir, file).replace(/\\/g, '/').replace(/\.(d\.ts|tsx?|jsx?)$/, '');
  return path.startsWith('.') ? path : `./${path}`;
}

function kebab(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

function camel(name: string): string {
  const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  return parts.map((p, i) => (i === 0 ? p[0]!.toLowerCase() + p.slice(1) : p[0]!.toUpperCase() + p.slice(1))).join('');
}

function safeKey(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`;
}

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > 90 ? `${flat.slice(0, 87)}...` : flat;
}
