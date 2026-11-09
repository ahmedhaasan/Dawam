export type ServiceResult<T, E> = { ok: true; value: T } | { ok: false; error: E };
