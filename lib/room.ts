// How much room each part of the pane asks for: the numbers of rows from which the layouts spend rows on looks
// (blank rows that set things off, a line of spine between steps) and the rows the forms take. Shared by the
// layout of the tree and the layout of the overview, so that both give way in the same order as a pane shrinks.

/** A blank row sets the rail off from the strip and the keys from the rest from this many rows up (always, while a filter is on). */
export const AIRY_MIN_ROWS = 20
/** From this many rows up the details have blank rows around them and between their parts, when they still fit whole. */
export const AIRY_DETAIL_ROWS = 26
/** From this many rows up the rail has a blank line of spine between its steps, when the whole rail still fits with them. */
export const SPACER_MIN_ROWS = 24
/** The line saying where a tree began is drawn from this many rows up; a smaller pane keeps the room for the rail. */
export const ORIGIN_MIN_ROWS = 16
/** Rows the edit form takes: title, status, summary, buttons. */
export const EDIT_ROWS = 4
/** Rows the form for a new tree takes: title, name, version, what it is for, a line for what went wrong, buttons. */
export const NEWTREE_ROWS = 6

/** The lines the keys at the bottom may take: three from 24 rows, two from 12, else one. */
export function footerLines(rows: number): number {
  return rows >= 24 ? 3 : rows >= 12 ? 2 : 1
}
