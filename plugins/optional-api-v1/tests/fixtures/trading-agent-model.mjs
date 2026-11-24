let sequence = 0;

export function respond(response, text, tool) {
  const delta = tool ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_manual_fixture_${++sequence}`, type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.arguments) } }] } : { role: 'assistant', content: text };
  const chunk = (value, reason) => JSON.stringify({ id: 'trading-decision-fixture', object: 'chat.completion.chunk', created: 1, model: 'fixture', choices: [{ index: 0, delta: value, finish_reason: reason }] });
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  response.end(`data: ${chunk(delta, null)}\n\ndata: ${chunk({}, tool ? 'tool_calls' : 'stop')}\n\ndata: [DONE]\n\n`);
}

export function taskInput(body) {
  const message = body.messages.filter(value => value.role === 'user').at(-1)?.content;
  const text = typeof message === 'string' ? message : message?.map(part => part.text ?? '').join('');
  const marker = '\n\nInput JSON:\n';
  const offset = text?.lastIndexOf(marker) ?? -1;
  return offset < 0 ? null : JSON.parse(text.slice(offset + marker.length));
}

export function toolResponses(body) {
  const calls = new Map(body.messages.flatMap(message => message.tool_calls ?? []).map(call => [call.id, call.function.name]));
  return body.messages.filter(message => message.role === 'tool').map(message => {
    const text = typeof message.content === 'string' ? message.content : message.content.map(part => part.text ?? '').join('');
    return { name: calls.get(message.tool_call_id), value: JSON.parse(text) };
  });
}
