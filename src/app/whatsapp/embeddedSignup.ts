// Runs Meta's Embedded Signup popup and resolves with the one-time code and what the business chose.
// The code is valid for 30 seconds, so the caller sends it to the server straight away.
import { parseSignupEvent, signupMessage, type SignupEvent } from './signupEvent'

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
/** Meta's own limit on the code; past it there's nothing to wait for. */
const CODE_WAIT_MS = 30_000

/** Opens the popup. Resolves once both the code and the finish message have arrived (either order);
 *  rejects with a message for the person when they leave, Meta errors, or the code never comes. */
export async function startSignup(cfg: { appId: string; configId: string; sdkVersion: string }, flow: 'new' | 'coexistence'): Promise<SignupResult> {
  const FB = await loadSdk(cfg.appId, cfg.sdkVersion)
  return new Promise((resolve, reject) => {
    let code = ''
    let finish: Extract<SignupEvent, { kind: 'finish' }> | null = null
    let timer: ReturnType<typeof setTimeout> | undefined
    const stop = () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
    }
    const done = () => {
      if (!code || !finish) return
      stop()
      resolve({ ...finish, code })
    }
    const onMessage = (e: MessageEvent) => {
      const ev = parseSignupEvent(e.origin, e.data)
      if (!ev) return
      if (ev.kind === 'finish') {
        finish = ev
        done()
        // Meta finished but its code hasn't come: don't wait forever (it's only valid 30 seconds anyway).
        if (!code)
          timer = setTimeout(() => {
            stop()
            reject(new Error('Meta finished the signup but didn’t hand Helo.ai its access code. Please run the signup again.'))
          }, CODE_WAIT_MS)
        return
      }
      stop()
      reject(new Error(signupMessage(ev)))
    }
    // Listen before the popup opens, so the finish message can't be missed.
    window.addEventListener('message', onMessage)
    FB.login(
      (r) => {
        code = r.authResponse?.code ?? ''
        if (code) return done()
        stop()
        reject(new Error(finish ? 'Meta finished the signup but didn’t hand Helo.ai its access code. Please run the signup again.' : 'Meta’s window was closed before the signup finished. Nothing was connected.'))
      },
      {
        config_id: cfg.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, sessionInfoVersion: '3', ...(flow === 'coexistence' && { featureType: 'whatsapp_business_app_onboarding' }) },
      },
    )
  })
}
