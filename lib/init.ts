// `/decide init`: the prompt that asks the model to look through the project and record where it starts.
//
// Like the system-prompt section (prompt.ts), the text is for the model, so it is English whatever
// language the pane is in; the last line says what the records are written in.

import { oneLine } from './width'

/** How many nodes init asks for in all, the starting point included. */
export const INIT_MAX_NODES = 8

/** What the records are written in: a language the mod knows, or whichever the person writes in. */
export type InitWrite = 'zh' | 'en' | 'follow'

const LANGUAGE: Record<InitWrite, string> = {
  zh: 'Chinese',
  en: 'English',
  follow: 'the language the person writes in (English if you cannot tell)',
}

/** The task init hands the model. The project's name goes in as the person gave it (or the folder's). */
export function initPrompt(input: { title: string; write: InitWrite }): string {
  return [
    // (not led by a slash: the engine reads a prompt that begins with one as a command the person typed, and refuses it)
    `Set up the decision tree for this project, "${oneLine(input.title)}" (the person ran /decide init). Recording is on and the tree is empty.`,
    '',
    '1. Call decision_tree. If it already lists decisions (retracted ones do not count), record nothing and say the tree is already set up.',
    "2. Look through the project, quickly (a dozen reads or so): README and docs, notes, CLAUDE.md or AGENTS.md, decision records (docs/adr, DECISIONS.md), CHANGELOG, `git log --oneline -30` and tags, the main config and manifest files, the layout of the code. Change no file, run none of the project's code, start no jobs, and skip secrets (.env, keys, credentials).",
    '3. Record the starting point with decision_record: parent null, kind "milestone", status "adopted", trunk true. The title says what the project is and where it stands now; the summary is one line; add a rationale only if the project states one; sources are the files you used.',
    `4. Then record the decisions the project has clearly already made, at most ${INIT_MAX_NODES - 1}, each under the starting point or under the decision it follows from. Status: adopted for what the files say is decided, in use or done; rejected for alternatives they say were dropped; planned or proposed for what they list as next or still open. Give sources, and decidedAt (YYYY-MM-DD) when a commit or a document dates the decision. Leave decidedBy out. Never invent a decision or a reason: what the files do not show, leave out.`,
    '5. Do not ask the person anything. Finish with two or three sentences: what you recorded and what you could not tell.',
    '',
    `Write titles, summaries, rationales and your closing message in ${LANGUAGE[input.write]}; technical terms stay in English.`,
  ].join('\n')
}
