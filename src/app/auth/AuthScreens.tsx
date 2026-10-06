import { useEffect, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { useAuth } from './AuthContext'
import { authApi } from './api'
import { errorDetail } from '@/app/api/meta'
import { setDummyMode } from '@/app/api/dummy'
import { AuthHeading, AuthLayout, Field, FormError, TextButton } from './AuthLayout'

type Mode = 'login' | 'signup' | 'forgot'

/** Signed-out screens: log in, sign up, forgot password. */
/** Shown instead of the login form when the API server can't be reached, so nobody gets a raw
 *  "page could not be found" from the host. The demo works with no server at all. */
function ServerDown() {
  const { refresh, databaseDown } = useAuth()
  const [checking, setChecking] = useState(false)
  return (
    <div className="space-y-4">
      <h1>{databaseDown ? 'Helo.ai can’t reach its database' : 'Helo.ai can’t reach its server'}</h1>
      <p className="text-muted-foreground">
        {databaseDown
          ? 'The server is up, but MongoDB isn’t answering it, so nobody can log in. If you run Helo.ai: in MongoDB Atlas, Network Access must allow this server (on Vercel: 0.0.0.0/0), and MONGODB_URI must be set.'
          : 'This site is up, but the server that handles logins, chats and WhatsApp isn’t answering. If you run Helo.ai, check the server’s deployment and its settings.'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={checking}
          onClick={() => {
            setChecking(true)
            void refresh().finally(() => setChecking(false))
          }}
        >
          {checking && <Loader2 className="size-4 animate-spin" />}
          Try again
        </Button>
        <Button onClick={() => setDummyMode(true)}>Explore the demo</Button>
      </div>
      <p className="text-muted-foreground text-xs">
        The demo runs in your browser with sample data. Nothing reaches WhatsApp.
      </p>
    </div>
  )
}

export function AuthScreen() {
  const { serverDown } = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  if (serverDown)
    return (
      <AuthLayout>
        <ServerDown />
      </AuthLayout>
    )
  return (
    <AuthLayout>
      {mode === 'login' && <Login email={email} setEmail={setEmail} go={setMode} />}
      {mode === 'signup' && <SendLink kind="signup" email={email} setEmail={setEmail} go={setMode} />}
      {mode === 'forgot' && <SendLink kind="forgot" email={email} setEmail={setEmail} go={setMode} />}
    </AuthLayout>
  )
}

interface ModeProps {
  email: string
  setEmail: (e: string) => void
  go: (m: Mode) => void
}

function Login({ email, setEmail, go }: ModeProps) {
  const { setMe } = useAuth()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setMe(await authApi.login(email, password))
    } catch (err) {
      setError(errorDetail(err))
      setBusy(false)
    }
  }

  return (
    <>
      <AuthHeading title="Log in">Use the email and password you set up for your Helo.ai account.</AuthHeading>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aside={
            <span className="text-sm">
              <TextButton onClick={() => go('forgot')}>Forgot password?</TextButton>
            </span>
          }
        />
        {error && <FormError>{error}</FormError>}
        <Button type="submit" className="w-full" disabled={busy || !email || !password}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Log in
        </Button>
      </form>
      <p className="mt-8 text-muted-foreground text-sm">
        New to Helo.ai? <TextButton onClick={() => go('signup')}>Create an account</TextButton>
      </p>
    </>
  )
}

const COPY = {
  signup: {
    title: 'Create your account',
    intro: 'Enter your work email. We’ll send a link to verify it, then you’ll set up your account here.',
    button: 'Email me a verification link',
    sentTitle: 'Check your inbox',
    sent: (e: string) => `We sent a verification link to ${e}. Open it within 30 minutes to verify your email, then you’ll set up your account.`,
  },
  forgot: {
    title: 'Reset your password',
    intro: 'Enter the email you log in with. We’ll send a link to verify it’s you, then you’ll choose a new password.',
    button: 'Email me a reset link',
    sentTitle: 'Check your inbox',
    sent: (e: string) => `If ${e} has a Helo.ai account, we sent it a link to reset the password. The link expires in 30 minutes.`,
  },
}

/** Sign-up and forgot password: ask for an email, then show "check your inbox" with a resend timer. */
function SendLink({ kind, email, setEmail, go }: ModeProps & { kind: 'signup' | 'forgot' }) {
  const c = COPY[kind]
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [existing, setExisting] = useState(false)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    setExisting(false)
    try {
      await (kind === 'signup' ? authApi.signup(email) : authApi.forgot(email))
      setSent(true)
      setWait(60)
    } catch (err) {
      setError(errorDetail(err))
      setExisting(err instanceof Error && /already have an account/i.test(err.message))
    } finally {
      setBusy(false)
    }
  }

  if (sent)
    return (
      <>
        <AuthHeading title={c.sentTitle}>{c.sent(email)}</AuthHeading>
        <div className="space-y-4">
          {error && <FormError>{error}</FormError>}
          <Button variant="outline" className="w-full" disabled={busy || wait > 0} onClick={() => void send()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {wait > 0 ? `Resend link in ${wait}s` : 'Resend link'}
          </Button>
          <p className="text-muted-foreground text-sm">
            Wrong address? <TextButton onClick={() => setSent(false)}>Use a different email</TextButton>
          </p>
        </div>
        <p className="mt-8 text-muted-foreground text-sm">
          <TextButton onClick={() => go('login')}>Back to log in</TextButton>
        </p>
      </>
    )

  return (
    <>
      <AuthHeading title={c.title}>{c.intro}</AuthHeading>
      <form onSubmit={send} className="space-y-4" noValidate>
        <Field label="Work email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        {error && (
          <FormError>
            {error} {existing && <TextButton onClick={() => go('login')}>Log in</TextButton>}
          </FormError>
        )}
        <Button type="submit" className="w-full" disabled={busy || !email}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          {c.button}
        </Button>
      </form>
      <p className="mt-8 text-muted-foreground text-sm">
        {kind === 'signup' ? 'Already have an account? ' : 'Remembered it? '}
        <TextButton onClick={() => go('login')}>Log in</TextButton>
      </p>
    </>
  )
}

/** Signed in but not in a workspace (e.g. removed from one): create a workspace to continue. */
export function CreateWorkspaceScreen() {
  const { me, setMe, logout } = useAuth()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setMe(await authApi.createWorkspace(name))
    } catch (err) {
      setError(errorDetail(err))
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <AuthHeading title="Create a workspace">
        {me?.user.name ? `${me.user.name}, you’re` : 'You’re'} not in a workspace yet. Create one to start setting up agents, or ask a
        workspace owner to invite {me?.user.email ?? 'you'}.
      </AuthHeading>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Workspace name" hint="Usually your company’s name. You can invite people to it next." required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        {error && <FormError>{error}</FormError>}
        <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Create workspace
        </Button>
      </form>
      <p className="mt-8 text-muted-foreground text-sm">
        Not you? <TextButton onClick={() => void logout()}>Log out</TextButton>
      </p>
    </AuthLayout>
  )
}
