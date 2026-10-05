// fake-ai.js: stand-in for env.AI when SB_FAKE_AI === '1' (local tests; no neurons, no network).
// env.SB_FAKE_DELAY_MS: delay per call (default 800).
// env.SB_FAKE_FAIL: comma list of failure switches:
//   draft_invalid  every storyboard text call returns broken JSON (draft -> repair -> fallback -> failed)
//   draft_quota    storyboard text call throws a Workers AI daily-quota error
//   scene_invalid  / scene_quota  same for the scene rewrite call
//   img_quota      every image call throws a quota error
//   <job id>       that image job always fails (e.g. frame_2, ref_loc, anchor)
import { FAKE_DRAFT_V6, FAKE_JPEG_B64 } from "./fixtures.js";
import { SCENE_SYSTEM_V6 } from "./prompt.v6.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const QUOTA_MSG = "4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan";

export function createFakeAI(env) {
  const delay = Math.max(0, Number(env.SB_FAKE_DELAY_MS ?? 800) || 0);
  const fail = new Set(String(env.SB_FAKE_FAIL || "").split(",").map((s) => s.trim()).filter(Boolean));
  const usage = (o) => ({ prompt_tokens: 2000, completion_tokens: o, neurons: 1 });
  return {
    fake: true,
    async run(model, inputs) {
      await sleep(delay);
      const msgs = (inputs && inputs.messages) || [];
      const scene = msgs[0] && msgs[0].content === SCENE_SYSTEM_V6;
      if (fail.has(scene ? "scene_quota" : "draft_quota")) throw new Error(QUOTA_MSG);
      if (fail.has(scene ? "scene_invalid" : "draft_invalid")) {
        return { choices: [{ message: { content: '{"title": "kırık' }, finish_reason: "stop" }], usage: usage(20) };
      }
      let content;
      if (scene) {
        const m = /\(n=(\d+)\)/.exec(String(msgs[1] && msgs[1].content));
        const n = m ? Number(m[1]) : 1;
        const sc = { ...FAKE_DRAFT_V6.scenes[Math.min(n, FAKE_DRAFT_V6.scenes.length) - 1] };
        sc.title = `${sc.title} (yeniden yazıldı)`;
        content = JSON.stringify(sc);
      } else {
        content = JSON.stringify(FAKE_DRAFT_V6);
      }
      return { choices: [{ message: { content }, finish_reason: "stop" }], usage: usage(scene ? 400 : 3000) };
    },
    // Image path: the workflow calls ai.image(job) instead of kleinRun() when this exists.
    async image(job) {
      await sleep(delay);
      if (fail.has("img_quota")) throw new Error(QUOTA_MSG);
      if (fail.has(job.id)) throw new Error(`fake failure for ${job.id}`);
      return FAKE_JPEG_B64;
    },
  };
}
