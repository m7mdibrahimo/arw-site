// arw-site-static's script (wrangler.static.jsonc): «النشر السريع», see ./fast.js
import { handle } from "./fast.js";

export default {
  fetch(request, env, ctx) {
    return handle(request, env, ctx);
  },
};
