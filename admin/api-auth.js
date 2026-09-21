(() => {
  const nativeFetch = window.fetch.bind(window);
  const workerOrigin = 'https://arw-site-bot.m7mdibrahimpc.workers.dev';
  window.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (url.origin === workerOrigin && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      let user;
      try { user = JSON.parse(localStorage.getItem('netlify-cms-user') || 'null'); } catch (_) {}
      const token = user?.token;
      if (!token) throw new Error('افتح لوحة الإدارة /admin/ وسجّل الدخول بحساب GitHub، ثم ارجع إلى هذه الصفحة.');
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
      headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
    return nativeFetch(input, init);
  };
})();
