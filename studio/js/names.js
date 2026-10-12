// A name never says the same thing twice in a row (owner 2026-10-12: «TNA TNA Bound For Glory» — «متتكررش تاني ابدا في
// اي حاجة», INCIDENTS #462). A phrase of two to six words said twice in a row is always a slip; one word twice only when it
// is a promotion's initials («TNA TNA», «WWE WWE») or a word a show's name is built from («عرض عرض»): «Bang Bang Gang»
// stays. The same rules are in lib/names.cjs for the site build (a test keeps the two equal).
const SINGLE_AR = new Set(['عرض', 'ملخص', 'مترجم', 'برنامج', 'حلقة', 'نتائج', 'كامل', 'اتحاد']);
const isInitials = (w) => /^[A-Z][A-Z0-9&]{1,7}$/.test(w);
export function collapseRepeatedNames(input) {
  if (typeof input !== 'string' || !input.trim()) return input;
  let s = input, prev;
  do {
    prev = s;
    s = s.replace(/(^|\s)((?:\S+\s+){1,5}\S+)\s+\2(?=\s|$)/giu, '$1$2');
    s = s.replace(/(^|\s)(\S+)((?:\s+\2)+)(?=\s|$)/giu, (m, pre, w) => (isInitials(w.toUpperCase()) && w === w.toUpperCase()) || SINGLE_AR.has(w) ? pre + w : m);
  } while (s !== prev);
  return s;
}
/** The fields that are names: what a show, recap, story or programme is called. */
export const NAME_FIELDS = ['title', 'headline', 'program_name', 'library_federation'];
