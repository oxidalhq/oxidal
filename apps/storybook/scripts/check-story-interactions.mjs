import { globSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// A later Story.play assignment silently replaces the first scenario before
// Storybook indexes it. Report both locations so each workflow gets its own story.
const src = fileURLToPath(
  new URL('../../../packages/ui/src/', import.meta.url),
);
for (const file of globSync('**/*.stories.tsx', { cwd: src })) {
  const ast = ts.createSourceFile(
    file,
    readFileSync(`${src}/${file}`, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const definitions = new Map();
  function record(name, node) {
    const line = ast.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (definitions.has(name)) {
      console.error(
        `${file}:${line} overwrites the play function for ${name} defined on line ${definitions.get(name)}`,
      );
      process.exitCode = 1;
    }
    definitions.set(name, line);
  }
  for (const statement of ast.statements) {
    if (
      ts.isExpressionStatement(statement) &&
      ts.isBinaryExpression(statement.expression)
    ) {
      const { left, operatorToken } = statement.expression;
      if (
        operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        left.name.text === 'play'
      )
        record(left.expression.text, left);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          !ts.isIdentifier(declaration.name) ||
          !declaration.initializer ||
          !ts.isObjectLiteralExpression(declaration.initializer)
        )
          continue;
        for (const property of declaration.initializer.properties) {
          if (
            property.name &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            property.name.text === 'play'
          )
            record(declaration.name.text, property);
        }
      }
    }
  }
}
