export function equal<T>(actual: T, expected: T, message: string): void { if (actual !== expected) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`); }
export function ok(value: unknown, message: string): void { if (!value) throw new Error(message); }
export function match(value: string, regex: RegExp, message: string): void { if (!regex.test(value)) throw new Error(`${message}: ${value}`); }
