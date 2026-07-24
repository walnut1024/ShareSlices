export class ProbeObject {
  constructor(state) {
    this.state = state;
  }
}

export default {
  async fetch() {
    return new Response("not-routed", {status: 404});
  },
};
