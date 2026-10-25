// Turns a raw bank description like "TIM HORTONS #4521 VANCOUVER BC" into a
// normalized merchant name ("tim hortons") and a category id.
//
// The rules (keyword -> category) are loaded once into a Map, so categorizing is a
// handful of O(1) hash lookups per transaction and never touches the database.

// Words banks add around the merchant name that say nothing about the merchant.
const NOISE = new Set([
  'pos', 'purchase', 'debit', 'credit', 'visa', 'mastercard', 'mc', 'interac', 'payment',
  'preauth', 'pre', 'auth', 'pending', 'contactless', 'tap', 'online', 'trip', 'help',
  'www', 'com', 'ca', 'inc', 'ltd',
]);

// Location words that usually trail the merchant name. Once we hit one, the name has ended.
const LOCATION = new Set([
  'bc', 'ab', 'on', 'qc', 'mb', 'sk', 'ns', 'nb', 'nl', 'pe', 'yt', 'nt', 'nu', 'wa', 'usa',
  'vancouver', 'burnaby', 'richmond', 'surrey', 'coquitlam', 'victoria', 'toronto', 'seattle',
]);

const MAX_MERCHANT_TOKENS = 4;

export function tokenize(description) {
  return description
    .toLowerCase()
    .replace(/['’&]/g, '') // "mcdonald's" -> "mcdonalds", "t&t" -> "tt"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

// Merchant name = the leading meaningful words, stopping at a store number,
// reference code, or location.
export function normalizeMerchant(description) {
  const name = [];
  for (const token of tokenize(description)) {
    if (NOISE.has(token)) continue;
    if (/\d/.test(token) || LOCATION.has(token)) {
      if (name.length > 0) break; // trailing store number / city: name is done
      continue; // leading reference number: skip it
    }
    name.push(token);
    if (name.length === MAX_MERCHANT_TOKENS) break;
  }
  return name.length > 0 ? name.join(' ') : null;
}

export class Categorizer {
  /**
   * @param {Iterable<[string, number]>} rules keyword -> category id
   * @param {number} fallbackCategoryId category used when nothing matches
   */
  constructor(rules, fallbackCategoryId) {
    this.rules = new Map(rules);
    this.fallback = fallbackCategoryId;
  }

  static async load(db) {
    const { rows: rules } = await db.query('SELECT keyword, category_id FROM category_rules');
    const { rows: [fallback] } = await db.query(
      "SELECT id FROM categories WHERE name = 'Uncategorized'",
    );
    return new Categorizer(rules.map((r) => [r.keyword, r.category_id]), fallback.id);
  }

  // Pairs are checked before single words, so "uber eats" (food delivery) wins over
  // "uber" (rideshare) and "tim hortons" matches the rule "timhortons".
  categorize(description) {
    const tokens = tokenize(description);
    for (let i = 0; i + 1 < tokens.length; i++) {
      const hit = this.rules.get(tokens[i] + tokens[i + 1]);
      if (hit !== undefined) return hit;
    }
    for (const token of tokens) {
      const hit = this.rules.get(token);
      if (hit !== undefined) return hit;
    }
    return this.fallback;
  }
}
