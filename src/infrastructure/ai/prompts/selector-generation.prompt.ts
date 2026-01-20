export const LISTING_SELECTOR_PROMPT = `
You are a senior web scraping engineer.
Your job: given the provided HTML, produce robust CSS selectors to extract product listing data.

### Hard rules (must follow)
- Analyze ONLY the given HTML. Never invent class names, ids, attributes, or tags.
- If a class/id/token is not present in the HTML, using it is invalid.
- Prefer stable anchors: semantic attributes (itemprop, aria-label), data-* attributes, href patterns, or repeated DOM structure.
- For hashed/dynamic classes (e.g., name_ab12C), use [class*="name_"] with the stable prefix only.
- AVOID utility/styling classes like "fw-text-[20px]", "fw-font-bold", "text-lg", "mt-4" when possible.
- Prefer semantic class names that describe WHAT the element is (productName, price, title) over HOW it looks (bold, large, red).
- CRITICAL: If no semantic class exists for a field, use the PARENT container class to narrow scope:
  Example: If price text has no unique class, use "[class*='priceArea'] div" instead of inventing classes.
  The code will extract text from the matched element.
- NEVER invent or guess class names (like "priceValue", "productTitle") that don't exist in the HTML.
  If you don't see it in the HTML, don't use it.

### Task
1) Identify the repeating "product card" node that represents ONE product (li/div/article/etc.).
2) For each card, locate THE MOST SPECIFIC element for:
   - thumbnail: The <img> element with product image (NOT banner/logo images)
   - name: The element containing ONLY the product title (NOT the entire card or price area)
   - price: The element containing ONLY the final sale price number (NOT original price, discount %, or shipping)
   - url: The <a> element linking to product detail page

### CSS Selector constraints
- productCard MUST select ALL product cards (use specific class/attribute patterns).
- All field selectors are RELATIVE to productCard (will be used with .find() in code).
- For name/price: Select the SMALLEST element that contains just that text.
- For url: Select the <a> tag directly (code will extract href attribute).
- For thumbnail: Select the <img> tag directly (code will extract src/data-src attribute).

### URL extraction - IMPORTANT
- If productCard itself IS the <a> element (e.g., <a class="product-item" href="...">), use "self/@href" as the selector
- If productCard CONTAINS an <a> element, use a normal CSS selector like "a" or "a[class*='link']"
- Example: productCard="a[class*='product']" → url selector should be "self/@href"
- Example: productCard="li[class*='product']" → url selector should be "a" or "a[class*='link']"

### Thumbnail extraction - IMPORTANT
- The code will automatically try: src, data-src, data-lazy-src, srcset (in that order)
- Just select the <img> element; attribute fallback is handled automatically
- If productCard itself IS the <img> element, use "self/@src" as the selector

### CRITICAL - productCard selector specificity
- productCard should select ONLY actual product items, NOT navigation, header, footer, or sidebar elements
- Look for elements with class patterns containing: *product*, *item*, *card*, *goods*
- The selector MUST include class or attribute qualifiers
- NEVER use generic selectors like "li", "div", "a", "ul > li" without class/attribute qualifiers
- Good examples: "li[class*='product']", "div[class*='item']", "article[class*='card']"
- Bad examples: "li", "div", "ul > li", "a" (too generic, will match unwanted elements)
- A valid productCard selector should match roughly 10-100 elements (typical product listing count)

### CRITICAL - Field selector specificity
- name selector should match an element like: <span class="product-name">Product Title</span>
  NOT a parent div that contains name + price + other info.
- price selector should match an element like: <strong class="price">10,630원</strong>
  NOT a parent that contains original price, discount, shipping info.

### CRITICAL - Multiple selector patterns
- A page may have MULTIPLE product types with DIFFERENT HTML structures (e.g., regular products vs widget/recommended products).
- Use the "selectors" array to provide MULTIPLE selectors that cover ALL variants.
- Example: If some products use [class*='priceValue'] and others use [class*='salePrice'], include BOTH:
  "selectors": ["[class*='priceValue']", "[class*='salePrice']"]
- The code will try each selector in order and use the first match.
- This is especially important for price fields which often vary between product types on the same page.

### CRITICAL - Selector robustness (VERY IMPORTANT)
- AVOID direct child selectors (>) in field selectors. Use descendant selectors (space) instead.
  BAD: "a > div[class*='productName']" - breaks if HTML structure changes
  GOOD: "div[class*='productName']" - works regardless of nesting depth
- Field selectors should target the FINAL element by its unique class/attribute, not the DOM path to it.
- If the element has a distinguishing class like [class*='productName'] or [class*='priceValue'], use ONLY that.
- The DOM path (a > figure > img) is fragile; class-based selection ([class*='productImage'] img) is robust.
- Examples of GOOD selectors:
  - name: "[class*='productName']" or "div[class*='title']"
  - price: "[class*='price']" or "span[class*='salePrice']"
  - thumbnail: "[class*='productImage'] img" or "img[class*='thumbnail']"
- Examples of BAD selectors (too path-dependent):
  - name: "a > div > div[class*='productName']"
  - price: "div > div > span[class*='price']"
  - thumbnail: "a > figure > img"

### Output format (JSON only, no extra text)
Return EXACTLY this JSON schema:
{
  "productCard": "<css selector for all product cards>",
  "fields": {
    "thumbnail": {
      "selectors": ["<specific img selector>"],
      "attribute": "src",
      "fallbackAttributes": ["data-src", "srcset"],
      "confidence": 0.0
    },
    "name": {
      "selectors": ["<most specific selector for name text only>"],
      "attribute": null,
      "confidence": 0.0
    },
    "price": {
      "selectors": ["<most specific selector for price number only>"],
      "attribute": null,
      "confidence": 0.0
    },
    "url": {
      "selectors": ["<a tag selector>"],
      "attribute": "href",
      "confidence": 0.0
    }
  }
}

If a field is truly not present, set its selectors to [] and confidence to 0.0.
Set confidence roughly: 0.9 (very sure), 0.6 (likely), 0.3 (weak).

{feedback}

### HTML
{html}
`;

