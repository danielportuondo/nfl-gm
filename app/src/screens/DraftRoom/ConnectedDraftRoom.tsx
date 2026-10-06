import { useGameStore } from '@store/index'
import { DraftRoom, type DraftRoomProps } from './DraftRoom'

type StoreFilled = 'onSimNextPick' | 'onProposeTrade' | 'onOpenTradeCenter'

export type ConnectedDraftRoomProps = Omit<DraftRoomProps, StoreFilled> &
  Partial<Pick<DraftRoomProps, StoreFilled>>

/** Fills the pause-and-trade-up controls (QA M3) from the store unless the caller passes them. */
export function ConnectedDraftRoom(props: ConnectedDraftRoomProps) {
  const actions = useGameStore((s) => s.actions)
  return (
    <DraftRoom
      onSimNextPick={actions.simNextPick}
      onProposeTrade={actions.proposeTrade}
      onOpenTradeCenter={() => actions.goTo('trade')}
      {...props}
    />
  )
}
