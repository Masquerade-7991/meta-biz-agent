import { Switch } from '@/app/components/ui/switch'
import { useAuth } from '@/app/auth/AuthContext'
import { authApi, type NotificationPrefs } from '@/app/auth/api'
import { can } from '@/app/lib/permissions'
import { SettingsSection } from '../SettingsSection'
import { FormFooter, LoadGate } from './SettingsUi'
import { NO_STAMP } from './formCore'
import { useSettingsForm } from './useSettingsForm'

// Only the emails Helo.ai sends today. The preferences also hold assigned, slaBreach and digest for
// emails still to come; they aren't shown until those emails exist.
const ROWS: { key: keyof NotificationPrefs; label: string; hint: string; alerts?: boolean }[] = [
  { key: 'escalations', label: 'Escalation alerts', hint: 'When a ticket you’re told about escalates and its level is set to email people.' },
  { key: 'budget', label: 'Budget alerts', hint: 'When WhatsApp spend reaches 80% and 100% of the monthly budget.', alerts: true },
]

/** You › Notifications: which emails you get from this workspace. The bell always shows everything. */
export function NotificationsSettings() {
  const { me } = useAuth()
  // Budget emails go to owners and admins (server/platform/alerts.ts raiseAlert).
  const getsAlerts = can(me?.role, 'alerts.receive')
  const form = useSettingsForm<NotificationPrefs>({
    load: () => authApi.notifications().then((value) => ({ value, stamp: NO_STAMP })),
    save: (v) => authApi.saveNotifications(v).then((value) => ({ value, stamp: NO_STAMP })),
  })
  if (form.state !== 'ready' || !form.draft) return <LoadGate error={form.loadError} onRetry={form.reload} what="your notifications" />
  const d = form.draft
  return (
    <div>
      <SettingsSection title="Emails" description={`What ${me?.workspace?.name ?? 'this workspace'} emails you about. In-app notifications (the bell) stay on for everything; sign-in links and invites always arrive. Other workspaces have their own.`}>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {ROWS.filter((r) => !r.alerts || getsAlerts).map((r) => (
            <li key={r.key}>
              <label className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
                <span>
                  {r.label}
                  <span className="block text-xs text-muted-foreground">{r.hint}</span>
                </span>
                <Switch checked={d[r.key]} onCheckedChange={(on) => form.set({ [r.key]: on } as Partial<NotificationPrefs>)} aria-label={r.label} />
              </label>
            </li>
          ))}
        </ul>
        <FormFooter form={form} can={null} />
      </SettingsSection>
    </div>
  )
}
