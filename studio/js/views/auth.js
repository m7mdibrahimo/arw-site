// Login, first-time setup and password reset.
import { api, saveSession, clearSession, IS_LOCAL } from '../api.js';
import { html, mount, $, icon, toast, esc } from '../ui.js';

const AUTH_BASE = 'https://arab-wrestling-auth.m7mdibrahimpc.workers.dev';

function shell(inner) {
  // The site's hero (arena photo) with one card in the middle
  return html`<div class="auth">
    <div class="auth-top">
      <img src="/assets/brand-logo.png?v=2" alt="">
      <h1>عرب <span>راسلنج</span></h1>
      <p>لوحة التحكم</p>
    </div>
    ${inner}
    <p class="auth-foot"><a href="/" class="link">الرجوع للموقع</a></p>
  </div>`;
}

export async function renderLogin(root, { onDone, reason } = {}) {
  let configured = true;
  try { configured = (await api.status()).configured; } catch (e) {
    mount(root, shell(html`<div class="auth-card"><h2>مش قادر أوصل للخادم</h2><p class="muted">${e.message}</p>
      ${IS_LOCAL ? html`<p class="muted small">شغّل الخادم المحلي للّوحة وحدّث الصفحة.</p>` : ''}
      <button class="btn btn-primary" onclick="location.reload()">حاول تاني</button></div>`));
    return;
  }
  if (!configured) return renderSetup(root, { onDone, first: true });

  mount(root, shell(html`<form class="auth-card" id="login-form" autocomplete="on" novalidate>
    <h2>تسجيل الدخول</h2>
    ${reason ? html`<div class="alert alert-info">${reason}</div>` : ''}
    <div class="alert alert-error" id="login-error" hidden></div>
    <label class="field"><span>اسم المستخدم أو الإيميل</span>
      <div class="input-ico">${icon('user')}<input class="input" name="username" id="login" autocomplete="username" required autocapitalize="off" spellcheck="false" dir="ltr"></div></label>
    <label class="field"><span>كلمة السر</span>
      <div class="input-ico">${icon('lock')}<input class="input" name="password" id="password" type="password" autocomplete="current-password" required dir="ltr">
      <button type="button" class="input-btn" id="toggle-pass" aria-label="إظهار كلمة السر">${icon('eye')}</button></div></label>
    <div class="auth-row">
      <label class="check"><input type="checkbox" id="remember" checked><span>تذكرني على الجهاز ده (٣٠ يوم)</span></label>
      <a href="#" id="forgot" class="link">نسيت كلمة السر؟</a>
    </div>
    <button class="btn btn-primary btn-lg btn-block" id="login-btn" type="submit">دخول</button>
    ${IS_LOCAL ? html`<p class="muted small center">نسخة تجريبية على جهازك — مفيش أي حاجة بتتغير على الموقع.</p>` : ''}
  </form>`));

  const pass = $('#password');
  $('#toggle-pass').onclick = () => {
    const show = pass.type === 'password';
    pass.type = show ? 'text' : 'password';
    $('#toggle-pass').innerHTML = show ? icon('eyeOff').__raw : icon('eye').__raw;
  };
  $('#forgot').onclick = (e) => { e.preventDefault(); renderSetup(root, { onDone, reset: true }); };
  $('#login').focus();
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('#login-error');
    err.hidden = true;
    const login = $('#login').value.trim(), password = pass.value;
    if (!login || !password) { err.textContent = 'اكتب اسم المستخدم وكلمة السر.'; err.hidden = false; return; }
    const btn = $('#login-btn');
    btn.disabled = true; btn.classList.add('loading');
    try {
      const remember = $('#remember').checked;
      const r = await api.login({ login, password, remember });
      saveSession({ token: r.token, user: r.user, remember });
      onDone && onDone(r.user);
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      pass.select();
    } finally { btn.disabled = false; btn.classList.remove('loading'); }
  };
}

