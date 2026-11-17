export function createSearch({ python }) {
  return {
    propose(request, checkpoint, feedback, limit, ctx) {
      return python.execute('propose', { request, checkpoint, feedback, limit }, ctx);
    },
  };
}
