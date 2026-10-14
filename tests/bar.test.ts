import { expect, test } from 'claude-code/testing'

import { CONTROL, NEW_KEYS, STEP_KEY, TREE_KEY, buttonPart, partText, partWidth, partsWidth, stepKey, textPart, treeKey, treeOfKey } from '../lib/bar'
import { QUIET, S } from '../lib/style'

test('keys: a control of the overview is addressed by its tree, and its step when it is a point of the graph', () => {
  expect(TREE_KEY).toBe('~tree:')
  expect(STEP_KEY).toBe('~step:')
  expect(treeKey('cloud-first')).toBe('~tree:cloud-first')
  // the second line of an entry is another button of the same tree
  expect(treeKey('cloud-first', 1)).toBe('~tree:cloud-first:2')
  expect(stepKey('cloud-first', 'c2')).toBe('~step:cloud-first:c2')
  expect(treeOfKey('~tree:cloud-first')).toEqual({ tree: 'cloud-first', step: null })
  expect(treeOfKey('~tree:cloud-first:2')).toEqual({ tree: 'cloud-first', step: null })
  expect(treeOfKey('~step:cloud-first:c2')).toEqual({ tree: 'cloud-first', step: 'c2' })
})

test('keys: any other key says nothing about a tree, and a key made from a name reads back as it was made', () => {
  for (const key of ['', 'n3', '~up', '~tab-main', '~new-name', '~tree:', '~tree::2', '~step:', '~step:main', '~step:main:', '~step::n1', 'tree:main']) {
    expect(treeOfKey(key), JSON.stringify(key)).toBeNull()
  }
  for (const tree of ['main', 'try-01', '2', 'a', 'long-experiment-name-number-0005', 'x2']) {
    expect(treeOfKey(treeKey(tree)), tree).toEqual({ tree, step: null })
    expect(treeOfKey(treeKey(tree, 1)), tree).toEqual({ tree, step: null })
    for (const id of ['n0', 'x-1', '2', 'step-with-many-hyphens']) expect(treeOfKey(stepKey(tree, id)), `${tree} ${id}`).toEqual({ tree, step: id })
  }
})

test('keys: every control starts with the mark no node id can start with, so that a control is never taken for a node', () => {
  expect(CONTROL).toBe('~')
  const all = [treeKey('main'), treeKey('main', 1), stepKey('main', 'n0'), ...Object.values(NEW_KEYS)]
  for (const key of all) expect(key.startsWith(CONTROL), key).toBe(true)
  // the controls of the form for a new tree are five and have a key each
  expect(Object.keys(NEW_KEYS).sort()).toEqual(['at', 'cancel', 'create', 'name', 'title'])
  expect(new Set(Object.values(NEW_KEYS)).size).toBe(5)
})

test('parts: a button with a hotkey is drawn `key: label`, and so is as wide as both; a text is as wide as it reads', () => {
  const plain = buttonPart('~open', { do: 'open' }, [S('open')])
  expect(plain).toEqual({ kind: 'button', key: '~open', hotkey: null, action: { do: 'open' }, spans: [{ text: 'open' }], dim: false })
  const keyed = buttonPart('~record', { do: 'record' }, [S('record here')], { hotkey: 'r', dim: true })
  expect(keyed).toMatchObject({ hotkey: 'r', dim: true })
  expect(partText(plain)).toBe('open')
  expect(partText(keyed)).toBe('r: record here')
  expect(partWidth(plain)).toBe(4)
  expect(partWidth(keyed)).toBe(14)
  const hint = textPart([S('⏎: open', QUIET)])
  expect(partText(hint)).toBe('⏎: open')
  expect(partWidth(hint)).toBe(7)
  expect(partsWidth([plain, keyed, hint])).toBe(25)
  expect(partsWidth([])).toBe(0)
  // a label in Chinese takes two columns a character
  expect(partWidth(buttonPart('~back', { do: 'back' }, [S('返回')], { hotkey: 't' }))).toBe(7)
})