/** GitHub sign-in popup, only to prove ownership (first setup and password reset). */
function githubToken() {
  return new Promise((resolve, reject) => {
    const w = window.open(`${AUTH_BASE}/auth?provider=github&site_id=${encodeURIComponent(location.hostname)}&scope=repo`, 'arw-github', 'width=620,height=720');
    if (!w) return reject(new Error('المتصفح منع النافذة. اسمح بالنوافذ المنبثقة للموقع وجرّب تاني.'));
    const timer = setInterval(() => { if (w.closed) { clearInterval(timer); window.removeEventListener('message', onMsg); reject(new Error('اتقفلت نافذة جيت هب قبل ما الدخول يكمل.')); } }, 600);
    function onMsg(e) {
      if (e.origin !== AUTH_BASE) return;
      if (e.data === 'authorizing:github') { w.postMessage('authorizing:github', e.origin); return; }
      const m = String(e.data || '').match(/^authorization:github:(success|error):([\s\S]*)$/);
      if (!m) return;
      clearInterval(timer);
      window.removeEventListener('message', onMsg);
      try { w.close(); } catch {}
      if (m[1] === 'success') { try { resolve(JSON.parse(m[2]).token); } catch { reject(new Error('رد غير مفهوم من جيت هب.')); } }
      else reject(new Error('جيت هب رفض الدخول.'));
    }
    window.addEventListener('message', onMsg);
  });
}

export function renderSetup(root, { onDone, first = false, reset = false } = {}) {
  mount(root, shell(html`<form class="auth-card" id="setup-form" novalidate>
    <h2>${first ? 'إنشاء حساب اللوحة' : 'تغيير كلمة السر'}</h2>
    <p class="muted">${first ? 'مرة واحدة بس: اختار اسم مستخدم وإيميل وكلمة سر. بعد كده هتدخل بيهم على طول.' : 'هنتأكد إنك صاحب الموقع بحساب جيت هب، وبعدين تختار كلمة سر جديدة. كل الأجهزة هيتعمل لها خروج.'}</p>
    <div class="alert alert-error" id="setup-error" hidden></div>
    <div class="step-own" id="own-box">
      ${IS_LOCAL
        ? html`<div class="alert alert-info">${icon('check')} نسخة تجريبية على جهازك: مش محتاج تأكيد ملكية.</div>`
        : html`<button type="button" class="btn btn-dark btn-block" id="gh-btn">${icon('shield')} تأكيد الملكية بحساب جيت هب</button>
               <p class="muted small">حساب جيت هب بيستخدم هنا مرة واحدة بس، عشان محدش غيرك يقدر يعمل الحساب.</p>`}
    </div>
    <label class="field"><span>اسمك <em>بيظهر في الترحيب — اختياري</em></span><input class="input" id="s-name" dir="auto" maxlength="40" placeholder="مثال: محمد"></label>
    <label class="field"><span>اسم المستخدم</span><input class="input" id="s-user" autocomplete="username" dir="ltr" placeholder="مثال: mohamed" autocapitalize="off" spellcheck="false"></label>
    <label class="field"><span>الإيميل</span><input class="input" id="s-mail" type="email" autocomplete="email" dir="ltr" placeholder="name@example.com"></label>
    <label class="field"><span>كلمة السر</span><div class="input-ico">${icon('lock')}<input class="input" id="s-pass" type="password" autocomplete="new-password" dir="ltr"></div>
      <div class="meter"><i id="meter"></i></div><small class="muted" id="meter-text">٨ حروف على الأقل، فيها حروف وأرقام</small></label>
    <label class="field"><span>أكّد كلمة السر</span><input class="input" id="s-pass2" type="password" autocomplete="new-password" dir="ltr"></label>
    <button class="btn btn-primary btn-lg btn-block" id="setup-btn" type="submit">${first ? 'إنشاء الحساب' : 'حفظ كلمة السر'}</button>
    ${!first ? html`<a href="#" class="link center block" id="back-login">رجوع لتسجيل الدخول</a>` : ''}
  </form>`));

  let ghToken = '';
  const err = $('#setup-error');
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  const ghBtn = $('#gh-btn');
  if (ghBtn) ghBtn.onclick = async () => {
    ghBtn.disabled = true;
    try {
      ghToken = await githubToken();
      $('#own-box').innerHTML = `<div class="alert alert-ok">${icon('check').__raw} تم تأكيد الملكية.</div>`;
    } catch (e) { fail(e.message); ghBtn.disabled = false; }
  };
  const back = $('#back-login');
  if (back) back.onclick = (e) => { e.preventDefault(); renderLogin(root, { onDone }); };
  $('#s-pass').oninput = () => {
    const p = $('#s-pass').value;
    let score = 0;
    if (p.length >= 8) score++; if (p.length >= 12) score++;
    if (/\d/.test(p) && /[A-Za-z؀-ۿ]/.test(p)) score++;
    if (/[^A-Za-z0-9؀-ۿ]/.test(p)) score++;
    $('#meter').style.width = `${score * 25}%`;
    $('#meter').dataset.level = String(score);
    $('#meter-text').textContent = ['ضعيفة جدا', 'ضعيفة', 'متوسطة', 'قوية', 'قوية جدا'][score];
  };
  $('#setup-form').onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    const username = $('#s-user').value.trim(), email = $('#s-mail').value.trim(), password = $('#s-pass').value;
    if (password !== $('#s-pass2').value) return fail('كلمتين السر مش زي بعض.');
    if (!IS_LOCAL && !ghToken) return fail('أكّد الملكية بحساب جيت هب الأول.');
    const btn = $('#setup-btn');
    btn.disabled = true; btn.classList.add('loading');
    try {
      await api.setup({ githubToken: ghToken, username, email, password, displayName: $('#s-name').value.trim() });
      const r = await api.login({ login: username, password, remember: true });
      saveSession({ token: r.token, user: r.user, remember: true });
      toast(first ? 'تم إنشاء الحساب. أهلا بيك!' : 'تم تغيير كلمة السر.');
      onDone && onDone(r.user);
    } catch (ex) { fail(ex.message); } finally { btn.disabled = false; btn.classList.remove('loading'); }
  };
}

