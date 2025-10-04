/**
 * Shared keyboard command schema for outline views. Centralising bindings keeps shortcuts
 * platform-agnostic and guarantees that new adapters (web, desktop, mobile) resolve the same
 * intent without duplicating modifier checks.
 */

export type OutlineCommandId =
  | "outline.focusNextRow"
  | "outline.focusPreviousRow"
  | "outline.indentSelection"
  | "outline.outdentSelection"
  | "outline.insertSiblingBelow"
  | "outline.insertChild"
  | "outline.toggleTodoDone"
  | "outline.collapseOrFocusParent"
  | "outline.expandOrFocusChild"
  | "outline.deleteSelection";

export type OutlineCommandCategory =
  | "navigation"
  | "editing"
  | "structure"
  | "destructive";

type OutlineKeyModifier = "alt" | "ctrl" | "meta" | "shift";

type OutlineCommandModifierState = Record<OutlineKeyModifier, boolean>;

export interface OutlineCommandBinding {
  readonly key: string;
  readonly modifiers: OutlineCommandModifierState;
  readonly allowRepeat: boolean;
}

export interface OutlineCommandDescriptor {
  readonly id: OutlineCommandId;
  readonly description: string;
  readonly category: OutlineCommandCategory;
  readonly bindings: readonly OutlineCommandBinding[];
}

export interface OutlineCommandMatch {
  readonly descriptor: OutlineCommandDescriptor;
  readonly binding: OutlineCommandBinding;
}

export interface OutlineKeyStrokeInit {
  readonly key: string;
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
  readonly repeat?: boolean;
}

export interface OutlineKeyStroke {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly repeat: boolean;
}

const DEFAULT_MODIFIER_STATE: OutlineCommandModifierState = {
  alt: false,
  ctrl: false,
  meta: false,
  shift: false
};

const createBinding = (
  key: string,
  modifiers: Partial<OutlineCommandModifierState>,
  options: { readonly allowRepeat?: boolean } = {}
): OutlineCommandBinding => ({
  key,
  modifiers: { ...DEFAULT_MODIFIER_STATE, ...modifiers },
  allowRepeat: options.allowRepeat ?? false
});

const normaliseStroke = (stroke: OutlineKeyStrokeInit): OutlineKeyStroke => ({
  key: stroke.key,
  altKey: Boolean(stroke.altKey),
  ctrlKey: Boolean(stroke.ctrlKey),
  metaKey: Boolean(stroke.metaKey),
  shiftKey: Boolean(stroke.shiftKey),
  repeat: Boolean(stroke.repeat)
});

const bindingMatchesStroke = (binding: OutlineCommandBinding, stroke: OutlineKeyStroke): boolean => {
  if (stroke.key !== binding.key) {
    return false;
  }
  if (stroke.repeat && !binding.allowRepeat) {
    return false;
  }
  const { modifiers } = binding;
  return (
    modifiers.alt === stroke.altKey
    && modifiers.ctrl === stroke.ctrlKey
    && modifiers.meta === stroke.metaKey
    && modifiers.shift === stroke.shiftKey
  );
};

const bindingPriority = (binding: OutlineCommandBinding): number => {
  let priority = 0;
  if (binding.modifiers.shift) {
    priority += 4;
  }
  if (binding.modifiers.meta) {
    priority += 3;
  }
  if (binding.modifiers.ctrl) {
    priority += 2;
  }
  if (binding.modifiers.alt) {
    priority += 1;
  }
  return priority;
};

export const outlineCommandDescriptors: readonly OutlineCommandDescriptor[] = [
  {
    id: "outline.focusNextRow",
    category: "navigation",
    description: "Focus the next visible outline row",
    bindings: [
      createBinding(
        "ArrowDown",
        { alt: false, ctrl: false, meta: false, shift: false },
        { allowRepeat: true }
      )
    ]
  },
  {
    id: "outline.focusPreviousRow",
    category: "navigation",
    description: "Focus the previous visible outline row",
    bindings: [
      createBinding(
        "ArrowUp",
        { alt: false, ctrl: false, meta: false, shift: false },
        { allowRepeat: true }
      )
    ]
  },
  {
    id: "outline.expandOrFocusChild",
    category: "structure",
    description: "Expand the current row or focus its first child",
    bindings: [
      createBinding(
        "ArrowRight",
        { alt: false, ctrl: false, meta: false, shift: false },
        { allowRepeat: true }
      )
    ]
  },
  {
    id: "outline.collapseOrFocusParent",
    category: "structure",
    description: "Collapse the current row or focus its parent",
    bindings: [
      createBinding(
        "ArrowLeft",
        { alt: false, ctrl: false, meta: false, shift: false },
        { allowRepeat: true }
      )
    ]
  },
  {
    id: "outline.toggleTodoDone",
    category: "editing",
    description: "Toggle the todo state for the selection",
    bindings: [
      createBinding("Enter", { alt: false, ctrl: true, meta: false, shift: false })
    ]
  },
  {
    id: "outline.insertSiblingBelow",
    category: "editing",
    description: "Insert a sibling row below the current selection",
    bindings: [
      createBinding("Enter", { alt: false, ctrl: false, meta: false, shift: false })
    ]
  },
  {
    id: "outline.insertChild",
    category: "editing",
    description: "Insert a child row under the current selection",
    bindings: [
      createBinding("Enter", { alt: false, ctrl: false, meta: false, shift: true })
    ]
  },
  {
    id: "outline.indentSelection",
    category: "structure",
    description: "Indent the current selection",
    bindings: [
      createBinding("Tab", { alt: false, ctrl: false, meta: false, shift: false }, { allowRepeat: true })
    ]
  },
  {
    id: "outline.outdentSelection",
    category: "structure",
    description: "Outdent the current selection",
    bindings: [
      createBinding("Tab", { alt: false, ctrl: false, meta: false, shift: true }, { allowRepeat: true })
    ]
  },
  {
    id: "outline.deleteSelection",
    category: "destructive",
    description: "Delete the selected rows from the outline",
    bindings: [
      createBinding("Backspace", { alt: false, ctrl: true, meta: false, shift: true }),
      createBinding("Backspace", { alt: false, ctrl: false, meta: true, shift: true })
    ]
  }
] as const satisfies readonly OutlineCommandDescriptor[];

export const matchOutlineCommand = (
  strokeInit: OutlineKeyStrokeInit,
  descriptors: readonly OutlineCommandDescriptor[] = outlineCommandDescriptors
): OutlineCommandMatch | null => {
  const stroke = normaliseStroke(strokeInit);
  const matches: Array<{
    descriptor: OutlineCommandDescriptor;
    binding: OutlineCommandBinding;
    descriptorIndex: number;
    priority: number;
  }> = [];

  descriptors.forEach((descriptor, descriptorIndex) => {
    descriptor.bindings.forEach((binding) => {
      if (!bindingMatchesStroke(binding, stroke)) {
        return;
      }
      matches.push({
        descriptor,
        binding,
        descriptorIndex,
        priority: bindingPriority(binding)
      });
    });
  });

  if (matches.length === 0) {
    return null;
  }

  matches.sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority;
    }
    return left.descriptorIndex - right.descriptorIndex;
  });

  const [best] = matches;
  return {
    descriptor: best.descriptor,
    binding: best.binding
  } satisfies OutlineCommandMatch;
};
