import { DEFAULT_TYPES_KEY } from "./encode.ts";
import { validateKnownTypeId } from "./metadata.ts";
import { createTypeRegistry, type TypeHandlerList } from "./types.ts";

export interface ChangeHandlerOptions {
  readonly typesKey?: string;
  readonly typeHandlers?: TypeHandlerList;
}

export interface ChangeHandlers {
  readonly onDateChange: (event: Event) => void;
  readonly onNumberChange: (event: Event) => void;
  readonly onBooleanChange: (event: Event) => void;
  readonly onBigIntChange: (event: Event) => void;
  readonly onURLChange: (event: Event) => void;
}

function parseFormTypes(value: string): Record<string, string> {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
      const newInput = document.createElement("input");
      newInput.type = "hidden";
      newInput.name = typesKey;
      form.appendChild(newInput);
      return newInput;
    })();

  const types = parseFormTypes(input.value);
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
  const registry = createTypeRegistry(options?.typeHandlers);

  return (event: Event) => {
    const input = event.target as HTMLInputElement;
    if (!input.name || !input.form) return;

    validateKnownTypeId(input.name, typeId, registry);
    input.dataset.sfType = typeId;
    updateFormTypes(input.form, input.name, typeId, typesKey);
  };
}

export function createChangeHandlers(options?: ChangeHandlerOptions): ChangeHandlers {
  const typesKey = options?.typesKey ?? DEFAULT_TYPES_KEY;

  return {
    onDateChange: onChange("Date", options),
    onNumberChange: onChange("number", options),
    onBooleanChange: createBooleanChangeHandler(typesKey),
    onBigIntChange: onChange("bigint", options),
    onURLChange: onChange("URL", options),
  };
}

const defaultHandlers = createChangeHandlers();

export const onDateChange: (event: Event) => void = defaultHandlers.onDateChange;
export const onNumberChange: (event: Event) => void = defaultHandlers.onNumberChange;
export const onBooleanChange: (event: Event) => void = defaultHandlers.onBooleanChange;
export const onBigIntChange: (event: Event) => void = defaultHandlers.onBigIntChange;
export const onURLChange: (event: Event) => void = defaultHandlers.onURLChange;
