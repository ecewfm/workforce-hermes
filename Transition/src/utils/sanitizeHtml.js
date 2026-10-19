// Cleans rich-text HTML (announcements) before it's stored or rendered with
// dangerouslySetInnerHTML.
//
// The announcement editor is a contenteditable with Bold / Italic / Underline /
// bullet list, but a paste can bring in anything — so only plain formatting
// survives. No scripts, iframes, forms, images, SVG, inline styles, classes,
// ids or event handlers. Links keep only http(s) / mailto / tel targets and
// always open in a new tab with rel="noopener noreferrer".
import DOMPurify from "dompurify";

const CONFIG = {
  ALLOWED_TAGS: [
    "p", "div", "span", "br", "hr",
    "b", "strong", "i", "em", "u", "s", "strike", "del", "ins", "sub", "sup", "mark", "small",
    "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
    "ul", "ol", "li",
    "table", "thead", "tbody", "tr", "th", "td",
    "a",
  ],
  ALLOWED_ATTR: ["href", "title"],
  ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|tel:)/i,
  ALLOW_DATA_ATTR: false,
  ALLOW_ARIA_ATTR: false,
};

// A private DOMPurify instance, so the link hook below can't affect any other
// code that might use DOMPurify later.
let purifier = null;
function getPurifier() {
  if (purifier) return purifier;
  purifier = DOMPurify(window);
  purifier.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "A") return;
    if (node.hasAttribute("href")) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
  return purifier;
}

/** Returns a safe HTML string for announcement bodies (empty string for nothing). */
export function sanitizeHtml(html) {
  if (html == null || html === "") return "";
  return getPurifier().sanitize(String(html), CONFIG);
}
