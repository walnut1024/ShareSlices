export default {
  async queue(batch) {
    for (const message of batch.messages) {
      message.ack();
    }
  },

  async scheduled(_controller, _env, context) {
    context.waitUntil(Promise.resolve());
  },
};
