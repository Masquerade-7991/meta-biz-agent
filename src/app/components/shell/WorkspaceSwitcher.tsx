import { useState, type FormEvent } from 'react'
import { Check, ChevronsUpDown, LogOut, Mail, Plus, Settings } from 'lucide-react'
import mark from '@/assets/helo-mark.svg'
import { useAuth } from '@/app/auth/AuthContext'
import { answerInvite, createWorkspace, leaveWorkspace, switchWorkspace } from '@/app/auth/workspaceSwitch'
import { errorDetail } from '@/app/api/meta'
import { roleLabel } from '@/app/lib/permissions'
import { cn } from '@/app/lib/utils'
import { Button } from '@/app/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/app/components/ui/dialog'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/app/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/app/components/wizard/ConfirmDialog'
import type { SettingsTab } from './SettingsPage'

const initial = (name?: string) => name?.trim()[0]?.toUpperCase() || '?'

/** The sidebar's top: which workspace you're in, the others you belong to, and invites waiting for you. */
export function WorkspaceSwitcher({ collapsed, onOpenSettings }: { collapsed: boolean; onOpenSettings: (tab: SettingsTab) => void }) {
  const { me, setMe } = useAuth()
  const [creating, setCreating] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const invites = me?.invites ?? []
  const others = (me?.workspaces ?? []).filter((w) => w.id !== me?.workspace?.id)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Workspace: ${me?.workspace?.name ?? ''}. Switch workspace`}
            className={cn(
              'relative flex items-center gap-2.5 rounded-md text-left transition-colors outline-none hover:bg-sidebar-accent/70 focus-visible:ring-[3px] focus-visible:ring-ring/50',
              collapsed ? 'size-10 justify-center' : 'w-full px-1.5 py-1.5',
            )}
          >
            <img src={mark} alt="" className="size-7 shrink-0" />
            {!collapsed && (
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-sm font-semibold text-foreground">Helo.ai</span>
                <span className="block truncate text-meta text-muted-foreground">{me?.workspace?.name}</span>
              </span>
            )}
            {!collapsed && <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />}
            {invites.length > 0 && <span className="absolute top-1 right-1 size-2 rounded-full bg-primary" aria-label={`${invites.length} invite${invites.length === 1 ? '' : 's'} waiting`} />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side={collapsed ? 'right' : 'bottom'} className="w-72">
          <DropdownMenuLabel className="text-meta font-normal text-muted-foreground">Workspaces</DropdownMenuLabel>
          {me?.workspace && (
            <DropdownMenuItem onSelect={() => onOpenSettings('members')}>
              <WorkspaceBadge name={me.workspace.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{me.workspace.name}</span>
                <span className="block text-meta text-muted-foreground">{roleLabel(me.role)}</span>
              </span>
              <Check className="size-4" />
            </DropdownMenuItem>
          )}
          {others.map((w) => (
            <DropdownMenuItem key={w.id} onSelect={() => void switchWorkspace(w.id)}>
              <WorkspaceBadge name={w.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{w.name}</span>
                <span className="block text-meta text-muted-foreground">{roleLabel(w.role)}</span>
              </span>
            </DropdownMenuItem>
          ))}
          {invites.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-meta font-normal text-muted-foreground">Invites</DropdownMenuLabel>
              {invites.map((i) => (
                <div key={i.id} className="space-y-2 rounded-sm px-2 py-1.5">
                  <p className="flex items-start gap-2 text-sm">
                    <Mail className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{i.workspaceName}</span>
                      <span className="block text-meta text-muted-foreground">
                        {i.inviterName ? `${i.inviterName} invited you` : 'You’re invited'} as {roleLabel(i.role)}
                      </span>
                    </span>
                  </p>
                  {/* Menu items, not buttons: Radix menus only move focus between items, so these stay reachable by keyboard. */}
                  <div className="flex gap-2 pl-6">
                    <DropdownMenuItem className="h-6 rounded-md bg-primary px-2 text-xs font-medium text-primary-foreground focus:bg-primary/90 focus:text-primary-foreground" onSelect={() => void answerInvite(i.id, true)}>
                      Accept
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="h-6 rounded-md px-2 text-xs"
                      onSelect={async (e) => {
                        e.preventDefault() // stay open: the other invites may still need an answer
                        const next = await answerInvite(i.id, false)
                        if (next) setMe(next)
                      }}
                    >
                      Decline
                    </DropdownMenuItem>
                  </div>
                </div>
              ))}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreating(true)}>
            <Plus className="size-4" /> Create workspace
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onOpenSettings('members')}>
            <Settings className="size-4" /> Workspace members
          </DropdownMenuItem>
          {me?.workspace && (
            <DropdownMenuItem onSelect={() => setLeaving(true)}>
              <LogOut className="size-4" /> Leave {me.workspace.name}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateWorkspaceDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={leaving}
        title={`Leave ${me?.workspace?.name ?? 'this workspace'}?`}
        description="You’ll lose access to its chats, tickets and agents. An owner can invite you again. Your other workspaces aren’t affected."
        confirmLabel="Leave workspace"
        onConfirm={() => {
          setLeaving(false)
          void leaveWorkspace()
        }}
        onCancel={() => setLeaving(false)}
      />
    </>
  )
}

function WorkspaceBadge({ name }: { name: string }) {
  return <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-meta font-semibold text-foreground">{initial(name)}</span>
}

function CreateWorkspaceDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await createWorkspace(name)
    } catch (err) {
      setError(errorDetail(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="space-y-4" noValidate>
          <DialogHeader>
            <DialogTitle>Create a workspace</DialogTitle>
            <DialogDescription>A separate space with its own WhatsApp numbers, agents, chats and members. You’ll be its owner.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="new-ws-name">Workspace name</Label>
            <Input id="new-ws-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Retail" />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
