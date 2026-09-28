import type { ReactNode } from 'react'

export interface Column<T> {
  key: string
  header: string
  render: (row: T) => ReactNode
  numeric?: boolean
  rating?: boolean
  frozen?: boolean
  sortValue?: (row: T) => number | string
}

export interface SortState {
  key: string
  dir: 'asc' | 'desc'
}

export type RowTone = 'attention' | 'yours'

/** Ratings are 40-99 integers (CLAUDE.md); round a consensus value for display. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with Table's own rendering
export function formatRating(value: number): number {
  return Math.round(value)
}

interface TableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  caption: string
  captionVisible?: boolean
  dense?: boolean
  selectedRowKey?: string | null
  onRowClick?: (row: T) => void
  sort?: SortState
  onSortChange?: (key: string) => void
  /** Sets `data-tone` on the row (styled in primitives.css); omit for the default, untoned row. */
  rowTone?: (row: T) => RowTone | undefined
}

/** Dense data table living in a sunken panel (docs/DESIGN.md §8). Numbers right-aligned tabular. */
export function Table<T>({
  columns,
  rows,
  rowKey,
  caption,
  captionVisible = false,
  dense = false,
  selectedRowKey,
  onRowClick,
  sort,
  onSortChange,
  rowTone,
}: TableProps<T>) {
  return (
    <div className="gg-table-wrap">
      <table className={dense ? 'gg-table gg-table--dense' : 'gg-table'}>
        <caption className={captionVisible ? undefined : 'gg-vh'}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((col) => {
              const sortable = Boolean(col.sortValue && onSortChange)
              const active = sort?.key === col.key
              return (
                <th
                  key={col.key}
                  scope="col"
                  className={[col.numeric ? 'gg-num' : '', col.frozen ? 'gg-col-frozen' : '']
                    .filter(Boolean)
                    .join(' ')}
                  aria-sort={
                    active
                      ? sort!.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : sortable
                        ? 'none'
                        : undefined
                  }
                >
                  {sortable ? (
                    <button
                      type="button"
                      className="gg-button gg-button--ghost"
                      style={{
                        minHeight: 'auto',
                        padding: 0,
                        gap: 4,
                        font: 'inherit',
                        color: 'inherit',
                        boxShadow: 'none',
                      }}
                      onClick={() => onSortChange!(col.key)}
                    >
                      {col.header}
                      {active && <span aria-hidden="true">{sort!.dir === 'asc' ? '▲' : '▼'}</span>}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const key = rowKey(row)
            const selected = key === selectedRowKey
            const tone = rowTone?.(row)
            return (
              <tr
                key={key}
                aria-selected={selected}
                data-tone={tone}
                tabIndex={onRowClick ? 0 : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          onRowClick(row)
                        }
                      }
                    : undefined
                }
                style={onRowClick ? { cursor: 'pointer' } : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={[
                      col.numeric ? 'gg-num' : '',
                      col.rating ? 'gg-rating' : '',
                      col.frozen ? 'gg-col-frozen' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
