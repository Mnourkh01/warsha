import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { TINTS } from "../../lib/tints";
import { useStrings } from "../../lib/i18n";
import {
  HTTP_METHODS,
  LIST_KINDS,
  PLAN_PRIORITIES,
  MAX_ACCEPTANCE,
  MAX_ACCEPTANCE_LEN,
  MAX_DESC,
  MAX_FIELDS,
  MAX_FIELD_STR,
  MAX_LABEL,
  MAX_PATH,
  PATH_KINDS,
  type HttpMethod,
  type PlanEffort,
  type PlanField,
  type PlanNode,
} from "../../store/plans";
import { KIND_META } from "./nodeKinds";

/** "name: type | note" per line -> PlanField[]. Loose on purpose: a line without a
 *  colon becomes a field named by the whole line with the default type. */
function parseFields(text: string): PlanField[] {
  const fields: PlanField[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const colon = trimmed.indexOf(":");
    const name = (colon === -1 ? trimmed : trimmed.slice(0, colon)).trim();
    if (!name) continue;
    const rest = colon === -1 ? "" : trimmed.slice(colon + 1);
    const bar = rest.indexOf("|");
    const type = (bar === -1 ? rest : rest.slice(0, bar)).trim() || "text";
    const note = bar === -1 ? undefined : rest.slice(bar + 1).trim() || undefined;
    fields.push({
      name: name.slice(0, MAX_FIELD_STR),
      type: type.slice(0, MAX_FIELD_STR),
      note: note?.slice(0, MAX_FIELD_STR),
    });
    if (fields.length >= MAX_FIELDS) break;
  }
  return fields;
}

function parseAcceptance(text: string): string[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.slice(0, MAX_ACCEPTANCE_LEN))
    .slice(0, MAX_ACCEPTANCE);
}

function fieldsText(fields: PlanField[] | undefined): string {
  return (fields ?? [])
    .map((f) => `${f.name}: ${f.type}${f.note ? ` | ${f.note}` : ""}`)
    .join("\n");
}

/** Right panel for the selected block. Text lists (acceptance, fields) keep a local
 *  draft for DISPLAY (so mid-typing blank lines are not filtered away) but commit the
 *  parsed value on every change - nothing is lost if the panel unmounts mid-edit. */
