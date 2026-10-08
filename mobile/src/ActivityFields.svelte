<script lang="ts">
  import {
    type ActivityAttributeField,
    parseActivityValues,
    type ActivityValues,
    getInitialActivityValues,
    hasActivityFormChanges,
  } from "../../src/shared/activity";

  let {
    title,
    fields,
    initialValues = {},
    options = {},
    optionsLoading = false,
    busy,
    onSave,
    onCancel,
  } = $props<{
    title: string;
    fields: ActivityAttributeField[];
    initialValues?: ActivityValues;
    options?: Record<string, string[]>;
    optionsLoading?: boolean;
    busy: boolean;
    onSave: (values: ActivityValues) => Promise<void>;
    onCancel: () => void;
  }>();
  function snapshotValues() {
    return getInitialActivityValues(fields, initialValues);
  }
  const initial = snapshotValues();
  let values = $state<Record<string, string>>({ ...initial });
  let error = $state("");

  async function save() {
    error = "";
    try {
      await onSave(parseActivityValues(fields, values));
    } catch (caught) {
      error =
        caught instanceof Error
          ? caught.message
          : "Unable to save activity details";
    }
  }

  function cancel() {
    const changed = hasActivityFormChanges(initial, values);
    if (
      changed &&
      !window.confirm(
        "Discard changes? Your unsaved activity details will be lost.",
      )
    )
      return;
    onCancel();
  }
</script>

<section class="empty-card">
  <h2>{title}</h2>
  {#if optionsLoading}<p role="status">Loading suggestions…</p>{/if}
  <form
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
    novalidate
  >
    {#each fields as field}
      <label>
        {field.label}{#if field.required}<span aria-hidden="true"> *</span>{/if}
        {#if field.type === "textarea"}
          <textarea
            bind:value={values[field.key]}
            name={field.key}
            rows="6"
            required={field.required}
            disabled={busy}
          ></textarea>
        {:else if field.type === "number"}
          <input
            type="number"
            name={field.key}
            value={values[field.key]}
            oninput={(event) => (values[field.key] = event.currentTarget.value)}
            min={field.min}
            max={field.max}
            step="1"
            required={field.required}
            disabled={busy}
          />
        {:else}
          <input
            bind:value={values[field.key]}
            name={field.key}
            required={field.required}
            autocomplete="off"
            list={options[field.key]?.length
              ? `options-${field.key}`
              : undefined}
            disabled={busy}
          />
          {#if options[field.key]?.length}
            <datalist id={`options-${field.key}`}>
              {#each options[field.key] as option}<option value={option}
                ></option>{/each}
            </datalist>
          {/if}
        {/if}
      </label>
    {/each}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="form-actions">
      <button class="secondary" type="button" onclick={cancel} disabled={busy}
        >Cancel</button
      >
      <button class="primary" type="submit" disabled={busy}>Save</button>
    </div>
  </form>
</section>
