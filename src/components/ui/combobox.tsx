"use client"

/**
 * The editable combobox with a list popup (WAI-ARIA APG), on React Aria
 * Components: the keyboard model, aria-expanded / aria-activedescendant,
 * outside-press and focus handling come from the library, the look from our
 * tokens. React Aria ships no CSS, so every state below styles its `data-*`
 * attribute. Parts follow the other primitives here: compose them, don't wrap.
 *
 *   <Combobox items={sections} aria-label="…" …>
 *     <ComboboxInput />
 *     <ComboboxPopover triggerRef={anchor}>
 *       <ComboboxList>{(section) => <ComboboxSection …>{(item) => <ComboboxItem …/>}</ComboboxSection>}</ComboboxList>
 *     </ComboboxPopover>
 *   </Combobox>
 */

import * as React from "react"
import {
  Collection,
  ComboBox,
  ComboBoxStateContext,
  Header,
  Input as AriaInput,
  ListBox,
  ListBoxItem,
  ListBoxSection,
  Popover,
  PopoverContext,
  type ComboBoxProps,
  type ComboBoxState,
  type InputProps,
  type ListBoxItemProps,
  type ListBoxProps,
  type ListBoxSectionProps,
  type PopoverProps,
} from "react-aria-components"

import { INPUT_CLASSES } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type ComboboxProps<T extends object> = Omit<ComboBoxProps<T>, "children" | "allowsCustomValue"> & {
  children: React.ReactNode
  /** Free text is a valid value (default true): the field is a search box, not a picker. */
  allowsCustomValue?: boolean
  /** Receives the live state, for the few things only it can do from outside (close the list). */
  stateRef?: React.RefObject<ComboBoxState<T> | null>
}

/** Hands the ComboBox state out through `stateRef`; renders nothing. */
function ComboboxStateRef<T extends object>({ stateRef }: { stateRef: React.RefObject<ComboBoxState<T> | null> }) {
  const state = React.useContext(ComboBoxStateContext) as ComboBoxState<T> | null
  React.useEffect(() => {
    stateRef.current = state
  })
  return null
}

function Combobox<T extends object>({
  stateRef,
  allowsCustomValue = true,
  className,
  children,
  ...props
}: ComboboxProps<T> & React.RefAttributes<HTMLDivElement>) {
  return (
    <ComboBox
      data-slot="combobox"
      allowsCustomValue={allowsCustomValue}
      className={cn("relative group", className as string | undefined)}
      {...props}
    >
      {stateRef && <ComboboxStateRef stateRef={stateRef} />}
      {children}
    </ComboBox>
  )
}

function ComboboxInput({ className, ...props }: Omit<InputProps, "className"> & { className?: string } & React.RefAttributes<HTMLInputElement>) {
  return <AriaInput data-slot="combobox-input" className={cn(INPUT_CLASSES, className)} {...props} />
}

/** The floating list. Portaled by React Aria, so clipped ancestors cannot hide it; as wide as its trigger. */
function ComboboxPopover({ className, ...props }: Omit<PopoverProps, "className"> & { className?: string }) {
  return (
    <Popover
      data-slot="combobox-popover"
      placement="bottom start"
      offset={8}
      className={cn(
        "z-[var(--z-dropdown)] w-(--trigger-width) overflow-hidden rounded-ctl border border-border-strong bg-popover shadow-[var(--shadow-overlay)] animate-in fade-in slide-in-from-top-1",
        className,
      )}
      {...props}
    />
  )
}

/**
 * The compact-width stand-in for the popover: a plain wrapper that takes the
 * popover's place as the library's "list surface" while `active`. React Aria
 * hides every element outside the input and that surface from assistive tech
 * while the list is open, so the wrapper has to be the one it is told about,
 * or the rows (and a back button) would be hidden. Inactive, it renders the
 * same element with no ref, so the Popover owns the slot again.
 */
function ComboboxLayer({ active, ...props }: React.ComponentProps<"div"> & { active: boolean }) {
  const surface = React.useContext(PopoverContext) as { ref?: React.Ref<HTMLDivElement> } | null
  return <div data-slot="combobox-layer" ref={active ? surface?.ref : undefined} {...props} />
}

function ComboboxList<T extends object>({ className, ...props }: Omit<ListBoxProps<T>, "className"> & { className?: string }) {
  return <ListBox data-slot="combobox-list" className={cn("max-h-[300px] overflow-y-auto py-2 outline-none", className)} {...props} />
}

function ComboboxSection<T extends object>({
  heading,
  items,
  children,
  ...props
}: Omit<ListBoxSectionProps<T>, "children" | "items"> & {
  /** Visible group label; without one the group is still named for assistive tech via `aria-label`. */
  heading?: string
  items: Iterable<T>
  children: (item: T) => React.ReactElement
}) {
  return (
    <ListBoxSection {...props}>
      {heading && (
        <Header className="whitespace-nowrap px-4 pt-2.5 pb-1 text-xs font-semibold text-muted-foreground">{heading}</Header>
      )}
      <Collection items={items}>{children}</Collection>
    </ListBoxSection>
  )
}

function ComboboxItem({ className, ...props }: Omit<ListBoxItemProps, "className"> & { className?: string }) {
  return (
    <ListBoxItem
      data-slot="combobox-item"
      className={cn(
        "flex min-h-11 cursor-pointer items-center gap-3 px-4 py-3 text-sm text-muted-foreground outline-none transition-colors",
        "data-[hovered]:bg-surface-hover data-[hovered]:text-foreground data-[focused]:bg-surface-3 data-[focused]:text-foreground",
        className,
      )}
      {...props}
    />
  )
}

export { Combobox, ComboboxInput, ComboboxItem, ComboboxLayer, ComboboxList, ComboboxPopover, ComboboxSection }
