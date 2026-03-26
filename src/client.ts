import { DEFAULT_TYPES_KEY } from "./encode.ts";

function updateFormTypes(
  form: HTMLFormElement,
  name: string,
  typeId: string,
  typesKey: string,
): void {
  let input = form.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${CSS.escape(typesKey)}"]`,
  );

  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.name = typesKey;
    form.appendChild(input);
  }

  const types: Record<string, string> = input.value ? JSON.parse(input.value) : {};
  types[name] = typeId;
  input.value = JSON.stringify(types);
}

export function onChange(typeId: string, options?: { typesKey?: string }): (event: Event) => void {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;

  return (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.name || !input.form) return;

    input.dataset.sfType = typeId;
    updateFormTypes(input.form, input.name, typeId, typesKey);
  };
}

export const onDateChange: (event: Event) => void = onChange("Date");
export const onNumberChange: (event: Event) => void = onChange("number");
export const onBigIntChange: (event: Event) => void = onChange("bigint");
export const onURLChange: (event: Event) => void = onChange("URL");

export const onBooleanChange: (event: Event) => void = (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.name || !input.form) return;

  input.dataset.sfType = "boolean";
  input.value = String(input.checked);
  updateFormTypes(input.form, input.name, "boolean", DEFAULT_TYPES_KEY);
};
