"use client";

import { DatePicker } from "@gravity-ui/date-components";
import { dateTimeParse } from "@gravity-ui/date-utils";
import { Plus, TrashBin } from "@gravity-ui/icons";
import { Button, Checkbox, Icon, NumberInput, SegmentedRadioGroup, Select, TextInput } from "@gravity-ui/uikit";
import type { Group, Node, Rule } from "@/lib/filters/ast";
import { FIELD_BY_KEY, FIELDS, OPS } from "@/lib/filters/fields";

type Props = {
  value: Group;
  onChange: (g: Group) => void;
  options: Record<string, string[]>;
};

const defaultRule = (): Rule => ({ type: "rule", field: "dateFrom", op: "nextDays", value: 30 });

function DateValue({ value, onUpdate }: { value: string | undefined; onUpdate: (v: string | undefined) => void }) {
  return (
    <DatePicker
      size="m"
      format="DD.MM.YYYY"
      value={value ? (dateTimeParse(value) ?? null) : null}
      onUpdate={(d) => onUpdate(d ? d.format("YYYY-MM-DD") : undefined)}
      style={{ width: 150 }}
    />
  );
}

function RuleValue({ rule, onChange, options }: { rule: Rule; onChange: (r: Rule) => void; options: Record<string, string[]> }) {
  const field = FIELD_BY_KEY.get(rule.field);
  const op = field && OPS[field.type].find((o) => o.key === rule.op);
  if (!field || !op || op.arity === 0) return null;
  const set = (value: unknown) => onChange({ ...rule, value });
  const arr = Array.isArray(rule.value) ? (rule.value as (string | number)[]) : [];

  if (op.arity === "list") {
    const opts = options[field.key] ?? [];
    return (
      <Select
        multiple
        filterable
        hasClear
        placeholder="значения"
        width={320}
        value={arr.map(String)}
        onUpdate={set}
        options={opts.map((o) => ({ value: o, content: o }))}
      />
    );
  }
  if (field.type === "date" && !["nextDays", "lastDays"].includes(op.key)) {
    if (op.arity === 2) {
      return (
        <>
          <DateValue value={arr[0] as string | undefined} onUpdate={(v) => set([v ?? "", arr[1] ?? ""])} />
          <span className="muted">—</span>
          <DateValue value={arr[1] as string | undefined} onUpdate={(v) => set([arr[0] ?? "", v ?? ""])} />
        </>
      );
    }
    return <DateValue value={rule.value as string | undefined} onUpdate={set} />;
  }
  if (field.type === "number" || ["nextDays", "lastDays"].includes(op.key)) {
    if (op.arity === 2) {
      return (
        <>
          <NumberInput size="m" style={{ width: 100 }} value={arr[0] === "" || arr[0] == null ? null : Number(arr[0])} onUpdate={(v) => set([v ?? "", arr[1] ?? ""])} />
          <span className="muted">—</span>
          <NumberInput size="m" style={{ width: 100 }} value={arr[1] === "" || arr[1] == null ? null : Number(arr[1])} onUpdate={(v) => set([arr[0] ?? "", v ?? ""])} />
        </>
      );
    }
    return <NumberInput size="m" style={{ width: 110 }} value={rule.value == null || rule.value === "" ? null : Number(rule.value)} onUpdate={(v) => set(v ?? "")} />;
  }
  return <TextInput size="m" style={{ width: 240 }} value={String(rule.value ?? "")} onUpdate={set} placeholder="значение" />;
}

function RuleRow({ rule, onChange, onRemove, options }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; options: Record<string, string[]> }) {
  const field = FIELD_BY_KEY.get(rule.field) ?? FIELDS[0];
  const ops = OPS[field.type];
  return (
    <div className="fb-row">
      <Select
        width={200}
        filterable
        value={[field.key]}
        onUpdate={([key]) => {
          const f = FIELD_BY_KEY.get(key)!;
          onChange({ type: "rule", field: key, op: OPS[f.type][0].key, value: undefined });
        }}
        options={FIELDS.map((f) => ({ value: f.key, content: f.label }))}
      />
      <Select
        width={190}
        value={[rule.op]}
        onUpdate={([op]) => {
          const next = ops.find((o) => o.key === op)!;
          const cur = ops.find((o) => o.key === rule.op);
          onChange({ ...rule, op, value: cur?.arity === next.arity ? rule.value : undefined });
        }}
        options={ops.map((o) => ({ value: o.key, content: o.label }))}
      />
      <RuleValue rule={rule} onChange={onChange} options={options} />
      <Button view="flat" onClick={onRemove} title="Удалить условие">
        <Icon data={TrashBin} />
      </Button>
    </div>
  );
}

function GroupEditor({ group, onChange, onRemove, options, depth }: { group: Group; onChange: (g: Group) => void; onRemove?: () => void; options: Record<string, string[]>; depth: number }) {
  const setChild = (i: number, n: Node | null) => {
    const children = [...group.children];
    if (n) children[i] = n;
    else children.splice(i, 1);
    onChange({ ...group, children });
  };
  return (
    <div className={`fb-group fb-group_${group.op}${group.not ? " fb-group_not" : ""}`}>
      <div className="fb-row">
        <SegmentedRadioGroup
          size="m"
          value={group.op}
          onUpdate={(op) => onChange({ ...group, op: op as Group["op"] })}
          options={[
            { value: "and", content: "И — все условия" },
            { value: "or", content: "ИЛИ — любое" },
          ]}
        />
        <Checkbox checked={!!group.not} onUpdate={(not) => onChange({ ...group, not })} content="НЕ (инвертировать)" />
        {onRemove && (
          <Button view="flat-danger" size="s" onClick={onRemove}>
            Удалить группу
          </Button>
        )}
      </div>
      {group.children.map((c, i) =>
        c.type === "rule" ? (
          <RuleRow key={i} rule={c} onChange={(r) => setChild(i, r)} onRemove={() => setChild(i, null)} options={options} />
        ) : (
          <GroupEditor key={i} group={c} onChange={(g) => setChild(i, g)} onRemove={() => setChild(i, null)} options={options} depth={depth + 1} />
        ),
      )}
      <div className="fb-row">
        <Button size="s" onClick={() => onChange({ ...group, children: [...group.children, defaultRule()] })}>
          <Icon data={Plus} /> Условие
        </Button>
        {depth < 4 && (
          <Button size="s" view="outlined" onClick={() => onChange({ ...group, children: [...group.children, { type: "group", op: group.op === "and" ? "or" : "and", children: [defaultRule()] }] })}>
            <Icon data={Plus} /> Группа
          </Button>
        )}
      </div>
    </div>
  );
}

export function FilterBuilder({ value, onChange, options }: Props) {
  return <GroupEditor group={value} onChange={onChange} options={options} depth={0} />;
}

/** Сколько условий в дереве — для счётчика на кнопке. */
export function countRules(g: Group): number {
  return g.children.reduce((n, c) => n + (c.type === "rule" ? 1 : countRules(c)), 0);
}
