import type { ReactNode } from 'react'
import { ToastRegion, type ToastItem } from '../primitives'
import { Rail, type NavItem } from './Rail'
import { Strip, type StripProps } from './Strip'

interface AppFrameProps {
  strip: StripProps
  navItems: NavItem[]
  currentScreen: string
  onSelectScreen: (id: string) => void
  toasts: ToastItem[]
  onDismissToast: (id: string) => void
  children: ReactNode
}

/** Strip + Rail/Tabs + Board (docs/DESIGN.md §4). Screens render into `children` as the Board content. */
export function AppFrame({
  strip,
  navItems,
  currentScreen,
  onSelectScreen,
  toasts,
  onDismissToast,
  children,
}: AppFrameProps) {
  return (
    <div className="gg-app">
      <Rail items={navItems} current={currentScreen} onSelect={onSelectScreen} />
      <div className="gg-main">
        <Strip {...strip} />
        <main className="gg-board">{children}</main>
      </div>
      <ToastRegion toasts={toasts} onDismiss={onDismissToast} />
    </div>
  )
}
