// Meta's rule for connector and tool names: letters, numbers and underscores only (META_NAME). People
// type names the way they talk ("Shopify store"); the console makes them valid instead of refusing them.

/** "Shopify store" → "Shopify_store", "look up order!" → "look_up_order". Empty when nothing usable is left. */
export const toMetaName = (text: string) =>
  text
    .trim()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s\-.]+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
