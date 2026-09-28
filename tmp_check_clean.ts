import { preprocessEmailReply } from "./supabase/functions/_shared/reply-text.ts";
import { ReadableStream } from "node:stream/web";

const data = await Deno.readTextFile("/home/ubuntu/.cursor/projects/workspace/uploads/fixtures/01-sourceco-browning.json");
const fx = JSON.parse(data);
const latest = fx.request.thread_history[3].content as string;
function testClean(content: string) {
  let s = preprocessEmailReply(content);
  const cuts:number[]=[];
  const idxFrom = s.search(/^\s*From:\s/im);
  const idxConf = s.search(/\bCONFIDENTIALITY NOTICE\b/i);
  const idxFwd = s.search(/-{2,}\s*(Forwarded message|Original Message)\s*-{2,}/i);
  cuts.push(idxFrom, idxConf, idxFwd);
  const valid = cuts.filter(n=>n>=0);
  let sliced = s;
  if (valid.length) {
    const cut = Math.min(...valid);
    sliced = s.slice(0,cut).trim();
  }
  console.log("orig len", content.length);
  console.log("after preprocess len", s.length);
  console.log("idxFrom", idxFrom, "idxConf", idxConf, "idxFwd", idxFwd);
  console.log("sliced len", sliced.length);
  console.log("sliced head:\n", sliced.slice(0,400));
}
testClean(latest);

