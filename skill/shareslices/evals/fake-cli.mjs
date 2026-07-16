#!/usr/bin/env node
import { appendFileSync } from "node:fs";

const argv = process.argv.slice(2);
if (process.env.SHARESLICES_EVAL_CAPTURE) {
  appendFileSync(process.env.SHARESLICES_EVAL_CAPTURE, `${JSON.stringify({argv, env: {promptDisabled: process.env.SHARESLICES_PROMPT_DISABLED ?? null}})}\n`);
}
if (argv.join(" ") === "--agent capabilities") {
  console.log(JSON.stringify({protocolVersion:1,cliVersion:"0.2.0",supportedProtocolVersions:[1],operations:["artifact.publish_local","auth.login","auth.status","auth.logout","artifact.list","artifact.upload","artifact.publish","artifact.unpublish","artifact.delete","artifact.publication.view","artifact.publication.edit","artifact.export","artifact.gallery.view","artifact.gallery.share","artifact.gallery.update","artifact.gallery.withdraw"]}));
  process.exit(0);
}
const operation = argv.includes("gallery") ? `artifact.gallery.${["share","update","withdraw"].find((value) => argv.includes(value)) ?? "view"}` :
  argv.includes("publish") && !argv.includes("artifact") ? "artifact.publish_local" :
  argv.includes("login") ? "auth.login" : argv.includes("upload") ? "artifact.upload" :
  argv.includes("unpublish") ? "artifact.unpublish" : argv.includes("export") ? "artifact.export" : "artifact.list";
console.log(JSON.stringify({protocolVersion:1,cliVersion:"0.2.0",operation,outcome:"completed",resources:{},data:{}}));
