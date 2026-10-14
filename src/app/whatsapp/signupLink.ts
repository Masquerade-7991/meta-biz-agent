// Meta's hosted Embedded Signup link (EMBEDDED_SIGNUP_LINK), and how what a business picks in
// Meta's signup maps onto Helo.ai. Pure: shared by the server (which builds the links) and the
// connect dialog (which shows the map).

export type SignupFlow = 'new' | 'coexistence'
const COEXISTENCE = 'whatsapp_business_app_onboarding'

/**
 * The link for each flow, from the one in the server's settings: a new number (the standard flow)
 * or a number already on the WhatsApp Business app (Meta's featureType for coexistence). null when
 * the link isn't Meta's signup page (https, facebook.com, a WhatsApp path, an app and a config).
 */
export function hostedLinks(raw: string | null | undefined): Record<SignupFlow, string> | null {
  let u: URL
  try {
    u = new URL(String(raw ?? '').trim())
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || !['business.facebook.com', 'www.facebook.com'].includes(u.hostname) || !u.pathname.includes('/whatsapp/')) return null
  if (!/^\d+$/.test(u.searchParams.get('app_id') ?? '') || !/^\d+$/.test(u.searchParams.get('config_id') ?? '')) return null
  let extras: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(u.searchParams.get('extras') ?? '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) extras = parsed as Record<string, unknown>
  } catch {
    // no usable extras: Meta's defaults
  }
  const make = (flow: SignupFlow) => {
    const { featureType: _drop, ...rest } = extras
    const x = { ...rest, sessionInfoVersion: rest.sessionInfoVersion ?? '3', ...(flow === 'coexistence' && { featureType: COEXISTENCE }) }
    const v = new URL(u)
    v.searchParams.set('extras', JSON.stringify(x))
    return v.toString()
  }
  return { new: make('new'), coexistence: make('coexistence') }
}

export interface SignupAssets {
  businessId?: string
  wabaId?: string
  phoneNumberId?: string | null
}
interface AssetRow {
  /** What it's called on Meta. */
  meta: string
  /** The id Meta reported, once signup has finished. */
  id?: string | null
  /** Where it lands in Helo.ai. */
  helo: string
}

/** What Meta's signup connects, and where each piece lands in Helo.ai. Ids fill in once Meta reports them. */
export function assetMap(flow: SignupFlow, workspace: string, a: SignupAssets | null = null): AssetRow[] {
  return [
    { meta: 'Business portfolio', id: a?.businessId, helo: `The workspace “${workspace}”` },
    { meta: 'WhatsApp Business account', id: a?.wabaId, helo: 'An account in Settings › WhatsApp. Its access is stored encrypted; its messages reach Helo.ai through our listening app, and your own webhook stays as it is.' },
    {
      meta: 'Phone number',
      id: a?.phoneNumberId,
      helo:
        flow === 'coexistence'
          ? 'A number on the WhatsApp page. The WhatsApp Business app keeps working on your phone; its chats and contacts sync here.'
          : 'A number on the WhatsApp page, registered for the API with a PIN Helo.ai keeps for you. It can run one AI agent.',
    },
    { meta: 'Permissions you grant', helo: 'Helo.ai manages the account and sends messages for you. Meta never shares your login or payment details.' },
  ]
}