export function Inspector({
  node,
  phases,
  onPatch,
  onDelete,
}: {
  node: PlanNode;
  phases: PlanNode[];
  onPatch: (patch: Partial<Omit<PlanNode, "id">>) => void;
  onDelete: () => void;
}) {
  const t = useStrings();
  const [acceptDraft, setAcceptDraft] = useState(() => (node.acceptance ?? []).join("\n"));
  const [fieldsDraft, setFieldsDraft] = useState(() => fieldsText(node.fields));
  useEffect(() => {
    setAcceptDraft((node.acceptance ?? []).join("\n"));
    setFieldsDraft(fieldsText(node.fields));
    // Reset drafts only when the selection moves to another block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  const Icon = KIND_META[node.kind].icon;
  return (
    <aside className="plan-inspector" aria-label={t.inspectorTitle}>
      <div className="plan-inspector-kind">
        <Icon size={14} />
        <span>{t.planKind[node.kind]}</span>
      </div>
      <label className="field">
        <span className="field-label">{t.inspLabel}</span>
        <input
          className="input bidi-auto"
          dir="auto"
          maxLength={MAX_LABEL}
          value={node.label}
          onChange={(e) => onPatch({ label: e.target.value })}
        />
      </label>
      <label className="field">
        <span className="field-label">{t.inspDescription}</span>
        <textarea
          className="input plan-textarea bidi-auto"
          dir="auto"
          rows={4}
          maxLength={MAX_DESC}
          value={node.description ?? ""}
          onChange={(e) => onPatch({ description: e.target.value || undefined })}
        />
      </label>
      <div className="field">
        <span className="field-label">{t.inspColor}</span>
        <div className="plan-swatches" role="group" aria-label={t.inspColor}>
          <button
            className={`plan-swatch none${!node.tint ? " on" : ""}`}
            title={t.inspNoColor}
            aria-label={t.inspNoColor}
            onClick={() => onPatch({ tint: undefined })}
          />
          {TINTS.map((tint) => (
            <button
              key={tint}
              className={`plan-swatch${node.tint === tint ? " on" : ""}`}
              style={{ background: `var(--tint-${tint})` }}
              title={tint}
              aria-label={tint}
              onClick={() => onPatch({ tint })}
            />
          ))}
        </div>
      </div>
      <div className="field">
        <span className="field-label">{t.inspStatus}</span>
        <div className="seg">
          <button
            className={!node.status ? "on" : ""}
            onClick={() => onPatch({ status: undefined })}
          >
            {t.statusTodo}
          </button>
          <button
            className={node.status === "doing" ? "on" : ""}
            onClick={() => onPatch({ status: "doing" })}
          >
            {t.statusDoing}
          </button>
          <button
            className={node.status === "done" ? "on" : ""}
            onClick={() => onPatch({ status: "done" })}
          >
            {t.statusDone}
          </button>
        </div>
      </div>
      {node.kind !== "phase" && node.kind !== "note" && (
        <div className="field">
          <span className="field-label">{t.inspEffort}</span>
          <div className="seg">
            {(["s", "m", "l"] as PlanEffort[]).map((e) => (
              <button
                key={e}
                className={node.effort === e ? "on" : ""}
                aria-label={e === "s" ? t.effortSmall : e === "m" ? t.effortMedium : t.effortLarge}
                onClick={() => onPatch({ effort: node.effort === e ? undefined : e })}
              >
                {e.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}
      {node.kind !== "phase" && node.kind !== "note" && (
        <div className="field">
          <span className="field-label">{t.inspPriority}</span>
          <div className="seg">
            {PLAN_PRIORITIES.map((p) => (
              <button
                key={p}
                className={node.priority === p ? "on" : ""}
                onClick={() => onPatch({ priority: node.priority === p ? undefined : p })}
              >
                {p === "must" ? t.priorityMust : p === "should" ? t.priorityShould : t.priorityCould}
              </button>
            ))}
          </div>
        </div>
      )}
      {node.kind !== "note" && (
        <div className="plan-two">
          <label className="field">
            <span className="field-label">{t.inspOwner}</span>
            <input
              className="input bidi-auto"
              dir="auto"
              maxLength={80}
              value={node.owner ?? ""}
              onChange={(e) => onPatch({ owner: e.target.value || undefined })}
            />
          </label>
          <label className="field">
            <span className="field-label">{t.inspDue}</span>
            <input
              className="input bidi-auto"
              dir="auto"
              maxLength={40}
              value={node.due ?? ""}
              onChange={(e) => onPatch({ due: e.target.value || undefined })}
            />
          </label>
        </div>
      )}
      <label className="field">
        <span className="field-label">{t.inspLink}</span>
        <input
          className="input mono"
          placeholder="https://..."
          maxLength={300}
          value={node.link ?? ""}
          onChange={(e) => onPatch({ link: e.target.value || undefined })}
        />
      </label>
      {node.kind !== "phase" && (
        <label className="field">
          <span className="field-label">{t.inspPhase}</span>
          <select
            className="select"
            value={node.phaseId ?? ""}
            onChange={(e) => onPatch({ phaseId: e.target.value || undefined })}
          >
            <option value="">{t.inspNoPhase}</option>
            {phases.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {node.kind === "api" && (
        <label className="field">
          <span className="field-label">{t.inspMethod}</span>
          <select
            className="select"
            value={node.method ?? "GET"}
            onChange={(e) => onPatch({ method: e.target.value as HttpMethod })}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
      )}
      {(PATH_KINDS as readonly string[]).includes(node.kind) && (
        <label className="field">
          <span className="field-label">{node.kind === "screen" ? t.inspRoute : t.inspPath}</span>
          <input
            className="input mono"
            placeholder={node.kind === "screen" ? "/login" : "/api/things"}
            maxLength={MAX_PATH}
            value={node.path ?? ""}
            onChange={(e) => onPatch({ path: e.target.value || undefined })}
          />
        </label>
      )}
      {(LIST_KINDS as readonly string[]).includes(node.kind) && (
        <label className="field">
          <span className="field-label">
            {node.kind === "decision"
              ? t.inspOptions
              : node.kind === "test"
                ? t.inspChecks
                : t.inspAcceptance}{" "}
            <span className="field-hint">{t.inspAcceptanceHint}</span>
          </span>
          <textarea
            className="input plan-textarea"
            rows={4}
            value={acceptDraft}
            onChange={(e) => {
              setAcceptDraft(e.target.value);
              const acceptance = parseAcceptance(e.target.value);
              onPatch({ acceptance: acceptance.length > 0 ? acceptance : undefined });
            }}
          />
        </label>
      )}
      {node.kind === "data" && (
        <label className="field">
          <span className="field-label">
            {t.inspFields} <span className="field-hint">{t.inspFieldsHint}</span>
          </span>
          <textarea
            className="input plan-textarea mono"
            rows={5}
            value={fieldsDraft}
            onChange={(e) => {
              setFieldsDraft(e.target.value);
              const fields = parseFields(e.target.value);
              onPatch({ fields: fields.length > 0 ? fields : undefined });
            }}
          />
        </label>
      )}
      <button className="btn-ghost plan-delete" onClick={onDelete}>
        <Trash2 size={14} />
        {t.deleteNode}
      </button>
    </aside>
  );
}
