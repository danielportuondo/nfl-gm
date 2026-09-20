import type { GameSettings } from '@contracts/index'

export interface GameSettingsFieldsProps {
  value: GameSettings
  onChange: (patch: Partial<GameSettings>) => void
}

/** The three game settings, one control each. New Game and Settings share it so the vocabulary stays one. */
export function GameSettingsFields({ value, onChange }: GameSettingsFieldsProps) {
  return (
    <>
      <div className="gg-field">
        <label className="gg-field__label" htmlFor="gg-setting-trade-strictness">
          Trade strictness
        </label>
        <select
          id="gg-setting-trade-strictness"
          value={value.tradeStrictness}
          onChange={(e) =>
            onChange({ tradeStrictness: e.target.value as GameSettings['tradeStrictness'] })
          }
        >
          <option value="lenient">Lenient</option>
          <option value="balanced">Balanced</option>
          <option value="strict">Strict</option>
          <option value="ruthless">Ruthless</option>
        </select>
      </div>

      <div className="gg-field">
        <label className="gg-field__label" htmlFor="gg-setting-offer-frequency">
          AI offer frequency
        </label>
        <select
          id="gg-setting-offer-frequency"
          value={value.aiOfferFrequency}
          onChange={(e) =>
            onChange({ aiOfferFrequency: e.target.value as GameSettings['aiOfferFrequency'] })
          }
        >
          <option value="rare">Rare</option>
          <option value="normal">Normal</option>
          <option value="aggressive">Aggressive</option>
        </select>
      </div>

      <label className="gg-field gg-field--check">
        <input
          type="checkbox"
          checked={value.injuries}
          onChange={(e) => onChange({ injuries: e.target.checked })}
        />
        Injuries
      </label>
    </>
  )
}
