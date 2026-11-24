import { capability } from '@sesame/plugin-sdk/capabilities';

export function createCapabilities(host) {
  const nav = host.workflows;
  const handlers = {
    workflow_status: input => nav.view(input),
    workflow_plan: input => nav[input.action](input),
    workflow_step: input => nav.report(input),
  };
  return Object.entries(handlers).map(([name, handler]) => capability(name, async (input, signal) => {
    signal?.throwIfAborted();
    const view = await handler(input ?? {});
    if (view.error) {
      const {code,vars} = view.error;
      return {...view,error:{code,message:{code:'error.'+code+'.message',vars},fix:{code:'error.'+code+'.fix',vars}}};
    }
    return view;
  }));
}
