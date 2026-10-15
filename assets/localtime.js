// «بتوقيت بلدك» (owner 2026-10-15: «اي حد فاتح في بلد الوقت يتغير حسب دولته … لو المتابع فاتح من السعودية الوقت ال يكون
// قدامه يكون توقيت السعودية»). A weekly time set in the show's own zone (data-at="America/New_York|1|20:00": the zone,
// the day 0 Sunday … 6 Saturday, the hour) is shown in the visitor's: the device's own zone, so nobody has to say where
// they are, and summer time on either side is counted. The page keeps Makkah time when the browser can't do it.
// Used by the federation guides (_includes/federation-guide.njk).
(function () {
  'use strict';
  var all = document.querySelectorAll('[data-at]');
  if (!all.length || !window.Intl || !Intl.DateTimeFormat) return;
  var EN = document.documentElement.lang === 'en';
  var here = '';
  try { here = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) {}
  if (!here) return;

  // the zone's country, said by name where it's one of the site's readers' usual ones
  var ZONES = {
    'Asia/Riyadh': ['السعودية', 'Saudi Arabia'], 'Africa/Cairo': ['مصر', 'Egypt'], 'Asia/Dubai': ['الإمارات', 'the UAE'],
    'Asia/Kuwait': ['الكويت', 'Kuwait'], 'Asia/Qatar': ['قطر', 'Qatar'], 'Asia/Bahrain': ['البحرين', 'Bahrain'],
    'Asia/Muscat': ['عمان', 'Oman'], 'Asia/Amman': ['الأردن', 'Jordan'], 'Asia/Beirut': ['لبنان', 'Lebanon'],
    'Asia/Damascus': ['سوريا', 'Syria'], 'Asia/Baghdad': ['العراق', 'Iraq'], 'Asia/Gaza': ['فلسطين', 'Palestine'],
    'Asia/Hebron': ['فلسطين', 'Palestine'], 'Asia/Aden': ['اليمن', 'Yemen'], 'Africa/Tripoli': ['ليبيا', 'Libya'],
    'Africa/Tunis': ['تونس', 'Tunisia'], 'Africa/Algiers': ['الجزائر', 'Algeria'], 'Africa/Casablanca': ['المغرب', 'Morocco'],
    'Africa/El_Aaiun': ['المغرب', 'Morocco'], 'Africa/Khartoum': ['السودان', 'Sudan'], 'Africa/Nouakchott': ['موريتانيا', 'Mauritania'],
    'Africa/Djibouti': ['جيبوتي', 'Djibouti'], 'Africa/Mogadishu': ['الصومال', 'Somalia'], 'Indian/Comoro': ['جزر القمر', 'Comoros'],
    'Asia/Jerusalem': ['فلسطين', 'Palestine'], 'Europe/Istanbul': ['تركيا', 'Turkey'], 'Europe/London': ['بريطانيا', 'the UK'],
    'Europe/Paris': ['فرنسا', 'France'], 'Europe/Berlin': ['ألمانيا', 'Germany'], 'Europe/Amsterdam': ['هولندا', 'the Netherlands'],
    'Europe/Brussels': ['بلجيكا', 'Belgium'], 'Europe/Madrid': ['إسبانيا', 'Spain'], 'Europe/Rome': ['إيطاليا', 'Italy'],
    'Europe/Stockholm': ['السويد', 'Sweden'], 'America/New_York': ['شرق أمريكا', 'US Eastern'], 'America/Toronto': ['كندا', 'Canada']
  };
  var place = ZONES[here];
  var label = EN ? (place ? place[1] + ' time' : 'your local time') : (place ? 'بتوقيت ' + place[0] : 'بتوقيتك المحلي');

  // what the clock reads in a zone at a moment
  function parts(tz, t) {
    var o = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' })
      .formatToParts(new Date(t)).forEach(function (p) { o[p.type] = p.value; });
    return o;
  }
  function offset(tz, t) { var p = parts(tz, t); return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(t / 60000) * 60000; }
  var WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // the next time that zone's clock shows this day and hour
  function next(tz, day, hh, mm) {
    var now = Date.now(), p = parts(tz, now);
    var ahead = (day - WD[p.weekday] + 7) % 7;
    var wall = Date.UTC(+p.year, +p.month - 1, +p.day + ahead, hh, mm);
    var t = wall - offset(tz, wall);
    return wall - offset(tz, t);
  }
  var DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  var KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  function say(t) {
    var p = parts(here, t), h = +p.hour % 24, m = String(+p.minute).padStart(2, '0'), d = WD[p.weekday];
    if (EN) return new Intl.DateTimeFormat('en-GB', { timeZone: here, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(t));
    var part = h < 5 ? 'فجر' : h < 12 ? 'صباح' : h < 15 ? 'ظهر' : h < 18 ? 'عصر' : 'مساء';
    return ((h % 12) || 12) + ':' + m + ' ' + part + ' ' + DAYS[d];
  }

  var days = document.getElementById('fgDays'), moved = false;
  Array.prototype.forEach.call(all, function (el) {
    var a = String(el.getAttribute('data-at')).split('|'), hm = (a[2] || '').split(':');
    if (a.length !== 3 || hm.length !== 2) return;
    var t;
    try { t = next(a[0], +a[1], +hm[0], +hm[1]); } catch (e) { return; }
    if (!isFinite(t)) return;
    if (el.tagName === 'EM') {
      // the week's strip: each show under the visitor's own day
      var col = days && days.querySelector('[data-day="' + KEYS[WD[parts(here, t).weekday]] + '"]');
      if (col && col !== el.parentNode) { col.appendChild(el); moved = true; }
      return;
    }
    el.textContent = say(t);
    var dt = el.previousElementSibling;
    if (dt && dt.classList.contains('fg-local-dt')) dt.textContent = EN ? label.charAt(0).toUpperCase() + label.slice(1) : label;
  });
  // a Makkah time with no hour to turn («فجر الثلاثاء») would mix two zones on one page: left out
  Array.prototype.forEach.call(document.querySelectorAll('dd.mecca:not([data-at])'), function (dd) { if (dd.parentNode) dd.parentNode.style.display = 'none'; });
  if (moved) Array.prototype.forEach.call(days.children, function (c) { c.classList.toggle('has', !!c.querySelector('em')); });
  var sub = document.getElementById('fgWeekSub');
  if (sub) {
    var mark = sub.getAttribute('data-mark') || '';
    sub.textContent = '';
    sub.appendChild(document.createTextNode(EN ? 'The ' : 'أسبوع '));
    var b = document.createElement('bdi'); b.textContent = mark; sub.appendChild(b);
    sub.appendChild(document.createTextNode(EN ? ' week, day by day, in ' + label + '.' : ' يوما بيوم، ' + label + '.'));
  }
  var note = document.getElementById('fgTimesNote');
  if (note) note.textContent = note.textContent.replace('بتوقيت مكة المكرمة', label).replace(/in Makkah time/i, 'in ' + label);
})();
