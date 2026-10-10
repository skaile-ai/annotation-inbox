import { de } from './de'
import { en } from './en'
import type { MessageKey, Messages } from './en'

export type Locale = 'en' | 'de'
export type { MessageKey, Messages }

const catalogs: Record<Locale, Messages> = { en, de }

/** Looks up one message and fills its `{name}` placeholders. */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

/**
 * `t(key, params)` for one locale, with `overrides` laid over the catalog.
 * An unknown locale falls back to English rather than throwing: a host's
 * locale string is not this package's to validate.
 */
export function createTranslator(locale: Locale = 'en', overrides: Partial<Messages> = {}): Translate {
  const catalog = catalogs[locale] ?? en
  return (key, params = {}) =>
    (overrides[key] ?? catalog[key]).replace(/\{(\w+)\}/g, (match, name: string) =>
      name in params ? String(params[name]) : match)
}
