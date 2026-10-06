import { useEffect, useState } from 'react'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { Button } from '@/app/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog'

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Delete',
  tone = 'danger',
  confirmText,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: string
  /** Say what happens ("Delete agent"), never "Proceed". */
  confirmLabel?: string
  /** 'default' for a non-destructive confirmation. */
  tone?: 'danger' | 'default'
  /** For things that can't be undone: the person types this (e.g. the agent's name) to confirm. */
  confirmText?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  useEffect(() => {
    if (!open) setTyped('')
  }, [open])
  const blocked = !!confirmText && typed.trim() !== confirmText.trim()
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {confirmText && (
          <div className="space-y-1.5">
            <Label htmlFor="confirm-text">
              Type <span className="font-semibold">{confirmText}</span> to confirm
            </Label>
            <Input id="confirm-text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={tone === 'danger' ? 'destructive' : 'default'} onClick={onConfirm} disabled={blocked}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
