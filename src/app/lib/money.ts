/** Money in the WhatsApp account's currency; just the number when Meta hasn't told us the currency. */
export function formatMoney(amount: number, currency: string | null, digits = 2) {
  const opts = { minimumFractionDigits: digits, maximumFractionDigits: digits }
  if (!currency) return amount.toLocaleString(undefined, opts)
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, ...opts }).format(amount)
  } catch {
    return `${amount.toLocaleString(undefined, opts)} ${currency}`
  }
}
