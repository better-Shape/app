/**
 * The value a preceding assertion already guaranteed, without a non-null assertion in the
 * body. A missing match should say which pattern failed rather than throw a property access
 * on null.
 *
 * `NonNullable<T>` is what makes the helper carry its own guarantee: with a plain `T` return
 * the caller still holds `number | null` and has to assert again at every use.
 */
export const must = <T>(value: T | null | undefined, what: string): NonNullable<T> => {
    if (value === null || value === undefined) throw new Error(`expected ${what}`);
    return value as NonNullable<T>;
};
