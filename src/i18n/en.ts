/**
 * The English catalog, and the source of truth for the key set: `de.ts` and
 * every `messages` override are typed against it, so a key added here is a
 * compile error there until it is translated.
 *
 * `{name}` placeholders are filled by `translate()`; nothing else is
 * interpreted.
 */
export const en = {
  title: 'Annotations',
  filterLabel: 'Show',
  'status.open': 'Open',
  'status.closed': 'Closed',
  'status.all': 'All',
  'item.implemented': 'Implemented',
  'item.rejected': 'Rejected',
  'item.open': 'Open',
  'item.resolvedBy': 'by {name}',
  'item.route': 'Route',
  'item.element': 'Element',
  'session': 'Session {id}',
  implement: 'Implement',
  reject: 'Reject',
  'reject.reason': 'Why is this note rejected?',
  'reject.confirm': 'Reject note',
  'reject.cancel': 'Cancel',
  'reject.required': 'A rejection needs a reason.',
  empty: 'No annotations.',
  loading: 'Loading…',
  error: 'Annotations could not be loaded: {message}',
  refresh: 'Refresh',
  'error.rejectedNeedsResolution': 'A rejected annotation needs a resolution.',
  'error.noIds': 'No annotation ids were given.',
} as const

export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>
