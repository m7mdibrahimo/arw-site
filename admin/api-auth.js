(() => {
  const nativeFetch = window.fetch.bind(window);
  const workerOrigin = 'https://arw-site-bot.m7mdibrahimpc.workers.dev';
  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === workerOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      // Decap CMS 3.x stores the session under 'decap-cms-user'; older
      // versions (and the name this file was originally written against)
      // used 'netlify-cms-user'. Check both so a login never silently fails
      // to be recognized just because the CMS package was upgraded.
      let token;
      for (const key of ['decap-cms-user', 'netlify-cms-user']) {
        try {
          const user = JSON.parse(localStorage.getItem(key) || 'null');
          if (user?.token) { token = user.token; break; }
        } catch (_) {}
      }
      if (!token) throw new Error('افتح لوحة الإدارة /admin/ وسجّل الدخول بحساب GitHub، ثم ارجع إلى هذه الصفحة.');
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
    return nativeFetch(input, init);
  };
})();
