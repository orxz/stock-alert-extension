// src/protocol/validators.ts
// RPC payload 校验组合子：纯 TS 手写，零第三方依赖。
// 设计参考 io-ts / zod 的组合子风格——每个组合子是 (input: unknown) => ValidationResult<T>。
// strictObject / partialStrictObject 拒绝未知键与原型污染键（__proto__/prototype/constructor）。
import { normalizeStockCode } from '../domain/stock.js';
import type { StockCode, GroupId, UserDataRevision } from '../domain/brands.js';

/** 校验结果：成功携带 value，失败携带 errors。 */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly string[] };

/** 校验器：接受 unknown，返回 ValidationResult<T>。 */
export type Validator<T> = (input: unknown) => ValidationResult<T>;

/** 从校验器类型推断其成功值类型（ValidatedValue<typeof validator> => T）。 */
export type ValidatedValue<V> = V extends (input: unknown) => ValidationResult<infer T> ? T : never;

// ===== 内部辅助构造子 =====

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail(...errors: string[]): ValidationResult<never> {
  return { ok: false, errors };
}

// ===== 原型污染防御 =====

/** 任何对象层级都禁止的危险键——读取即拒绝，防止 __proto__/constructor 污染。 */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

/** 自定义分组 ID 规则：g_all 计算视图或 g_<字母数字>（v1.3 storage.js 用 'g_' + timestamp 生成）。 */
const GROUP_ID_RE = /^g_all$|^g_[a-zA-Z0-9]+$/;

/** UserDataRevision 规则：sha256:<hex>（与 §3 乐观并发控制一致；测试夹具允许短 hex）。 */
const REVISION_RE = /^sha256:[0-9a-fA-F]+$/;

// ===== 基础标量组合子 =====

/** 任意字符串校验器。 */
export function string(): Validator<string> {
  return (input) => (typeof input === 'string' ? ok(input) : fail('expected a string'));
}

/** 布尔校验器。 */
export function boolean(): Validator<boolean> {
  return (input) => (typeof input === 'boolean' ? ok(input) : fail('expected a boolean'));
}

/** 字面量枚举校验器：input 必须是给定字面量之一。 */
export function literalEnum<T extends string | number>(...values: readonly T[]): Validator<T> {
  return (input) => {
    for (const v of values) {
      if (input === v) return ok(input as T);
    }
    return fail(`expected one of [${values.join(', ')}]`);
  };
}

/** 非空修剪字符串：trim 后长度 > 0。用于 query / 股票名等自由文本。 */
export function nonEmptyTrimmedString(): Validator<string> {
  return (input) => {
    if (typeof input !== 'string') return fail('expected a string');
    const trimmed = input.trim();
    return trimmed.length > 0 ? ok(trimmed) : fail('expected a non-empty string');
  };
}

// ===== 数组组合子 =====

/** 数组校验器：每项经 element 校验；首个失败项立即短路。 */
export function array<T>(element: Validator<T>): Validator<readonly T[]> {
  return (input) => {
    if (!Array.isArray(input)) return fail('expected an array');
    const out: T[] = [];
    for (let i = 0; i < input.length; i++) {
      const result = element(input[i]);
      if (!result.ok) {
        return fail(...result.errors.map((e) => `[${i}]: ${e}`));
      }
      out.push(result.value);
    }
    return ok(out);
  };
}

/** 去重数组校验器：在 array 基础上拒绝重复项（用 Set 检测）。 */
export function duplicateFreeArray<T>(element: Validator<T>): Validator<readonly T[]> {
  const base = array(element);
  return (input) => {
    const result = base(input);
    if (!result.ok) return result;
    const seen = new Set<unknown>();
    for (const item of result.value) {
      if (seen.has(item)) {
        return fail(`duplicate value: ${String(item)}`);
      }
      seen.add(item);
    }
    return ok(result.value);
  };
}

/** 上限数组校验器：先验证长度不超过 max，再委托 array 校验器校验。element 必须是 Validator<readonly T[]>。 */
export function maxItems<T>(max: number, element: Validator<readonly T[]>): Validator<readonly T[]> {
  return (input) => {
    if (Array.isArray(input) && input.length > max) {
      return fail(`array must have at most ${max} items (got ${input.length})`);
    }
    return element(input);
  };
}

