import { z } from 'zod'

export { z }

export function emptyStringToUndefined(value) {
  return typeof value === 'string' && value.trim() === '' ? undefined : value
}
