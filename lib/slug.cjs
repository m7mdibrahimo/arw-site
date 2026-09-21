function arabicSlug(str) {
  if (!str) return "";
  return str
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[؟،؛«»"'`\u060C\u061B\u061F\?\,\;\:\!\(\)\[\]\{\}]/g, '')
    .replace(/[\.\_\/\\]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0600-\u06FF\-]/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

module.exports = { arabicSlug };