// ===== 严格对象组合子 =====

type ValidatorMap = Readonly<Record<string, Validator<unknown>>>;

function rejectForbiddenAndUnknownKeys(input: Record<string, unknown>, fields: ValidatorMap): readonly string[] | null {
  const keys = Object.keys(input);
  for (const key of keys) {
    if (FORBIDDEN_KEYS.has(key)) return [`forbidden key: ${key}`];
  }
  const known = new Set(Object.keys(fields));
  for (const key of keys) {
    if (!known.has(key)) return [`unknown key: ${key}`];
  }
  return null;
}

/**
 * 严格对象校验器：拒绝原型污染键与未知键；每个已知键经对应校验器。
 * 顶层 payload 与嵌套 patch 都复用此校验器，确保任何未知/危险键在进入 Application 层前被拒绝。
 */
export function strictObject<M extends ValidatorMap>(
  fields: M
): Validator<{ readonly [K in keyof M]: ValidatedValue<M[K]> }> {
  return (input) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return fail('expected a plain object');
    }
    const obj = input as Record<string, unknown>;
    const guardErrors = rejectForbiddenAndUnknownKeys(obj, fields);
    if (guardErrors) return fail(...guardErrors);
    const out: Record<string, unknown> = {};
    for (const [key, validator] of Object.entries(fields)) {
      const result = validator(obj[key]);
      if (!result.ok) {
        return fail(...result.errors.map((e) => `${key}: ${e}`));
      }
      out[key] = result.value;
    }
    return ok(out as { readonly [K in keyof M]: ValidatedValue<M[K]> });
  };
}

/**
 * 严格 Partial 对象校验器：所有字段可选，但仍拒绝原型污染键与未知键。
 * 用于 BoardConfig patch——只允许 viewMode/sortField/sortDirection/priceHidden 的子集。
 */
export function partialStrictObject<M extends ValidatorMap>(
  fields: M
): Validator<{ readonly [K in keyof M]?: ValidatedValue<M[K]> }> {
  return (input) => {
    if (typeof input !== 'object' || input === null || Array.isArray(input)) {
      return fail('expected a plain object');
    }
    const obj = input as Record<string, unknown>;
    const guardErrors = rejectForbiddenAndUnknownKeys(obj, fields);
    if (guardErrors) return fail(...guardErrors);
    const out: Record<string, unknown> = {};
    for (const [key, validator] of Object.entries(fields)) {
      if (key in obj) {
        const result = validator(obj[key]);
        if (!result.ok) {
          return fail(...result.errors.map((e) => `${key}: ${e}`));
        }
        out[key] = result.value;
      }
    }
    return ok(out as { readonly [K in keyof M]?: ValidatedValue<M[K]> });
  };
}

// ===== ID 与领域标量组合子 =====

/** 股票代码校验器：复用 domain 的 normalizeStockCode，返回规范化的 StockCode 品牌。 */
export function stockCode(): Validator<StockCode> {
  return (input) => {
    const normalized = normalizeStockCode(input);
    return normalized === null ? fail('invalid stock code') : ok(normalized);
  };
}

/** 分组 ID 校验器：g_all 计算视图或 g_<字母数字> 自定义分组（容错接受 g_all）。 */
export function groupId(): Validator<GroupId> {
  return (input) => {
    if (typeof input !== 'string') return fail('expected a string');
    return GROUP_ID_RE.test(input) ? ok(input as GroupId) : fail('invalid group id');
  };
}

/** UserDataRevision 校验器：形如 sha256:<hex>，用于乐观并发控制的 expectedRevision。 */
export function revision(): Validator<UserDataRevision> {
  return (input) => {
    if (typeof input !== 'string') return fail('expected a string');
    return REVISION_RE.test(input) ? ok(input as UserDataRevision) : fail('invalid revision');
  };
}

/** 分组名校验器：trim 后 1–12 Unicode 码点（[...name].length 计算码点，兼容 emoji/CJK）。 */
export function groupName(): Validator<string> {
  return (input) => {
    if (typeof input !== 'string') return fail('expected a string');
    const trimmed = input.trim();
    const codePoints = [...trimmed].length;
    if (codePoints < 1 || codePoints > 12) {
      return fail('group name must be 1–12 Unicode code points after trim');
    }
    return ok(trimmed);
  };
}