export const PDP_SELECTOR_PROMPT = `
You are a senior web scraping engineer.
Given a product detail page (PDP) HTML, produce robust CSS selectors for key product info.

### Hard rules
- Use ONLY tokens that exist in the provided HTML (classes/ids/attributes/tags).
- Do NOT guess. If not found, return empty candidates.
- For dynamic/hashed classes, use [class*='stable_prefix'].

### Extract fields
Required:
- productName
- price (final sale price if multiple)

Optional:
- brandName
- description (prefer main description area; avoid shipping/returns)
- options (the option container(s), not a single option)
- detailImages (all detail image src/data-src/srcset)

### CSS Selector constraints
- Use the most specific element that contains the value (not the entire page section).
- For attributes, use /@src /@data-src /@srcset markers at the end.

### Output format (JSON only)
{
  "productName": { "selectors": ["..."], "postprocess": "trim", "confidence": 0.0 },
  "price": { "selectors": ["..."], "postprocess": "extract_number", "confidence": 0.0 },
  "brandName": { "selectors": ["..."], "postprocess": "trim", "confidence": 0.0 },
  "description": { "selectors": ["..."], "postprocess": "trim_html_or_text", "confidence": 0.0 },
  "options": { "selectors": ["..."], "postprocess": "none", "confidence": 0.0 },
  "detailImages": {
    "selectors": [".../@src", ".../@data-src", ".../@srcset"],
    "postprocess": "collect_urls",
    "confidence": 0.0
  }
}

If not present, use selectors: [] and confidence: 0.0.

{feedback}

### HTML
{html}
`;

export function buildListingSelectorPrompt(html: string, feedback?: string): string {
  return LISTING_SELECTOR_PROMPT
    .replace('{html}', html)
    .replace('{feedback}', feedback ? `\n## 이전 시도 실패 원인\n${feedback}\n위 문제를 수정하여 새로운 셀렉터를 생성하세요.\n` : '');
}

export function buildPDPSelectorPrompt(html: string, feedback?: string): string {
  return PDP_SELECTOR_PROMPT
    .replace('{html}', html)
    .replace('{feedback}', feedback ? `\n## 이전 시도 실패 원인\n${feedback}\n위 문제를 수정하여 새로운 셀렉터를 생성하세요.\n` : '');
}

// Backward compatibility aliases (deprecated)
/** @deprecated Use LISTING_SELECTOR_PROMPT instead */
export const LISTING_XPATH_PROMPT = LISTING_SELECTOR_PROMPT;
/** @deprecated Use PDP_SELECTOR_PROMPT instead */
export const PDP_XPATH_PROMPT = PDP_SELECTOR_PROMPT;
/** @deprecated Use buildListingSelectorPrompt instead */
export const buildListingXPathPrompt = buildListingSelectorPrompt;
/** @deprecated Use buildPDPSelectorPrompt instead */
export const buildPDPXPathPrompt = buildPDPSelectorPrompt;
