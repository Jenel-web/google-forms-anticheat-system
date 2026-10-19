// Numbers questions across the WHOLE form, not just the page on screen. Classic script (content scripts cannot import);
// loaded before content.js and unit-tested by evaluating this file in a plain context.
//
// Google Forms puts the form's structure in the page as `var FB_PUBLIC_LOAD_DATA_ = [...]`. The items live at data[1][1],
// each as [itemId, title, help, type, ...]. Every question on screen carries its item id in a `data-params` attribute.
// So the number of the question being looked at is its position among all the form's questions, on every page.
// Only item ids and types are read: no titles, no choices, no answers. Google's markup is unofficial; everything here
// fails soft (null), and the caller falls back to counting the items on the current page.
const EG_FORM = (() => {
  const NOT_A_QUESTION = [6, 8, 11, 12]; // title/description, section break, image, video
  const MAX_ITEMS = 500;

  // The JSON array that starts at text[start] (a '['), found by bracket matching that ignores brackets inside strings.
  function arrayAt(text, start) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (ch === '\\') i += 1;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '[') {
        depth += 1;
      } else if (ch === ']') {
        depth -= 1;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  }

  // Ids of the form's questions in order, from one script's text. null when this script is not the form's data.
  function parseOrder(text) {
    try {
      const at = String(text).indexOf('FB_PUBLIC_LOAD_DATA_');
      if (at < 0) return null;
      const open = text.indexOf('[', at);
      if (open < 0) return null;
      const json = arrayAt(text, open);
      if (!json) return null;
      const data = JSON.parse(json);
      const items = data && data[1] && data[1][1];
      if (!Array.isArray(items)) return null;
      const ids = items
        .filter((it) => Array.isArray(it) && Number.isSafeInteger(it[0]) && !NOT_A_QUESTION.includes(it[3]))
        .map((it) => it[0]);
      return ids.length ? ids.slice(0, MAX_ITEMS) : null;
    } catch {
      return null;
    }
  }

  function orderFromScripts(texts) {
    for (const t of texts) {
      if (typeof t === 'string' && t.includes('FB_PUBLIC_LOAD_DATA_')) {
        const order = parseOrder(t);
        if (order) return order;
      }
    }
    return null;
  }

  // The item id inside a data-params value such as `%.@.[1328757188,"Name",null,0,...`.
  function idFromParams(params) {
    const m = /^%\.@\.\[(\d{1,15}),/.exec(String(params || ''));
    return m ? Number(m[1]) : null;
  }

  // 1-based position of an item among the questions, or 0 when it is not one (a description, an image...).
  function numberFor(order, id) {
    const at = order && id !== null && id !== undefined ? order.indexOf(id) : -1;
    return at + 1;
  }

  return { parseOrder, orderFromScripts, idFromParams, numberFor, NOT_A_QUESTION };
})();
