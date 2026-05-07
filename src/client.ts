import { DEFAULT_TYPES_KEY } from "./encode.ts";

export interface ChangeHandlerOptions {
  readonly typesKey?: string;
}

export interface ChangeHandlers {
  readonly onDateChange: (event: Event) => void;
  readonly onNumberChange: (event: Event) => void;
  readonly onBooleanChange: (event: Event) => void;
  readonly onBigIntChange: (event: Event) => void;
  readonly onURLChange: (event: Event) => void;
}

function updateFormTypes(
  form: HTMLFormElement,
  name: string,
  typeId: string,
  typesKey: string,
): void {
  const existingInput = form.querySelector<HTMLInputElement>(
    `input[type="hidden"][name="${CSS.escape(typesKey)}"]`,
  );

  const input =
    existingInput ??
    (() => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = typesKey;
      form.appendChild(input);
      return input;
    })();

  const types: Record<string, string> = input.value ? JSON.parse(input.value) : {};
  types[name] = typeId;
  input.value = JSON.stringify(types);
}

function createBooleanChangeHandler(typesKey: string): (event: Event) => void {
  return (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.name || !input.form) return;

    input.dataset.sfType = "boolean";
    input.value = String(input.checked);
    updateFormTypes(input.form, input.name, "boolean", typesKey);
  };
}

export function onChange(typeId: string, options?: ChangeHandlerOptions): (event: Event) => void {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;

  return (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.name || !input.form) return;

    input.dataset.sfType = typeId;
    updateFormTypes(input.form, input.name, typeId, typesKey);
  };
}

export function createChangeHandlers(options?: ChangeHandlerOptions): ChangeHandlers {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;

  return {
    onDateChange: onChange("Date", { typesKey }),
    onNumberChange: onChange("number", { typesKey }),
    onBooleanChange: createBooleanChangeHandler(typesKey),
    onBigIntChange: onChange("bigint", { typesKey }),
    onURLChange: onChange("URL", { typesKey }),
  };
}

const defaultHandlers = createChangeHandlers();

export const onDateChange: (event: Event) => void = defaultHandlers.onDateChange;
export const onNumberChange: (event: Event) => void = defaultHandlers.onNumberChange;
export const onBooleanChange: (event: Event) => void = defaultHandlers.onBooleanChange;
export const onBigIntChange: (event: Event) => void = defaultHandlers.onBigIntChange;
export const onURLChange: (event: Event) => void = defaultHandlers.onURLChange;
