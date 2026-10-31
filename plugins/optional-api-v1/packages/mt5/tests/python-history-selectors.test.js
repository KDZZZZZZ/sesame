import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Value } from '@sesame/plugin-sdk/schema/value';
import { PYTHON_TOOLS } from '../backend/python-tools.js';
import { nativeValueForLosslessIds } from '../backend/json.js';

const interval = { date_from: '2026-10-21T09:00:00Z', date_to: '2026-10-21T10:00:00Z' };
const orderId = '9007199254740993', positionId = '9007199254740995';
const histories = ['history_orders_get', 'history_deals_get'];
const schemaFor = name => PYTHON_TOOLS.find(tool => tool.name === name).inputSchema;

for (const name of histories) {
  test(`${name}: order ticket, position, and full interval are independent valid forms`, () => {
    const schema = schemaFor(name);
    for (const args of [{ ticket: orderId }, { position: positionId }, interval, { ...interval, group: '*,!EUR*' }]) {
      assert.equal(Value.Check(schema, args), true, JSON.stringify(args));
      assert.deepEqual(nativeValueForLosslessIds(schema, args), args, 'official preflight keeps the selector and exact ID');
    }
  });

  test(`${name}: empty, partial, and mixed selectors fail before native dispatch`, () => {
    const schema = schemaFor(name);
    for (const args of [
      {}, { group: 'EUR*' }, { date_from: interval.date_from }, { date_to: interval.date_to },
      { ticket: orderId, position: positionId }, { ticket: orderId, group: 'EUR*' }, { position: positionId, group: 'EUR*' },
      { ...interval, ticket: orderId }, { ...interval, position: positionId },
      { ticket: orderId, date_from: interval.date_from }, { position: positionId, date_to: interval.date_to },
      { order: orderId }, { deal: '9007199254740997' }, { ticket: orderId, unexpected: true },
    ]) {
      assert.equal(Value.Check(schema, args), false, JSON.stringify(args));
      assert.throws(() => nativeValueForLosslessIds(schema, args), /inputSchema/, JSON.stringify(args));
    }
  });

  test(`${name}: identity selectors require positive decimal text`, () => {
    for (const field of ['ticket', 'position']) {
      for (const value of ['', '0', '-1', '1.5', 'x', 42, null]) {
        assert.equal(Value.Check(schemaFor(name), { [field]: value }), false, `${field}=${value}`);
      }
    }
  });
}

test('history catalog identifies ticket as order identity and position as the corresponding position ID', () => {
  const deals = PYTHON_TOOLS.find(tool => tool.name === 'history_deals_get');
  assert.match(deals.inputSchema.properties.ticket.description, /DEAL_ORDER/);
  assert.match(deals.inputSchema.properties.ticket.description, /成交.*ticket|deal ticket/i);
  assert.match(deals.inputSchema.properties.position.description, /DEAL_POSITION_ID/);
  assert.match(PYTHON_TOOLS.find(tool => tool.name === 'history_orders_get').inputSchema.properties.position.description, /ORDER_POSITION_ID/);
});

test('actual Python dispatcher keeps identity selectors as integer keywords and ranges as UTC positional arguments', () => {
  // Execute only the production converter/dispatch AST with pure Python stand-ins.
  // Do not import the worker, MetaTrader5, numpy, application services, or storage.
  const script = `
import ast, datetime, json, sys
from pathlib import Path
from types import SimpleNamespace
tree=ast.parse(Path(sys.argv[1]).read_text(encoding='utf-8'))
declarations=[node for node in tree.body if isinstance(node,ast.Assign) and any(isinstance(target,ast.Name) and target.id in {'POSITIONAL','IDS','ENUMS'} for target in node.targets)]
converter=next(node for node in tree.body if isinstance(node,ast.FunctionDef) and node.name=='convert_input')
branch=next(node for node in ast.walk(tree) if isinstance(node,ast.If) and ast.unparse(node.test)=="name == 'initialize'")
while len(branch.orelse)==1 and isinstance(branch.orelse[0],ast.If): branch=branch.orelse[0]
dispatch=compile(ast.Module(body=branch.orelse,type_ignores=[]),'production-dispatch','exec')
calls=[]
def history(*args,**kwargs):
 calls.append({'args':[value.isoformat() for value in args], 'kwargs':{key:str(value) if key in ('ticket','position') else value for key,value in kwargs.items()}, 'types':{key:type(value).__name__ for key,value in kwargs.items()}})
 return ()
scope={'datetime':datetime,'mt5':SimpleNamespace(history_deals_get=history,history_orders_get=history)}
exec(compile(ast.Module(body=[*declarations,converter],type_ignores=[]),'production-converter','exec'),scope)
for case in json.load(sys.stdin):
 local={**scope,'name':case['name'],'args':scope['convert_input'](case['arguments'])}
 exec(dispatch,local)
print(json.dumps(calls))
`;
  const inputs = histories.flatMap(name => [
    { name, arguments: { ticket: orderId } }, { name, arguments: { position: positionId } },
    { name, arguments: { ...interval, group: 'EUR*' } }, { name, arguments: interval },
  ]);
  const result = spawnSync(process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
    ['-B', '-c', script, fileURLToPath(new URL('../backend/python-worker.py', import.meta.url))],
    { input: JSON.stringify(inputs), encoding: 'utf8', timeout: 5000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const calls = JSON.parse(result.stdout);
  assert.equal(calls.length, inputs.length, 'exactly one synthetic native call per query');
  const expected = [
    { args: [], kwargs: { ticket: orderId }, types: { ticket: 'int' } },
    { args: [], kwargs: { position: positionId }, types: { position: 'int' } },
    { args: ['2026-10-21T09:00:00+00:00', '2026-10-21T10:00:00+00:00'], kwargs: { group: 'EUR*' }, types: { group: 'str' } },
    { args: ['2026-10-21T09:00:00+00:00', '2026-10-21T10:00:00+00:00'], kwargs: {}, types: {} },
  ];
  assert.deepEqual(calls, [...expected, ...expected]);
});
