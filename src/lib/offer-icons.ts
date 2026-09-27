/**
 * The CLOSED vocabulary an offer's icon is picked from.
 *
 * Every token is a Phosphor icon name (https://phosphoricons.com, kebab-case),
 * which is what the dashboard renders. A closed set rather than a generated
 * image because the proposal step sits inside a modal: picking a token is part
 * of the one completion that splits the text into offers, so it costs nothing
 * extra and arrives instantly. The per-offer GENERATED image
 * (`POST /orgs/brands/:brandId/offers/:offerId/image`) is a separate, slower
 * thing and can still be produced later.
 *
 * Adding a token is a one-line edit here. Nothing in the database constrains the
 * value (a CHECK would make every new token a migration); the write path does.
 *
 * Deliberately free of any database, express or `@`-aliased import. Keep it so.
 */
export const OFFER_ICONS = [
  'package',
  'shopping-bag',
  'storefront',
  't-shirt',
  'sneaker',
  'diamond',
  'gift',
  'flower',
  'leaf',
  'plant',
  'coffee',
  'fork-knife',
  'wine',
  'cookie',
  'pill',
  'first-aid-kit',
  'heartbeat',
  'tooth',
  'barbell',
  'person-simple-run',
  'flower-lotus',
  'scissors',
  'paint-brush',
  'palette',
  'camera',
  'music-notes',
  'film-slate',
  'book-open',
  'graduation-cap',
  'chalkboard-teacher',
  'code',
  'desktop',
  'device-mobile',
  'cloud',
  'robot',
  'chart-line-up',
  'megaphone',
  'handshake',
  'briefcase',
  'scales',
  'calculator',
  'bank',
  'currency-dollar',
  'house',
  'buildings',
  'wrench',
  'hammer',
  'lightning',
  'car',
  'airplane',
  'truck',
  'globe',
  'map-pin',
  'users',
  'chat-circle',
  'phone',
  'envelope',
  'calendar',
  'shield-check',
  'gear',
  'paw-print',
  'baby',
  'ticket',
  'game-controller',
  'sparkle',
] as const;

export type OfferIcon = (typeof OFFER_ICONS)[number];

const OFFER_ICON_SET: ReadonlySet<string> = new Set(OFFER_ICONS);

export function isOfferIcon(value: unknown): value is OfferIcon {
  return typeof value === 'string' && OFFER_ICON_SET.has(value);
}
