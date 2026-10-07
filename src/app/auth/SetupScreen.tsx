import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { cn } from '@/app/lib/utils'
import { useAuth } from './AuthContext'
import { authApi, type Me, type Verified } from './api'
import { errorDetail } from '@/app/api/meta'
import { AuthHeading, AuthLayout, Field, FormError, TextButton } from './AuthLayout'

/**
 * Opened from an emailed link (/auth/verify?token=…). The link only verifies the email: this
 * screen uses it up, confirms, and hands over to the app, where setup continues.
 * `onDone` gets the signed-in user (null for an email change, which doesn't sign anyone in).
 */
export function VerifyScreen({ token, onDone }: { token: string; onDone: (me: Me | null) => void }) {
  const [result, setResult] = useState<Verified | null>(null)
  const [error, setError] = useState<string | null>(null)
  const started = useRef(false) // a link works once; StrictMode's double effect must not spend it twice

  useEffect(() => {
    if (started.current) return
    started.current = true
    authApi.verify(token).then(setResult, (err) => setError(errorDetail(err)))
  }, [token])

  if (error)
    return (
      <AuthLayout>
        <AuthHeading title="This link can’t be used">
          {error} Links work once. Sign-up and password links expire after 30 minutes, and invites after 7 days.
        </AuthHeading>
        <Button className="w-full" onClick={() => onDone(null)}>
          Go to log in
        </Button>
      </AuthLayout>
    )

  if (!result)
    return (
      <AuthLayout>
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" /> Verifying your email…
        </p>
      </AuthLayout>
    )

  const joinedNow = result.purpose === 'invite' && result.me?.setup === 'complete'
  const copy = {
    signup: { title: 'Email verified', body: `Thanks, ${result.me?.user.email} is confirmed. Next, set up your account.`, button: 'Set up my account' },
    invite: joinedNow
      ? { title: `You’ve joined ${result.me?.workspace?.name}`, body: 'Your email is confirmed and you’re now a member of the workspace.', button: 'Open Helo.ai' }
      : { title: 'Email verified', body: `Thanks, ${result.me?.user.email} is confirmed. Next, set up your account to join ${result.me?.joining?.workspaceName}.`, button: 'Set up my account' },
    reset: { title: 'It’s you', body: 'Your email is confirmed. Next, choose a new password. You’ve been logged out everywhere else.', button: 'Choose a new password' },
    email_change: { title: 'Your email is updated', body: `From now on, log in with ${result.email}.`, button: 'Continue' },
  }[result.purpose]

  return (
    <AuthLayout>
      <CheckCircle2 className="mb-5 size-10 text-success" aria-hidden />
      <AuthHeading title={copy.title}>{copy.body}</AuthHeading>
      <Button className="w-full" autoFocus onClick={() => onDone(result.me ?? null)}>
        {copy.button}
      </Button>
    </AuthLayout>
  )
}

/** Step markers for the in-app setup: it really is a sequence, so the steps are counted. */
function Steps({ labels, current }: { labels: string[]; current: number }) {
  return (
    <ol className="mb-8 flex gap-2" aria-label={`Step ${current + 1} of ${labels.length}`}>
      {labels.map((l, i) => (
        <li key={l} className="flex-1 space-y-1.5">
          <span className={cn('block h-1 rounded-full', i <= current ? 'bg-primary' : 'bg-muted')} />
          <span className={cn('text-xs', i === current ? 'text-foreground' : 'text-muted-foreground')}>
            {l}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** In-app account setup after the email is verified: details, password, then workspace (or join). */
export function AccountSetupScreen() {
  const { me, setMe, logout } = useAuth()
  const joining = me?.joining
  const labels = joining ? ['Your details', 'Password'] : ['Your details', 'Password', 'Workspace']
  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const last = step === labels.length - 1

  async function next(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (step === 1) {
      if (password.length < 8) return setError('Use at least 8 characters for your password.')
      if (password !== confirm) return setError('The two passwords don’t match.')
    }
    if (!last) return setStep(step + 1)
    setBusy(true)
    try {
      setMe(await authApi.finishSetup({ name, password, ...(joining ? {} : { workspaceName }) }))
    } catch (err) {
      setError(errorDetail(err))
      setBusy(false)
    }
  }

  const heading = [
    { title: 'Your details', intro: `Your email ${me?.user.email} is verified. What should people in your workspace call you?` },
    { title: 'Choose a password', intro: 'You’ll log in with your email and this password from now on.' },
    { title: 'Name your workspace', intro: 'A workspace holds your agents and the people you work with. You’ll be its owner and can invite people next.' },
  ][step]

  return (
    <AuthLayout>
      <Steps labels={labels} current={step} />
      <AuthHeading title={heading.title}>
        {joining && step === 0
          ? `${joining.inviterName ?? 'A workspace owner'} invited you to ${joining.workspaceName}. ${heading.intro}`
          : heading.intro}
      </AuthHeading>
      <form onSubmit={next} className="space-y-4" noValidate>
        {step === 0 && <Field label="Full name" autoComplete="name" required autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}
        {step === 1 && (
          <>
            <Field label="Password" type="password" autoComplete="new-password" hint="At least 8 characters." required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
            <Field label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </>
        )}
        {step === 2 && (
          <Field
            label="Workspace name"
            hint="Usually your company’s name."
            required
            autoFocus
            maxLength={80}
            value={workspaceName}
            onChange={(e) => setWorkspaceName(e.target.value)}
          />
        )}
        {error && <FormError>{error}</FormError>}
        <div className="flex gap-2">
          {step > 0 && (
            <Button type="button" variant="outline" onClick={() => (setError(null), setStep(step - 1))} disabled={busy}>
              Back
            </Button>
          )}
          <Button
            type="submit"
            className="flex-1"
            disabled={busy || (step === 0 && !name.trim()) || (step === 1 && (!password || !confirm)) || (step === 2 && !workspaceName.trim())}
          >
            {busy && <Loader2 className="size-4 animate-spin" />}
            {!last ? 'Continue' : joining ? `Join ${joining.workspaceName}` : 'Create workspace'}
          </Button>
        </div>
      </form>
      <p className="mt-8 text-muted-foreground text-sm">
        Not you? <TextButton onClick={() => void logout()}>Log out</TextButton>
      </p>
    </AuthLayout>
  )
}

/** After a verified reset link: choose a new password before anything else. */
export function NewPasswordScreen() {
  const { me, setMe } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    if (password !== confirm) return setError('The two passwords don’t match.')
    setBusy(true)
    try {
      setMe(await authApi.newPassword(password))
    } catch (err) {
      setError(errorDetail(err))
      setBusy(false)
    }
  }

  return (
    <AuthLayout>
      <AuthHeading title="Choose a new password">For {me?.user.email}. You’ll use it to log in from now on.</AuthHeading>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="New password" type="password" autoComplete="new-password" hint="At least 8 characters." required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        <Field label="Confirm new password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <FormError>{error}</FormError>}
        <Button type="submit" className="w-full" disabled={busy || !password || !confirm}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Save new password
        </Button>
      </form>
    </AuthLayout>
  )
}
