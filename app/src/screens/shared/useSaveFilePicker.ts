import { useRef, type ChangeEvent, type InputHTMLAttributes } from 'react'

/**
 * A hidden file `<input>` plus the read/reset dance for picking a save file (Settings and New Game
 * both offer "Import a save file"; docs/HANDOFF.md Phase 5D brief). `onFile` receives the file's text;
 * the input is cleared after every read so the same file can be picked again.
 */
export function useSaveFilePicker(onFile: (json: string) => void) {
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const text = await file.text()
    onFile(text)
  }

  const inputProps: InputHTMLAttributes<HTMLInputElement> & { ref: typeof inputRef } = {
    ref: inputRef,
    type: 'file',
    accept: 'application/json,.json',
    'aria-label': 'Choose a save file',
    style: { display: 'none' },
    onChange: handleChange,
  }

  return { inputProps, open: () => inputRef.current?.click() }
}
