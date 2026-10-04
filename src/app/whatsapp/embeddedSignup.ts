// Runs Meta's Embedded Signup popup and resolves with the one-time code and what the business chose.
// The code is valid for 30 seconds, so the caller sends it to the server straight away.
import { parseSignupEvent, type SignupEvent } from './signupEvent'

interface FB {
  init: (o: { appId: string; version: string; xfbml?: boolean; autoLogAppEvents?: boolean }) => void
  login: (cb: (r: { authResponse?: { code?: string } }) => void, o: Record<string, unknown>) => void
}
declare global {
  interface Window {
    FB?: FB
    fbAsyncInit?: () => void
  }
}

let sdk: Promise<FB> | null = null
/** Loads Meta's JS SDK once. */
function loadSdk(appId: string, version: string): Promise<FB> {
  sdk ??= new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB!.init({ appId, version, xfbml: false, autoLogAppEvents: true })
      resolve(window.FB!)
    }
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/en_US/sdk.js'
    s.async = true
    s.crossOrigin = 'anonymous'
    s.onerror = () => {
      sdk = null
      reject(new Error('Couldn’t load Facebook’s sign-in. Check your connection or ad blocker, then try again.'))
    }
    document.body.appendChild(s)
  })
  return sdk
}

export type SignupResult = Extract<SignupEvent, { kind: 'finish' }> & { code: string }

/** Opens the popup. Resolves once both the code and the finish message have arrived (either order). */
export async function startSignup(cfg: { appId: string; configId: string; sdkVersion: string }, flow: 'new' | 'coexistence'): Promise<SignupResult> {
  const FB = await loadSdk(cfg.appId, cfg.sdkVersion)
  return new Promise((resolve, reject) => {
    let code = ''
    let finish: Extract<SignupEvent, { kind: 'finish' }> | null = null
    const done = () => {
      if (!code || !finish) return
      window.removeEventListener('message', onMessage)
      resolve({ ...finish, code })
    }
    const onMessage = (e: MessageEvent) => {
      const ev = parseSignupEvent(e.origin, e.data)
      if (!ev) return
      if (ev.kind === 'finish') {
        finish = ev
        done()
        return
      }
      window.removeEventListener('message', onMessage)
      reject(new Error(ev.kind === 'cancel' ? `You closed the signup${ev.step ? ` at ${ev.step.toLowerCase().replace(/_/g, ' ')}` : ''}. Nothing was connected.` : `Meta stopped the signup: ${ev.message} (session ${ev.sessionId})`))
    }
    // Listen before the popup opens, so the finish message can't be missed.
    window.addEventListener('message', onMessage)
    FB.login(
      (r) => {
        code = r.authResponse?.code ?? ''
        if (code) done()
        else if (!finish) {
          window.removeEventListener('message', onMessage)
          reject(new Error('The signup was closed before it finished. Nothing was connected.'))
        }
      },
      {
        config_id: cfg.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, ...(flow === 'coexistence' && { featureType: 'whatsapp_business_app_onboarding' }) },
      },
    )
  })
}
