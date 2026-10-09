import { createReadToolDefinition, createWriteToolDefinition, createEditToolDefinition, createBashToolDefinition } from '@earendil-works/pi-coding-agent';

export function createTools({ operations, box, Type }) {
  let executionDirectory;
  const tools = [createReadToolDefinition('/work', { operations }), createWriteToolDefinition('/work', { operations }), createEditToolDefinition('/work', { operations }),
    createBashToolDefinition('/work', { exposeSessionEnvironment: false, operations: { exec: async (command, _cwd, options) => box.run(['/bin/bash', '-c', command], { ...options, cwd: executionDirectory }) } })];
  const bash = tools.find(tool => tool.name === 'bash');
  bash.parameters = { ...bash.parameters, properties: { ...bash.parameters.properties, cwd: Type.Optional(Type.String({ description: '可选 /work 内执行子目录。仅此子树映射为沙箱 /work；不会复制主工作区的其他持久文件。', maxLength: 1000 })) } };
  // Pi owns schemas, exact edits, truncation and events. Only file/process I/O is adapted.
  return tools.map(tool => ({ ...tool, execute: async (call, args, signal, update, ctx) => {
    executionDirectory = tool.name === 'bash' ? args.cwd : undefined;
    try { return await tool.execute(call, args, signal, update, { ...ctx, cwd: '/work' }); } finally { executionDirectory = undefined; }
  } }));
}
