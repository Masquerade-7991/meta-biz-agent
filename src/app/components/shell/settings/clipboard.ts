import { toast } from 'sonner'

/** Copies text, falling back to the old way where the clipboard API isn't there (plain HTTP). */
export async function copyText(text: string, done = 'Copied') {
  try {
    if (!navigator.clipboard) throw new Error('no clipboard')
    await navigator.clipboard.writeText(text)
    toast.success(done)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    let ok = false
    try {
      ok = document.execCommand('copy')
    } catch {
      ok = false
    }
    ta.remove()
    if (ok) toast.success(done)
    else toast.error('Couldn’t copy. Select the text and copy it yourself.')
    return ok
  }
}