/** A member signed in with the temporary password the owner gave them: they choose their own first. */
export function renderForceChange(root, user, onDone) {
  mount(root, shell(html`<form class="auth-card" id="fc-form" novalidate>
    <h2>اختار كلمة سر خاصة بيك</h2>
    <p class="muted">أهلا ${user.displayName || user.username}. كلمة السر اللي معاك مؤقتة من صاحب الموقع، ولازم تغيّرها قبل ما تدخل. محدش هيعرف الجديدة غيرك.</p>
    <div class="alert alert-error" id="fc-error" hidden></div>
    <label class="field"><span>كلمة السر المؤقتة</span><input class="input" id="fc-cur" type="password" autocomplete="current-password" dir="ltr"></label>
    <label class="field"><span>كلمة السر الجديدة</span><div class="input-ico">${icon('lock')}<input class="input" id="fc-new" type="password" autocomplete="new-password" dir="ltr"></div>
      <small class="muted">٨ حروف على الأقل، فيها حروف وأرقام</small></label>
    <label class="field"><span>أكّد الجديدة</span><input class="input" id="fc-new2" type="password" autocomplete="new-password" dir="ltr"></label>
    <button class="btn btn-primary btn-lg btn-block" id="fc-btn" type="submit">حفظ والدخول</button>
    <a href="#" class="link center block" id="fc-out">خروج</a>
  </form>`));
  const err = $('#fc-error');
  $('#fc-cur').focus();
  $('#fc-out').onclick = async (e) => {
    e.preventDefault();
    try { await api.logout(); } catch {}
    clearSession(); location.reload();
  };
  $('#fc-form').onsubmit = async (e) => {
    e.preventDefault();
    err.hidden = true;
    if ($('#fc-new').value !== $('#fc-new2').value) { err.textContent = 'كلمتين السر الجديدة مش زي بعض.'; err.hidden = false; return; }
    const btn = $('#fc-btn'); btn.disabled = true; btn.classList.add('loading');
    try {
      const r = await api.changePassword({ current: $('#fc-cur').value, next: $('#fc-new').value });
      let remember = false;
      try { remember = !!localStorage.getItem('arw_studio_token'); } catch {}
      saveSession({ token: r.token, user: r.user, remember });
      toast('اتحفظت كلمة السر. أهلا بيك!');
      onDone(r.user);
    } catch (ex) { err.textContent = ex.message; err.hidden = false; }
    finally { btn.disabled = false; btn.classList.remove('loading'); }
  };
}
