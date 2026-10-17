import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import ts from 'typescript';
import {expect,it} from 'vitest';

// LocationMessageCard's component tests exercise visible/hidden transitions.
// This guards the separate screen-level memo boundary that previously kept
// passing its initial false value despite a viewability/focus update.
it('invalidates the conversation list memo on viewport and navigation-focus changes',()=>{
  const source=ts.createSourceFile('Conversation.tsx',readFileSync(join(__dirname,'../src/screens/Conversation.tsx'),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let deps:ts.Expression|undefined;
  const visit=(node:ts.Node)=>{
    if(ts.isVariableDeclaration(node) && node.name.getText(source)==='body' && node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(source)==='useMemo')deps=node.initializer.arguments[1];
    ts.forEachChild(node,visit);
  };
  visit(source);
  expect(deps && ts.isArrayLiteralExpression(deps)).toBe(true);
  const names=deps && ts.isArrayLiteralExpression(deps)?deps.elements.map(node=>node.getText(source)):[];
  expect(names).toEqual(expect.arrayContaining(['visibleLocationIds','screenFocused']));
});
