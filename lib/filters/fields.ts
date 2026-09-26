import type { SportEvent } from "../types";

export type FieldType = "text" | "enum" | "array" | "date" | "number" | "bool";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  get: (e: SportEvent, today: string) => unknown;
  /** для enum/array — фиксированные варианты; иначе берутся из данных */
  options?: string[];
};

const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export function status(e: SportEvent, today: string): string {
  if (e.removedAt) return "Исключено";
  if (e.dateTo < today) return "Прошло";
  if (e.dateFrom <= today) return "Идёт";
  return "Предстоит";
}

export const FIELDS: FieldDef[] = [
  { key: "name", label: "Название", type: "text", get: (e) => e.name },
  { key: "dateFrom", label: "Дата начала", type: "date", get: (e) => e.dateFrom },
  { key: "dateTo", label: "Дата окончания", type: "date", get: (e) => e.dateTo },
  { key: "duration", label: "Длительность, дн.", type: "number", get: (e) => days(e.dateFrom, e.dateTo) + 1 },
  { key: "daysLeft", label: "Дней до начала", type: "number", get: (e, t) => days(t, e.dateFrom) },
  { key: "status", label: "Статус", type: "enum", get: status, options: ["Предстоит", "Идёт", "Прошло", "Исключено"] },
  { key: "year", label: "Год", type: "number", get: (e) => e.year },
  { key: "level", label: "Уровень", type: "enum", get: (e) => e.level },
  { key: "source", label: "Источник", type: "enum", get: (e) => (e.source === "ekp" ? "ЕКП" : "ФСП"), options: ["ЕКП", "ФСП"] },
  { key: "disciplines", label: "Дисциплины", type: "array", get: (e) => e.disciplines },
  { key: "region", label: "Субъект РФ", type: "enum", get: (e) => e.region },
  { key: "federalDistrict", label: "Фед. округ", type: "enum", get: (e) => e.federalDistrict },
  { key: "city", label: "Город", type: "text", get: (e) => e.city },
  { key: "isOnline", label: "Онлайн", type: "bool", get: (e) => e.isOnline },
  { key: "participants", label: "Участников", type: "number", get: (e) => e.participants },
  { key: "genderAge", label: "Пол / возраст", type: "text", get: (e) => e.genderAge },
  { key: "squad", label: "Состав", type: "enum", get: (e) => e.squad },
  { key: "note", label: "Примечание", type: "text", get: (e) => e.note },
  { key: "organizer", label: "Организатор", type: "text", get: (e) => e.organizer },
  { key: "linked", label: "Есть в ЕКП и ФСП", type: "bool", get: (e) => !!e.linkedId },
  { key: "firstSeenAt", label: "Впервые найдено", type: "date", get: (e) => e.firstSeenAt.slice(0, 10) },
  { key: "ekpId", label: "№ СМ в ЕКП", type: "text", get: (e) => e.ekpId },
];

export const FIELD_BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

export type OpDef = { key: string; label: string; arity: 0 | 1 | 2 | "list" };

export const OPS: Record<FieldType, OpDef[]> = {
  text: [
    { key: "contains", label: "содержит", arity: 1 },
    { key: "notContains", label: "не содержит", arity: 1 },
    { key: "eq", label: "равно", arity: 1 },
    { key: "startsWith", label: "начинается с", arity: 1 },
    { key: "empty", label: "пусто", arity: 0 },
    { key: "notEmpty", label: "не пусто", arity: 0 },
  ],
  enum: [
    { key: "in", label: "одно из", arity: "list" },
    { key: "notIn", label: "ни одно из", arity: "list" },
    { key: "empty", label: "пусто", arity: 0 },
    { key: "notEmpty", label: "не пусто", arity: 0 },
  ],
  array: [
    { key: "any", label: "любая из", arity: "list" },
    { key: "all", label: "все из", arity: "list" },
    { key: "none", label: "ни одной из", arity: "list" },
    { key: "empty", label: "пусто", arity: 0 },
  ],
  date: [
    { key: "eq", label: "равна", arity: 1 },
    { key: "before", label: "раньше", arity: 1 },
    { key: "after", label: "позже", arity: 1 },
    { key: "between", label: "между", arity: 2 },
    { key: "nextDays", label: "в ближайшие N дней", arity: 1 },
    { key: "lastDays", label: "за последние N дней", arity: 1 },
    { key: "thisMonth", label: "в этом месяце", arity: 0 },
    { key: "nextMonth", label: "в следующем месяце", arity: 0 },
    { key: "thisQuarter", label: "в этом квартале", arity: 0 },
    { key: "thisYear", label: "в этом году", arity: 0 },
    { key: "empty", label: "пусто", arity: 0 },
  ],
  number: [
    { key: "eq", label: "=", arity: 1 },
    { key: "neq", label: "≠", arity: 1 },
    { key: "lt", label: "<", arity: 1 },
    { key: "lte", label: "≤", arity: 1 },
    { key: "gt", label: ">", arity: 1 },
    { key: "gte", label: "≥", arity: 1 },
    { key: "between", label: "между", arity: 2 },
    { key: "empty", label: "пусто", arity: 0 },
  ],
  bool: [
    { key: "isTrue", label: "да", arity: 0 },
    { key: "isFalse", label: "нет", arity: 0 },
  ],
};
