import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { TINTS } from "../../lib/tints";
import { useStrings } from "../../lib/i18n";
import {
  API_AUTHS,
  DATA_SENSITIVITIES,
  DEPLOY_ENVS,
  DUE_KINDS,
  EFFORT_KINDS,
  HTTP_METHODS,
  LINK_KINDS,
  LIST_KINDS,
  MODEL_KINDS,
  NOTE_FLAVORS,
  OWNER_KINDS,
  PLAN_PRIORITIES,
  PRIORITY_KINDS,
  SPEC_KINDS,
  STATUS_KINDS,
  TEST_TYPES,
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

/** Segmented single-choice with click-again-to-clear, shared by the kind selects. */
function SegChoice<T extends string>({
  label,
  value,
  options,
  names,
  onPick,
}: {
  label: string;
  value: T | undefined;
  options: readonly T[];
  names: Record<T, string>;
  onPick: (value: T | undefined) => void;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="seg">
        {options.map((option) => (
          <button
            key={option}
            className={value === option ? "on" : ""}
            onClick={() => onPick(value === option ? undefined : option)}
          >
            {names[option]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Right panel for the selected block. Field order tells the story of the block:
 *  what it is (label, description, kind-specific core), then the work plumbing
 *  (status, effort, priority, people, dates), then bookkeeping (phase, link, color).
 *  Which fields exist at all comes from the per-kind matrix in store/plans.ts.
 *
 *  Text lists (acceptance, fields) keep a local draft for DISPLAY (so mid-typing blank
 *  lines are not filtered away) but commit the parsed value on every change - nothing
 *  is lost if the panel unmounts mid-edit. */
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

  const kind = node.kind;
  const has = (kinds: readonly string[]) => kinds.includes(kind);
  const hasOwner = has(OWNER_KINDS);
  const hasDue = has(DUE_KINDS);

  const Icon = KIND_META[kind].icon;
  return (
    <aside className="plan-inspector" aria-label={t.inspectorTitle}>
      <div className="plan-inspector-kind">
        <Icon size={14} />
        <span>{t.planKind[kind]}</span>
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

      {/* ---- what this block IS (kind-specific core) ---- */}
      {kind === "note" && (
        <SegChoice
          label={t.inspFlavor}
          value={node.flavor}
          options={NOTE_FLAVORS}
          names={{
            idea: t.flavorIdea,
            risk: t.flavorRisk,
            question: t.flavorQuestion,
            constraint: t.flavorConstraint,
          }}
          onPick={(flavor) => onPatch({ flavor })}
        />
      )}
      {kind === "api" && (
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
      {has(PATH_KINDS) && (
        <label className="field">
          <span className="field-label">{kind === "screen" ? t.inspRoute : t.inspPath}</span>
          <input
            className="input mono"
            placeholder={kind === "screen" ? "/login" : "/api/things"}
            maxLength={MAX_PATH}
            value={node.path ?? ""}
            onChange={(e) => onPatch({ path: e.target.value || undefined })}
          />
        </label>
      )}
      {kind === "api" && (
        <SegChoice
          label={t.inspAuth}
          value={node.auth}
          options={API_AUTHS}
          names={{ public: t.authPublic, user: t.authUser, admin: t.authAdmin }}
          onPick={(auth) => onPatch({ auth })}
        />
      )}
      {has(MODEL_KINDS) && (
        <label className="field">
          <span className="field-label">{t.inspModel}</span>
          <input
            className="input mono"
            placeholder="claude-sonnet-5"
            maxLength={60}
            value={node.model ?? ""}
            onChange={(e) => onPatch({ model: e.target.value || undefined })}
          />
        </label>
      )}
      {has(SPEC_KINDS) && (
        <label className="field">
          <span className="field-label">
            {kind === "service"
              ? t.specTech
              : kind === "ai"
                ? t.specContract
                : kind === "agent"
                  ? t.specExit
                  : kind === "integration"
                    ? t.specProvider
                    : kind === "data"
                      ? t.specKey
                      : t.specRollback}
          </span>
          <input
            className="input bidi-auto"
            dir="auto"
            maxLength={200}
            value={node.spec ?? ""}
            onChange={(e) => onPatch({ spec: e.target.value || undefined })}
          />
        </label>
      )}
      {kind === "data" && (
        <SegChoice
          label={t.inspSensitivity}
          value={node.sensitivity}
          options={DATA_SENSITIVITIES}
          names={{ none: t.sensNone, personal: t.sensPersonal, sensitive: t.sensSensitive }}
          onPick={(sensitivity) => onPatch({ sensitivity })}
        />
      )}
      {kind === "test" && (
        <SegChoice
          label={t.inspTestType}
          value={node.testType}
          options={TEST_TYPES}
          names={{ unit: t.ttUnit, integration: t.ttIntegration, e2e: t.ttE2e, manual: t.ttManual }}
          onPick={(testType) => onPatch({ testType })}
        />
      )}
      {kind === "deploy" && (
        <SegChoice
          label={t.inspEnv}
          value={node.env}
          options={DEPLOY_ENVS}
          names={{ dev: t.envDev, staging: t.envStaging, prod: t.envProd }}
          onPick={(env) => onPatch({ env })}
        />
      )}
      {has(LIST_KINDS) && (
        <label className="field">
          <span className="field-label">
            {kind === "decision"
              ? t.inspOptions
              : kind === "test"
                ? t.inspChecks
                : kind === "agent"
                  ? t.inspTools
                  : kind === "phase"
                    ? t.inspExitCriteria
                    : kind === "screen"
                      ? t.inspScreenParts
                      : kind === "gate"
                        ? t.inspGateCriteria
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
      {kind === "decision" && (node.acceptance?.length ?? 0) > 0 && (
        <label className="field">
          <span className="field-label">{t.inspChosen}</span>
          <select
            className="select"
            value={node.chosen ?? ""}
            onChange={(e) => onPatch({ chosen: e.target.value || undefined })}
          >
            <option value="">{t.chosenNone}</option>
            {(node.acceptance ?? []).map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "data" && (
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

      {/* ---- work plumbing (only on kinds that carry it) ---- */}
      {has(STATUS_KINDS) && (
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
      )}
      {has(EFFORT_KINDS) && (
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
      {has(PRIORITY_KINDS) && (
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
      {(hasOwner || hasDue) && (
        <div className={hasOwner && hasDue ? "plan-two" : undefined}>
          {hasOwner && (
            <label className="field">
              <span className="field-label">{kind === "gate" ? t.inspApprover : t.inspOwner}</span>
              <input
                className="input bidi-auto"
                dir="auto"
                maxLength={80}
                value={node.owner ?? ""}
                onChange={(e) => onPatch({ owner: e.target.value || undefined })}
              />
            </label>
          )}
          {hasDue && (
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
          )}
        </div>
      )}

      {/* ---- bookkeeping ---- */}
      {kind !== "phase" && (
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
      {has(LINK_KINDS) && (
        <label className="field">
          <span className="field-label">
            {kind === "screen" ? t.inspDesignLink : t.inspDocsLink}
          </span>
          <input
            className="input mono"
            placeholder="https://..."
            maxLength={300}
            value={node.link ?? ""}
            onChange={(e) => onPatch({ link: e.target.value || undefined })}
          />
        </label>
      )}
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
      <button className="btn-ghost plan-delete" onClick={onDelete}>
        <Trash2 size={14} />
        {t.deleteNode}
      </button>
    </aside>
  );
}
